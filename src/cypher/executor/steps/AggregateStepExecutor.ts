/**
 * Aggregate step executor for the Cypher execution layer.
 *
 * Supports:
 * - **Path A (storage-level)**: delegates directly to `ISyncGraphKernel` / `Graph` aggregates.
 * - **Path F (fused columnar sync)**: single-pass over `queryNodeSlotsSync` for
 *   `NodeScanStep -> FilterStep? -> AggregateStep` without intermediate `SlotRow` allocations.
 * - **Path B (in-process)**: computes aggregates over {@link SlotRow} buffers using compiled closures.
 *
 * @module cypher/executor/steps/AggregateStepExecutor
 */

import { Graph } from '../../../Graph';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import type { GroupedAggregateSpec, ISyncGraphKernel } from '../../../storage/IStorageProvider';
import {
  AggregateStep,
  AggregateSpec,
  FilterStep,
  NodeScanStep,
  PropertyFilter,
} from '../../plan/QueryPlan';
import type { GraphQueryOptions } from '../../../Graph/GraphQueryOptions';
import { Expression } from '../../ast/AstNode';
import type { CompiledPlanMeta } from '../../plan/CompiledPlanMeta';
import { CypherRuntimeError, UnboundParameterError } from '../../errors';
import { compileExpression, type CompiledExprFn } from '../ClosureCompiler';
import { Row, ExpressionEvaluator, serializeCypherKey } from '../ExpressionEvaluator';

interface AggAccumulator {
  count: number;
  sum: number;
  avgSum: number;
  avgCount: number;
  min: unknown;
  max: unknown;
  collect: unknown[];
  distinctSeen?: Set<string>;
}

/**
 * Executes aggregate plan steps against a {@link Graph}.
 */
export class AggregateStepExecutor {
  private readonly _graph: Graph;
  private readonly _evaluator: ExpressionEvaluator;

  constructor(graph: Graph, evaluator: ExpressionEvaluator) {
    this._graph = graph;
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

  // ── Main entry points ──────────────────────────────────────────

  async executeAggregate(
    step: AggregateStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.useStorageLevel && this._canUseStorageLevel(step)) {
      return this._executeAggregateStorageLevel(step, meta, transaction);
    }
    return this._executeAggregateInProcess(step, rows, params, meta);
  }

