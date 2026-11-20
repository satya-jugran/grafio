/**
 * Read step executor for the Cypher execution layer.
 *
 * Executes {@link NodeScanStep}, {@link NodeSeekStep}, {@link VerifyNodeStep},
 * and {@link EdgeExpandStep} against a {@link Graph} instance, with zero-overhead
 * synchronous CSR+Delta kernel fast paths on {@link ISyncGraphKernel}.
 *
 * @module cypher/executor/steps/ReadStepExecutors
 */

import { Graph } from '../../../Graph';
import { Node } from '../../../Node';
import { Edge } from '../../../Edge';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import type {
  ISyncGraphKernel,
  ITransactionHandle,
  StorageQueryOptions,
} from '../../../storage/IStorageProvider';
import { TAG_ABSENT } from '../../../storage/engine/ColumnStore';
import type { Bitmask64Query } from '../../../storage/engine/StringDictionary';
import {
  NodeScanStep,
  NodeSeekStep,
  EdgeExpandStep,
  VerifyNodeStep,
  PropertyFilter,
} from '../../plan/QueryPlan';
import type { GraphQueryOptions } from '../../../Graph/GraphQueryOptions';
import { UNBOUND, type VarSlotTable } from '../../plan/CompiledPlanMeta';
import { UnboundParameterError } from '../../errors';
import { Row, ExpressionEvaluator } from '../ExpressionEvaluator';
import { RingQueue } from '../RingQueue';

interface ParameterReference {
  kind: 'Parameter';
  name: string;
}

function isParameterReference(value: object): value is ParameterReference {
  const candidate = value as Partial<ParameterReference>;
  return candidate.kind === 'Parameter' && typeof candidate.name === 'string';
}

type ComparisonOperator = '>' | '<' | '>=' | '<=';

function compareValues(
  actual: unknown,
  expected: unknown,
  operator: ComparisonOperator,
): boolean {
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return false;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
    return compareComparableValues(actual, expected, operator);
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return compareComparableValues(actual, expected, operator);
  }
  return false;
}

function compareComparableValues(
  actual: string | number,
  expected: string | number,
  operator: ComparisonOperator,
): boolean {
  switch (operator) {
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
  }
}

interface FrontierKernelItem {
  nodeSlot: number;
  hops: number;
  usedEdgeSlots?: number[];
  pathNodeSlots?: number[];
  pathEdgeSlots?: number[];
}

interface FrontierNodeItem {
  node: Node;
  hops: number;
  usedEdgeIds?: string[];
  pathNodes?: Node[];
  pathEdges?: Edge[];
}

/**
 * Executes read-only plan steps (NodeScan, NodeSeek, VerifyNode, EdgeExpand)
 * against a {@link Graph} instance.
 */
export class ReadStepExecutor {
  private readonly _graph: Graph;
  private readonly _evaluator: ExpressionEvaluator;

  constructor(graph: Graph, evaluator: ExpressionEvaluator) {
    this._graph = graph;
    this._evaluator = evaluator;
  }

  // ── NodeScanStep ───────────────────────────────────────────────

  async executeNodeScan(
    step: NodeScanStep,
    rows: Row[],
    params: Record<string, unknown>,
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    const filter = this._buildNodeScanFilter(step, params);
    const nodes = Object.keys(filter).length > 0
      ? await this._graph.getNodes({ filter, transaction })
      : await this._graph.getNodes({ transaction });

    return this._crossJoinNodes(rows, nodes, slotTable.getOrAdd(step.variable));
  }

