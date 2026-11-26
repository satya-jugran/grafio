/**
 * High-performance in-memory storage engine backed by dense `uint32` slot arenas,
 * columnar TypedArray properties, Hybrid Global CSR + Delta adjacency lists,
 * opt-in scoped hash + sorted range indexes, and conflict-checked delta transactions.
 *
 * @module storage/InMemoryStorageProvider
 */

import type {
  AggregateResult,
  EdgeData,
  GraphData,
  ITransactionHandle,
  NodeData,
  ReadonlyNodeData,
  ReadonlyEdgeData,
  PropertyPatch,
  QueryOptionsFilterProperty,
  StorageQueryOptions,
} from '../types';
import {
  EdgeAlreadyExistsError,
  EdgeNotFoundError,
  InvalidPropertyError,
  NodeAlreadyExistsError,
  NodeHasEdgesError,
  NodeNotFoundError,
} from '../errors';
import { Node } from '../Node';
import { Edge } from '../Edge';
import { findInvalidPropertyEntry, isPrimitive } from '../utils';
import type {
  CreateIndexOptions,
  IndexMetadata,
  IStorageProvider,
  ISyncGraphKernel,
} from './IStorageProvider';
import { NONE_SLOT, SlotArena, type IdStrategy } from './engine/SlotArena';
import { AdjacencyStore } from './engine/AdjacencyStore';
import { PropertyIndexStore, type RangeOperator } from './engine/PropertyIndexStore';
import {
  TransactionManager,
  type TransactionContext,
  type UndoEntry,
} from './engine/TransactionManager';
import { Uint32SlotSet } from './engine/Uint32SlotSet';
import { ColumnStore, TAG_ABSENT, TAG_VALUE } from './engine/ColumnStore';

export interface InMemoryStorageProviderOptions {
  /**
   * Optional partition key identifying this graph.
   * Returned in `exportJSON().graphId`. Defaults to `'default'`.
   */
  graphId?: string;

  /**
   * ID generation strategy when callers omit `id`:
   * - `'compact'` (default): zero-CSPRNG `@n<slot>:<gen>` / `@e<slot>:<gen>` IDs
   *   enabling O(1) hash-free decoding.
   * - `'uuid'`: RFC-4122 v4 UUIDs via pooled CSPRNG.
   */
  idStrategy?: IdStrategy;
}

export class InMemoryStorageProvider implements IStorageProvider, ISyncGraphKernel {
  readonly __isSyncGraphKernel = true as const;
  readonly graphId: string;

  readonly arena: SlotArena;
  readonly adjacency: AdjacencyStore;
  readonly propertyIndexes: PropertyIndexStore;
  private readonly _txnManager: TransactionManager;
  private _undoStack: UndoEntry[] | null = null;

  constructor(options: InMemoryStorageProviderOptions = {}) {
    this.graphId = options.graphId ?? 'default';
    this.arena = new SlotArena(options.idStrategy ?? 'compact');
    this.adjacency = new AdjacencyStore(this.arena.nodeCapacity);
    this.propertyIndexes = new PropertyIndexStore();
    this._txnManager = new TransactionManager();

    this.arena.onNodeCapacityGrow = (newCap: number) => {
      this.adjacency.growNodes(newCap);
    };
  }

  get indexEpoch(): number {
    return this.propertyIndexes.indexEpoch;
  }

  get hasActiveTransactions(): boolean {
    return this._txnManager.hasActiveTransactions;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle & Compaction
  // ---------------------------------------------------------------------------

  async clear(): Promise<void> {
    this.clearSync();
  }

  clearSync(): void {
    this.arena.clear();
    this.adjacency.clear();
    this.propertyIndexes.clear();
    this._txnManager.clear();
    this._undoStack = null;
  }

  compact(): void {
    this.adjacency.buildCSR(
      this.arena.nodeHighWater,
      this.arena.edgeHighWater,
      this.arena.edgeAlive,
      this.arena.edgeSrcSlot,
      this.arena.edgeTgtSlot,
      this.arena.edgeTypeId,
    );
    this.arena.reclaimRetiredSlots();
  }

  // ---------------------------------------------------------------------------
  // ISyncGraphKernel Direct Slot & Entity Helpers
  // ---------------------------------------------------------------------------

  getNodeSlot(id: string): number {
    return this.arena.resolveNodeSlot(id);
  }

  getEdgeSlot(id: string): number {
    return this.arena.resolveEdgeSlot(id);
  }

  getNodeEntityBySlot(slot: number): Node {
    return this.arena.getNodeEntity(slot);
  }

  getEdgeEntityBySlot(slot: number): Edge {
    return this.arena.getEdgeEntity(slot);
  }

  // ---------------------------------------------------------------------------
  // Undo Checkpoints (Implicit Statement-Level Atomicity for Cypher Writes)
  // ---------------------------------------------------------------------------

  beginUndoCheckpoint(): void {
    this._undoStack = [];
  }

  commitUndoCheckpoint(): void {
    this._undoStack = null;
  }

  rollbackUndoCheckpoint(): void {
    const stack = this._undoStack;
    this._undoStack = null;
    if (!stack || stack.length === 0) return;

    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      switch (entry.kind) {
        case 'deleteNode': {
          const slot = this.arena.resolveNodeSlot(entry.id);
          if (slot >= 0) {
            const props = this.propertyIndexes.hasAnyNodeIndexes
              ? this.arena.nodeColumns.materializeRecord(slot)
              : {};
            this.propertyIndexes.onNodeDeleted(slot, this.arena.nodeLabelIds[slot], props);
            this.arena.detachNodeIncidentEdges(slot, this.adjacency);
            const delayReuse = this.adjacency.hasCsrEntries(slot);
            this.arena.freeNode(slot, delayReuse);
            this.adjacency.clearNodeDelta(slot);
          }
          break;
        }
        case 'deleteEdge': {
          const slot = this.arena.resolveEdgeSlot(entry.id);
          if (slot >= 0) {
            const props = this.propertyIndexes.hasAnyEdgeIndexes
              ? this.arena.edgeColumns.materializeRecord(slot)
              : {};
            this.propertyIndexes.onEdgeDeleted(slot, this.arena.edgeTypeId[slot], props);
            const removedFromDelta = this.adjacency.removeEdge(
              slot,
              this.arena.edgeSrcSlot[slot],
              this.arena.edgeTgtSlot[slot],
            );
            const delayReuse = !removedFromDelta || slot < this.adjacency.csrEdgeSlotBound;
            this.arena.freeEdge(slot, delayReuse);
          }
          break;
        }
        case 'restoreNode': {
          const d = entry.data;
          if (this.arena.resolveNodeSlot(d.id) < 0) {
            const slot = this.arena.allocateNode(
              d.labels,
              d.properties,
              d.id,
              d.createdOn,
              d.updatedOn,
            );
            this.arena.bindDanglingEdgesForNode(d.id, slot, this.adjacency);
            this.propertyIndexes.onNodeInserted(slot, this.arena.nodeLabelIds[slot], d.properties);
          }
          break;
        }
        case 'restoreEdge': {
          const e = entry.data;
          if (this.arena.resolveEdgeSlot(e.id) < 0) {
            const rawSrc = this.arena.resolveNodeSlot(e.sourceId);
            const rawTgt = this.arena.resolveNodeSlot(e.targetId);
            const srcSlot = rawSrc < 0 ? NONE_SLOT : rawSrc;
            const tgtSlot = rawTgt < 0 ? NONE_SLOT : rawTgt;
            const { slot, typeId } = this.arena.allocateEdge(
              srcSlot,
              tgtSlot,
              e.type,
              e.properties,
              e.id,
              e.createdOn,
              e.updatedOn,
              e.sourceId,
              e.targetId,
            );
            if (srcSlot !== NONE_SLOT && tgtSlot !== NONE_SLOT) {
              this.adjacency.addEdge(slot, srcSlot, tgtSlot, typeId);
            }
            this.propertyIndexes.onEdgeInserted(slot, typeId, e.properties);
          }
          break;
        }
        case 'restoreNodeProps': {
          const slot = this.arena.resolveNodeSlot(entry.id);
          if (slot >= 0) {
            const curProps = this.arena.nodeColumns.materializeRecord(slot);
            this.arena.invalidateNodeEntity(slot);
            this.arena.nodeColumns.clearSlot(slot);
            this.arena.nodeColumns.setRecord(slot, entry.props);
            this.propertyIndexes.onNodePropertiesUpdated(
              slot,
              this.arena.nodeLabelIds[slot],
              curProps,
              entry.props,
            );
          }
          break;
        }
        case 'restoreEdgeProps': {
          const slot = this.arena.resolveEdgeSlot(entry.id);
          if (slot >= 0) {
            const curProps = this.arena.edgeColumns.materializeRecord(slot);
            this.arena.invalidateEdgeEntity(slot);
            this.arena.edgeColumns.clearSlot(slot);
            this.arena.edgeColumns.setRecord(slot, entry.props);
            this.propertyIndexes.onEdgePropertiesUpdated(
              slot,
              this.arena.edgeTypeId[slot],
              curProps,
              entry.props,
            );
          }
          break;
        }
        case 'restoreNodeLabels': {
          const slot = this.arena.resolveNodeSlot(entry.id);
          if (slot >= 0) {
            const props = this.propertyIndexes.hasAnyNodeIndexes
              ? this.arena.nodeColumns.materializeRecord(slot)
              : {};
            this.propertyIndexes.onNodeDeleted(slot, this.arena.nodeLabelIds[slot], props);
            this.arena.setNodeLabelsBySlot(slot, entry.labels);
            this.propertyIndexes.onNodeInserted(slot, this.arena.nodeLabelIds[slot], props);
          }
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Node Mutations
  // ---------------------------------------------------------------------------

  async insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      this._txnManager.stageInsertNode(ctx, node, this.arena);
      return;
    }

    if (this.arena.resolveNodeSlot(node.id) >= 0) {
      throw new NodeAlreadyExistsError(node.id);
    }
    const slot = this.arena.allocateNode(
      node.labels,
      node.properties,
      node.id,
      node.createdOn,
      node.updatedOn,
    );
    this.arena.bindDanglingEdgesForNode(node.id, slot, this.adjacency);
    this.propertyIndexes.onNodeInserted(slot, this.arena.nodeLabelIds[slot], node.properties);
    this._txnManager.recordLiveNodeWrite(node.id);
    this._undoStack?.push({ kind: 'deleteNode', id: node.id });
  }

  async insertNodes(nodes: readonly NodeData[], transaction?: ITransactionHandle): Promise<void> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      for (let i = 0; i < nodes.length; i++) {
        this._txnManager.stageInsertNode(ctx, nodes[i], this.arena);
      }
      return;
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < nodes.length; i++) {
      const nid = nodes[i].id;
      if (seenIds.has(nid) || this.arena.resolveNodeSlot(nid) >= 0) {
        throw new NodeAlreadyExistsError(nid);
      }
      seenIds.add(nid);
    }

    this.arena.ensureNodeCapacity(this.arena.nodeHighWater + nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const slot = this.arena.allocateNode(
        node.labels,
        node.properties,
        node.id,
        node.createdOn,
        node.updatedOn,
      );
      this.arena.bindDanglingEdgesForNode(node.id, slot, this.adjacency);
      this.propertyIndexes.onNodeInserted(slot, this.arena.nodeLabelIds[slot], node.properties);
      this._txnManager.recordLiveNodeWrite(node.id);
      this._undoStack?.push({ kind: 'deleteNode', id: node.id });
    }
  }

