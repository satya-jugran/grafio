/**
 * Pipeline step executor for the Cypher execution layer.
 *
 * Executes {@link FilterStep}, {@link ProjectStep}, {@link SortStep},
 * and {@link LimitStep} as pure row-buffer transformations.
 *
 * @module cypher/executor/steps/PipelineStepExecutors
 */

import {
  FilterStep,
  ProjectStep,
  SortStep,
  LimitStep,
} from '../../plan/QueryPlan';
import { Row, ExpressionEvaluator } from '../ExpressionEvaluator';
import { parallelMap } from '../parallelMap';

/**
 * Executes pure pipeline (row-transformation) steps.
 *
 * These steps do not touch the {@link Graph} — they only transform
 * the row buffer using the expression evaluator.
 */
export class PipelineStepExecutor {
  private readonly _evaluator: ExpressionEvaluator;
  private readonly _maxDegreeOfParallelism: number;

  constructor(
    evaluator: ExpressionEvaluator,
    maxDegreeOfParallelism: number = 1,
  ) {
    this._evaluator = evaluator;
    this._maxDegreeOfParallelism = Math.max(1, maxDegreeOfParallelism);
  }

  // ── FilterStep ─────────────────────────────────────────────────

  async executeFilter(
    step: FilterStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Promise<Row[]> {
    return parallelMap(rows, (chunk) => {
      const filtered = chunk.filter((row) => {
        const result = this._evaluator.evaluate(step.predicate, row, params);
        return Boolean(result);
      });
      return Promise.resolve(filtered);
    }, this._maxDegreeOfParallelism);
  }

  // ── ProjectStep ────────────────────────────────────────────────

  async executeProject(
    step: ProjectStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Promise<Row[]> {
    const projected = await parallelMap(rows, (chunk) => {
      const mapped = chunk.map((row) => {
        const newRow = new Map<string, unknown>();
        if (step.star) {
          for (const [k, v] of row.entries()) {
            newRow.set(k, v);
          }
        }
        for (const col of step.columns) {
          newRow.set(col.alias, this._evaluator.evaluate(col.expression, row, params));
        }
        return newRow;
      });
      return Promise.resolve(mapped);
    }, this._maxDegreeOfParallelism);

    if (!step.distinct) return projected;

    const seen = new Set<string>();
    const deduped: Row[] = [];

    for (const row of projected) {
      const keyParts: string[] = [];
      const keys = step.star ? Array.from(row.keys()).sort() : step.columns.map(c => c.alias);
      for (const colName of keys) {
        keyParts.push(getDistinctKey(row.get(colName)));
      }
      const key = keyParts.join('\x00');

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
  ): Row[] {
    return [...rows].sort((a, b) => {
      for (const spec of step.items) {
        const va = this._evaluator.evaluate(spec.expression, a, params);
        const vb = this._evaluator.evaluate(spec.expression, b, params);
        const cmp = this._evaluator.compare(va, vb);
        if (cmp !== 0) return spec.direction === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });
  }

  // ── LimitStep ──────────────────────────────────────────────────

  executeLimit(
    step: LimitStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    if (rows.length === 0) return [];

    const start = step.skipExpr
      ? Math.max(0, Number(this._evaluator.evaluate(step.skipExpr, rows[0], params)))
      : 0;
    const limitVal = step.limitExpr
      ? Number(this._evaluator.evaluate(step.limitExpr, rows[0], params))
      : Infinity;
    const end = limitVal === Infinity ? undefined : start + limitVal;
    return rows.slice(start, end);
  }

  // ── UnwindStep ─────────────────────────────────────────────────

  async executeUnwind(
    step: import('../../plan/QueryPlan').UnwindStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Promise<Row[]> {
    return parallelMap(rows, (chunk) => {
      const result: Row[] = [];
      for (const row of chunk) {
        const val = this._evaluator.evaluate(step.expression, row, params);
        if (val === null || val === undefined) {
          continue;
        } else if (Array.isArray(val)) {
          for (const item of val) {
            const newRow = new Map(row);
            newRow.set(step.variable, item);
            result.push(newRow);
          }
        } else {
          const newRow = new Map(row);
          newRow.set(step.variable, val);
          result.push(newRow);
        }
      }
      return Promise.resolve(result);
    }, this._maxDegreeOfParallelism);
  }
}

/**
 * Serialize a single value into a stable, collision-free string key
 * for DISTINCT deduplication.
 *
 * Handles primitives, entities (nodes/edges with `.id`), arrays of
 * entities (e.g. result of `nodes(path)` / `relationships(path)`),
 * and arbitrary objects.
 */
export function getDistinctKey(value: unknown): string {
  if (value === null) return '\x00null';
  if (value === undefined) return '\x00undef';

  if (typeof value === 'object') {
    if ('id' in (value as object)) {
      return (value as { id: string }).id;
    }

    if (Array.isArray(value)) {
      return value.map((el) => getDistinctKey(el)).join('\x1F');
    }
  }

  return String(value);
}