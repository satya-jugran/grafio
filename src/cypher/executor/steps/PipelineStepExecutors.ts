/**
 * Pipeline step executor for the Cypher execution layer.
 *
 * Executes {@link FilterStep}, {@link ProjectStep}, {@link SortStep},
 * {@link LimitStep}, and {@link UnwindStep} against {@link SlotRow} buffers
 * using pre-compiled CSP-safe closures from {@link CompiledPlanMeta}.
 *
 * @module cypher/executor/steps/PipelineStepExecutors
 */

import type { Expression } from '../../ast/AstNode';
import type { ISyncGraphKernel } from '../../../storage/IStorageProvider';
import {
  FilterStep,
  ProjectStep,
  SortStep,
  LimitStep,
  UnwindStep,
} from '../../plan/QueryPlan';
import {
  UNBOUND,
  type CompiledPlanMeta,
} from '../../plan/CompiledPlanMeta';
import { compileExpression, type CompiledExprFn } from '../ClosureCompiler';
import {
  Row,
  ExpressionEvaluator,
  serializeCypherKey,
  serializeSlotRowKey,
} from '../ExpressionEvaluator';

/**
 * Executes pure pipeline (row-transformation) steps.
 */
export class PipelineStepExecutor {
  private readonly _evaluator: ExpressionEvaluator;

  constructor(evaluator: ExpressionEvaluator) {
    this._evaluator = evaluator;
  }

  private _getCompiled(expr: Expression, meta: CompiledPlanMeta): CompiledExprFn {
    let fn = meta.compiledExprs.get(expr);
    if (!fn) {
      fn = compileExpression(expr, meta.slotTable);
      meta.compiledExprs.set(expr, fn);
    }
    return fn;
  }

  // ── FilterStep ─────────────────────────────────────────────────

  async executeFilter(
    step: FilterStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
  ): Promise<Row[]> {
    return this.executeFilterSync(step, rows, params, meta);
  }

  executeFilterSync(
    step: FilterStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    if (rows.length === 0) return [];
    const fn = this._getCompiled(step.predicate, meta);
    const out: Row[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (Boolean(fn(row, params, kernel))) {
        out.push(row);
      }
    }
    return out;
  }

  // ── ProjectStep ────────────────────────────────────────────────

  async executeProject(
    step: ProjectStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
  ): Promise<Row[]> {
    return this.executeProjectSync(step, rows, params, meta);
  }

