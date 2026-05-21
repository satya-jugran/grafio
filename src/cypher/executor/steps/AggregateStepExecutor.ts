/**
 * Aggregate step executor for the Cypher execution layer.
 *
 * Supports two execution paths:
 * - **Path A (storage-level)**: delegates to Graph aggregate APIs
 *   (`getNodeCount`, `aggregateNodeProperty`, etc.) when possible.
 * - **Path B (in-process)**: computes aggregates over materialised
 *   row buffers for complex plans that can't use Path A.
 *
 * @module cypher/executor/steps/AggregateStepExecutor
 */

import { Graph } from '../../../Graph';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import {
  AggregateStep,
  AggregateSpec,
} from '../../plan/QueryPlan';
import { Expression } from '../../ast/AstNode';
import { CypherRuntimeError } from '../../errors';
import { Row, ExpressionEvaluator } from '../ExpressionEvaluator';

/**
 * Executes aggregate plan steps against a {@link Graph}.
 *
 * Requires both the {@link Graph} instance and an
 * {@link ExpressionEvaluator} for computing aggregate expressions.
 */
export class AggregateStepExecutor {
  private readonly _graph: Graph;
  private readonly _evaluator: ExpressionEvaluator;

  constructor(graph: Graph, evaluator: ExpressionEvaluator) {
    this._graph = graph;
    this._evaluator = evaluator;
  }

  // ── Main entry point ────────────────────────────────────────────