  executeAggregateSync(
    kernel: ISyncGraphKernel,
    step: AggregateStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Row[] {
    if (step.useStorageLevel && this._canUseStorageLevel(step)) {
      return this._executeAggregateStorageLevelSync(kernel, step, meta, transaction);
    }
    return this._executeAggregateInProcess(step, rows, params, meta, kernel);
  }

  private _buildScanFilter(
    scanStep: NodeScanStep,
    params: Record<string, unknown>,
  ): NonNullable<GraphQueryOptions['filter']> {
    const filter: NonNullable<GraphQueryOptions['filter']> = {};
    if (scanStep.types?.length) {
      filter.types = scanStep.types;
    } else if (scanStep.label) {
      filter.types = [scanStep.label];
    }
    if (scanStep.propertyFilters?.length) {
      filter.properties = scanStep.propertyFilters.map((f) =>
        this._resolveFilterParams(f, params),
      );
    }
    return filter;
  }

  /**
   * Attempts fused async execution for `NodeScanStep -> AggregateStep` without
   * streaming raw node documents across storage boundaries. Returns `null` when
   * the plan requires regular step-by-step evaluation.
   */
  async tryExecuteFusedNodeAggregateAsync(
    scanStep: NodeScanStep,
    aggStep: AggregateStep,
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Promise<Row[] | null> {
    if (aggStep.sourceEntity === 'edge') return null;
    if (aggStep.sourceVariable && aggStep.sourceVariable !== scanStep.variable) return null;

    const filter = this._buildScanFilter(scanStep, params);
    const storageFilter = Object.keys(filter).length > 0 ? filter : undefined;

    // Pillar 3: Filtered/unfiltered pure COUNT(*) / COUNT(scanVar)
    if (
      aggStep.groupBy.length === 0 &&
      aggStep.aggregates.length > 0 &&
      aggStep.aggregates.every(
        (spec) =>
          spec.function === 'COUNT' &&
          !spec.distinct &&
          ((spec.expression.kind === 'Literal' && spec.expression.value === '*') ||
            (spec.expression.kind === 'Identifier' && spec.expression.name === scanStep.variable)),
      )
    ) {
      const nodeCount = await this._graph.getNodeCount(
        storageFilter || transaction ? { filter: storageFilter, transaction } : undefined,
      );
      const resultRow = meta.slotTable.createEmptyRow();
      for (const spec of aggStep.aggregates) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = nodeCount;
      }
      return [resultRow];
    }

    // Pillar 4: Storage-level grouped/filtered multi-aggregate pushdown
    const store = this._graph._getStore();
    if (typeof store.aggregateGrouped !== 'function') return null;

    const groupByKeys: string[] = [];
    for (const g of aggStep.groupBy) {
      const propKey = this._extractPropertyKey(g, scanStep.variable);
      if (propKey === null) return null;
      groupByKeys.push(propKey);
    }

    const aggregates: GroupedAggregateSpec[] = [];
    for (const spec of aggStep.aggregates) {
      if (spec.function === 'COLLECT' || spec.distinct) return null;
      if (spec.function === 'COUNT') {
        const isEntityOrStar =
          (spec.expression.kind === 'Literal' && spec.expression.value === '*') ||
          (spec.expression.kind === 'Identifier' && spec.expression.name === scanStep.variable);
        if (isEntityOrStar) {
          aggregates.push({ alias: spec.alias, fn: 'COUNT' });
          continue;
        }
      }
      const propKey = this._extractPropertyKey(spec.expression, scanStep.variable);
      if (propKey === null) return null;
      aggregates.push({
        alias: spec.alias,
        fn: spec.function,
        propertyKey: propKey,
      });
    }

    const groupedRows = await store.aggregateGrouped({
      target: 'node',
      groupByKeys,
      aggregates,
      options: storageFilter || transaction
        ? { filter: storageFilter, transaction: transaction?._getHandle() }
        : undefined,
    });
    if (groupedRows === null) return null;

    const aggSlots = aggStep.aggregates.map((spec) => meta.slotTable.getOrAdd(spec.alias));

    if (groupByKeys.length === 0 && groupedRows.length === 0) {
      const emptyRow = meta.slotTable.createEmptyRow();
      for (let a = 0; a < aggSlots.length; a++) {
        emptyRow[aggSlots[a]!] = this._extractAggField({ count: 0 }, aggStep.aggregates[a]!.function);
      }
      return [emptyRow];
    }

    const groupSlots = aggStep.groupByAliases.map((a) => meta.slotTable.getOrAdd(a));
    return groupedRows.map((gRow) => {
      const outRow = meta.slotTable.createEmptyRow();
      for (let g = 0; g < groupSlots.length; g++) {
        outRow[groupSlots[g]!] = gRow.groupValues[g];
      }
      for (let a = 0; a < aggSlots.length; a++) {
        const spec = aggStep.aggregates[a]!;
        outRow[aggSlots[a]!] = gRow.aggValues[spec.alias];
      }
      return outRow;
    });
  }

  /**
   * Fused single-pass columnar execution for `NodeScanStep -> FilterStep? -> AggregateStep`
   * on synchronous in-memory graphs with no active transactions.
   */
  executeFusedNodeAggregateSync(
    kernel: ISyncGraphKernel,
    scanStep: NodeScanStep,
    filterStep: FilterStep | undefined,
    aggStep: AggregateStep,
    seedRow: Row,
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
  ): Row[] {
    const filter = this._buildScanFilter(scanStep, params);

    const slots = kernel.queryNodeSlotsSync(
      Object.keys(filter).length > 0 ? { filter } : undefined,
    );

    const nodeSlot = meta.slotTable.getOrAdd(scanStep.variable);
    const probeRow = seedRow.slice();
    const filterFn = filterStep ? this._getCompiled(filterStep.predicate, meta) : null;

    const groupFns = aggStep.groupBy.map((g) => this._getCompiled(g, meta));
    const groupSlots = aggStep.groupByAliases.map((a) => meta.slotTable.getOrAdd(a));

    const aggFns = aggStep.aggregates.map((spec) =>
      spec.expression.kind === 'Literal' && spec.expression.value === '*'
        ? null
        : this._getCompiled(spec.expression, meta),
    );
    const aggSlots = aggStep.aggregates.map((spec) => meta.slotTable.getOrAdd(spec.alias));

    if (groupFns.length === 0) {
      const accs = this._createAccumulators(aggStep.aggregates);
      for (let i = 0; i < slots.length; i++) {
        probeRow[nodeSlot] = kernel.getNodeEntityBySlot(slots[i]);
        if (filterFn && !filterFn(probeRow, params, kernel)) continue;
        this._updateAccumulators(accs, aggStep.aggregates, aggFns, probeRow, params, kernel);
      }
      const outRow = meta.slotTable.createEmptyRow();
      for (let a = 0; a < aggSlots.length; a++) {
        outRow[aggSlots[a]] = this._finalizeAccumulator(accs[a], aggStep.aggregates[a].function);
      }
      return [outRow];
    }

    const groups = new Map<string, { keyValues: unknown[]; accs: AggAccumulator[] }>();
    for (let i = 0; i < slots.length; i++) {
      probeRow[nodeSlot] = kernel.getNodeEntityBySlot(slots[i]);
      if (filterFn && !filterFn(probeRow, params, kernel)) continue;

      const keyValues = new Array<unknown>(groupFns.length);
      for (let g = 0; g < groupFns.length; g++) {
        keyValues[g] = groupFns[g](probeRow, params, kernel);
      }
      const keyStr = this._serializeGroupKey(keyValues);
      let entry = groups.get(keyStr);
      if (!entry) {
        entry = { keyValues, accs: this._createAccumulators(aggStep.aggregates) };
        groups.set(keyStr, entry);
      }
      this._updateAccumulators(entry.accs, aggStep.aggregates, aggFns, probeRow, params, kernel);
    }

    const out: Row[] = [];
    for (const group of groups.values()) {
      const outRow = meta.slotTable.createEmptyRow();
      for (let g = 0; g < groupSlots.length; g++) {
        outRow[groupSlots[g]] = group.keyValues[g];
      }
      for (let a = 0; a < aggSlots.length; a++) {
        outRow[aggSlots[a]] = this._finalizeAccumulator(
          group.accs[a],
          aggStep.aggregates[a].function,
        );
      }
      out.push(outRow);
    }
    return out;
  }

  private _resolveFilterParams(
    f: PropertyFilter,
    params: Record<string, unknown>,
  ): PropertyFilter {
    const resolved: PropertyFilter = {};
    if (f.key !== undefined) resolved.key = f.key;
    if (f.op !== undefined) resolved.op = f.op;
    if (f.AND) resolved.AND = f.AND.map((c) => this._resolveFilterParams(c, params));
    if (f.OR) resolved.OR = f.OR.map((c) => this._resolveFilterParams(c, params));
    if ('value' in f) {
      const val = f.value;
      if (
        typeof val === 'object' &&
        val !== null &&
        (val as { kind?: unknown }).kind === 'Parameter' &&
        typeof (val as { name?: unknown }).name === 'string'
      ) {
        const pname = (val as { name: string }).name;
        if (!(pname in params)) throw new UnboundParameterError(pname);
        resolved.value = params[pname];
      } else {
        resolved.value = val;
      }
    }
    return resolved;
  }

  private _createAccumulators(specs: AggregateSpec[]): AggAccumulator[] {
    return specs.map((spec) => ({
      count: 0,
      sum: 0,
      avgSum: 0,
      avgCount: 0,
      min: undefined,
      max: undefined,
      collect: [],
      distinctSeen: spec.distinct ? new Set<string>() : undefined,
    }));
  }

  private _updateAccumulators(
    accs: AggAccumulator[],
    specs: AggregateSpec[],
    fns: Array<CompiledExprFn | null>,
    row: Row,
    params: Record<string, unknown>,
    kernel: ISyncGraphKernel,
  ): void {
    for (let a = 0; a < specs.length; a++) {
      const fn = fns[a];
      const val = fn === null ? 1 : fn(row, params, kernel);
      if (val === null || val === undefined) continue;

      const acc = accs[a];
      if (acc.distinctSeen) {
        const key = this._valueDistinctKey(val);
        if (acc.distinctSeen.has(key)) continue;
        acc.distinctSeen.add(key);
      }

      switch (specs[a].function) {
        case 'COUNT':
          acc.count++;
          break;
        case 'SUM': {
          const n = Number(val);
          if (!Number.isNaN(n)) acc.sum += n;
          break;
        }
        case 'AVG': {
          const n = Number(val);
          if (!Number.isNaN(n)) {
            acc.avgSum += n;
            acc.avgCount++;
          }
          break;
        }
        case 'MIN':
          if (acc.min === undefined || this._evaluator.compare(val, acc.min) < 0) {
            acc.min = val;
          }
          break;
        case 'MAX':
          if (acc.max === undefined || this._evaluator.compare(val, acc.max) > 0) {
            acc.max = val;
          }
          break;
        case 'COLLECT':
          acc.collect.push(val);
          break;
      }
    }
  }

  private _finalizeAccumulator(acc: AggAccumulator, fn: string): unknown {
    switch (fn) {
      case 'COUNT': return acc.count;
      case 'SUM': return acc.sum;
      case 'AVG': return acc.avgCount === 0 ? 0 : acc.avgSum / acc.avgCount;
      case 'MIN': return acc.min === undefined ? null : acc.min;
      case 'MAX': return acc.max === undefined ? null : acc.max;
      case 'COLLECT': return acc.collect;
      default: throw new CypherRuntimeError(`Unknown aggregate function: ${fn}`);
    }
  }

  // ── Storage-level eligibility ──────────────────────────────────

  private _canUseStorageLevel(step: AggregateStep): boolean {
    if (!step.sourceVariable || !step.sourceEntity) return false;
    if (step.groupBy.length > 0) return false;

    for (const spec of step.aggregates) {
      if (!this._isSimpleAggregateExpr(spec.expression, step.sourceVariable)) {
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

  private _partitionAggregateSpecs(step: AggregateStep): {
    countAggs: AggregateSpec[];
    propertyAggs: Map<string, AggregateSpec[]>;
    collectAggs: AggregateSpec[];
  } {
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
        let list = propertyAggs.get(coalesceKey);
        if (!list) {
          list = [];
          propertyAggs.set(coalesceKey, list);
        }
        list.push(spec);
      }
    }
    return { countAggs, propertyAggs, collectAggs };
  }

  // ── Path A (Async) ─────────────────────────────────────────────

  private async _executeAggregateStorageLevel(
    step: AggregateStep,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.sourceEntity === 'edge') {
      return this._executeEdgeAggregateStorageLevel(step, meta, transaction);
    }

    const typeFilter = step.sourceTypes ? { types: step.sourceTypes } : undefined;
    const resultRow = meta.slotTable.createEmptyRow();
    const { countAggs, propertyAggs, collectAggs } = this._partitionAggregateSpecs(step);

    if (countAggs.length > 0) {
      const nodeCount = await this._graph.getNodeCount(
        typeFilter ? { filter: typeFilter, transaction } : { transaction },
      );
      for (const spec of countAggs) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = nodeCount;
      }
    }

    for (const [coalesceKey, specs] of propertyAggs) {
      const [propKey, distinctStr] = coalesceKey.split('|');
      const distinct = distinctStr === 'true';
      const aggResult = await this._graph.aggregateNodeProperty(propKey, {
        filter: typeFilter,
        distinct,
        transaction,
      });
      for (const spec of specs) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = this._extractAggField(
          aggResult,
          spec.function,
        );
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
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = spec.distinct
          ? this._deduplicatedValues(values)
          : values;
      }
    }