  executeNodeScanSync(
    kernel: ISyncGraphKernel,
    step: NodeScanStep,
    rows: Row[],
    params: Record<string, unknown>,
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Row[] {
    if (rows.length === 0) return [];

    const filter = this._buildNodeScanFilter(step, params);
    const hasFilter = Object.keys(filter).length > 0;
    const txHandle = transaction?._getHandle();
    const varSlot = slotTable.getOrAdd(step.variable);

    if (txHandle !== undefined) {
      const nodes = kernel.queryNodesSync(
        hasFilter ? { filter, transaction: txHandle } : { transaction: txHandle },
      );
      return this._crossJoinNodes(rows, nodes, varSlot);
    }

    const slots = kernel.queryNodeSlotsSync(hasFilter ? { filter } : undefined);
    const slotCount = slots.length;
    if (slotCount === 0) return [];

    if (rows.length === 1) {
      const base = rows[0];
      const out = new Array<Row>(slotCount);
      for (let i = 0; i < slotCount; i++) {
        const nr = base.slice();
        nr[varSlot] = kernel.getNodeEntityBySlot(slots[i]);
        out[i] = nr;
      }
      return out;
    }

    const nodes = new Array<Node>(slotCount);
    for (let i = 0; i < slotCount; i++) {
      nodes[i] = kernel.getNodeEntityBySlot(slots[i]);
    }
    return this._crossJoinNodes(rows, nodes, varSlot);
  }

  private _buildNodeScanFilter(
    step: NodeScanStep,
    params: Record<string, unknown>,
  ): NonNullable<GraphQueryOptions['filter']> {
    const filter: NonNullable<GraphQueryOptions['filter']> = {};
    if (step.types?.length) {
      filter.types = step.types;
    } else if (step.label) {
      filter.types = [step.label];
    }
    if (step.propertyFilters?.length) {
      filter.properties = this._resolvePropertyFilterParams(step.propertyFilters, params);
    }
    return filter;
  }

  private _crossJoinNodes(
    rows: Row[],
    nodes: readonly Node[],
    varSlot: number,
  ): Row[] {
    if (rows.length === 0 || nodes.length === 0) return [];
    const out = new Array<Row>(rows.length * nodes.length);
    let idx = 0;
    for (let r = 0; r < rows.length; r++) {
      const base = rows[r];
      for (let n = 0; n < nodes.length; n++) {
        const nr = base.slice();
        nr[varSlot] = nodes[n];
        out[idx++] = nr;
      }
    }
    return out;
  }

  private _resolvePropertyFilterParams(
    filters: PropertyFilter[],
    params: Record<string, unknown>,
  ): PropertyFilter[] {
    return filters.map((f) => this._resolveOneFilter(f, params));
  }

  private _resolveOneFilter(
    f: PropertyFilter,
    params: Record<string, unknown>,
  ): PropertyFilter {
    const resolved: PropertyFilter = {};
    if (f.key !== undefined) resolved.key = f.key;
    if (f.op !== undefined) resolved.op = f.op;
    if (f.AND) {
      resolved.AND = f.AND.map((child) => this._resolveOneFilter(child, params));
    }
    if (f.OR) {
      resolved.OR = f.OR.map((child) => this._resolveOneFilter(child, params));
    }
    if ('value' in f) {
      const value = f.value;
      if (typeof value === 'object' && value !== null && isParameterReference(value)) {
        if (!(value.name in params)) {
          throw new UnboundParameterError(value.name);
        }
        resolved.value = params[value.name];
      } else {
        resolved.value = value;
      }
    }
    return resolved;
  }

  // ── VerifyNodeStep ───────────────────────────────────────────────

  async executeVerifyNode(
    step: VerifyNodeStep,
    rows: Row[],
    params: Record<string, unknown>,
    slotTable: VarSlotTable,
    _transaction?: GraphTransaction,
  ): Promise<Row[]> {
    return this._verifyNodes(step, rows, params, slotTable);
  }

  executeVerifyNodeSync(
    kernel: ISyncGraphKernel,
    step: VerifyNodeStep,
    rows: Row[],
    params: Record<string, unknown>,
    slotTable: VarSlotTable,
    _transaction?: GraphTransaction,
  ): Row[] {
    return this._verifyNodes(step, rows, params, slotTable, kernel);
  }

  private _verifyNodes(
    step: VerifyNodeStep,
    rows: Row[],
    params: Record<string, unknown>,
    slotTable: VarSlotTable,
    kernel?: ISyncGraphKernel,
  ): Row[] {
    if (rows.length === 0) return [];
    const resolvedFilters = step.propertyFilters?.length
      ? this._resolvePropertyFilterParams(step.propertyFilters, params)
      : undefined;
    const varSlot = slotTable.getOrAdd(step.variable);

    const arena = kernel?.arena;
    const labelMask =
      kernel && step.types?.length
        ? kernel.arena.labelDict.buildQueryMask(step.types)
        : undefined;
    if (kernel && step.types?.length && labelMask === null) return [];

    const checkColumnDirect = Boolean(kernel && !kernel.hasActiveTransactions);
    const out: Row[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const raw = row[varSlot];
      if (raw === UNBOUND || !raw) continue;
      const node = raw as Node;

      if (
        checkColumnDirect &&
        kernel &&
        arena &&
        node._slot !== undefined &&
        arena.nodeAlive[node._slot] === 1 &&
        arena.nodeIds[node._slot] === node.id
      ) {
        const slot = node._slot;
        if (labelMask && !arena.matchesNodeLabelMask(slot, labelMask)) continue;
        if (resolvedFilters && !this._evaluateSlotFilters(kernel, slot, resolvedFilters)) continue;
        out.push(row);
      } else {
        if (step.types?.length && (!node.labels || !step.types.some((t) => node.labels.includes(t)))) {
          continue;
        }
        if (resolvedFilters && !this._evaluatePropertyFilters(node.properties, resolvedFilters)) {
          continue;
        }
        out.push(row);
      }
    }
    return out;
  }

  private _evaluateSlotFilters(
    kernel: ISyncGraphKernel,
    slot: number,
    filters: PropertyFilter[],
  ): boolean {
    for (let i = 0; i < filters.length; i++) {
      if (!this._evaluateOneSlotFilter(kernel, slot, filters[i])) return false;
    }
    return true;
  }

  private _evaluateOneSlotFilter(
    kernel: ISyncGraphKernel,
    slot: number,
    filter: PropertyFilter,
  ): boolean {
    if (filter.AND && Array.isArray(filter.AND)) {
      for (let i = 0; i < filter.AND.length; i++) {
        if (!this._evaluateOneSlotFilter(kernel, slot, filter.AND[i])) return false;
      }
      return true;
    }
    if (filter.OR && Array.isArray(filter.OR)) {
      for (let i = 0; i < filter.OR.length; i++) {
        if (this._evaluateOneSlotFilter(kernel, slot, filter.OR[i])) return true;
      }
      return false;
    }

    const key = filter.key as string;
    const keyId = kernel.arena.nodePropDict.lookup(key);
    let actualValue: unknown = undefined;
    if (keyId >= 0) {
      const col = kernel.arena.nodeColumns.getColumnByKeyId(keyId);
      if (col && col.tags[slot] !== TAG_ABSENT) {
        actualValue = col.get(slot);
      }
    }
    return this._matchOp(actualValue, filter.value, (filter.op as string) || '=');
  }

  private _evaluatePropertyFilters(
    nodeProps: Readonly<Record<string, unknown>>,
    filters: PropertyFilter[],
  ): boolean {
    for (const filter of filters) {
      if (!this._evaluateOneFilter(nodeProps, filter)) return false;
    }
    return true;
  }

  private _evaluateOneFilter(
    nodeProps: Readonly<Record<string, unknown>>,
    filter: PropertyFilter,
  ): boolean {
    if (filter.AND && Array.isArray(filter.AND)) {
      return filter.AND.every((f) => this._evaluateOneFilter(nodeProps, f));
    }
    if (filter.OR && Array.isArray(filter.OR)) {
      return filter.OR.some((f) => this._evaluateOneFilter(nodeProps, f));
    }
    const key = filter.key as string;
    const op = (filter.op as string) || '=';
    return this._matchOp(nodeProps[key], filter.value, op);
  }

  private _matchOp(actualValue: unknown, expectedValue: unknown, op: string): boolean {
    switch (op) {
      case '=': return actualValue === expectedValue;
      case '<>': return actualValue !== expectedValue;
      case '>': return compareValues(actualValue, expectedValue, '>');
      case '<': return compareValues(actualValue, expectedValue, '<');
      case '>=': return compareValues(actualValue, expectedValue, '>=');
      case '<=': return compareValues(actualValue, expectedValue, '<=');
      case 'CONTAINS': return typeof actualValue === 'string' && actualValue.includes(expectedValue as string);
      case 'STARTS_WITH': return typeof actualValue === 'string' && actualValue.startsWith(expectedValue as string);
      case 'ENDS_WITH': return typeof actualValue === 'string' && actualValue.endsWith(expectedValue as string);
      case 'IN': return Array.isArray(expectedValue) && expectedValue.includes(actualValue);
      case 'NOT_IN': return Array.isArray(expectedValue) && !expectedValue.includes(actualValue);
      case 'IS_NULL': return actualValue == null;
      case 'IS_NOT_NULL': return actualValue != null;
      default: return false;
    }
  }

  // ── NodeSeekStep ───────────────────────────────────────────────

  async executeNodeSeek(
    step: NodeSeekStep,
    rows: Row[],
    params: Record<string, unknown>,
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    let nodes: readonly Node[];

    switch (step.index) {
      case 'id': {
        const id = this._evaluator.resolveParam(step.value, params);
        const node = await this._graph.getNode(String(id ?? ''), transaction);
        nodes = node ? [node] : [];
        break;
      }
      case 'property': {
        const resolvedValue = this._evaluator.resolveParam(step.value, params);
        const filter: NonNullable<GraphQueryOptions['filter']> = {
          properties: [{ key: step.key!, value: resolvedValue, op: '=' }],
        };
        if (step.types?.length) filter.types = step.types;
        nodes = await this._graph.getNodes({ filter, transaction });
        break;
      }
      default:
        nodes = [];
    }

    return this._crossJoinNodes(rows, nodes, slotTable.getOrAdd(step.variable));
  }

  executeNodeSeekSync(
    kernel: ISyncGraphKernel,
    step: NodeSeekStep,
    rows: Row[],
    params: Record<string, unknown>,
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Row[] {
    if (rows.length === 0) return [];
    const txHandle = transaction?._getHandle();
    let nodes: Node[];

    switch (step.index) {
      case 'id': {
        const id = this._evaluator.resolveParam(step.value, params);
        const node = kernel.getNodeSync(String(id ?? ''), txHandle);
        nodes = node ? [node] : [];
        break;
      }
      case 'property': {
        const resolvedValue = this._evaluator.resolveParam(step.value, params);
        const filter: NonNullable<GraphQueryOptions['filter']> = {
          properties: [{ key: step.key!, value: resolvedValue, op: '=' }],
        };
        if (step.types?.length) filter.types = step.types;
        nodes = kernel.queryNodesSync({ filter, transaction: txHandle });
        break;
      }
      default:
        nodes = [];
    }

    return this._crossJoinNodes(rows, nodes, slotTable.getOrAdd(step.variable));
  }

  // ── EdgeExpandStep ─────────────────────────────────────────────

  async executeEdgeExpand(
    step: EdgeExpandStep,
    rows: Row[],
    _params: Record<string, unknown>,
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (rows.length === 0) return [];

    const srcSlotVar = slotTable.getOrAdd(step.source);
    const tgtSlotVar = slotTable.getOrAdd(step.target);
    const edgeSlotVar = step.edgeVar ? slotTable.getOrAdd(step.edgeVar) : -1;
    const pathSlotVar = step.pathVar ? slotTable.getOrAdd(step.pathVar) : -1;

    const boundRows: Array<{ row: Row; sourceNode: Node }> = [];
    const nodeCache = new Map<string, Node>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawSrc = row[srcSlotVar];
      if (rawSrc === UNBOUND || !rawSrc) continue;
      const sourceNode = rawSrc as Node;
      boundRows.push({ row, sourceNode });
      nodeCache.set(sourceNode.id, sourceNode);
    }
    if (boundRows.length === 0) return [];

    const edgeOptions: GraphQueryOptions = step.types.length > 0
      ? { filter: { types: step.types }, transaction }
      : { transaction };

    const adjCache = new Map<string, readonly Edge[]>();
    if (step.strategy === 'single-hop') {
      return this._expandSingleHopBatchAsync(
        step,
        boundRows,
        edgeOptions,
        adjCache,
        nodeCache,
        tgtSlotVar,
        edgeSlotVar,
        pathSlotVar,
        transaction,
      );
    }
    return this._expandMultiHopBatchAsync(
      step,
      boundRows,
      edgeOptions,
      adjCache,
      nodeCache,
      tgtSlotVar,
      edgeSlotVar,
      pathSlotVar,
      transaction,
    );
  }

  private async _loadEdgesAndTargetsBatch(
    nodeIds: readonly string[],
    step: EdgeExpandStep,
    edgeOptions: GraphQueryOptions,
    adjCache: Map<string, readonly Edge[]>,
    nodeCache: Map<string, Node>,
    transaction?: GraphTransaction,
  ): Promise<void> {
    const missingSourceIds: string[] = [];
    const seenSources = new Set<string>();
    for (let i = 0; i < nodeIds.length; i++) {
      const id = nodeIds[i]!;
      if (!adjCache.has(id) && !seenSources.has(id)) {
        seenSources.add(id);
        missingSourceIds.push(id);
      }
    }
    if (missingSourceIds.length === 0) return;

    if (missingSourceIds.length === 1) {
      const edges = await this._graph._getAdjacentEdges(step.direction, missingSourceIds[0]!, edgeOptions);
      adjCache.set(missingSourceIds[0]!, edges);
    } else {
      const edgesMap = await this._graph._getAdjacentEdgesBatch(step.direction, missingSourceIds, edgeOptions);
      for (const id of missingSourceIds) {
        adjCache.set(id, edgesMap.get(id) ?? []);
      }
    }

    const missingNodeIds: string[] = [];
    const seenMissingNodes = new Set<string>();
    for (const sourceId of missingSourceIds) {
      const edges = adjCache.get(sourceId)!;
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i]!;
        const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
        if (!nodeCache.has(targetId) && !seenMissingNodes.has(targetId)) {
          seenMissingNodes.add(targetId);
          missingNodeIds.push(targetId);
        }
      }
    }