  insertNodeSync(
    labels: readonly string[],
    properties: Readonly<Record<string, unknown>>,
    id?: string,
    transaction?: ITransactionHandle,
  ): Node {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      const node = new Node(labels, properties, id);
      this._txnManager.stageInsertNode(ctx, node.toJSON(), this.arena);
      return node;
    }

    if (id !== undefined && this.arena.resolveNodeSlot(id) >= 0) {
      throw new NodeAlreadyExistsError(id);
    }
    const slot = this.arena.allocateNode(labels, properties, id);
    const createdId = this.arena.nodeIds[slot];
    this.arena.bindDanglingEdgesForNode(createdId, slot, this.adjacency);
    this.propertyIndexes.onNodeInserted(slot, this.arena.nodeLabelIds[slot], properties);
    this._txnManager.recordLiveNodeWrite(createdId);
    this._undoStack?.push({ kind: 'deleteNode', id: createdId });
    return this.arena.getNodeEntity(slot);
  }

  insertNodesSync(
    items: ReadonlyArray<{
      labels: readonly string[];
      properties?: Readonly<Record<string, unknown>>;
      id?: string;
    }>,
    transaction?: ITransactionHandle,
  ): Node[] {
    const out = new Array<Node>(items.length);
    const ctx = this._txnManager.getContext(transaction);
    if (!ctx) {
      const seenIds = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const explicitId = items[i].id;
        if (explicitId !== undefined) {
          if (seenIds.has(explicitId) || this.arena.resolveNodeSlot(explicitId) >= 0) {
            throw new NodeAlreadyExistsError(explicitId);
          }
          seenIds.add(explicitId);
        }
      }
      this.arena.ensureNodeCapacity(this.arena.nodeHighWater + items.length);
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      out[i] = this.insertNodeSync(item.labels, item.properties ?? {}, item.id, transaction);
    }
    return out;
  }

  async deleteNode(id: string, transaction?: ITransactionHandle): Promise<void> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      this._txnManager.stageDeleteNode(ctx, id, this.arena);
      return;
    }

    const slot = this.arena.resolveNodeSlot(id);
    if (slot < 0) return;

    const props = (this.propertyIndexes.hasAnyNodeIndexes || this._undoStack !== null)
      ? this.arena.nodeColumns.materializeRecord(slot)
      : {};
    if (this._undoStack !== null) {
      this._undoStack.push({
        kind: 'restoreNode',
        data: {
          id,
          labels: [...this.arena.nodeLabelStrings[slot]],
          createdOn: this.arena.nodeCreatedOn[slot],
          updatedOn: this.arena.nodeUpdatedOn[slot],
          properties: { ...props },
        },
      });
    }

    this.propertyIndexes.onNodeDeleted(slot, this.arena.nodeLabelIds[slot], props);
    this.arena.detachNodeIncidentEdges(slot, this.adjacency);
    const delayReuse = this.adjacency.hasCsrEntries(slot);
    this.arena.freeNode(slot, delayReuse);
    this.adjacency.clearNodeDelta(slot);
    this._txnManager.recordLiveNodeWrite(id, undefined, true);
  }

  deleteNodeByIdSync(
    id: string,
    cascade: boolean,
    transaction?: ITransactionHandle,
  ): { result: boolean; cascadeDeletedEdgesCount?: number } {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      if (!this._hasNodeInCtx(id, ctx)) return { result: false };
      const outEdges = this._getEdgesBySourceInCtx(id, ctx);
      const inEdges = this._getEdgesByTargetInCtx(id, ctx);
      const incidentCount = outEdges.length + inEdges.length;
      if (!cascade) {
        if (incidentCount > 0) throw new NodeHasEdgesError(id, incidentCount);
      } else {
        for (let i = 0; i < outEdges.length; i++) {
          this._txnManager.stageDeleteEdge(ctx, outEdges[i].id, this.arena);
        }
        for (let i = 0; i < inEdges.length; i++) {
          this._txnManager.stageDeleteEdge(ctx, inEdges[i].id, this.arena);
        }
      }
      this._txnManager.stageDeleteNode(ctx, id, this.arena);
      return cascade ? { result: true, cascadeDeletedEdgesCount: incidentCount } : { result: true };
    }

    const slot = this.arena.resolveNodeSlot(id);
    if (slot < 0) return { result: false };

    const outDeg = this.adjacency.outDegree(slot);
    const inDeg = this.adjacency.inDegree(slot);
    const danglingOut = this.arena.hasDanglingEdges ? (this.arena.danglingOutEdges.get(id)?.size ?? 0) : 0;
    const danglingIn = this.arena.hasDanglingEdges ? (this.arena.danglingInEdges.get(id)?.size ?? 0) : 0;
    const incidentCount = outDeg + inDeg + danglingOut + danglingIn;

    if (!cascade) {
      if (incidentCount > 0) throw new NodeHasEdgesError(id, incidentCount);
    } else if (incidentCount > 0) {
      // Collect incident edge slots first since deletion mutates delta buffers
      const edgeSlots: number[] = [];
      this._collectIncidentEdgeSlots(slot, edgeSlots);
      for (let i = 0; i < edgeSlots.length; i++) {
        this._deleteEdgeBySlotLive(edgeSlots[i]);
      }
    }

    const props = (this.propertyIndexes.hasAnyNodeIndexes || this._undoStack !== null)
      ? this.arena.nodeColumns.materializeRecord(slot)
      : {};
    if (this._undoStack !== null) {
      this._undoStack.push({
        kind: 'restoreNode',
        data: {
          id,
          labels: [...this.arena.nodeLabelStrings[slot]],
          createdOn: this.arena.nodeCreatedOn[slot],
          updatedOn: this.arena.nodeUpdatedOn[slot],
          properties: { ...props },
        },
      });
    }

    this.propertyIndexes.onNodeDeleted(slot, this.arena.nodeLabelIds[slot], props);
    this.arena.detachNodeIncidentEdges(slot, this.adjacency);
    const delayReuse = this.adjacency.hasCsrEntries(slot);
    this.arena.freeNode(slot, delayReuse);
    this.adjacency.clearNodeDelta(slot);
    this._txnManager.recordLiveNodeWrite(id, undefined, true);
    return cascade
      ? { result: true, cascadeDeletedEdgesCount: incidentCount }
      : { result: true };
  }

  // ---------------------------------------------------------------------------
  // Node Queries
  // ---------------------------------------------------------------------------

  async hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) return this._hasNodeInCtx(id, ctx);
    return this.arena.resolveNodeSlot(id) >= 0;
  }

  async getNode(id: string, transaction?: ITransactionHandle): Promise<ReadonlyNodeData | undefined> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) return this._getNodeDataInCtx(id, ctx);
    const slot = this.arena.resolveNodeSlot(id);
    return slot >= 0 ? this._nodeDataBySlot(slot) : undefined;
  }

  getNodeSync(id: string, transaction?: ITransactionHandle): Node | undefined {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      const data = this._getNodeDataInCtx(id, ctx);
      return data
        ? Node._fromFrozen(
            data.id,
            data.labels,
            data.properties,
            data.createdOn ?? Date.now(),
            data.updatedOn ?? Date.now(),
          )
        : undefined;
    }
    const slot = this.arena.resolveNodeSlot(id);
    return slot >= 0 ? this.arena.getNodeEntity(slot) : undefined;
  }

  async getNodesByIds(
    ids: string[],
    transaction?: ITransactionHandle,
  ): Promise<Map<string, ReadonlyNodeData>> {
    const result = new Map<string, ReadonlyNodeData>();
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (result.has(id)) continue;
        const data = this._getNodeDataInCtx(id, ctx);
        if (data) result.set(id, data);
      }
      return result;
    }

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (result.has(id)) continue;
      const slot = this.arena.resolveNodeSlot(id);
      if (slot >= 0) {
        result.set(id, this._nodeDataBySlot(slot));
      }
    }
    return result;
  }

  getNodesByIdsSync(
    ids: readonly string[],
    transaction?: ITransactionHandle,
  ): Map<string, Node> {
    const result = new Map<string, Node>();
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (result.has(id)) continue;
        const data = this._getNodeDataInCtx(id, ctx);
        if (data) {
          result.set(
            id,
            Node._fromFrozen(
              data.id,
              data.labels,
              data.properties,
              data.createdOn ?? Date.now(),
              data.updatedOn ?? Date.now(),
            ),
          );
        }
      }
      return result;
    }

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (result.has(id)) continue;
      const slot = this.arena.resolveNodeSlot(id);
      if (slot >= 0) {
        result.set(id, this.arena.getNodeEntity(slot));
      }
    }
    return result;
  }

  async getNodeCount(options?: StorageQueryOptions): Promise<number> {
    return this.countNodesSync(options);
  }

  countNodesSync(options?: StorageQueryOptions): number {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (!ctx && !options?.filter) {
      return this.arena.liveNodeCount;
    }

    if (!ctx && options?.filter) {
      const { types, properties } = options.filter;
      if ((!properties || properties.length === 0) && types && types.length === 1) {
        const lid = this.arena.labelDict.lookup(types[0]);
        return lid >= 0 ? (this.arena.getNodesByLabelId(lid)?.size ?? 0) : 0;
      }
      return this._collectMatchingNodeSlotsLive(options, false).length;
    }

    return this._queryNodeDataInCtx(ctx!, options).length;
  }

  queryNodeSlotsSync(options?: StorageQueryOptions): Uint32Array | number[] {
    return this._collectMatchingNodeSlotsLive(options, true);
  }

  queryNodesSync(options?: StorageQueryOptions): Node[] {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      const rows = this._queryNodeDataInCtx(ctx, options);
      const out = new Array<Node>(rows.length);
      for (let i = 0; i < rows.length; i++) {
        const d = rows[i];
        out[i] = Node._fromFrozen(
          d.id,
          d.labels,
          d.properties,
          d.createdOn ?? Date.now(),
          d.updatedOn ?? Date.now(),
        );
      }
      return out;
    }

    const slots = this._collectMatchingNodeSlotsLive(options, true);
    const out = new Array<Node>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this.arena.getNodeEntity(slots[i]);
    }
    return out;
  }

  async getNodes(options?: StorageQueryOptions): Promise<ReadonlyNodeData[]> {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      return this._queryNodeDataInCtx(ctx, options);
    }

    const slots = this._collectMatchingNodeSlotsLive(options, true);
    const out = new Array<ReadonlyNodeData>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this._nodeDataBySlot(slots[i]);
    }
    return out;
  }

  async aggregateNodeProperty(
    key: string,
    options?: StorageQueryOptions,
  ): Promise<AggregateResult> {
    return this.aggregateNodePropertySync(key, options);
  }

  aggregateNodePropertySync(
    key: string,
    options?: StorageQueryOptions,
  ): AggregateResult {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      const nodes = this._queryNodeDataInCtx(ctx, options);
      return this._aggregatePropertyOverRecords(nodes, key, options?.distinct);
    }

    const slots = this._collectMatchingNodeSlotsLive(options, false);
    const keyId = this.arena.nodePropDict.lookup(key);
    if (keyId < 0) return { count: 0 };

    const col = this.arena.nodeColumns.getColumnByKeyId(keyId);
    if (!col) return { count: 0 };

    // Single-pass zero-allocation aggregation directly on typed ColumnStore!
    if (options?.distinct) {
      const seen = new Set<number>();
      let count = 0;
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;

      if (col.kind === 'number' && col.numValues) {
        const tags = col.tags;
        const vals = col.numValues;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (tags[s] !== TAG_VALUE) continue;
          const v = vals[s];
          if (Number.isNaN(v) || seen.has(v)) continue;
          seen.add(v);
          count++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      } else if (col.kind === 'mixed' && col.mixedValues) {
        const tags = col.tags;
        const vals = col.mixedValues;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (tags[s] !== TAG_VALUE) continue;
          const v = vals[s];
          if (typeof v !== 'number' || Number.isNaN(v) || seen.has(v)) continue;
          seen.add(v);
          count++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (count === 0) return { count: 0 };
      return { count, sum, avg: sum / count, min, max };
    }

    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    if (col.kind === 'number' && col.numValues) {
      const tags = col.tags;
      const vals = col.numValues;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (tags[s] !== TAG_VALUE) continue;
        const v = vals[s];
        if (Number.isNaN(v)) continue;
        count++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    } else if (col.kind === 'mixed' && col.mixedValues) {
      const tags = col.tags;
      const vals = col.mixedValues;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (tags[s] !== TAG_VALUE) continue;
        const v = vals[s];
        if (typeof v !== 'number' || Number.isNaN(v)) continue;
        count++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    if (count === 0) return { count: 0 };
    return { count, sum, avg: sum / count, min, max };
  }

  // ---------------------------------------------------------------------------
  // Edge Mutations
  // ---------------------------------------------------------------------------

  async insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      this._txnManager.stageInsertEdge(ctx, edge, this.arena, false);
      return;
    }

    if (this.arena.resolveEdgeSlot(edge.id) >= 0) {
      throw new EdgeAlreadyExistsError(edge.id);
    }
    const rawSrc = this.arena.resolveNodeSlot(edge.sourceId);
    const rawTgt = this.arena.resolveNodeSlot(edge.targetId);
    const srcSlot = rawSrc < 0 ? NONE_SLOT : rawSrc;
    const tgtSlot = rawTgt < 0 ? NONE_SLOT : rawTgt;

    const { slot, typeId } = this.arena.allocateEdge(
      srcSlot,
      tgtSlot,
      edge.type,
      edge.properties,
      edge.id,
      edge.createdOn,
      edge.updatedOn,
      edge.sourceId,
      edge.targetId,
    );
    if (srcSlot !== NONE_SLOT && tgtSlot !== NONE_SLOT) {
      this.adjacency.addEdge(slot, srcSlot, tgtSlot, typeId);
    }
    this.propertyIndexes.onEdgeInserted(slot, typeId, edge.properties);
    this._txnManager.recordLiveEdgeWrite(edge.id);
    this._undoStack?.push({ kind: 'deleteEdge', id: edge.id });
  }

  async insertEdges(edges: readonly EdgeData[], transaction?: ITransactionHandle): Promise<void> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      for (let i = 0; i < edges.length; i++) {
        this._txnManager.stageInsertEdge(ctx, edges[i], this.arena, false);
      }
      return;
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < edges.length; i++) {
      const eid = edges[i].id;
      if (seenIds.has(eid) || this.arena.resolveEdgeSlot(eid) >= 0) {
        throw new EdgeAlreadyExistsError(eid);
      }
      seenIds.add(eid);
    }

    const wasEmpty = this.arena.liveEdgeCount === 0;
    this.arena.ensureEdgeCapacity(this.arena.edgeHighWater + edges.length);
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const rawSrc = this.arena.resolveNodeSlot(edge.sourceId);
      const rawTgt = this.arena.resolveNodeSlot(edge.targetId);
      const srcSlot = rawSrc < 0 ? NONE_SLOT : rawSrc;
      const tgtSlot = rawTgt < 0 ? NONE_SLOT : rawTgt;

      const { slot, typeId } = this.arena.allocateEdge(
        srcSlot,
        tgtSlot,
        edge.type,
        edge.properties,
        edge.id,
        edge.createdOn,
        edge.updatedOn,
        edge.sourceId,
        edge.targetId,
      );
      if (!wasEmpty && srcSlot !== NONE_SLOT && tgtSlot !== NONE_SLOT) {
        this.adjacency.addEdge(slot, srcSlot, tgtSlot, typeId);
      }
      this.propertyIndexes.onEdgeInserted(slot, typeId, edge.properties);
      this._txnManager.recordLiveEdgeWrite(edge.id);
      this._undoStack?.push({ kind: 'deleteEdge', id: edge.id });
    }
    if (wasEmpty && edges.length > 0) {
      this.compact();
    }
  }

  insertEdgeSync(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Readonly<Record<string, unknown>>,
    id?: string,
    transaction?: ITransactionHandle,
  ): Edge {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      if (!this._hasNodeInCtx(sourceId, ctx)) throw new NodeNotFoundError(sourceId);
      if (!this._hasNodeInCtx(targetId, ctx)) throw new NodeNotFoundError(targetId);
      const edge = new Edge(sourceId, targetId, type, properties, id);
      this._txnManager.stageInsertEdge(ctx, edge.toJSON(), this.arena, true);
      return edge;
    }

    if (id !== undefined && this.arena.resolveEdgeSlot(id) >= 0) {
      throw new EdgeAlreadyExistsError(id);
    }
    const srcSlot = this.arena.resolveNodeSlot(sourceId);
    const tgtSlot = this.arena.resolveNodeSlot(targetId);
    if (srcSlot < 0) throw new NodeNotFoundError(sourceId);
    if (tgtSlot < 0) throw new NodeNotFoundError(targetId);

    const { slot, typeId } = this.arena.allocateEdge(
      srcSlot,
      tgtSlot,
      type,
      properties,
      id,
    );
    this.adjacency.addEdge(slot, srcSlot, tgtSlot, typeId);
    this.propertyIndexes.onEdgeInserted(slot, typeId, properties);
    const createdId = this.arena.edgeIds[slot];
    this._txnManager.recordLiveEdgeWrite(createdId);
    this._undoStack?.push({ kind: 'deleteEdge', id: createdId });
    return this.arena.getEdgeEntity(slot);
  }

  insertEdgesSync(
    items: ReadonlyArray<{
      sourceId: string;
      targetId: string;
      type: string;
      properties?: Readonly<Record<string, unknown>>;
      id?: string;
    }>,
    transaction?: ITransactionHandle,
  ): Edge[] {
    const ctx = this._txnManager.getContext(transaction);
    const out = new Array<Edge>(items.length);
    if (ctx) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        out[i] = this.insertEdgeSync(
          it.sourceId,
          it.targetId,
          it.type,
          it.properties ?? {},
          it.id,
          transaction,
        );
      }
      return out;
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.id !== undefined) {
        if (seenIds.has(it.id) || this.arena.resolveEdgeSlot(it.id) >= 0) {
          throw new EdgeAlreadyExistsError(it.id);
        }
        seenIds.add(it.id);
      }
      if (this.arena.resolveNodeSlot(it.sourceId) < 0) throw new NodeNotFoundError(it.sourceId);
      if (this.arena.resolveNodeSlot(it.targetId) < 0) throw new NodeNotFoundError(it.targetId);
    }

    const wasEmpty = this.arena.liveEdgeCount === 0;
    this.arena.ensureEdgeCapacity(this.arena.edgeHighWater + items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const srcSlot = this.arena.resolveNodeSlot(it.sourceId);
      const tgtSlot = this.arena.resolveNodeSlot(it.targetId);

      const props = it.properties ?? {};
      const { slot, typeId } = this.arena.allocateEdge(
        srcSlot,
        tgtSlot,
        it.type,
        props,
        it.id,
      );
      if (!wasEmpty) {
        this.adjacency.addEdge(slot, srcSlot, tgtSlot, typeId);
      }
      this.propertyIndexes.onEdgeInserted(slot, typeId, props);
      this._txnManager.recordLiveEdgeWrite(this.arena.edgeIds[slot]);
      this._undoStack?.push({ kind: 'deleteEdge', id: this.arena.edgeIds[slot] });
      out[i] = this.arena.getEdgeEntity(slot);
    }
    if (wasEmpty && items.length > 0) {
      this.compact();
    }
    return out;
  }

  async deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void> {
    this.deleteEdgeByIdSync(id, transaction);
  }

  deleteEdgeByIdSync(id: string, transaction?: ITransactionHandle): boolean {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      const existed = this._hasEdgeInCtx(id, ctx);
      if (!existed) return false;
      this._txnManager.stageDeleteEdge(ctx, id, this.arena);
      return true;
    }

    const slot = this.arena.resolveEdgeSlot(id);
    if (slot < 0) return false;
    this._deleteEdgeBySlotLive(slot);
    return true;
  }

  private _deleteEdgeBySlotLive(slot: number): void {
    const id = this.arena.edgeIds[slot];
    const props = (this.propertyIndexes.hasAnyEdgeIndexes || this._undoStack !== null)
      ? this.arena.edgeColumns.materializeRecord(slot)
      : {};
    if (this._undoStack !== null) {
      this._undoStack.push({
        kind: 'restoreEdge',
        data: {
          id,
          sourceId: this.arena.getEdgeSourceId(slot),
          targetId: this.arena.getEdgeTargetId(slot),
          type: this.arena.edgeTypeDict.getString(this.arena.edgeTypeId[slot]),
          createdOn: this.arena.edgeCreatedOn[slot],
          updatedOn: this.arena.edgeUpdatedOn[slot],
          properties: { ...props },
        },
      });
    }
    this.propertyIndexes.onEdgeDeleted(slot, this.arena.edgeTypeId[slot], props);
    const removedFromDelta = this.adjacency.removeEdge(
      slot,
      this.arena.edgeSrcSlot[slot],
      this.arena.edgeTgtSlot[slot],
    );
    const delayReuse = !removedFromDelta || slot < this.adjacency.csrEdgeSlotBound;
    this.arena.freeEdge(slot, delayReuse);
    this._txnManager.recordLiveEdgeWrite(id, undefined, true);
  }

  // ---------------------------------------------------------------------------
  // Edge Queries
  // ---------------------------------------------------------------------------

  async hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) return this._hasEdgeInCtx(id, ctx);
    return this.arena.resolveEdgeSlot(id) >= 0;
  }

  async getEdge(id: string, transaction?: ITransactionHandle): Promise<ReadonlyEdgeData | undefined> {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) return this._getEdgeDataInCtx(id, ctx);
    const slot = this.arena.resolveEdgeSlot(id);
    return slot >= 0 ? this._edgeDataBySlot(slot) : undefined;
  }

  getEdgeSync(id: string, transaction?: ITransactionHandle): Edge | undefined {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      const data = this._getEdgeDataInCtx(id, ctx);
      return data
        ? Edge._fromFrozen(
            data.id,
            data.sourceId,
            data.targetId,
            data.type,
            data.properties,
            data.createdOn ?? Date.now(),
            data.updatedOn ?? Date.now(),
          )
        : undefined;
    }
    const slot = this.arena.resolveEdgeSlot(id);
    return slot >= 0 ? this.arena.getEdgeEntity(slot) : undefined;
  }

  async getEdgeCount(options?: StorageQueryOptions): Promise<number> {
    return this.countEdgesSync(options);
  }

  countEdgesSync(options?: StorageQueryOptions): number {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (!ctx && !options?.filter) {
      return this.arena.liveEdgeCount;
    }
    if (!ctx && options?.filter) {
      const { types, properties } = options.filter;
      if ((!properties || properties.length === 0) && types && types.length === 1) {
        const tid = this.arena.edgeTypeDict.lookup(types[0]);
        return tid >= 0 ? (this.arena.getEdgesByTypeId(tid)?.size ?? 0) : 0;
      }
      return this._collectMatchingEdgeSlotsLive(options, false).length;
    }
    return this._queryEdgeDataInCtx(ctx!, options).length;
  }

  async getEdges(options?: StorageQueryOptions): Promise<ReadonlyEdgeData[]> {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      return this._queryEdgeDataInCtx(ctx, options);
    }
    const slots = this._collectMatchingEdgeSlotsLive(options, true);
    const out = new Array<ReadonlyEdgeData>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this._edgeDataBySlot(slots[i]);
    }
    return out;
  }

  queryEdgesSync(options?: StorageQueryOptions): Edge[] {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      const rows = this._queryEdgeDataInCtx(ctx, options);
      return rows.map((d) =>
        Edge._fromFrozen(
          d.id,
          d.sourceId,
          d.targetId,
          d.type,
          d.properties,
          d.createdOn ?? Date.now(),
          d.updatedOn ?? Date.now(),
        ),
      );
    }
    const slots = this._collectMatchingEdgeSlotsLive(options, true);
    const out = new Array<Edge>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this.arena.getEdgeEntity(slots[i]);
    }
    return out;
  }

  async getEdgesBySource(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]> {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      return this._filterAndOrderEdgeData(this._getEdgesBySourceInCtx(nodeId, ctx), options);
    }

    const srcSlot = this.arena.resolveNodeSlot(nodeId);
    if (srcSlot < 0 && (!this.arena.hasDanglingEdges || !this.arena.danglingOutEdges.has(nodeId))) {
      return [];
    }
    const slots = this._filterAdjacentEdgeSlotsLive(srcSlot, 'out', options, nodeId);
    const out = new Array<ReadonlyEdgeData>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this._edgeDataBySlot(slots[i]);
    }
    return out;
  }

  getEdgesBySourceSync(nodeId: string, options?: StorageQueryOptions): Edge[] {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      const filtered = this._filterAndOrderEdgeData(this._getEdgesBySourceInCtx(nodeId, ctx), options);
      return filtered.map((d) =>
        Edge._fromFrozen(
          d.id,
          d.sourceId,
          d.targetId,
          d.type,
          d.properties,
          d.createdOn ?? Date.now(),
          d.updatedOn ?? Date.now(),
        ),
      );
    }
    const srcSlot = this.arena.resolveNodeSlot(nodeId);
    if (srcSlot < 0 && (!this.arena.hasDanglingEdges || !this.arena.danglingOutEdges.has(nodeId))) {
      return [];
    }
    const slots = this._filterAdjacentEdgeSlotsLive(srcSlot, 'out', options, nodeId);
    const out = new Array<Edge>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this.arena.getEdgeEntity(slots[i]);
    }
    return out;
  }

  async getEdgesByTarget(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]> {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      return this._filterAndOrderEdgeData(this._getEdgesByTargetInCtx(nodeId, ctx), options);
    }

    const tgtSlot = this.arena.resolveNodeSlot(nodeId);
    if (tgtSlot < 0 && (!this.arena.hasDanglingEdges || !this.arena.danglingInEdges.has(nodeId))) {
      return [];
    }
    const slots = this._filterAdjacentEdgeSlotsLive(tgtSlot, 'in', options, nodeId);
    const out = new Array<ReadonlyEdgeData>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this._edgeDataBySlot(slots[i]);
    }
    return out;
  }

  getEdgesByTargetSync(nodeId: string, options?: StorageQueryOptions): Edge[] {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      const filtered = this._filterAndOrderEdgeData(this._getEdgesByTargetInCtx(nodeId, ctx), options);
      return filtered.map((d) =>
        Edge._fromFrozen(
          d.id,
          d.sourceId,
          d.targetId,
          d.type,
          d.properties,
          d.createdOn ?? Date.now(),
          d.updatedOn ?? Date.now(),
        ),
      );
    }
    const tgtSlot = this.arena.resolveNodeSlot(nodeId);
    if (tgtSlot < 0 && (!this.arena.hasDanglingEdges || !this.arena.danglingInEdges.has(nodeId))) {
      return [];
    }
    const slots = this._filterAdjacentEdgeSlotsLive(tgtSlot, 'in', options, nodeId);
    const out = new Array<Edge>(slots.length);
    for (let i = 0; i < slots.length; i++) {
      out[i] = this.arena.getEdgeEntity(slots[i]);
    }
    return out;
  }

  async aggregateEdgeProperty(
    key: string,
    options?: StorageQueryOptions,
  ): Promise<AggregateResult> {
    return this.aggregateEdgePropertySync(key, options);
  }

  aggregateEdgePropertySync(
    key: string,
    options?: StorageQueryOptions,
  ): AggregateResult {
    const ctx = this._txnManager.getContext(options?.transaction);
    if (ctx) {
      const edges = this._queryEdgeDataInCtx(ctx, options);
      return this._aggregatePropertyOverRecords(edges, key, options?.distinct);
    }

    const slots = this._collectMatchingEdgeSlotsLive(options, false);
    const keyId = this.arena.edgePropDict.lookup(key);
    if (keyId < 0) return { count: 0 };

    const col = this.arena.edgeColumns.getColumnByKeyId(keyId);
    if (!col) return { count: 0 };

    if (options?.distinct) {
      const seen = new Set<number>();
      let count = 0;
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;

      if (col.kind === 'number' && col.numValues) {
        const tags = col.tags;
        const vals = col.numValues;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (tags[s] !== TAG_VALUE) continue;
          const v = vals[s];
          if (Number.isNaN(v) || seen.has(v)) continue;
          seen.add(v);
          count++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      } else if (col.kind === 'mixed' && col.mixedValues) {
        const tags = col.tags;
        const vals = col.mixedValues;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (tags[s] !== TAG_VALUE) continue;
          const v = vals[s];
          if (typeof v !== 'number' || Number.isNaN(v) || seen.has(v)) continue;
          seen.add(v);
          count++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (count === 0) return { count: 0 };
      return { count, sum, avg: sum / count, min, max };
    }

    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    if (col.kind === 'number' && col.numValues) {
      const tags = col.tags;
      const vals = col.numValues;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (tags[s] !== TAG_VALUE) continue;
        const v = vals[s];
        if (Number.isNaN(v)) continue;
        count++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    } else if (col.kind === 'mixed' && col.mixedValues) {
      const tags = col.tags;
      const vals = col.mixedValues;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (tags[s] !== TAG_VALUE) continue;
        const v = vals[s];
        if (typeof v !== 'number' || Number.isNaN(v)) continue;
        count++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    if (count === 0) return { count: 0 };
    return { count, sum, avg: sum / count, min, max };
  }

  // ---------------------------------------------------------------------------
  // Property & Label Mutations
  // ---------------------------------------------------------------------------

  async patchProperties(
    target: 'node' | 'edge',
    id: string,
    patch: PropertyPatch,
    transaction?: ITransactionHandle,
  ): Promise<void> {
    this.patchPropertiesSync(target, id, patch, transaction);
  }

  patchPropertiesSync(
    target: 'node' | 'edge',
    id: string,
    patch: PropertyPatch,
    transaction?: ITransactionHandle,
  ): void {
    if (patch.set) {
      const invalid = findInvalidPropertyEntry(patch.set);
      if (invalid) {
        throw new InvalidPropertyError(invalid[0], invalid[1]);
      }
    }

    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      this._txnManager.stagePatchProperties(ctx, target, id, patch, this.arena);
      return;
    }

    if (target === 'node') {
      const slot = this.arena.resolveNodeSlot(id);
      if (slot < 0) throw new NodeNotFoundError(id);

      const needOldProps =
        this.propertyIndexes.hasAnyNodeIndexes ||
        this._undoStack !== null ||
        this._txnManager.hasActiveTransactions;
      const oldProps = needOldProps ? this.arena.nodeColumns.materializeRecord(slot) : {};
      if (this._undoStack !== null) {
        this._undoStack.push({ kind: 'restoreNodeProps', id, props: oldProps });
      }

      this.arena.invalidateNodeEntity(slot);
      if (patch.replace) {
        this.arena.nodeColumns.clearSlot(slot);
      } else if (patch.unset) {
        for (let i = 0; i < patch.unset.length; i++) {
          const keyId = this.arena.nodePropDict.lookup(patch.unset[i]);
          if (keyId >= 0) this.arena.nodeColumns.deleteValueByKeyId(keyId, slot);
        }
      }
      if (patch.set) {
        this.arena.nodeColumns.setRecord(slot, patch.set);
      }
      this.arena.nodeUpdatedOn[slot] = Date.now();
      this.arena.nodeVersion[slot] = (this.arena.nodeVersion[slot] + 1) >>> 0;

      if (this.propertyIndexes.hasAnyNodeIndexes) {
        const newProps = this.arena.nodeColumns.materializeRecord(slot);
        const changedKeys = patch.replace
          ? undefined
          : [
              ...(patch.unset ?? []),
              ...(patch.set ? Object.keys(patch.set) : []),
            ];
        this.propertyIndexes.onNodePropertiesUpdated(
          slot,
          this.arena.nodeLabelIds[slot],
          oldProps,
          newProps,
          changedKeys,
        );
      }
      const touched = patch.replace
        ? Object.keys(oldProps).concat(patch.set ? Object.keys(patch.set) : [])
        : [...(patch.unset ?? []), ...(patch.set ? Object.keys(patch.set) : [])];
      this._txnManager.recordLiveNodeWrite(id, touched, false, !!patch.replace);
    } else {
      const slot = this.arena.resolveEdgeSlot(id);
      if (slot < 0) throw new EdgeNotFoundError(id);

      const needOldProps =
        this.propertyIndexes.hasAnyEdgeIndexes ||
        this._undoStack !== null ||
        this._txnManager.hasActiveTransactions;
      const oldProps = needOldProps ? this.arena.edgeColumns.materializeRecord(slot) : {};
      if (this._undoStack !== null) {
        this._undoStack.push({ kind: 'restoreEdgeProps', id, props: oldProps });
      }

      this.arena.invalidateEdgeEntity(slot);
      if (patch.replace) {
        this.arena.edgeColumns.clearSlot(slot);
      } else if (patch.unset) {
        for (let i = 0; i < patch.unset.length; i++) {
          const keyId = this.arena.edgePropDict.lookup(patch.unset[i]);
          if (keyId >= 0) this.arena.edgeColumns.deleteValueByKeyId(keyId, slot);
        }
      }
      if (patch.set) {
        this.arena.edgeColumns.setRecord(slot, patch.set);
      }
      this.arena.edgeUpdatedOn[slot] = Date.now();
      this.arena.edgeVersion[slot] = (this.arena.edgeVersion[slot] + 1) >>> 0;

      if (this.propertyIndexes.hasAnyEdgeIndexes) {
        const newProps = this.arena.edgeColumns.materializeRecord(slot);
        const changedKeys = patch.replace
          ? undefined
          : [
              ...(patch.unset ?? []),
              ...(patch.set ? Object.keys(patch.set) : []),
            ];
        this.propertyIndexes.onEdgePropertiesUpdated(
          slot,
          this.arena.edgeTypeId[slot],
          oldProps,
          newProps,
          changedKeys,
        );
      }
      const touched = patch.replace
        ? Object.keys(oldProps).concat(patch.set ? Object.keys(patch.set) : [])
        : [...(patch.unset ?? []), ...(patch.set ? Object.keys(patch.set) : [])];
      this._txnManager.recordLiveEdgeWrite(id, touched, false, !!patch.replace);
    }
  }

  async removeNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: ITransactionHandle,
  ): Promise<void> {
    this.removeNodeLabelsSync(nodeId, labels, transaction);
  }

  removeNodeLabelsSync(
    nodeId: string,
    labels: readonly string[],
    transaction?: ITransactionHandle,
  ): number {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      return this._txnManager.stageRemoveNodeLabels(ctx, nodeId, labels, this.arena);
    }

    const slot = this.arena.resolveNodeSlot(nodeId);
    if (slot < 0) throw new NodeNotFoundError(nodeId);

    const oldLabels = this._undoStack !== null ? this.arena.nodeLabelStrings[slot] : undefined;
    const removed = this.arena.removeNodeLabelsBySlot(slot, labels);
    if (removed.length > 0) {
      if (this._undoStack !== null && oldLabels) {
        this._undoStack.push({ kind: 'restoreNodeLabels', id: nodeId, labels: oldLabels });
      }
      if (this.propertyIndexes.hasAnyNodeIndexes) {
        const removedIds = removed.map((l) => this.arena.labelDict.lookup(l)).filter((id) => id >= 0);
        const props = this.arena.nodeColumns.materializeRecord(slot);
        this.propertyIndexes.onNodeLabelsRemoved(slot, removedIds, props);
      }
      this._txnManager.recordLiveNodeLabelWrite(nodeId);
    }
    return removed.length;
  }

  async addNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: ITransactionHandle,
  ): Promise<void> {
    this.addNodeLabelsSync(nodeId, labels, transaction);
  }

  addNodeLabelsSync(
    nodeId: string,
    labels: readonly string[],
    transaction?: ITransactionHandle,
  ): number {
    const ctx = this._txnManager.getContext(transaction);
    if (ctx) {
      return this._txnManager.stageAddNodeLabels(ctx, nodeId, labels, this.arena);
    }

    const slot = this.arena.resolveNodeSlot(nodeId);
    if (slot < 0) throw new NodeNotFoundError(nodeId);

    const oldLabels = this._undoStack !== null ? this.arena.nodeLabelStrings[slot] : undefined;
    const added = this.arena.addNodeLabelsBySlot(slot, labels);
    if (added.length > 0) {
      if (this._undoStack !== null && oldLabels) {
        this._undoStack.push({ kind: 'restoreNodeLabels', id: nodeId, labels: oldLabels });
      }
      if (this.propertyIndexes.hasAnyNodeIndexes) {
        const addedIds = added.map((l) => this.arena.labelDict.lookup(l)).filter((id) => id >= 0);
        const props = this.arena.nodeColumns.materializeRecord(slot);
        this.propertyIndexes.onNodeLabelsAdded(slot, addedIds, props);
      }
      this._txnManager.recordLiveNodeLabelWrite(nodeId);
    }
    return added.length;
  }

  // ---------------------------------------------------------------------------
  // Index Management
  // ---------------------------------------------------------------------------

  async createIndex(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): Promise<void> {
    this.createIndexSync(name, target, propertyKeys, options);
  }

  createIndexSync(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): void {
    this.propertyIndexes.createIndex(
      name,
      target,
      propertyKeys,
      this.arena,
      options?.labelOrType,
    );
  }

  async hasIndex(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): Promise<boolean> {
    return this.hasIndexSync(target, propertyKeys, labelOrType);
  }

  hasIndexSync(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): boolean {
    return this.propertyIndexes.hasIndex(target, propertyKeys, labelOrType);
  }

  async getIndex(name: string): Promise<IndexMetadata | undefined> {
    return this.propertyIndexes.getIndex(name);
  }

  async deleteIndex(name: string): Promise<void> {
    this.deleteIndexSync(name);
  }

  deleteIndexSync(name: string): void {
    this.propertyIndexes.deleteIndex(name);
  }

  async getIndexes(): Promise<IndexMetadata[]> {
    return this.getIndexesSync();
  }

  getIndexesSync(): IndexMetadata[] {
    return this.propertyIndexes.getIndexes();
  }

  // ---------------------------------------------------------------------------
  // Data Portability
  // ---------------------------------------------------------------------------

  async exportJSON(): Promise<GraphData> {
    const highN = this.arena.nodeHighWater;
    const nodes: NodeData[] = [];
    for (let s = 0; s < highN; s++) {
      if (this.arena.nodeAlive[s] === 0) continue;
      const props = this.arena.nodeColumns.materializeRecord(s);
      nodes.push({
        id: this.arena.nodeIds[s],
        labels: [...this.arena.nodeLabelStrings[s]],
        createdOn: this.arena.nodeCreatedOn[s],
        updatedOn: this.arena.nodeUpdatedOn[s],
        properties: { ...props },
      });
    }

    const highE = this.arena.edgeHighWater;
    const edges: EdgeData[] = [];
    for (let s = 0; s < highE; s++) {
      if (this.arena.edgeAlive[s] === 0) continue;
      const props = this.arena.edgeColumns.materializeRecord(s);
      edges.push({
        id: this.arena.edgeIds[s],
        sourceId: this.arena.getEdgeSourceId(s),
        targetId: this.arena.getEdgeTargetId(s),
        type: this.arena.edgeTypeDict.getString(this.arena.edgeTypeId[s]),
        createdOn: this.arena.edgeCreatedOn[s],
        updatedOn: this.arena.edgeUpdatedOn[s],
        properties: { ...props },
      });
    }

    return {
      graphId: this.graphId,
      nodes,
      edges,
    };
  }

  async importJSON(data: GraphData): Promise<void> {
    const seenNodeIds = new Set<string>();
    for (let i = 0; i < data.nodes.length; i++) {
      const nid = data.nodes[i].id;
      if (seenNodeIds.has(nid) || this.arena.resolveNodeSlot(nid) >= 0) {
        throw new NodeAlreadyExistsError(nid);
      }
      seenNodeIds.add(nid);
    }

    const seenEdgeIds = new Set<string>();
    for (let i = 0; i < data.edges.length; i++) {
      const eid = data.edges[i].id;
      if (seenEdgeIds.has(eid) || this.arena.resolveEdgeSlot(eid) >= 0) {
        throw new EdgeAlreadyExistsError(eid);
      }
      seenEdgeIds.add(eid);
    }

    const wasEmpty = this.arena.liveEdgeCount === 0;
    const hasPreExistingDangling = !wasEmpty && this.arena.hasDanglingEdges;
    this.arena.ensureNodeCapacity(this.arena.nodeHighWater + data.nodes.length);
    for (let i = 0; i < data.nodes.length; i++) {
      const n = data.nodes[i];
      const slot = this.arena.allocateNode(
        n.labels,
        n.properties,
        n.id,
        n.createdOn,
        n.updatedOn,
      );
      if (hasPreExistingDangling) {
        this.arena.bindDanglingEdgesForNode(n.id, slot, this.adjacency);
      }
      this.propertyIndexes.onNodeInserted(slot, this.arena.nodeLabelIds[slot], n.properties);
    }

    this.arena.ensureEdgeCapacity(this.arena.edgeHighWater + data.edges.length);
    for (let i = 0; i < data.edges.length; i++) {
      const e = data.edges[i];
      const rawSrc = this.arena.resolveNodeSlot(e.sourceId);
      const rawTgt = this.arena.resolveNodeSlot(e.targetId);
      const srcSlot = rawSrc < 0 ? NONE_SLOT : rawSrc;
      const tgtSlot = rawTgt < 0 ? NONE_SLOT : rawTgt;

      const { slot, typeId } = this.arena.allocateEdge(
        srcSlot,
        tgtSlot,
        e.type,
        e.properties,
        e.id,
        e.createdOn,
        e.updatedOn,
        e.sourceId,
        e.targetId,
      );
      if (!wasEmpty && srcSlot !== NONE_SLOT && tgtSlot !== NONE_SLOT) {
        this.adjacency.addEdge(slot, srcSlot, tgtSlot, typeId);
      }
      this.propertyIndexes.onEdgeInserted(slot, typeId, e.properties);
    }

    if (wasEmpty && data.edges.length > 0) {
      this.compact();
    }
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  supportsTransactions(): boolean {
    return true;
  }

  async beginTransaction(): Promise<ITransactionHandle> {
    return this._txnManager.begin();
  }

  async commitTransaction(handle: ITransactionHandle): Promise<void> {
    this._txnManager.commit(handle, this.arena, this.adjacency, this.propertyIndexes);
  }

  async rollbackTransaction(handle: ITransactionHandle): Promise<void> {
    this._txnManager.rollback(handle);
  }

  // ---------------------------------------------------------------------------
  // Internal Query Selection & Evaluation Helpers (Live Path)
  // ---------------------------------------------------------------------------

  private _nodeDataBySlot(slot: number): ReadonlyNodeData {
    return {
      id: this.arena.nodeIds[slot],
      labels: this.arena.nodeLabelStrings[slot],
      createdOn: this.arena.nodeCreatedOn[slot],
      updatedOn: this.arena.nodeUpdatedOn[slot],
      properties: this.arena.nodeColumns.materializeRecord(slot),
    };
  }

  private _edgeDataBySlot(slot: number): ReadonlyEdgeData {
    return {
      id: this.arena.edgeIds[slot],
      sourceId: this.arena.getEdgeSourceId(slot),
      targetId: this.arena.getEdgeTargetId(slot),
      type: this.arena.edgeTypeDict.getString(this.arena.edgeTypeId[slot]),
      createdOn: this.arena.edgeCreatedOn[slot],
      updatedOn: this.arena.edgeUpdatedOn[slot],
      properties: this.arena.edgeColumns.materializeRecord(slot),
    };
  }

  private _collectIncidentEdgeSlots(nodeSlot: number, out: number[]): void {
    const seen = new Set<number>();
    const csrOutEntries = this.adjacency.getCsrOutEntries();
    for (
      let i = this.adjacency.getCsrOutStart(nodeSlot), end = this.adjacency.getCsrOutEnd(nodeSlot);
      i < end;
      i += 3
    ) {
      const eSlot = csrOutEntries[i];
      if (
        this.arena.edgeAlive[eSlot] === 1 &&
        this.arena.edgeSrcSlot[eSlot] === nodeSlot &&
        !seen.has(eSlot)
      ) {
        seen.add(eSlot);
        out.push(eSlot);
      }
    }
    const dOut = this.adjacency.getDeltaOutBuf(nodeSlot);
    const dOutLen = this.adjacency.getDeltaOutWordLen(nodeSlot);
    if (dOut) {
      for (let i = 0; i < dOutLen; i += 3) {
        const eSlot = dOut[i];
        if (this.arena.edgeAlive[eSlot] === 1 && !seen.has(eSlot)) {
          seen.add(eSlot);
          out.push(eSlot);
        }
      }
    }

    const csrInEntries = this.adjacency.getCsrInEntries();
    for (
      let i = this.adjacency.getCsrInStart(nodeSlot), end = this.adjacency.getCsrInEnd(nodeSlot);
      i < end;
      i += 3
    ) {
      const eSlot = csrInEntries[i];
      if (
        this.arena.edgeAlive[eSlot] === 1 &&
        this.arena.edgeTgtSlot[eSlot] === nodeSlot &&
        !seen.has(eSlot)
      ) {
        seen.add(eSlot);
        out.push(eSlot);
      }
    }
    const dIn = this.adjacency.getDeltaInBuf(nodeSlot);
    const dInLen = this.adjacency.getDeltaInWordLen(nodeSlot);
    if (dIn) {
      for (let i = 0; i < dInLen; i += 3) {
        const eSlot = dIn[i];
        if (this.arena.edgeAlive[eSlot] === 1 && !seen.has(eSlot)) {
          seen.add(eSlot);
          out.push(eSlot);
        }
      }
    }

    if (this.arena.hasDanglingEdges) {
      const nodeId = this.arena.nodeIds[nodeSlot];
      const dout = this.arena.danglingOutEdges.get(nodeId);
      if (dout) {
        for (const eSlot of dout) {
          if (this.arena.edgeAlive[eSlot] === 1 && !seen.has(eSlot)) {
            seen.add(eSlot);
            out.push(eSlot);
          }
        }
      }
      const din = this.arena.danglingInEdges.get(nodeId);
      if (din) {
        for (const eSlot of din) {
          if (this.arena.edgeAlive[eSlot] === 1 && !seen.has(eSlot)) {
            seen.add(eSlot);
            out.push(eSlot);
          }
        }
      }
    }
  }

  private _collectMatchingNodeSlotsLive(
    options?: StorageQueryOptions,
    applyOrderLimit = true,
  ): Uint32Array | number[] {
    const filter = options?.filter;
    const types = filter?.types;
    const props = filter?.properties;
    const limit = applyOrderLimit ? options?.limit : undefined;
    const orderBy = applyOrderLimit ? options?.orderBy : undefined;

    const labelQuery = types && types.length > 0
      ? this.arena.labelDict.buildQueryMask(types)
      : undefined;
    if (labelQuery === null) return new Uint32Array(0);

    // 1. Check index-accelerated candidate sets
    const candidateSets: Uint32SlotSet[] = [];
    let rangeSlice: Uint32Array | null = null;

    if (types && types.length === 1) {
      const lid = this.arena.labelDict.lookup(types[0]);
      if (lid < 0) return new Uint32Array(0);
      const labelSet = this.arena.getNodesByLabelId(lid);
      if (!labelSet || labelSet.size === 0) return new Uint32Array(0);
      candidateSets.push(labelSet);
    }

    if (props && props.length > 0 && this.propertyIndexes.hasAnyNodeIndexes) {
      // Try compound index first
      const eqMap: Record<string, unknown> = {};
      const eqKeys: string[] = [];
      for (let i = 0; i < props.length; i++) {
        const pf = props[i];
        if (pf.key !== undefined && (pf.op === undefined || pf.op === '=')) {
          eqKeys.push(pf.key);
          eqMap[pf.key] = pf.value;
        }
      }
      if (eqKeys.length >= 2) {
        const compIdx = this.propertyIndexes.findCompoundIndex('node', eqKeys, types);
        if (compIdx) {
          const set = compIdx.lookupCompound(eqMap);
          if (!set || set.size === 0) return new Uint32Array(0);
          candidateSets.push(set);
        }
      }

      // Single-property equality / IN / range index checks
      for (let i = 0; i < props.length; i++) {
        const pf = props[i];
        if (pf.key === undefined) continue;
        const idx = this.propertyIndexes.findSingleIndex('node', pf.key, types);
        if (!idx) continue;

        const op = pf.op ?? '=';
        if (op === '=') {
          const set = idx.lookupExact(pf.value);
          if (!set || set.size === 0) return new Uint32Array(0);
          candidateSets.push(set);
        } else if (op === 'IN' && Array.isArray(pf.value)) {
          const seenSlots = new Set<number>();
          const seenVals = new Set<unknown>();
          const unionArr: number[] = [];
          for (let v = 0; v < pf.value.length; v++) {
            const pv = pf.value[v];
            if (seenVals.has(pv)) continue;
            seenVals.add(pv);
            const set = idx.lookupExact(pv);
            if (set) {
              const s = set.rawSlice();
              for (let j = 0; j < s.length; j++) {
                const slot = s[j];
                if (!seenSlots.has(slot)) {
                  seenSlots.add(slot);
                  unionArr.push(slot);
                }
              }
            }
          }
          if (unionArr.length === 0) return new Uint32Array(0);
          if (!rangeSlice || unionArr.length < rangeSlice.length) {
            rangeSlice = Uint32Array.from(unionArr);
          }
        } else if (
          op === '>' ||
          op === '>=' ||
          op === '<' ||
          op === '<=' ||
          op === 'STARTS_WITH'
        ) {
          const canOrderShortcut =
            orderBy !== undefined &&
            orderBy.field === pf.key &&
            props.length === 1 &&
            (!types || types.length <= 1) &&
            (!types || types.length === 0 || idx.labelOrType === types[0]) &&
            (op !== 'STARTS_WITH' || orderBy.direction === 'asc');
          const matchedRange = idx.lookupRange(
            op as RangeOperator,
            pf.value,
            canOrderShortcut ? limit : undefined,
            orderBy?.direction === 'desc',
          );
          if (matchedRange.length === 0) return new Uint32Array(0);
          if (canOrderShortcut) {
            return matchedRange;
          }
          if (!rangeSlice || matchedRange.length < rangeSlice.length) {
            rangeSlice = matchedRange;
          }
        }
      }
    }

    // 2. Choose tightest iteration source
    let sourceSlots: Uint32Array | null = null;
    if (candidateSets.length > 0) {
      let smallest = candidateSets[0];
      for (let i = 1; i < candidateSets.length; i++) {
        if (candidateSets[i].size < smallest.size) smallest = candidateSets[i];
      }
      sourceSlots = rangeSlice && rangeSlice.length < smallest.size
        ? rangeSlice
        : smallest.rawSlice();
    } else if (rangeSlice !== null) {
      sourceSlots = rangeSlice;
    }

    const hasProps = props !== undefined && props.length > 0;
    const earlyStop = limit !== undefined && !orderBy;
    const out: number[] = [];

    if (sourceSlots !== null) {
      // Fast path: single label with no property filters and no orderBy -> slice directly
      if (
        !hasProps &&
        candidateSets.length === 1 &&
        types?.length === 1 &&
        !orderBy
      ) {
        if (limit !== undefined && sourceSlots.length > limit) {
          return sourceSlots.subarray(0, limit);
        }
        return sourceSlots;
      }

      for (let i = 0; i < sourceSlots.length; i++) {
        const s = sourceSlots[i];
        if (this.arena.nodeAlive[s] === 0) continue;
        if (labelQuery && !this.arena.matchesNodeLabelMask(s, labelQuery)) continue;
        if (hasProps && !this._matchesNodePropsOnSlot(s, props!)) continue;
        out.push(s);
        if (earlyStop && out.length >= limit!) break;
      }
    } else {
      const high = this.arena.nodeHighWater;
      const alive = this.arena.nodeAlive;
      for (let s = 0; s < high; s++) {
        if (alive[s] === 0) continue;
        if (labelQuery && !this.arena.matchesNodeLabelMask(s, labelQuery)) continue;
        if (hasProps && !this._matchesNodePropsOnSlot(s, props!)) continue;
        out.push(s);
        if (earlyStop && out.length >= limit!) break;
      }
    }

    if (orderBy && out.length > 1) {
      this._sortSlots(
        out,
        orderBy.field,
        orderBy.direction,
        this.arena.nodeCreatedOn,
        this.arena.nodeUpdatedOn,
        this.arena.nodeColumns,
      );
    }

    if (limit !== undefined && out.length > limit) {
      out.length = limit;
    }
    return out;
  }

  private _collectMatchingEdgeSlotsLive(
    options?: StorageQueryOptions,
    applyOrderLimit = true,
  ): Uint32Array | number[] {
    const filter = options?.filter;
    const types = filter?.types;
    const props = filter?.properties;
    const limit = applyOrderLimit ? options?.limit : undefined;
    const orderBy = applyOrderLimit ? options?.orderBy : undefined;

    let typeMaskQuery = null as ReturnType<typeof this.arena.edgeTypeDict.buildQueryMask>;
    const hasTypes = types !== undefined && types.length > 0;
    if (hasTypes) {
      typeMaskQuery = this.arena.edgeTypeDict.buildQueryMask(types!);
      if (typeMaskQuery === null) return new Uint32Array(0);
    }

    const candidateSets: Uint32SlotSet[] = [];
    if (types && types.length === 1) {
      const tid = this.arena.edgeTypeDict.lookup(types[0]);
      if (tid < 0) return new Uint32Array(0);
      const tset = this.arena.getEdgesByTypeId(tid);
      if (!tset || tset.size === 0) return new Uint32Array(0);
      candidateSets.push(tset);
    }

    let rangeSlice: Uint32Array | null = null;
    if (props && props.length > 0 && this.propertyIndexes.hasAnyEdgeIndexes) {
      for (let i = 0; i < props.length; i++) {
        const pf = props[i];
        if (pf.key === undefined) continue;
        const idx = this.propertyIndexes.findSingleIndex('edge', pf.key, types);
        if (!idx) continue;
        const op = pf.op ?? '=';
        if (op === '=') {
          const set = idx.lookupExact(pf.value);
          if (!set || set.size === 0) return new Uint32Array(0);
          candidateSets.push(set);
        } else if (op === '>' || op === '>=' || op === '<' || op === '<=' || op === 'STARTS_WITH') {
          const matched = idx.lookupRange(op as RangeOperator, pf.value);
          if (matched.length === 0) return new Uint32Array(0);
          if (!rangeSlice || matched.length < rangeSlice.length) rangeSlice = matched;
        }
      }
    }

    let sourceSlots: Uint32Array | null = null;
    if (candidateSets.length > 0) {
      let smallest = candidateSets[0];
      for (let i = 1; i < candidateSets.length; i++) {
        if (candidateSets[i].size < smallest.size) smallest = candidateSets[i];
      }
      sourceSlots = rangeSlice && rangeSlice.length < smallest.size
        ? rangeSlice
        : smallest.rawSlice();
    } else if (rangeSlice !== null) {
      sourceSlots = rangeSlice;
    }

    const hasProps = props !== undefined && props.length > 0;
    const earlyStop = limit !== undefined && !orderBy;
    const out: number[] = [];

    if (sourceSlots !== null) {
      if (!hasProps && candidateSets.length === 1 && types?.length === 1 && !orderBy) {
        if (limit !== undefined && sourceSlots.length > limit) {
          return sourceSlots.subarray(0, limit);
        }
        return sourceSlots;
      }

      for (let i = 0; i < sourceSlots.length; i++) {
        const s = sourceSlots[i];
        if (this.arena.edgeAlive[s] === 0) continue;
        if (typeMaskQuery && !this._matchesEdgeTypeMask(s, typeMaskQuery)) continue;
        if (hasProps && !this._matchesEdgePropsOnSlot(s, props!)) continue;
        out.push(s);
        if (earlyStop && out.length >= limit!) break;
      }
    } else {
      const high = this.arena.edgeHighWater;
      const alive = this.arena.edgeAlive;
      for (let s = 0; s < high; s++) {
        if (alive[s] === 0) continue;
        if (typeMaskQuery && !this._matchesEdgeTypeMask(s, typeMaskQuery)) continue;
        if (hasProps && !this._matchesEdgePropsOnSlot(s, props!)) continue;
        out.push(s);
        if (earlyStop && out.length >= limit!) break;
      }
    }

    if (orderBy && out.length > 1) {
      this._sortSlots(
        out,
        orderBy.field,
        orderBy.direction,
        this.arena.edgeCreatedOn,
        this.arena.edgeUpdatedOn,
        this.arena.edgeColumns,
      );
    }

    if (limit !== undefined && out.length > limit) {
      out.length = limit;
    }
    return out;
  }

  private _filterAdjacentEdgeSlotsLive(
    nodeSlot: number,
    dir: 'out' | 'in',
    options?: StorageQueryOptions,
    nodeId?: string,
  ): number[] {
    const types = options?.filter?.types;
    const props = options?.filter?.properties;
    const hasTypes = types !== undefined && types.length > 0;
    const typeQuery = hasTypes ? this.arena.edgeTypeDict.buildQueryMask(types!) : undefined;
    if (typeQuery === null) return [];

    const hasProps = props !== undefined && props.length > 0;
    const out: number[] = [];
    const alive = this.arena.edgeAlive;

    if (nodeSlot >= 0) {
      const csrEntries = dir === 'out'
        ? this.adjacency.getCsrOutEntries()
        : this.adjacency.getCsrInEntries();
      const csrStart = dir === 'out'
        ? this.adjacency.getCsrOutStart(nodeSlot)
        : this.adjacency.getCsrInStart(nodeSlot);
      const csrEnd = dir === 'out'
        ? this.adjacency.getCsrOutEnd(nodeSlot)
        : this.adjacency.getCsrInEnd(nodeSlot);

      const edgeSrcSlot = this.arena.edgeSrcSlot;
      const edgeTgtSlot = this.arena.edgeTgtSlot;
      for (let i = csrStart; i < csrEnd; i += 3) {
        const eSlot = csrEntries[i];
        if (alive[eSlot] === 0) continue;
        if (
          dir === 'out'
            ? edgeSrcSlot[eSlot] !== nodeSlot || edgeTgtSlot[eSlot] !== csrEntries[i + 1]
            : edgeTgtSlot[eSlot] !== nodeSlot || edgeSrcSlot[eSlot] !== csrEntries[i + 1]
        ) {
          continue;
        }
        if (typeQuery && !this._matchesEdgeTypeId(csrEntries[i + 2], typeQuery)) continue;
        if (hasProps && !this._matchesEdgePropsOnSlot(eSlot, props!)) continue;
        out.push(eSlot);
      }

      const deltaBuf = dir === 'out'
        ? this.adjacency.getDeltaOutBuf(nodeSlot)
        : this.adjacency.getDeltaInBuf(nodeSlot);
      const deltaLen = dir === 'out'
        ? this.adjacency.getDeltaOutWordLen(nodeSlot)
        : this.adjacency.getDeltaInWordLen(nodeSlot);
      if (deltaBuf && deltaLen > 0) {
        for (let i = 0; i < deltaLen; i += 3) {
          const eSlot = deltaBuf[i];
          if (alive[eSlot] === 0) continue;
          if (typeQuery && !this._matchesEdgeTypeId(deltaBuf[i + 2], typeQuery)) continue;
          if (hasProps && !this._matchesEdgePropsOnSlot(eSlot, props!)) continue;
          out.push(eSlot);
        }
      }
    }

    if (this.arena.hasDanglingEdges && nodeId !== undefined) {
      const dSet = dir === 'out'
        ? this.arena.danglingOutEdges.get(nodeId)
        : this.arena.danglingInEdges.get(nodeId);
      if (dSet) {
        for (const eSlot of dSet) {
          if (alive[eSlot] === 0) continue;
          if (typeQuery && !this._matchesEdgeTypeMask(eSlot, typeQuery)) continue;
          if (hasProps && !this._matchesEdgePropsOnSlot(eSlot, props!)) continue;
          out.push(eSlot);
        }
      }
    }

    if (options?.orderBy && out.length > 1) {
      this._sortSlots(
        out,
        options.orderBy.field,
        options.orderBy.direction,
        this.arena.edgeCreatedOn,
        this.arena.edgeUpdatedOn,
        this.arena.edgeColumns,
      );
    }
    if (options?.limit !== undefined && out.length > options.limit) {
      out.length = options.limit;
    }
    return out;
  }

  private _matchesEdgeTypeMask(
    edgeSlot: number,
    query: NonNullable<ReturnType<typeof this.arena.edgeTypeDict.buildQueryMask>>,
  ): boolean {
    return this._matchesEdgeTypeId(this.arena.edgeTypeId[edgeSlot], query);
  }

  private _matchesEdgeTypeId(
    typeId: number,
    query: NonNullable<ReturnType<typeof this.arena.edgeTypeDict.buildQueryMask>>,
  ): boolean {
    if (typeId < 32) return ((query.lo & (1 << typeId)) >>> 0) !== 0;
    if (typeId < 64) return ((query.hi & (1 << (typeId - 32))) >>> 0) !== 0;
    return query.overflowIds ? query.overflowIds.includes(typeId) : false;
  }

  private _matchesNodePropsOnSlot(
    slot: number,
    filters: readonly QueryOptionsFilterProperty[],
  ): boolean {
    const cols = this.arena.nodeColumns;
    for (let i = 0; i < filters.length; i++) {
      if (!this._evalPropFilterOnSlot(cols, slot, filters[i])) return false;
    }
    return true;
  }

  private _matchesEdgePropsOnSlot(
    slot: number,
    filters: readonly QueryOptionsFilterProperty[],
  ): boolean {
    const cols = this.arena.edgeColumns;
    for (let i = 0; i < filters.length; i++) {
      if (!this._evalPropFilterOnSlot(cols, slot, filters[i])) return false;
    }
    return true;
  }

  private _evalPropFilterOnSlot(
    cols: ColumnStore,
    slot: number,
    filter: QueryOptionsFilterProperty,
  ): boolean {
    if (filter.AND && filter.AND.length > 0) {
      for (let i = 0; i < filter.AND.length; i++) {
        if (!this._evalPropFilterOnSlot(cols, slot, filter.AND[i])) return false;
      }
    }
    if (filter.OR && filter.OR.length > 0) {
      let any = false;
      for (let i = 0; i < filter.OR.length; i++) {
        if (this._evalPropFilterOnSlot(cols, slot, filter.OR[i])) {
          any = true;
          break;
        }
      }
      if (!any) return false;
    }
    if (filter.key === undefined) return true;

    const keyId = cols.keyDict.lookup(filter.key);
    const col = keyId >= 0 ? cols.getColumnByKeyId(keyId) : undefined;
    const actualValue = col ? col.get(slot) : undefined;
    return matchPropOp(actualValue, filter.value, filter.op ?? '=');
  }

  private _sortSlots(
    slots: number[],
    field: string,
    direction: 'asc' | 'desc',
    createdOn: Float64Array,
    updatedOn: Float64Array,
    cols: ColumnStore,
  ): void {
    const keyId = field !== 'createdOn' && field !== 'updatedOn' ? cols.keyDict.lookup(field) : -1;
    const col = keyId >= 0 ? cols.getColumnByKeyId(keyId) : undefined;
    const isCreated = field === 'createdOn';
    const isUpdated = field === 'updatedOn';

    slots.sort((a, b) => {
      const va = isCreated ? createdOn[a] : isUpdated ? updatedOn[a] : col?.get(a);
      const vb = isCreated ? createdOn[b] : isUpdated ? updatedOn[b] : col?.get(b);
      return compareSortValues(va, vb, direction);
    });
  }

  // ---------------------------------------------------------------------------
  // Internal Transaction Context Helpers
  // ---------------------------------------------------------------------------

  private _hasNodeInCtx(id: string, ctx: TransactionContext): boolean {
    if (ctx.createdNodes.has(id)) return true;
    if (ctx.deletedNodes.has(id)) return false;
    return this.arena.resolveNodeSlot(id) >= 0;
  }

  private _hasEdgeInCtx(id: string, ctx: TransactionContext): boolean {
    if (ctx.createdEdges.has(id)) return true;
    if (ctx.deletedEdges.has(id)) return false;
    return this.arena.resolveEdgeSlot(id) >= 0;
  }

  private _getNodeDataInCtx(id: string, ctx: TransactionContext): ReadonlyNodeData | undefined {
    const created = ctx.createdNodes.get(id);
    if (created) return created;
    if (ctx.deletedNodes.has(id)) return undefined;

    const slot = this.arena.resolveNodeSlot(id);
    if (slot < 0) return undefined;

    const base = this._nodeDataBySlot(slot);
    const delta = ctx.nodeDeltas.get(id);
    if (!delta) return base;

    let labels: readonly string[] = base.labels;
    if (delta.removedLabels.size > 0 || delta.addedLabels.size > 0) {
      const next = delta.removedLabels.size > 0
        ? base.labels.filter((l) => !delta.removedLabels.has(l))
        : [...base.labels];
      for (const lbl of delta.addedLabels) {
        if (!next.includes(lbl)) next.push(lbl);
      }
      labels = Object.freeze(next);
    }
    const properties = this._txnManager.applyNodeDeltaToProps(base.properties, delta);
    return {
      ...base,
      labels,
      properties,
    };
  }

  private _getEdgeDataInCtx(id: string, ctx: TransactionContext): ReadonlyEdgeData | undefined {
    const created = ctx.createdEdges.get(id);
    if (created) return created;
    if (ctx.deletedEdges.has(id)) return undefined;

    const slot = this.arena.resolveEdgeSlot(id);
    if (slot < 0) return undefined;

    const base = this._edgeDataBySlot(slot);
    const delta = ctx.edgeDeltas.get(id);
    if (!delta) return base;

    return {
      ...base,
      properties: this._txnManager.applyEdgeDeltaToProps(base.properties, delta),
    };
  }

  private _queryNodeDataInCtx(
    ctx: TransactionContext,
    options?: StorageQueryOptions,
  ): ReadonlyNodeData[] {
    const out: ReadonlyNodeData[] = [];

    for (const created of ctx.createdNodes.values()) {
      if (this._matchesNodeDataFilter(created, options)) {
        out.push(created);
      }
    }

    const high = this.arena.nodeHighWater;
    for (let s = 0; s < high; s++) {
      if (this.arena.nodeAlive[s] === 0) continue;
      const id = this.arena.nodeIds[s];
      if (ctx.deletedNodes.has(id) || ctx.createdNodes.has(id)) continue;
      const node = this._getNodeDataInCtx(id, ctx);
      if (node && this._matchesNodeDataFilter(node, options)) {
        out.push(node);
      }
    }

    return this._applyOrderAndLimitData(out, options);
  }

  private _queryEdgeDataInCtx(
    ctx: TransactionContext,
    options?: StorageQueryOptions,
  ): ReadonlyEdgeData[] {
    const out: ReadonlyEdgeData[] = [];

    for (const created of ctx.createdEdges.values()) {
      if (this._matchesEdgeDataFilter(created, options)) {
        out.push(created);
      }
    }

    const high = this.arena.edgeHighWater;
    for (let s = 0; s < high; s++) {
      if (this.arena.edgeAlive[s] === 0) continue;
      const id = this.arena.edgeIds[s];
      if (ctx.deletedEdges.has(id) || ctx.createdEdges.has(id)) continue;
      const edge = this._getEdgeDataInCtx(id, ctx);
      if (edge && this._matchesEdgeDataFilter(edge, options)) {
        out.push(edge);
      }
    }

    return this._applyOrderAndLimitData(out, options);
  }

  private _getEdgesBySourceInCtx(nodeId: string, ctx: TransactionContext): ReadonlyEdgeData[] {
    const out: ReadonlyEdgeData[] = [];
    const seen = new Set<string>();

    const addedIds = ctx.outEdgesAdded.get(nodeId);
    if (addedIds) {
      for (const eid of addedIds) {
        const e = ctx.createdEdges.get(eid);
        if (e) {
          out.push(e);
          seen.add(eid);
        }
      }
    }

    const srcSlot = this.arena.resolveNodeSlot(nodeId);
    if (srcSlot >= 0 || (this.arena.hasDanglingEdges && this.arena.danglingOutEdges.has(nodeId))) {
      const liveSlots = this._filterAdjacentEdgeSlotsLive(srcSlot, 'out', undefined, nodeId);
      for (let i = 0; i < liveSlots.length; i++) {
        const eid = this.arena.edgeIds[liveSlots[i]];
        if (seen.has(eid) || ctx.deletedEdges.has(eid)) continue;
        const edge = this._getEdgeDataInCtx(eid, ctx);
        if (edge) out.push(edge);
      }
    }
    return out;
  }

  private _getEdgesByTargetInCtx(nodeId: string, ctx: TransactionContext): ReadonlyEdgeData[] {
    const out: ReadonlyEdgeData[] = [];
    const seen = new Set<string>();

    const addedIds = ctx.inEdgesAdded.get(nodeId);
    if (addedIds) {
      for (const eid of addedIds) {
        const e = ctx.createdEdges.get(eid);
        if (e) {
          out.push(e);
          seen.add(eid);
        }
      }
    }

    const tgtSlot = this.arena.resolveNodeSlot(nodeId);
    if (tgtSlot >= 0 || (this.arena.hasDanglingEdges && this.arena.danglingInEdges.has(nodeId))) {
      const liveSlots = this._filterAdjacentEdgeSlotsLive(tgtSlot, 'in', undefined, nodeId);
      for (let i = 0; i < liveSlots.length; i++) {
        const eid = this.arena.edgeIds[liveSlots[i]];
        if (seen.has(eid) || ctx.deletedEdges.has(eid)) continue;
        const edge = this._getEdgeDataInCtx(eid, ctx);
        if (edge) out.push(edge);
      }
    }
    return out;
  }

  private _filterAndOrderEdgeData(
    edges: ReadonlyEdgeData[],
    options?: StorageQueryOptions,
  ): ReadonlyEdgeData[] {
    if (!options?.filter && !options?.orderBy && options?.limit === undefined) {
      return edges;
    }
    const filtered = options?.filter
      ? edges.filter((e) => this._matchesEdgeDataFilter(e, options))
      : edges;
    return this._applyOrderAndLimitData(filtered, options);
  }

  private _matchesNodeDataFilter(
    node: ReadonlyNodeData,
    options?: StorageQueryOptions,
  ): boolean {
    const f = options?.filter;
    if (!f) return true;
    if (f.types && f.types.length > 0) {
      if (!node.labels.some((l) => f.types!.includes(l))) return false;
    }
    if (f.properties && f.properties.length > 0) {
      for (let i = 0; i < f.properties.length; i++) {
        if (!evalPropFilterOnRecord(node.properties, f.properties[i])) return false;
      }
    }
    return true;
  }

  private _matchesEdgeDataFilter(
    edge: ReadonlyEdgeData,
    options?: StorageQueryOptions,
  ): boolean {
    const f = options?.filter;
    if (!f) return true;
    if (f.types && f.types.length > 0) {
      if (!f.types.includes(edge.type)) return false;
    }
    if (f.properties && f.properties.length > 0) {
      for (let i = 0; i < f.properties.length; i++) {
        if (!evalPropFilterOnRecord(edge.properties, f.properties[i])) return false;
      }
    }
    return true;
  }

  private _applyOrderAndLimitData<T extends ReadonlyNodeData | ReadonlyEdgeData>(
    items: T[],
    options?: StorageQueryOptions,
  ): T[] {
    let out = items;
    if (options?.orderBy && out.length > 1) {
      const { field, direction } = options.orderBy;
      out = [...out].sort((a, b) => {
        const va = field === 'createdOn' ? a.createdOn : field === 'updatedOn' ? a.updatedOn : a.properties?.[field];
        const vb = field === 'createdOn' ? b.createdOn : field === 'updatedOn' ? b.updatedOn : b.properties?.[field];
        return compareSortValues(va, vb, direction);
      });
    }
    if (options?.limit !== undefined && out.length > options.limit) {
      out = out.slice(0, options.limit);
    }
    return out;
  }

  private _aggregatePropertyOverRecords(
    records: ReadonlyArray<ReadonlyNodeData | ReadonlyEdgeData>,
    key: string,
    distinct?: boolean,
  ): AggregateResult {
    const seen = distinct ? new Set<number>() : null;
    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < records.length; i++) {
      const val = records[i].properties?.[key];
      if (typeof val !== 'number' || Number.isNaN(val)) continue;
      if (seen) {
        if (seen.has(val)) continue;
        seen.add(val);
      }
      count++;
      sum += val;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    if (count === 0) return { count: 0 };
    return { count, sum, avg: sum / count, min, max };
  }
}