    return [resultRow];
  }

  private async _executeEdgeAggregateStorageLevel(
    step: AggregateStep,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.sourceTypes && step.sourceTypes.length > 0) {
      throw new Error(
        'Edge storage-level aggregation cannot be used with source node type ' +
        'constraints. The planner should have rejected this plan in _isEdgeSimplePlan.',
      );
    }

    const typeFilter = step.edgeTypes?.length ? { types: step.edgeTypes } : undefined;
    const resultRow = meta.slotTable.createEmptyRow();
    const { countAggs, propertyAggs, collectAggs } = this._partitionAggregateSpecs(step);

    if (countAggs.length > 0) {
      const edgeCount = await this._graph.getEdgeCount(
        typeFilter
          ? { filter: typeFilter, transaction }
          : (transaction ? { transaction } : undefined),
      );
      for (const spec of countAggs) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = edgeCount;
      }
    }

    for (const [coalesceKey, specs] of propertyAggs) {
      const [propKey, distinctStr] = coalesceKey.split('|');
      const distinct = distinctStr === 'true';
      const aggResult = await this._graph.aggregateEdgeProperty(propKey, {
        filter: typeFilter,
        distinct,
        transaction,
      });
      for (const spec of specs) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = this._extractAggField(
          aggResult,
          spec.function,
        );
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
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = spec.distinct
          ? this._deduplicatedValues(values)
          : values;
      }
    }

    return [resultRow];
  }

  // ── Path A (Sync Kernel) ───────────────────────────────────────

  private _executeAggregateStorageLevelSync(
    kernel: ISyncGraphKernel,
    step: AggregateStep,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Row[] {
    const txHandle = transaction?._getHandle();
    const resultRow = meta.slotTable.createEmptyRow();
    const { countAggs, propertyAggs, collectAggs } = this._partitionAggregateSpecs(step);

    if (step.sourceEntity === 'edge') {
      if (step.sourceTypes && step.sourceTypes.length > 0) {
        throw new Error(
          'Edge storage-level aggregation cannot be used with source node type ' +
          'constraints. The planner should have rejected this plan in _isEdgeSimplePlan.',
        );
      }
      const typeFilter = step.edgeTypes?.length ? { types: step.edgeTypes } : undefined;
      const queryOpts = typeFilter
        ? { filter: typeFilter, transaction: txHandle }
        : (txHandle ? { transaction: txHandle } : undefined);

      if (countAggs.length > 0) {
        const edgeCount = kernel.countEdgesSync(queryOpts);
        for (const spec of countAggs) {
          resultRow[meta.slotTable.getOrAdd(spec.alias)] = edgeCount;
        }
      }

      for (const [coalesceKey, specs] of propertyAggs) {
        const [propKey, distinctStr] = coalesceKey.split('|');
        const aggResult = kernel.aggregateEdgePropertySync(propKey, {
          filter: typeFilter,
          distinct: distinctStr === 'true',
          transaction: txHandle,
        });
        for (const spec of specs) {
          resultRow[meta.slotTable.getOrAdd(spec.alias)] = this._extractAggField(
            aggResult,
            spec.function,
          );
        }
      }

      if (collectAggs.length > 0) {
        const edges = kernel.queryEdgesSync(queryOpts);
        for (const spec of collectAggs) {
          const propKey = this._extractPropertyKey(spec.expression, step.sourceVariable!);
          const values = edges
            .map((e) => (propKey ? e.properties[propKey] : e))
            .filter((v) => v !== undefined);
          resultRow[meta.slotTable.getOrAdd(spec.alias)] = spec.distinct
            ? this._deduplicatedValues(values)
            : values;
        }
      }
      return [resultRow];
    }

    const typeFilter = step.sourceTypes ? { types: step.sourceTypes } : undefined;
    const queryOpts = typeFilter
      ? { filter: typeFilter, transaction: txHandle }
      : (txHandle ? { transaction: txHandle } : undefined);

    if (countAggs.length > 0) {
      const nodeCount = kernel.countNodesSync(queryOpts);
      for (const spec of countAggs) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = nodeCount;
      }
    }

    for (const [coalesceKey, specs] of propertyAggs) {
      const [propKey, distinctStr] = coalesceKey.split('|');
      const aggResult = kernel.aggregateNodePropertySync(propKey, {
        filter: typeFilter,
        distinct: distinctStr === 'true',
        transaction: txHandle,
      });
      for (const spec of specs) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = this._extractAggField(
          aggResult,
          spec.function,
        );
      }
    }

    if (collectAggs.length > 0) {
      const nodes = kernel.queryNodesSync(queryOpts);
      for (const spec of collectAggs) {
        const propKey = this._extractPropertyKey(spec.expression, step.sourceVariable!);
        const values = nodes
          .map((n) => (propKey ? n.properties[propKey] : n))
          .filter((v) => v !== undefined);
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = spec.distinct
          ? this._deduplicatedValues(values)
          : values;
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
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    if (step.groupBy.length === 0) {
      const resultRow = meta.slotTable.createEmptyRow();
      for (const spec of step.aggregates) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = this._computeAggregate(
          spec,
          rows,
          params,
          meta,
          kernel,
        );
      }
      return [resultRow];
    }

    const groupFns = step.groupBy.map((expr) => this._getCompiled(expr, meta));
    const groupSlots = step.groupByAliases.map((a) => meta.slotTable.getOrAdd(a));
    const groups = new Map<string, { keyValues: unknown[]; rows: Row[] }>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keyValues = new Array<unknown>(groupFns.length);
      for (let g = 0; g < groupFns.length; g++) {
        keyValues[g] = groupFns[g](row, params, kernel);
      }
      const keyStr = this._serializeGroupKey(keyValues);
      let group = groups.get(keyStr);
      if (!group) {
        group = { keyValues, rows: [] };
        groups.set(keyStr, group);
      }
      group.rows.push(row);
    }

    const result: Row[] = [];
    for (const group of groups.values()) {
      const resultRow = meta.slotTable.createEmptyRow();
      for (let i = 0; i < groupSlots.length; i++) {
        resultRow[groupSlots[i]] = group.keyValues[i];
      }
      for (const spec of step.aggregates) {
        resultRow[meta.slotTable.getOrAdd(spec.alias)] = this._computeAggregate(
          spec,
          group.rows,
          params,
          meta,
          kernel,
        );
      }
      result.push(resultRow);
    }
    return result;
  }

  private _computeAggregate(
    spec: AggregateSpec,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    kernel?: ISyncGraphKernel,
  ): unknown {
    const { expression, distinct } = spec;
    const isStar = expression.kind === 'Literal' && expression.value === '*';
    const fn = isStar ? null : this._getCompiled(expression, meta);

    let values: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      const v = fn === null ? 1 : fn(rows[i], params, kernel);
      if (v !== null && v !== undefined) {
        values.push(v);
      }
    }

    if (distinct) {
      values = this._deduplicatedValues(values);
    }

    switch (spec.function) {
      case 'COUNT':
        return values.length;
      case 'SUM': {
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
          const n = Number(values[i]);
          if (!Number.isNaN(n)) sum += n;
        }
        return sum;
      }
      case 'AVG': {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < values.length; i++) {
          const n = Number(values[i]);
          if (!Number.isNaN(n)) {
            sum += n;
            count++;
          }
        }
        return count === 0 ? 0 : sum / count;
      }
      case 'MIN': {
        if (values.length === 0) return null;
        let min = values[0];
        for (let i = 1; i < values.length; i++) {
          if (this._evaluator.compare(values[i], min) < 0) min = values[i];
        }
        return min;
      }
      case 'MAX': {
        if (values.length === 0) return null;
        let max = values[0];
        for (let i = 1; i < values.length; i++) {
          if (this._evaluator.compare(values[i], max) > 0) max = values[i];
        }
        return max;
      }
      case 'COLLECT':
        return values;
      default:
        throw new CypherRuntimeError(`Unknown aggregate function: ${spec.function}`);
    }
  }

  private _valueDistinctKey(v: unknown): string {
    return serializeCypherKey(v);
  }

  private _deduplicatedValues(values: unknown[]): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];
    for (const v of values) {
      const key = this._valueDistinctKey(v);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(v);
      }
    }
    return result;
  }

  private _serializeGroupKey(keyValues: unknown[]): string {
    return keyValues
      .map((v, idx) => {
        const sk = serializeCypherKey(v);
        return `${idx}:${sk.length}:${sk}`;
      })
      .join('\x00');
  }
}