    if (missingNodeIds.length > 0) {
      const fetchedNodes = await this._graph.getNodesByIds(missingNodeIds, transaction);
      for (const [id, node] of fetchedNodes) {
        nodeCache.set(id, node);
      }
    }
  }

  private async _expandSingleHopBatchAsync(
    step: EdgeExpandStep,
    boundRows: ReadonlyArray<{ row: Row; sourceNode: Node }>,
    edgeOptions: GraphQueryOptions,
    adjCache: Map<string, readonly Edge[]>,
    nodeCache: Map<string, Node>,
    tgtSlotVar: number,
    edgeSlotVar: number,
    pathSlotVar: number,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    await this._loadEdgesAndTargetsBatch(
      boundRows.map((b) => b.sourceNode.id),
      step,
      edgeOptions,
      adjCache,
      nodeCache,
      transaction,
    );

    const result: Row[] = [];
    for (let i = 0; i < boundRows.length; i++) {
      const { row, sourceNode } = boundRows[i]!;
      const edges = adjCache.get(sourceNode.id) ?? [];
      const existingRaw = row[tgtSlotVar];
      const existingTarget = existingRaw !== UNBOUND ? (existingRaw as Node | undefined) : undefined;

      for (let eIdx = 0; eIdx < edges.length; eIdx++) {
        const edge = edges[eIdx]!;
        const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
        const targetNode = nodeCache.get(targetId);
        if (!targetNode) continue;

        if (
          step.targetTypes &&
          step.targetTypes.length > 0 &&
          !targetNode.labels.some((l) => step.targetTypes!.includes(l))
        ) {
          continue;
        }
        if (existingTarget && existingTarget.id !== targetNode.id) continue;

        const newRow = row.slice();
        if (edgeSlotVar >= 0) newRow[edgeSlotVar] = edge;
        newRow[tgtSlotVar] = targetNode;

        if (pathSlotVar >= 0) {
          const existingPath = newRow[pathSlotVar];
          if (existingPath !== UNBOUND && Array.isArray(existingPath) && existingPath.length > 0) {
            newRow[pathSlotVar] = [...existingPath, edge, targetNode];
          } else {
            newRow[pathSlotVar] = [sourceNode, edge, targetNode];
          }
        }
        result.push(newRow);
      }
    }
    return result;
  }

  private async _expandMultiHopBatchAsync(
    step: EdgeExpandStep,
    boundRows: ReadonlyArray<{ row: Row; sourceNode: Node }>,
    edgeOptions: GraphQueryOptions,
    adjCache: Map<string, readonly Edge[]>,
    nodeCache: Map<string, Node>,
    tgtSlotVar: number,
    edgeSlotVar: number,
    pathSlotVar: number,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.maxHops <= 0) return [];
    const needPath = pathSlotVar >= 0;

    if (step.strategy === 'multi-hop-dfs') {
      await this._loadEdgesAndTargetsBatch(
        boundRows.map((b) => b.sourceNode.id),
        step,
        edgeOptions,
        adjCache,
        nodeCache,
        transaction,
      );
      const out: Row[] = [];
      for (let i = 0; i < boundRows.length; i++) {
        const { row, sourceNode } = boundRows[i]!;
        const existingRaw = row[tgtSlotVar];
        const existingTarget = existingRaw !== UNBOUND ? (existingRaw as Node | undefined) : undefined;
        const stack: FrontierNodeItem[] = [{
          node: sourceNode,
          hops: 0,
          pathNodes: needPath ? [sourceNode] : undefined,
          pathEdges: needPath ? [] : undefined,
        }];
        while (stack.length > 0) {
          const item = stack.pop()!;
          if (item.hops >= step.maxHops) continue;
          await this._loadEdgesAndTargetsBatch(
            [item.node.id],
            step,
            edgeOptions,
            adjCache,
            nodeCache,
            transaction,
          );
          const nextItems: FrontierNodeItem[] = [];
          this._expandMultiHopItem(
            step,
            row,
            existingTarget,
            item,
            adjCache.get(item.node.id) ?? [],
            nodeCache,
            tgtSlotVar,
            edgeSlotVar,
            pathSlotVar,
            out,
            nextItems,
          );
          for (let j = 0; j < nextItems.length; j++) {
            stack.push(nextItems[j]!);
          }
        }
      }
      return out;
    }

    // Level-synchronous batched BFS preserves per-row BFS output order while limiting RTTs to <= 2 * maxHops.
    const resultsByRow: Row[][] = boundRows.map(() => []);
    let currentLevel = boundRows.map((bound, rowIdx) => {
      const existingRaw = bound.row[tgtSlotVar];
      return {
        rowIdx,
        row: bound.row,
        existingTarget: existingRaw !== UNBOUND ? (existingRaw as Node | undefined) : undefined,
        item: {
          node: bound.sourceNode,
          hops: 0,
          pathNodes: needPath ? [bound.sourceNode] : undefined,
          pathEdges: needPath ? [] : undefined,
        } as FrontierNodeItem,
      };
    });

    for (let hop = 0; hop < step.maxHops && currentLevel.length > 0; hop++) {
      await this._loadEdgesAndTargetsBatch(
        currentLevel.map((entry) => entry.item.node.id),
        step,
        edgeOptions,
        adjCache,
        nodeCache,
        transaction,
      );

      const nextLevel: typeof currentLevel = [];
      for (let i = 0; i < currentLevel.length; i++) {
        const entry = currentLevel[i]!;
        const nextItems: FrontierNodeItem[] = [];
        this._expandMultiHopItem(
          step,
          entry.row,
          entry.existingTarget,
          entry.item,
          adjCache.get(entry.item.node.id) ?? [],
          nodeCache,
          tgtSlotVar,
          edgeSlotVar,
          pathSlotVar,
          resultsByRow[entry.rowIdx]!,
          nextItems,
        );
        for (let j = 0; j < nextItems.length; j++) {
          nextLevel.push({
            rowIdx: entry.rowIdx,
            row: entry.row,
            existingTarget: entry.existingTarget,
            item: nextItems[j]!,
          });
        }
      }
      currentLevel = nextLevel;
    }

    const out: Row[] = [];
    for (let i = 0; i < resultsByRow.length; i++) {
      const rowMatches = resultsByRow[i]!;
      for (let j = 0; j < rowMatches.length; j++) {
        out.push(rowMatches[j]!);
      }
    }
    return out;
  }

  private _expandMultiHopItem(
    step: EdgeExpandStep,
    row: Row,
    existingTarget: Node | undefined,
    item: FrontierNodeItem,
    edges: readonly Edge[],
    nodeCache: Map<string, Node>,
    tgtSlotVar: number,
    edgeSlotVar: number,
    pathSlotVar: number,
    emittedRows: Row[],
    nextFrontier: FrontierNodeItem[],
  ): void {
    const needPath = pathSlotVar >= 0;
    const { hops, usedEdgeIds, pathNodes, pathEdges } = item;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]!;
      // Per-path relationship uniqueness (openCypher trail semantics)
      const edgeUsed = needPath
        ? (pathEdges !== undefined && pathEdges.some((pe) => pe.id === edge.id))
        : (usedEdgeIds !== undefined && usedEdgeIds.includes(edge.id));
      if (edgeUsed) continue;

      const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
      const targetNode = nodeCache.get(targetId);
      if (!targetNode) continue;

      const newHops = hops + 1;
      const matchesTargetLabels =
        !step.targetTypes ||
        step.targetTypes.length === 0 ||
        targetNode.labels.some((l) => step.targetTypes!.includes(l));
      const canEmit =
        newHops >= step.minHops &&
        newHops <= step.maxHops &&
        matchesTargetLabels &&
        (!existingTarget || existingTarget.id === targetNode.id);
      const canExpand = newHops < step.maxHops;

      const newPathNodes = needPath && (canEmit || canExpand) ? [...(pathNodes ?? []), targetNode] : undefined;
      const newPathEdges = needPath && (canEmit || canExpand) ? [...(pathEdges ?? []), edge] : undefined;

      if (canEmit) {
        const newRow = row.slice();
        if (edgeSlotVar >= 0) newRow[edgeSlotVar] = edge;
        newRow[tgtSlotVar] = targetNode;
        if (needPath && newPathNodes && newPathEdges) {
          const pathValue: (Node | Edge)[] = [newPathNodes[0]!];
          for (let p = 0; p < newPathEdges.length; p++) {
            pathValue.push(newPathEdges[p]!, newPathNodes[p + 1]!);
          }
          newRow[pathSlotVar] = pathValue;
        }
        emittedRows.push(newRow);
      }

      if (canExpand) {
        nextFrontier.push({
          node: targetNode,
          hops: newHops,
          usedEdgeIds: needPath
            ? undefined
            : usedEdgeIds
              ? [...usedEdgeIds, edge.id]
              : [edge.id],
          pathNodes: newPathNodes,
          pathEdges: newPathEdges,
        });
      }
    }
  }

  // ── Sync CSR + Delta EdgeExpand ──────────────────────────────────

  executeEdgeExpandSync(
    kernel: ISyncGraphKernel,
    step: EdgeExpandStep,
    rows: Row[],
    _params: Record<string, unknown>,
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Row[] {
    if (rows.length === 0) return [];

    const srcSlotVar = slotTable.getOrAdd(step.source);
    const tgtSlotVar = slotTable.getOrAdd(step.target);
    const edgeSlotVar = step.edgeVar ? slotTable.getOrAdd(step.edgeVar) : -1;
    const pathSlotVar = step.pathVar ? slotTable.getOrAdd(step.pathVar) : -1;
    const txHandle = transaction?._getHandle();

    if (txHandle !== undefined) {
      const out: Row[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rawSrc = row[srcSlotVar];
        if (rawSrc === UNBOUND || !rawSrc) continue;
        this._expandFromNodeTxSync(
          kernel,
          step,
          row,
          rawSrc as Node,
          tgtSlotVar,
          edgeSlotVar,
          pathSlotVar,
          txHandle,
          out,
        );
      }
      return out;
    }

    const arena = kernel.arena;

    // Precompile allowed edge type IDs
    let singleTypeId = -1;
    let allowedTypeSet: Set<number> | null = null;
    if (step.types.length > 0) {
      const knownIds: number[] = [];
      for (let i = 0; i < step.types.length; i++) {
        const tid = arena.edgeTypeDict.lookup(step.types[i]);
        if (tid >= 0) knownIds.push(tid);
      }
      if (knownIds.length === 0) return [];
      if (knownIds.length === 1) {
        singleTypeId = knownIds[0];
      } else {
        allowedTypeSet = new Set(knownIds);
      }
    }

    // Precompile target label bitmask
    let targetMask: Bitmask64Query | undefined;
    if (step.targetTypes && step.targetTypes.length > 0) {
      const compiled = arena.labelDict.buildQueryMask(step.targetTypes);
      if (compiled === null) return [];
      targetMask = compiled;
    }

    const needEdgeEntity = edgeSlotVar >= 0 || pathSlotVar >= 0;
    const out: Row[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawSrc = row[srcSlotVar];
      if (rawSrc === UNBOUND || !rawSrc) continue;
      const sourceNode = rawSrc as Node;

      const srcSlot =
        sourceNode._slot !== undefined &&
        arena.nodeAlive[sourceNode._slot] === 1 &&
        arena.nodeIds[sourceNode._slot] === sourceNode.id
          ? sourceNode._slot
          : kernel.getNodeSlot(sourceNode.id);
      if (srcSlot < 0) continue;

      if (step.strategy === 'single-hop') {
        this._expandSingleHopKernelSync(
          kernel,
          step,
          row,
          sourceNode,
          srcSlot,
          tgtSlotVar,
          edgeSlotVar,
          pathSlotVar,
          singleTypeId,
          allowedTypeSet,
          targetMask,
          needEdgeEntity,
          out,
        );
      } else {
        this._expandMultiHopKernelSync(
          kernel,
          step,
          row,
          sourceNode,
          srcSlot,
          tgtSlotVar,
          edgeSlotVar,
          pathSlotVar,
          singleTypeId,
          allowedTypeSet,
          targetMask,
          out,
        );
      }
    }

    return out;
  }

  private _expandSingleHopKernelSync(
    kernel: ISyncGraphKernel,
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
    srcSlot: number,
    tgtSlotVar: number,
    edgeSlotVar: number,
    pathSlotVar: number,
    singleTypeId: number,
    allowedTypeSet: Set<number> | null,
    targetMask: Bitmask64Query | undefined,
    needEdgeEntity: boolean,
    out: Row[],
  ): void {
    const arena = kernel.arena;
    const adj = kernel.adjacency;
    const edgeAlive = arena.edgeAlive;
    const nodeAlive = arena.nodeAlive;
    const isOut = step.direction === 'out';

    const existingRaw = row[tgtSlotVar];
    const existingTarget = existingRaw !== UNBOUND ? (existingRaw as Node | undefined) : undefined;
    let existingTargetSlot = -2; // -2 = none
    if (existingTarget) {
      existingTargetSlot =
        existingTarget._slot !== undefined &&
        nodeAlive[existingTarget._slot] === 1 &&
        arena.nodeIds[existingTarget._slot] === existingTarget.id
          ? existingTarget._slot
          : kernel.getNodeSlot(existingTarget.id);
      if (existingTargetSlot < 0) return;
    }

    const existingPath =
      pathSlotVar >= 0 && row[pathSlotVar] !== UNBOUND && Array.isArray(row[pathSlotVar]) && (row[pathSlotVar] as unknown[]).length > 0
        ? (row[pathSlotVar] as (Node | Edge)[])
        : undefined;

    const visitSlice = (entries: Uint32Array, start: number, end: number): void => {
      for (let i = start; i < end; i += 3) {
        const edgeSlot = entries[i];
        if (edgeAlive[edgeSlot] === 0) continue;

        const typeId = entries[i + 2];
        if (singleTypeId >= 0 && typeId !== singleTypeId) continue;
        if (allowedTypeSet && !allowedTypeSet.has(typeId)) continue;

        const neighborSlot = entries[i + 1];
        if (nodeAlive[neighborSlot] === 0) continue;
        if (existingTargetSlot >= 0 && neighborSlot !== existingTargetSlot) continue;
        if (targetMask && !arena.matchesNodeLabelMask(neighborSlot, targetMask)) continue;

        const targetNode = kernel.getNodeEntityBySlot(neighborSlot);
        const newRow = row.slice();
        newRow[tgtSlotVar] = targetNode;

        if (needEdgeEntity) {
          const edgeObj = kernel.getEdgeEntityBySlot(edgeSlot);
          if (edgeSlotVar >= 0) newRow[edgeSlotVar] = edgeObj;
          if (pathSlotVar >= 0) {
            newRow[pathSlotVar] = existingPath
              ? [...existingPath, edgeObj, targetNode]
              : [sourceNode, edgeObj, targetNode];
          }
        }
        out.push(newRow);
      }
    };

    if (isOut) {
      const csrEntries = adj.getCsrOutEntries();
      const csrStart = adj.getCsrOutStart(srcSlot);
      const csrEnd = adj.getCsrOutEnd(srcSlot);
      if (csrStart < csrEnd) visitSlice(csrEntries, csrStart, csrEnd);

      const dBuf = adj.getDeltaOutBuf(srcSlot);
      const dWords = adj.getDeltaOutWordLen(srcSlot);
      if (dBuf && dWords > 0) visitSlice(dBuf, 0, dWords);
    } else {
      const csrEntries = adj.getCsrInEntries();
      const csrStart = adj.getCsrInStart(srcSlot);
      const csrEnd = adj.getCsrInEnd(srcSlot);
      if (csrStart < csrEnd) visitSlice(csrEntries, csrStart, csrEnd);

      const dBuf = adj.getDeltaInBuf(srcSlot);
      const dWords = adj.getDeltaInWordLen(srcSlot);
      if (dBuf && dWords > 0) visitSlice(dBuf, 0, dWords);
    }
  }

  private _expandMultiHopKernelSync(
    kernel: ISyncGraphKernel,
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
    srcSlot: number,
    tgtSlotVar: number,
    edgeSlotVar: number,
    pathSlotVar: number,
    singleTypeId: number,
    allowedTypeSet: Set<number> | null,
    targetMask: Bitmask64Query | undefined,
    out: Row[],
  ): void {
    const arena = kernel.arena;
    const adj = kernel.adjacency;
    const edgeAlive = arena.edgeAlive;
    const nodeAlive = arena.nodeAlive;
    const isOut = step.direction === 'out';
    const isBFS = step.strategy !== 'multi-hop-dfs';
    const needPath = pathSlotVar >= 0;

    const existingRaw = row[tgtSlotVar];
    const existingTarget = existingRaw !== UNBOUND ? (existingRaw as Node | undefined) : undefined;
    let existingTargetSlot = -2;
    if (existingTarget) {
      existingTargetSlot =
        existingTarget._slot !== undefined &&
        nodeAlive[existingTarget._slot] === 1 &&
        arena.nodeIds[existingTarget._slot] === existingTarget.id
          ? existingTarget._slot
          : kernel.getNodeSlot(existingTarget.id);
      if (existingTargetSlot < 0) return;
    }

    const queue = isBFS ? new RingQueue<FrontierKernelItem>() : undefined;
    const stack: FrontierKernelItem[] = [];
    const initial: FrontierKernelItem = {
      nodeSlot: srcSlot,
      hops: 0,
      pathNodeSlots: needPath ? [srcSlot] : undefined,
      pathEdgeSlots: needPath ? [] : undefined,
    };
    if (queue) queue.push(initial);
    else stack.push(initial);

    const csrEntries = isOut ? adj.getCsrOutEntries() : adj.getCsrInEntries();

    const expandSlice = (
      entries: Uint32Array,
      start: number,
      end: number,
      hops: number,
      usedEdgeSlots: number[] | undefined,
      pathNodeSlots: number[] | undefined,
      pathEdgeSlots: number[] | undefined,
    ): void => {
      for (let i = start; i < end; i += 3) {
        const edgeSlot = entries[i];
        if (edgeAlive[edgeSlot] === 0) continue;

        const typeId = entries[i + 2];
        if (singleTypeId >= 0 && typeId !== singleTypeId) continue;
        if (allowedTypeSet && !allowedTypeSet.has(typeId)) continue;

        // Per-path relationship uniqueness (openCypher trail semantics)
        const activeUsedEdges = needPath ? pathEdgeSlots : usedEdgeSlots;
        if (activeUsedEdges !== undefined && activeUsedEdges.includes(edgeSlot)) {
          continue;
        }

        const neighborSlot = entries[i + 1];
        if (nodeAlive[neighborSlot] === 0) continue;

        const newHops = hops + 1;
        const canEmit =
          newHops >= step.minHops &&
          newHops <= step.maxHops &&
          (existingTargetSlot < 0 || neighborSlot === existingTargetSlot) &&
          (!targetMask || arena.matchesNodeLabelMask(neighborSlot, targetMask));
        const canExpand = newHops < step.maxHops;

        const newPathNodeSlots =
          needPath && (canEmit || canExpand) ? [...pathNodeSlots!, neighborSlot] : undefined;
        const newPathEdgeSlots =
          needPath && (canEmit || canExpand) ? [...pathEdgeSlots!, edgeSlot] : undefined;

        if (canEmit) {
          const newRow = row.slice();
          const targetNode = kernel.getNodeEntityBySlot(neighborSlot);
          newRow[tgtSlotVar] = targetNode;
          if (edgeSlotVar >= 0) {
            newRow[edgeSlotVar] = kernel.getEdgeEntityBySlot(edgeSlot);
          }
          if (needPath && newPathNodeSlots && newPathEdgeSlots) {
            const pathValue: (Node | Edge)[] = [
              newPathNodeSlots[0] === srcSlot
                ? sourceNode
                : kernel.getNodeEntityBySlot(newPathNodeSlots[0]),
            ];
            for (let k = 0; k < newPathEdgeSlots.length; k++) {
              pathValue.push(
                kernel.getEdgeEntityBySlot(newPathEdgeSlots[k]),
                k === newPathEdgeSlots.length - 1
                  ? targetNode
                  : kernel.getNodeEntityBySlot(newPathNodeSlots[k + 1]),
              );
            }
            newRow[pathSlotVar] = pathValue;
          }
          out.push(newRow);
        }

        if (canExpand) {
          const nextItem: FrontierKernelItem = {
            nodeSlot: neighborSlot,
            hops: newHops,
            usedEdgeSlots: needPath
              ? undefined
              : usedEdgeSlots
                ? [...usedEdgeSlots, edgeSlot]
                : [edgeSlot],
            pathNodeSlots: newPathNodeSlots,
            pathEdgeSlots: newPathEdgeSlots,
          };
          if (queue) queue.push(nextItem);
          else stack.push(nextItem);
        }
      }
    };

    while ((queue ? queue.length : stack.length) > 0) {
      const item = queue ? queue.shift()! : stack.pop()!;
      if (item.hops >= step.maxHops) continue;
      const uSlot = item.nodeSlot;

      const csrStart = isOut ? adj.getCsrOutStart(uSlot) : adj.getCsrInStart(uSlot);
      const csrEnd = isOut ? adj.getCsrOutEnd(uSlot) : adj.getCsrInEnd(uSlot);
      if (csrStart < csrEnd) {
        expandSlice(csrEntries, csrStart, csrEnd, item.hops, item.usedEdgeSlots, item.pathNodeSlots, item.pathEdgeSlots);
      }

      const dBuf = isOut ? adj.getDeltaOutBuf(uSlot) : adj.getDeltaInBuf(uSlot);
      const dWords = isOut ? adj.getDeltaOutWordLen(uSlot) : adj.getDeltaInWordLen(uSlot);
      if (dBuf && dWords > 0) {
        expandSlice(dBuf, 0, dWords, item.hops, item.usedEdgeSlots, item.pathNodeSlots, item.pathEdgeSlots);
      }
    }
  }

  private _expandFromNodeTxSync(
    kernel: ISyncGraphKernel,
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
    tgtSlotVar: number,
    edgeSlotVar: number,
    pathSlotVar: number,
    txHandle: ITransactionHandle,
    out: Row[],
  ): void {
    const queryOpts: StorageQueryOptions =
      step.types.length > 0
        ? { filter: { types: step.types }, transaction: txHandle }
        : { transaction: txHandle };

    const existingRaw = row[tgtSlotVar];
    const existingTarget = existingRaw !== UNBOUND ? (existingRaw as Node | undefined) : undefined;

    if (step.strategy === 'single-hop') {
      const edges =
        step.direction === 'out'
          ? kernel.getEdgesBySourceSync(sourceNode.id, queryOpts)
          : kernel.getEdgesByTargetSync(sourceNode.id, queryOpts);

      const targetIds = edges.map((e) => (step.direction === 'out' ? e.targetId : e.sourceId));
      const uniqueIds = [...new Set(targetIds)];
      const nodeMap = kernel.getNodesByIdsSync(uniqueIds, txHandle);

      for (const edge of edges) {
        const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
        const targetNode = nodeMap.get(targetId);
        if (!targetNode) continue;

        if (
          step.targetTypes?.length &&
          !targetNode.labels.some((l) => step.targetTypes!.includes(l))
        ) {
          continue;
        }
        if (existingTarget && existingTarget.id !== targetNode.id) continue;

        const newRow = row.slice();
        if (edgeSlotVar >= 0) newRow[edgeSlotVar] = edge;
        newRow[tgtSlotVar] = targetNode;
        if (pathSlotVar >= 0) {
          const existingPath = newRow[pathSlotVar];
          if (existingPath !== UNBOUND && Array.isArray(existingPath) && existingPath.length > 0) {
            newRow[pathSlotVar] = [...existingPath, edge, targetNode];
          } else {
            newRow[pathSlotVar] = [sourceNode, edge, targetNode];
          }
        }
        out.push(newRow);
      }
      return;
    }

    const needPath = pathSlotVar >= 0;
    const isBFS = step.strategy !== 'multi-hop-dfs';
    const queue = isBFS ? new RingQueue<FrontierNodeItem>() : undefined;
    const stack: FrontierNodeItem[] = [];
    const initial: FrontierNodeItem = {
      node: sourceNode,
      hops: 0,
      pathNodes: needPath ? [sourceNode] : undefined,
      pathEdges: needPath ? [] : undefined,
    };
    if (queue) queue.push(initial);
    else stack.push(initial);

    while ((queue ? queue.length : stack.length) > 0) {
      const { node, hops, usedEdgeIds, pathNodes, pathEdges } = queue ? queue.shift()! : stack.pop()!;
      if (hops >= step.maxHops) continue;

      const edges =
        step.direction === 'out'
          ? kernel.getEdgesBySourceSync(node.id, queryOpts)
          : kernel.getEdgesByTargetSync(node.id, queryOpts);

      const targetIds = edges.map((e) => (step.direction === 'out' ? e.targetId : e.sourceId));
      const uniqueIds = [...new Set(targetIds)];
      const nodeMap = kernel.getNodesByIdsSync(uniqueIds, txHandle);

      for (const edge of edges) {
        // Per-path relationship uniqueness (openCypher trail semantics)
        const edgeUsed = needPath
          ? (pathEdges !== undefined && pathEdges.some((pe) => pe.id === edge.id))
          : (usedEdgeIds !== undefined && usedEdgeIds.includes(edge.id));
        if (edgeUsed) continue;

        const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
        const targetNode = nodeMap.get(targetId);
        if (!targetNode) continue;

        const newHops = hops + 1;
        const matchesTargetLabels =
          !step.targetTypes?.length ||
          targetNode.labels.some((l) => step.targetTypes!.includes(l));
        const canEmit =
          newHops >= step.minHops &&
          newHops <= step.maxHops &&
          matchesTargetLabels &&
          (!existingTarget || existingTarget.id === targetNode.id);
        const canExpand = newHops < step.maxHops;

        const newPathNodes = needPath && (canEmit || canExpand) ? [...(pathNodes ?? []), targetNode] : undefined;
        const newPathEdges = needPath && (canEmit || canExpand) ? [...(pathEdges ?? []), edge] : undefined;

        if (canEmit) {
          const newRow = row.slice();
          if (edgeSlotVar >= 0) newRow[edgeSlotVar] = edge;
          newRow[tgtSlotVar] = targetNode;
          if (needPath && newPathNodes && newPathEdges) {
            const pathValue: (Node | Edge)[] = [newPathNodes[0]];
            for (let k = 0; k < newPathEdges.length; k++) {
              pathValue.push(newPathEdges[k], newPathNodes[k + 1]);
            }
            newRow[pathSlotVar] = pathValue;
          }
          out.push(newRow);
        }

        if (canExpand) {
          const item: FrontierNodeItem = {
            node: targetNode,
            hops: newHops,
            usedEdgeIds: needPath
              ? undefined
              : usedEdgeIds
                ? [...usedEdgeIds, edge.id]
                : [edge.id],
            pathNodes: newPathNodes,
            pathEdges: newPathEdges,
          };
          if (queue) queue.push(item);
          else stack.push(item);
        }
      }
    }
  }
}
