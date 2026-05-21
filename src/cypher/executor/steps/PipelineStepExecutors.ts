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

/**
 * Executes pure pipeline (row-transformation) steps.
 *
 * These steps do not touch the {@link Graph} — they only transform
 * the row buffer using the expression evaluator.
 */
export class PipelineStepExecutor {
  private readonly _evaluator: ExpressionEvaluator;

  constructor(evaluator: ExpressionEvaluator) {
    this._evaluator = evaluator;
  }

  // ── FilterStep ─────────────────────────────────────────────────

  executeFilter(
    step: FilterStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    return rows.filter((row) => {
      const result = this._evaluator.evaluate(step.predicate, row, params);
      return Boolean(result);
    });
  }

  // ── ProjectStep ────────────────────────────────────────────────

  executeProject(
    step: ProjectStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    const projected = rows.map((row) => {
      const newRow = new Map<string, unknown>();
      for (const col of step.columns) {
        newRow.set(col.alias, this._evaluator.evaluate(col.expression, row, params));
      }
      return newRow;
    });

    if (!step.distinct) return projected;

    const seen = new Set<string>();
    const deduped: Row[] = [];

    for (const row of projected) {
      const keyParts: string[] = [];
      for (const col of step.columns) {
        const value = row.get(col.alias);
        if (value === null) {
          keyParts.push('\x00null');
        } else if (value === undefined) {
          keyParts.push('\x00undef');
        } else if (typeof value === 'object' && value !== null && 'id' in (value as object)) {
          keyParts.push((value as { id: string }).id);
        } else {
          keyParts.push(String(value));
        }
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
}