function matchPropOp(
  actualValue: unknown,
  filterValue: unknown,
  op: NonNullable<QueryOptionsFilterProperty['op']>,
): boolean {
  switch (op) {
    case '=': return actualValue === filterValue;
    case '<>': return actualValue !== filterValue;
    case '>':
      return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue > filterValue) ||
        (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue > filterValue);
    case '<':
      return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue < filterValue) ||
        (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue < filterValue);
    case '>=':
      return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue >= filterValue) ||
        (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue >= filterValue);
    case '<=':
      return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue <= filterValue) ||
        (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue <= filterValue);
    case 'CONTAINS': return typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue.includes(filterValue);
    case 'STARTS_WITH': return typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue.startsWith(filterValue);
    case 'ENDS_WITH': return typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue.endsWith(filterValue);
    case 'IN': return Array.isArray(filterValue) && filterValue.includes(actualValue);
    case 'NOT_IN': return Array.isArray(filterValue) && !filterValue.includes(actualValue);
    case 'IS_NULL': return actualValue === null || actualValue === undefined;
    case 'IS_NOT_NULL': return actualValue !== null && actualValue !== undefined;
    default: return actualValue === filterValue;
  }
}

function evalPropFilterOnRecord(
  properties: Readonly<Record<string, unknown>>,
  filter: QueryOptionsFilterProperty,
): boolean {
  if (filter.AND && filter.AND.length > 0) {
    for (let i = 0; i < filter.AND.length; i++) {
      if (!evalPropFilterOnRecord(properties, filter.AND[i])) return false;
    }
  }
  if (filter.OR && filter.OR.length > 0) {
    let any = false;
    for (let i = 0; i < filter.OR.length; i++) {
      if (evalPropFilterOnRecord(properties, filter.OR[i])) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }
  if (filter.key === undefined) return true;
  return matchPropOp(properties[filter.key], filter.value, filter.op ?? '=');
}

function compareSortValues(
  aVal: unknown,
  bVal: unknown,
  direction: 'asc' | 'desc',
): number {
  if (aVal === undefined && bVal === undefined) return 0;
  if (aVal === undefined) return direction === 'asc' ? 1 : -1;
  if (bVal === undefined) return direction === 'asc' ? -1 : 1;
  if (aVal === bVal) return 0;
  const lt = (aVal as number | string) < (bVal as number | string);
  return direction === 'asc' ? (lt ? -1 : 1) : (lt ? 1 : -1);
}