  /**
   * Execute an {@link AggregateStep}, dispatching to storage-level
   * aggregation (Path A) for simple plans or in-process aggregation
   * (Path B) for complex plans with preceding pipeline steps.
   */
  async executeAggregate(
    step: AggregateStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.useStorageLevel && this._canUseStorageLevel(step)) {
      return this._executeAggregateStorageLevel(step, transaction);
    }
    return this._executeAggregateInProcess(step, rows, params);
  }

  // ── Storage-level eligibility ──────────────────────────────────

  private _canUseStorageLevel(step: AggregateStep): boolean {
    if (!step.sourceVariable || !step.sourceEntity) return false;
    if (step.groupBy.length > 0) return false;

    if (step.sourceEntity === 'edge') {
      for (const spec of step.aggregates) {
        if (!this._isSimpleAggregateExpr(spec.expression, step.sourceVariable!)) {
          return false;
        }
      }
      return true;
    }

    for (const spec of step.aggregates) {
      if (!this._isSimpleAggregateExpr(spec.expression, step.sourceVariable!)) {
        return false;
      }
    }
    return true;
  }

  private _isSimpleAggregateExpr(expr: Expression, sourceVar: string): boolean {
    if (expr.kind === 'Literal' && expr.value === '*') return true;
    if (expr.kind === 'Identifier' && expr.name === sourceVar) return true;
    if (
      expr.kind === 'PropertyAccess' &&
      expr.object.kind === 'Identifier' &&
      expr.object.name === sourceVar
    ) {
      return true;
    }
    return false;
  }

  private _extractPropertyKey(expr: Expression, sourceVar: string): string | null {
    if (
      expr.kind === 'PropertyAccess' &&
      expr.object.kind === 'Identifier' &&
      expr.object.name === sourceVar
    ) {
      return expr.property;
    }
    return null;
  }

  // ── Path A: Storage-level aggregation ──────────────────────────

  private async _executeAggregateStorageLevel(
    step: AggregateStep,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.sourceEntity === 'edge') {
      return this._executeEdgeAggregateStorageLevel(step, transaction);
    }

    const sourceTypes = step.sourceTypes;
    const typeFilter = sourceTypes ? { types: sourceTypes } : undefined;
    const resultRow = new Map<string, unknown>();

    const countAggs: AggregateSpec[] = [];
    const propertyAggs = new Map<string, AggregateSpec[]>();
    const collectAggs: AggregateSpec[] = [];

    for (const spec of step.aggregates) {
      if (spec.function === 'COLLECT') {
        collectAggs.push(spec);
        continue;
      }
      const propKey = this._extractPropertyKey(spec.expression, step.sourceVariable!);
      if (propKey === null) {
        countAggs.push(spec);
      } else {
        const coalesceKey = `${propKey}|${spec.distinct}`;
        if (!propertyAggs.has(coalesceKey)) {
          propertyAggs.set(coalesceKey, []);
        }
        propertyAggs.get(coalesceKey)!.push(spec);
      }
    }

    if (countAggs.length > 0) {
      const nodeCount = await this._graph.getNodeCount(
        typeFilter ? { filter: typeFilter, transaction } : { transaction },
      );
      for (const spec of countAggs) {
        resultRow.set(spec.alias, nodeCount);
      }
    }

    for (const [coalesceKey, specs] of propertyAggs) {
      const [propKey, distinctStr] = coalesceKey.split('|');
      const distinct = distinctStr === 'true';
      const aggResult = await this._graph.aggregateNodeProperty(propKey, {
        filter: typeFilter as { types: string[] },
        distinct,
        transaction,
      });
      for (const spec of specs) {
        resultRow.set(spec.alias, this._extractAggField(aggResult, spec.function));
      }
    }

    if (collectAggs.length > 0) {
      const nodes = await this._graph.getNodes(
        typeFilter ? { filter: typeFilter, transaction } : { transaction },
      );
      for (const spec of collectAggs) {
        const propKey = this._extractPropertyKey(spec.expression, step.sourceVariable!);
        const values = nodes
          .map((n) => (propKey ? n.properties[propKey] : n))
          .filter((v) => v !== undefined);
        resultRow.set(spec.alias, spec.distinct ? [...new Set(values)] : values);
      }
    }

    return [resultRow];
  }

  private async _executeEdgeAggregateStorageLevel(
    step: AggregateStep,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.sourceTypes && step.sourceTypes.length > 0) {
      throw new Error(
        'Edge storage-level aggregation cannot be used with source node type ' +
        'constraints. The planner should have rejected this plan in _isEdgeSimplePlan.'
      );
    }

    const typeFilter = step.edgeTypes?.length ? { types: step.edgeTypes } : undefined;
    const resultRow = new Map<string, unknown>();

    const countAggs: AggregateSpec[] = [];
    const propertyAggs = new Map<string, AggregateSpec[]>();
    const collectAggs: AggregateSpec[] = [];

    for (const spec of step.aggregates) {
      if (spec.function === 'COLLECT') {
        collectAggs.push(spec);
        continue;
      }
      const propKey = this._extractPropertyKey(spec.expression, step.sourceVariable!);
      if (propKey === null) {
        countAggs.push(spec);
      } else {
        const coalesceKey = `${propKey}|${spec.distinct}`;
        if (!propertyAggs.has(coalesceKey)) {
          propertyAggs.set(coalesceKey, []);
        }
        propertyAggs.get(coalesceKey)!.push(spec);
      }
    }

    if (countAggs.length > 0) {
      const edgeCount = await this._graph.getEdgeCount(
        typeFilter
          ? { filter: typeFilter, transaction }
          : (transaction ? { transaction } : undefined),
      );
      for (const spec of countAggs) {
        resultRow.set(spec.alias, edgeCount);
      }
    }

    for (const [coalesceKey, specs] of propertyAggs) {
      const [propKey, distinctStr] = coalesceKey.split('|');
      const distinct = distinctStr === 'true';
      const aggResult = await this._graph.aggregateEdgeProperty(propKey, {
        filter: typeFilter,
        distinct,
        transaction,
      } as any);
      for (const spec of specs) {
        resultRow.set(spec.alias, this._extractAggField(aggResult, spec.function));
      }
    }

    if (collectAggs.length > 0) {
      const edges = await this._graph.getEdges(
        typeFilter
          ? { filter: typeFilter, transaction }
          : (transaction ? { transaction } : undefined),
      );
      for (const spec of collectAggs) {
        const propKey = this._extractPropertyKey(spec.expression, step.sourceVariable!);
        const values = edges
          .map((e) => (propKey ? e.properties[propKey] : e))
          .filter((v) => v !== undefined);
        resultRow.set(spec.alias, spec.distinct ? [...new Set(values)] : values);
      }
    }

    return [resultRow];
  }

  private _extractAggField(
    result: { count: number; sum?: number; avg?: number; min?: number; max?: number },
    fn: string,
  ): unknown {
    switch (fn) {
      case 'COUNT': return result.count;
      case 'SUM': return result.sum ?? 0;
      case 'AVG': return result.avg ?? 0;
      case 'MIN': return result.min ?? null;
      case 'MAX': return result.max ?? null;
      default: return null;
    }
  }

  // ── Path B: In-process aggregation ─────────────────────────────

  private _executeAggregateInProcess(
    step: AggregateStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    if (step.groupBy.length === 0) {
      const resultRow = new Map<string, unknown>();
      for (const spec of step.aggregates) {
        resultRow.set(spec.alias, this._computeAggregate(spec, rows, params));
      }
      return [resultRow];
    }

    const groups = new Map<string, { keyValues: unknown[]; rows: Row[] }>();
    for (const row of rows) {
      const keyValues: unknown[] = step.groupBy.map((expr) =>
        this._evaluator.evaluate(expr, row, params),
      );
      const keyStr = this._serializeGroupKey(keyValues);
      if (!groups.has(keyStr)) {
        groups.set(keyStr, { keyValues, rows: [] });
      }
      groups.get(keyStr)!.rows.push(row);
    }

    const result: Row[] = [];
    for (const [, group] of groups) {
      const resultRow = new Map<string, unknown>();
      for (let i = 0; i < step.groupBy.length; i++) {
        const alias = step.groupByAliases[i];
        resultRow.set(alias, group.keyValues[i]);
      }
      for (const spec of step.aggregates) {
        resultRow.set(spec.alias, this._computeAggregate(spec, group.rows, params));
      }
      result.push(resultRow);
    }
    return result;
  }

  private _computeAggregate(
    spec: AggregateSpec,
    rows: Row[],
    params: Record<string, unknown>,
  ): unknown {
    const { expression, distinct } = spec;
    let values: unknown[] = rows
      .map((row) => this._evaluateExpressionForAggregate(expression, row, params))
      .filter((v) => v !== null && v !== undefined);

    if (distinct) {
      values = [...new Set(values)];
    }

    switch (spec.function) {
      case 'COUNT':
        return values.length;
      case 'SUM': {
        const nums = values.map(Number).filter((n) => !isNaN(n));
        return nums.reduce((a, b) => a + b, 0);
      }
      case 'AVG': {
        const nums = values.map(Number).filter((n) => !isNaN(n));
        if (nums.length === 0) return 0;
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }
      case 'MIN': {
        if (values.length === 0) return null;
        return values.reduce((a, b) =>
          this._evaluator.compare(a, b) <= 0 ? a : b,
        );
      }
      case 'MAX': {
        if (values.length === 0) return null;
        return values.reduce((a, b) =>
          this._evaluator.compare(a, b) >= 0 ? a : b,
        );
      }
      case 'COLLECT':
        return values;
      default:
        throw new CypherRuntimeError(`Unknown aggregate function: ${spec.function}`);
    }
  }

  private _evaluateExpressionForAggregate(
    expr: Expression,
    row: Row,
    params: Record<string, unknown>,
  ): unknown {
    if (expr.kind === 'Literal' && expr.value === '*') {
      return 1;
    }
    return this._evaluator.evaluate(expr, row, params);
  }

  private _serializeGroupKey(keyValues: unknown[]): string {
    return keyValues
      .map((v) => {
        if (v === null) return '\x00null';
        if (v === undefined) return '\x00undef';
        if (typeof v === 'object' && v !== null && 'id' in (v as object)) {
          return (v as { id: string }).id;
        }
        return String(v);
      })
      .join('\x00');
  }
}