  executeProjectSync(
    step: ProjectStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    if (rows.length === 0) return [];
    const { colFns, colSlots } = this._prepareProjectCols(step, meta);
    const projected = new Array<Row>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      projected[i] = this._projectOneRow(rows[i], step.star === true, colFns, colSlots, params, meta, kernel);
    }
    return step.distinct ? this._dedupeProjected(projected, step, colSlots, meta) : projected;
  }

  private _prepareProjectCols(
    step: ProjectStep,
    meta: CompiledPlanMeta,
  ): { colFns: CompiledExprFn[]; colSlots: number[] } {
    const len = step.columns.length;
    const colFns = new Array<CompiledExprFn>(len);
    const colSlots = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      colFns[i] = this._getCompiled(step.columns[i].expression, meta);
      colSlots[i] = meta.slotTable.getOrAdd(step.columns[i].alias);
    }
    return { colFns, colSlots };
  }

  private _projectOneRow(
    row: Row,
    preserveAll: boolean,
    colFns: CompiledExprFn[],
    colSlots: number[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row {
    const newRow = preserveAll ? row.slice() : meta.slotTable.createEmptyRow();
    // Evaluate all projections against original `row` before writing `newRow` so alias shadowing is safe
    for (let c = 0; c < colFns.length; c++) {
      newRow[colSlots[c]] = colFns[c](row, params, kernel);
    }
    return newRow;
  }

  private _dedupeProjected(
    projected: Row[],
    step: ProjectStep,
    colSlots: number[],
    meta: CompiledPlanMeta,
  ): Row[] {
    const seen = new Set<string>();
    const deduped: Row[] = [];

    if (step.star) {
      const slotToVar = meta.slotTable.slotToVar;
      const sortedSlots = slotToVar
        .map((name, slot) => ({ name, slot }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((x) => x.slot);

      for (let i = 0; i < projected.length; i++) {
        const row = projected[i];
        const key = serializeSlotRowKey(row, sortedSlots);
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(row);
        }
      }
      return deduped;
    }

    for (let i = 0; i < projected.length; i++) {
      const row = projected[i];
      let key = '';
      for (let c = 0; c < colSlots.length; c++) {
        const sk = serializeCypherKey(row[colSlots[c]]);
        const part = `${c}:${sk.length}:${sk}`;
        key = c === 0 ? part : `${key}\x00${part}`;
      }
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(row);
      }
    }
    return deduped;
  }

  // ── SortStep ───────────────────────────────────────────────────

  executeSort(
    step: SortStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    if (rows.length <= 1) return rows.slice();
    const specCount = step.items.length;
    if (specCount === 0) return rows.slice();

    const itemFns = new Array<CompiledExprFn>(specCount);
    const dirs = new Array<'ASC' | 'DESC'>(specCount);
    for (let s = 0; s < specCount; s++) {
      itemFns[s] = this._getCompiled(step.items[s].expression, meta);
      dirs[s] = step.items[s].direction;
    }

    // Schwartzian pre-evaluation avoids O(N log N) expression re-evaluations
    const keysByRow = new Array<unknown[]>(rows.length);
    const indices = new Array<number>(rows.length);
    for (let r = 0; r < rows.length; r++) {
      indices[r] = r;
      const row = rows[r];
      const vals = new Array<unknown>(specCount);
      for (let s = 0; s < specCount; s++) {
        vals[s] = itemFns[s](row, params, kernel);
      }
      keysByRow[r] = vals;
    }

    indices.sort((ia, ib) => {
      const ka = keysByRow[ia];
      const kb = keysByRow[ib];
      for (let s = 0; s < specCount; s++) {
        const cmp = this._evaluator.compare(ka[s], kb[s]);
        if (cmp !== 0) return dirs[s] === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });

    const sorted = new Array<Row>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      sorted[i] = rows[indices[i]];
    }
    return sorted;
  }

  executeSortSync(
    step: SortStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    return this.executeSort(step, rows, params, meta, kernel);
  }

  // ── LimitStep ──────────────────────────────────────────────────

  executeLimit(
    step: LimitStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    if (rows.length === 0) return [];

    const start = step.skipExpr
      ? Math.max(0, Number(this._getCompiled(step.skipExpr, meta)(rows[0], params, kernel)))
      : 0;
    const limitVal = step.limitExpr
      ? Number(this._getCompiled(step.limitExpr, meta)(rows[0], params, kernel))
      : Infinity;
    const end = limitVal === Infinity ? undefined : start + limitVal;
    return rows.slice(start, end);
  }

  executeLimitSync(
    step: LimitStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    return this.executeLimit(step, rows, params, meta, kernel);
  }

  // ── UnwindStep ─────────────────────────────────────────────────

  async executeUnwind(
    step: UnwindStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
  ): Promise<Row[]> {
    return this.executeUnwindSync(step, rows, params, meta);
  }

  executeUnwindSync(
    step: UnwindStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    if (rows.length === 0) return [];
    const fn = this._getCompiled(step.expression, meta);
    const varSlot = meta.slotTable.getOrAdd(step.variable);
    const result: Row[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const val = fn(row, params, kernel);
      if (val === null || val === undefined) {
        continue;
      } else if (Array.isArray(val)) {
        for (let j = 0; j < val.length; j++) {
          const newRow = row.slice();
          newRow[varSlot] = val[j];
          result.push(newRow);
        }
      } else {
        const newRow = row.slice();
        newRow[varSlot] = val;
        result.push(newRow);
      }
    }
    return result;
  }
}

/**
 * Serialize a single value into a stable, collision-free string key
 * for DISTINCT deduplication.
 */
export function getDistinctKey(value: unknown): string {
  return serializeCypherKey(value);
}
