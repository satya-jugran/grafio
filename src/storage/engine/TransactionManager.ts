/**
 * Transaction manager for the v8 in-memory graph kernel.
 *
 * Provides two execution modes:
 *  1. **Explicit `GraphTransaction` contexts:** concurrent isolated staging buffers
 *     with property-level deltas and optimistic write-conflict detection
 *     (`TransactionConflictError` on overlapping `(entity, property)` or delete-modify conflicts,
 *     while merging disjoint property updates cleanly).
 *  2. **Lightweight Undo Checkpoints:** single-writer inverse-operation log for
 *     implicit statement-level atomicity on standalone Cypher write queries.
 *
 * @module storage/engine/TransactionManager
 */

import type { EdgeData, ITransactionHandle, NodeData, PropertyPatch, ReadonlyEdgeData, ReadonlyNodeData } from '../../types';
import {
  EdgeAlreadyExistsError,
  EdgeNotFoundError,
  NodeAlreadyExistsError,
  NodeNotFoundError,
  TransactionConflictError,
} from '../../errors';
import { NONE_SLOT, type SlotArena } from './SlotArena';
import type { AdjacencyStore } from './AdjacencyStore';
import type { PropertyIndexStore } from './PropertyIndexStore';

export interface NodeDelta {
  /** `true` if `replace: true` was applied in this transaction */
  replacedProps: boolean;
  /** Keys set/overwritten in this transaction */
  setProps: Map<string, unknown>;
  /** Keys explicitly unset in this transaction */
  unsetProps: Set<string>;
  /** Labels removed in this transaction */
  removedLabels: Set<string>;
  /** Labels added in this transaction */
  addedLabels: Set<string>;
}

export interface EdgeDelta {
  replacedProps: boolean;
  setProps: Map<string, unknown>;
  unsetProps: Set<string>;
}

export interface TransactionContext {
  readonly id: string;
  readonly startSeq: number;

  // Staged brand-new entities created inside this transaction
  readonly createdNodes: Map<string, ReadonlyNodeData>;
  readonly createdEdges: Map<string, ReadonlyEdgeData>;
  readonly createdEdgesStrict: Set<string>;

  // Deleted live entity IDs (tombstones)
  readonly deletedNodes: Map<string, number>; // id -> baseEntityVersion
  readonly deletedEdges: Map<string, number>; // id -> baseEntityVersion

  // Property/label deltas against live entities
  readonly nodeDeltas: Map<string, NodeDelta>;
  readonly edgeDeltas: Map<string, EdgeDelta>;

  // Per-txn adjacency overlays for staged edges / deleted edges
  readonly outEdgesAdded: Map<string, Set<string>>; // srcNodeId -> edgeIds (created in txn)
  readonly inEdgesAdded: Map<string, Set<string>>;  // tgtNodeId -> edgeIds (created in txn)
}

export type UndoEntry =
  | { kind: 'deleteNode'; id: string }
  | { kind: 'deleteEdge'; id: string }
  | { kind: 'restoreNode'; data: NodeData }
  | { kind: 'restoreEdge'; data: EdgeData }
  | { kind: 'restoreNodeProps'; id: string; props: Readonly<Record<string, unknown>> }
  | { kind: 'restoreEdgeProps'; id: string; props: Readonly<Record<string, unknown>> }
  | { kind: 'restoreNodeLabels'; id: string; labels: readonly string[] };

export class TransactionManager {
  private _commitSeq = 0;
  private _txnCounter = 0;
  private readonly _activeTxns = new Map<string, TransactionContext>();

  // Sparse per-entity-ID commit sequence maps for conflict detection (populated on committed mutations)
  private readonly _nodeEntitySeq = new Map<string, number>();
  private readonly _nodePropSeq = new Map<string, Map<string, number>>();
  private readonly _nodeAnyPropSeq = new Map<string, number>();
  private readonly _nodeReplaceSeq = new Map<string, number>();
  private readonly _nodeLabelSeq = new Map<string, number>();
  private readonly _edgeEntitySeq = new Map<string, number>();
  private readonly _edgePropSeq = new Map<string, Map<string, number>>();
  private readonly _edgeAnyPropSeq = new Map<string, number>();
  private readonly _edgeReplaceSeq = new Map<string, number>();
  private readonly _deletedNodeSeq = new Map<string, number>();
  private readonly _deletedEdgeSeq = new Map<string, number>();

  get hasActiveTransactions(): boolean {
    return this._activeTxns.size > 0;
  }

  get commitSeq(): number {
    return this._commitSeq;
  }

  getContext(handle?: ITransactionHandle): TransactionContext | null {
    if (!handle) return null;
    return this._activeTxns.get(handle.id) ?? null;
  }

  begin(): ITransactionHandle {
    const id = `txn-${++this._txnCounter}-${Date.now().toString(36)}`;
    const ctx: TransactionContext = {
      id,
      startSeq: this._commitSeq,
      createdNodes: new Map(),
      createdEdges: new Map(),
      createdEdgesStrict: new Set(),
      deletedNodes: new Map(),
      deletedEdges: new Map(),
      nodeDeltas: new Map(),
      edgeDeltas: new Map(),
      outEdgesAdded: new Map(),
      inEdgesAdded: new Map(),
    };
    this._activeTxns.set(id, ctx);
    return { id, context: undefined };
  }

  rollback(handle: ITransactionHandle): void {
    this._activeTxns.delete(handle.id);
  }

  /**
   * Records a live non-transactional write commit seq so concurrent active
   * transactions see conflicts if they touch the same entity/property.
   */
  recordLiveNodeWrite(
    id: string,
    propKeys?: readonly string[],
    deleted = false,
    replaced = false,
  ): void {
    if (this._activeTxns.size === 0) return;
    const seq = ++this._commitSeq;
    if (deleted) {
      this._deletedNodeSeq.set(id, seq);
      return;
    }
    this._nodeEntitySeq.set(id, seq);
    if (replaced) {
      this._nodeReplaceSeq.set(id, seq);
      this._nodeAnyPropSeq.set(id, seq);
    }
    if (propKeys && propKeys.length > 0) {
      this._nodeAnyPropSeq.set(id, seq);
      let pm = this._nodePropSeq.get(id);
      if (!pm) {
        pm = new Map();
        this._nodePropSeq.set(id, pm);
      }
      for (const k of propKeys) pm.set(k, seq);
    }
  }

  recordLiveNodeLabelWrite(id: string): void {
    if (this._activeTxns.size === 0) return;
    const seq = ++this._commitSeq;
    this._nodeLabelSeq.set(id, seq);
    this._nodeEntitySeq.set(id, seq);
  }

  recordLiveEdgeWrite(
    id: string,
    propKeys?: readonly string[],
    deleted = false,
    replaced = false,
  ): void {
    if (this._activeTxns.size === 0) return;
    const seq = ++this._commitSeq;
    if (deleted) {
      this._deletedEdgeSeq.set(id, seq);
      return;
    }
    this._edgeEntitySeq.set(id, seq);
    if (replaced) {
      this._edgeReplaceSeq.set(id, seq);
      this._edgeAnyPropSeq.set(id, seq);
    }
    if (propKeys && propKeys.length > 0) {
      this._edgeAnyPropSeq.set(id, seq);
      let pm = this._edgePropSeq.get(id);
      if (!pm) {
        pm = new Map();
        this._edgePropSeq.set(id, pm);
      }
      for (const k of propKeys) pm.set(k, seq);
    }
  }

  // ── Staged Mutations ──────────────────────────────────────────────────────

  stageInsertNode(ctx: TransactionContext, node: NodeData, arena: SlotArena): void {
    const existingLive = arena.resolveNodeSlot(node.id) >= 0;
    if ((existingLive && !ctx.deletedNodes.has(node.id)) || ctx.createdNodes.has(node.id)) {
      throw new NodeAlreadyExistsError(node.id);
    }
    const now = Date.now();
    ctx.createdNodes.set(node.id, {
      id: node.id,
      labels: Object.freeze([...node.labels]),
      createdOn: node.createdOn ?? now,
      updatedOn: node.updatedOn ?? now,
      properties: Object.freeze({ ...node.properties }),
    });
  }

  stageDeleteNode(ctx: TransactionContext, id: string, arena: SlotArena): void {
    if (ctx.createdNodes.has(id)) {
      ctx.createdNodes.delete(id);
      return;
    }
    const slot = arena.resolveNodeSlot(id);
    if (slot < 0 || ctx.deletedNodes.has(id)) return;
    ctx.nodeDeltas.delete(id);
    ctx.deletedNodes.set(id, this._nodeEntitySeq.get(id) ?? 0);
  }

  stageInsertEdge(
    ctx: TransactionContext,
    edge: EdgeData,
    arena: SlotArena,
    strictEndpoints = false,
  ): void {
    const existingLive = arena.resolveEdgeSlot(edge.id) >= 0;
    if ((existingLive && !ctx.deletedEdges.has(edge.id)) || ctx.createdEdges.has(edge.id)) {
      throw new EdgeAlreadyExistsError(edge.id);
    }
    if (strictEndpoints) {
      ctx.createdEdgesStrict.add(edge.id);
    } else {
      ctx.createdEdgesStrict.delete(edge.id);
    }
    const now = Date.now();
    const staged: EdgeData = {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      createdOn: edge.createdOn ?? now,
      updatedOn: edge.updatedOn ?? now,
      properties: Object.freeze({ ...edge.properties }),
    };
    ctx.createdEdges.set(edge.id, staged);

    let outSet = ctx.outEdgesAdded.get(edge.sourceId);
    if (!outSet) {
      outSet = new Set();
      ctx.outEdgesAdded.set(edge.sourceId, outSet);
    }
    outSet.add(edge.id);

    let inSet = ctx.inEdgesAdded.get(edge.targetId);
    if (!inSet) {
      inSet = new Set();
      ctx.inEdgesAdded.set(edge.targetId, inSet);
    }
    inSet.add(edge.id);
  }

  stageDeleteEdge(ctx: TransactionContext, id: string, arena: SlotArena): void {
    const created = ctx.createdEdges.get(id);
    if (created) {
      ctx.createdEdges.delete(id);
      ctx.outEdgesAdded.get(created.sourceId)?.delete(id);
      ctx.inEdgesAdded.get(created.targetId)?.delete(id);
      return;
    }
    const slot = arena.resolveEdgeSlot(id);
    if (slot < 0 || ctx.deletedEdges.has(id)) return;
    ctx.edgeDeltas.delete(id);
    ctx.deletedEdges.set(id, this._edgeEntitySeq.get(id) ?? 0);
  }

  stagePatchProperties(
    ctx: TransactionContext,
    target: 'node' | 'edge',
    id: string,
    patch: PropertyPatch,
    arena: SlotArena,
  ): void {
    if (target === 'node') {
      const created = ctx.createdNodes.get(id);
      if (created) {
        const nextProps: Record<string, unknown> = patch.replace ? {} : { ...created.properties };
        if (patch.unset) {
          for (const k of patch.unset) delete nextProps[k];
        }
        if (patch.set) {
          for (const [k, v] of Object.entries(patch.set)) nextProps[k] = v;
        }
        ctx.createdNodes.set(id, {
          ...created,
          updatedOn: Date.now(),
          properties: Object.freeze(nextProps),
        });
        return;
      }
      if (ctx.deletedNodes.has(id)) throw new NodeNotFoundError(id);

      const slot = arena.resolveNodeSlot(id);
      if (slot < 0) throw new NodeNotFoundError(id);

      let delta = ctx.nodeDeltas.get(id);
      if (!delta) {
        delta = {
          replacedProps: false,
          setProps: new Map(),
          unsetProps: new Set(),
          removedLabels: new Set(),
          addedLabels: new Set(),
        };
        ctx.nodeDeltas.set(id, delta);
      }

      if (patch.replace) {
        delta.replacedProps = true;
        delta.setProps.clear();
        delta.unsetProps.clear();
      }
      if (patch.unset) {
        for (const k of patch.unset) {
          delta.setProps.delete(k);
          delta.unsetProps.add(k);
        }
      }
      if (patch.set) {
        for (const [k, v] of Object.entries(patch.set)) {
          delta.unsetProps.delete(k);
          delta.setProps.set(k, v);
        }
      }
    } else {
      const created = ctx.createdEdges.get(id);
      if (created) {
        const nextProps: Record<string, unknown> = patch.replace ? {} : { ...created.properties };
        if (patch.unset) {
          for (const k of patch.unset) delete nextProps[k];
        }
        if (patch.set) {
          for (const [k, v] of Object.entries(patch.set)) nextProps[k] = v;
        }
        ctx.createdEdges.set(id, {
          ...created,
          updatedOn: Date.now(),
          properties: Object.freeze(nextProps),
        });
        return;
      }
      if (ctx.deletedEdges.has(id)) throw new EdgeNotFoundError(id);

      const slot = arena.resolveEdgeSlot(id);
      if (slot < 0) throw new EdgeNotFoundError(id);

      let delta = ctx.edgeDeltas.get(id);
      if (!delta) {
        delta = {
          replacedProps: false,
          setProps: new Map(),
          unsetProps: new Set(),
        };
        ctx.edgeDeltas.set(id, delta);
      }

      if (patch.replace) {
        delta.replacedProps = true;
        delta.setProps.clear();
        delta.unsetProps.clear();
      }
      if (patch.unset) {
        for (const k of patch.unset) {
          delta.setProps.delete(k);
          delta.unsetProps.add(k);
        }
      }
      if (patch.set) {
        for (const [k, v] of Object.entries(patch.set)) {
          delta.unsetProps.delete(k);
          delta.setProps.set(k, v);
        }
      }
    }
  }

  stageRemoveNodeLabels(ctx: TransactionContext, nodeId: string, labels: readonly string[], arena: SlotArena): number {
    const created = ctx.createdNodes.get(nodeId);
    if (created) {
      const filtered = created.labels.filter((l) => !labels.includes(l));
      const removedCount = created.labels.length - filtered.length;
      if (removedCount > 0) {
        ctx.createdNodes.set(nodeId, {
          ...created,
          labels: Object.freeze(filtered),
          updatedOn: Date.now(),
        });
      }
      return removedCount;
    }
    if (ctx.deletedNodes.has(nodeId)) throw new NodeNotFoundError(nodeId);

    const slot = arena.resolveNodeSlot(nodeId);
    if (slot < 0) throw new NodeNotFoundError(nodeId);

    let delta = ctx.nodeDeltas.get(nodeId);
    if (!delta) {
      delta = {
        replacedProps: false,
        setProps: new Map(),
        unsetProps: new Set(),
        removedLabels: new Set(),
        addedLabels: new Set(),
      };
      ctx.nodeDeltas.set(nodeId, delta);
    }
    let removedCount = 0;
    const currentLabels = arena.nodeLabelStrings[slot];
    for (const lbl of labels) {
      if (delta.addedLabels.has(lbl)) {
        delta.addedLabels.delete(lbl);
        removedCount++;
      } else if (currentLabels.includes(lbl) && !delta.removedLabels.has(lbl)) {
        delta.removedLabels.add(lbl);
        removedCount++;
      }
    }
    return removedCount;
  }

  stageAddNodeLabels(ctx: TransactionContext, nodeId: string, labels: readonly string[], arena: SlotArena): number {
    const created = ctx.createdNodes.get(nodeId);
    if (created) {
      const added: string[] = [];
      for (const lbl of labels) {
        if (!created.labels.includes(lbl) && !added.includes(lbl)) {
          added.push(lbl);
        }
      }
      if (added.length > 0) {
        ctx.createdNodes.set(nodeId, {
          ...created,
          labels: Object.freeze([...created.labels, ...added]),
          updatedOn: Date.now(),
        });
      }
      return added.length;
    }
    if (ctx.deletedNodes.has(nodeId)) throw new NodeNotFoundError(nodeId);

    const slot = arena.resolveNodeSlot(nodeId);
    if (slot < 0) throw new NodeNotFoundError(nodeId);

    let delta = ctx.nodeDeltas.get(nodeId);
    if (!delta) {
      delta = {
        replacedProps: false,
        setProps: new Map(),
        unsetProps: new Set(),
        removedLabels: new Set(),
        addedLabels: new Set(),
      };
      ctx.nodeDeltas.set(nodeId, delta);
    }
    let addedCount = 0;
    const currentLabels = arena.nodeLabelStrings[slot];
    for (const lbl of labels) {
      if (delta.removedLabels.has(lbl)) {
        delta.removedLabels.delete(lbl);
        addedCount++;
      } else if (!currentLabels.includes(lbl) && !delta.addedLabels.has(lbl)) {
        delta.addedLabels.add(lbl);
        addedCount++;
      }
    }
    return addedCount;
  }

  // ── View Materialization (Reads Inside Transaction) ───────────────────────

  applyNodeDeltaToProps(baseProps: Readonly<Record<string, unknown>>, delta: NodeDelta): Readonly<Record<string, unknown>> {
    const merged: Record<string, unknown> = delta.replacedProps ? {} : { ...baseProps };
    for (const k of delta.unsetProps) delete merged[k];
    for (const [k, v] of delta.setProps) merged[k] = v;
    return Object.freeze(merged);
  }

  applyEdgeDeltaToProps(baseProps: Readonly<Record<string, unknown>>, delta: EdgeDelta): Readonly<Record<string, unknown>> {
    const merged: Record<string, unknown> = delta.replacedProps ? {} : { ...baseProps };
    for (const k of delta.unsetProps) delete merged[k];
    for (const [k, v] of delta.setProps) merged[k] = v;
    return Object.freeze(merged);
  }

  // ── Optimistic Conflict Detection + Atomic Commit ─────────────────────────

  commit(
    handle: ITransactionHandle,
    arena: SlotArena,
    adjacency: AdjacencyStore,
    propIndex: PropertyIndexStore,
  ): void {
    const ctx = this._activeTxns.get(handle.id);
    if (!ctx) {
      throw new Error('No active transaction to commit');
    }

    // 1. Validate BEFORE mutating any live state
    this._validateCommit(ctx, arena);

    const newSeq = ++this._commitSeq;

    // 2. Apply edge deletions before node deletions so incident CSR edges retire cleanly
    for (const id of ctx.deletedEdges.keys()) {
      const slot = arena.resolveEdgeSlot(id);
      if (slot >= 0) {
        const oldProps = propIndex.hasAnyEdgeIndexes ? arena.edgeColumns.materializeRecord(slot) : {};
        propIndex.onEdgeDeleted(slot, arena.edgeTypeId[slot], oldProps);
        const removedFromDelta = adjacency.removeEdge(slot, arena.edgeSrcSlot[slot], arena.edgeTgtSlot[slot]);
        const delayReuse = !removedFromDelta || slot < adjacency.csrEdgeSlotBound;
        arena.freeEdge(slot, delayReuse);
        this._deletedEdgeSeq.set(id, newSeq);
      }
    }

    // 3. Apply node deletions
    for (const id of ctx.deletedNodes.keys()) {
      const slot = arena.resolveNodeSlot(id);
      if (slot >= 0) {
        const oldProps = propIndex.hasAnyNodeIndexes ? arena.nodeColumns.materializeRecord(slot) : {};
        propIndex.onNodeDeleted(slot, arena.nodeLabelIds[slot], oldProps);
        arena.detachNodeIncidentEdges(slot, adjacency);
        const delayReuse = adjacency.hasCsrEntries(slot);
        arena.freeNode(slot, delayReuse);
        adjacency.clearNodeDelta(slot);
        this._deletedNodeSeq.set(id, newSeq);
      }
    }

    // 4. Apply node creations
    for (const node of ctx.createdNodes.values()) {
      const slot = arena.allocateNode(node.labels, node.properties, node.id, node.createdOn, node.updatedOn);
      arena.bindDanglingEdgesForNode(node.id, slot, adjacency);
      propIndex.onNodeInserted(slot, arena.nodeLabelIds[slot], node.properties);
      this._nodeEntitySeq.set(node.id, newSeq);
    }

    // 5. Apply node property/label deltas
    for (const [id, delta] of ctx.nodeDeltas) {
      const slot = arena.resolveNodeSlot(id);
      if (slot < 0) continue;

      if (delta.removedLabels.size > 0) {
        const removed = Array.from(delta.removedLabels);
        const removedIds = removed
          .map((l) => arena.labelDict.lookup(l))
          .filter((lid) => lid >= 0);
        const curProps = propIndex.hasAnyNodeIndexes ? arena.nodeColumns.materializeRecord(slot) : {};
        const actualRemoved = arena.removeNodeLabelsBySlot(slot, removed);
        propIndex.onNodeLabelsRemoved(slot, removedIds, curProps);
        if (actualRemoved.length > 0) {
          this._nodeLabelSeq.set(id, newSeq);
        }
      }

      if (delta.addedLabels.size > 0) {
        const added = Array.from(delta.addedLabels);
        const curProps = propIndex.hasAnyNodeIndexes ? arena.nodeColumns.materializeRecord(slot) : {};
        const actualAdded = arena.addNodeLabelsBySlot(slot, added);
        if (actualAdded.length > 0) {
          const addedIds = actualAdded
            .map((l) => arena.labelDict.lookup(l))
            .filter((lid) => lid >= 0);
          propIndex.onNodeLabelsAdded(slot, addedIds, curProps);
          this._nodeLabelSeq.set(id, newSeq);
        }
      }

      if (delta.replacedProps || delta.setProps.size > 0 || delta.unsetProps.size > 0) {
        const oldProps = arena.nodeColumns.materializeRecord(slot);
        arena.invalidateNodeEntity(slot);
        if (delta.replacedProps) {
          arena.nodeColumns.clearSlot(slot);
        } else {
          for (const k of delta.unsetProps) {
            const keyId = arena.nodePropDict.lookup(k);
            if (keyId >= 0) arena.nodeColumns.deleteValueByKeyId(keyId, slot);
          }
        }
        for (const [k, v] of delta.setProps) {
          arena.nodeColumns.setValue(k, slot, v);
        }
        arena.nodeUpdatedOn[slot] = Date.now();
        arena.nodeVersion[slot] = (arena.nodeVersion[slot] + 1) >>> 0;
        const newProps = arena.nodeColumns.materializeRecord(slot);
        const changedKeys = delta.replacedProps
          ? undefined
          : [...delta.unsetProps, ...delta.setProps.keys()];
        propIndex.onNodePropertiesUpdated(slot, arena.nodeLabelIds[slot], oldProps, newProps, changedKeys);

        let pm = this._nodePropSeq.get(id);
        if (!pm) {
          pm = new Map();
          this._nodePropSeq.set(id, pm);
        }
        if (delta.replacedProps) {
          this._nodeReplaceSeq.set(id, newSeq);
          for (const k of Object.keys(oldProps)) pm.set(k, newSeq);
        } else {
          for (const k of delta.unsetProps) pm.set(k, newSeq);
        }
        for (const k of delta.setProps.keys()) pm.set(k, newSeq);
        this._nodeAnyPropSeq.set(id, newSeq);
      }
      this._nodeEntitySeq.set(id, newSeq);
    }

    // 6. Apply edge creations
    for (const edge of ctx.createdEdges.values()) {
      const rawSrc = arena.resolveNodeSlot(edge.sourceId);
      const rawTgt = arena.resolveNodeSlot(edge.targetId);
      if (ctx.createdEdgesStrict.has(edge.id)) {
        if (rawSrc < 0) throw new NodeNotFoundError(edge.sourceId);
        if (rawTgt < 0) throw new NodeNotFoundError(edge.targetId);
      }
      const srcSlot = rawSrc < 0 ? NONE_SLOT : rawSrc;
      const tgtSlot = rawTgt < 0 ? NONE_SLOT : rawTgt;
      const { slot, typeId } = arena.allocateEdge(
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
        adjacency.addEdge(slot, srcSlot, tgtSlot, typeId);
      }
      propIndex.onEdgeInserted(slot, typeId, edge.properties);
      this._edgeEntitySeq.set(edge.id, newSeq);
    }

    // 7. Apply edge property deltas
    for (const [id, delta] of ctx.edgeDeltas) {
      const slot = arena.resolveEdgeSlot(id);
      if (slot < 0) continue;

      const oldProps = arena.edgeColumns.materializeRecord(slot);
      arena.invalidateEdgeEntity(slot);
      if (delta.replacedProps) {
        arena.edgeColumns.clearSlot(slot);
      } else {
        for (const k of delta.unsetProps) {
          const keyId = arena.edgePropDict.lookup(k);
          if (keyId >= 0) arena.edgeColumns.deleteValueByKeyId(keyId, slot);
        }
      }
      for (const [k, v] of delta.setProps) {
        arena.edgeColumns.setValue(k, slot, v);
      }
      arena.edgeUpdatedOn[slot] = Date.now();
      arena.edgeVersion[slot] = (arena.edgeVersion[slot] + 1) >>> 0;
      const newProps = arena.edgeColumns.materializeRecord(slot);
      const changedKeys = delta.replacedProps
        ? undefined
        : [...delta.unsetProps, ...delta.setProps.keys()];
      propIndex.onEdgePropertiesUpdated(slot, arena.edgeTypeId[slot], oldProps, newProps, changedKeys);

      let pm = this._edgePropSeq.get(id);
      if (!pm) {
        pm = new Map();
        this._edgePropSeq.set(id, pm);
      }
      if (delta.replacedProps) {
        this._edgeReplaceSeq.set(id, newSeq);
        for (const k of Object.keys(oldProps)) pm.set(k, newSeq);
      } else {
        for (const k of delta.unsetProps) pm.set(k, newSeq);
      }
      for (const k of delta.setProps.keys()) pm.set(k, newSeq);
      this._edgeAnyPropSeq.set(id, newSeq);
      this._edgeEntitySeq.set(id, newSeq);
    }

    this._activeTxns.delete(handle.id);
    if (this._activeTxns.size === 0) {
      this._trimVersionMaps();
    }
  }

  private _validateCommit(ctx: TransactionContext, arena: SlotArena): void {
    // Check node creations don't collide with newly committed node IDs
    for (const node of ctx.createdNodes.values()) {
      if (arena.resolveNodeSlot(node.id) >= 0 && !ctx.deletedNodes.has(node.id)) {
        throw new TransactionConflictError(`Node '${node.id}' was created concurrently`);
      }
    }

    // Check deleted nodes weren't modified concurrently
    for (const id of ctx.deletedNodes.keys()) {
      const liveSeq = this._nodeEntitySeq.get(id) ?? 0;
      if (liveSeq > ctx.startSeq) {
        throw new TransactionConflictError(`Node '${id}' was modified concurrently before delete`);
      }
    }

    // Check node deltas: entity not deleted concurrently, and overlapping properties/labels not modified
    for (const [id, delta] of ctx.nodeDeltas) {
      const delSeq = this._deletedNodeSeq.get(id) ?? 0;
      if (delSeq > ctx.startSeq) {
        throw new TransactionConflictError(`Node '${id}' was deleted concurrently`);
      }
      if (delta.removedLabels.size > 0 || delta.addedLabels.size > 0) {
        if ((this._nodeLabelSeq.get(id) ?? 0) > ctx.startSeq) {
          throw new TransactionConflictError(`Node '${id}' labels were modified concurrently`);
        }
      }
      if (delta.replacedProps) {
        if (
          (this._nodeAnyPropSeq.get(id) ?? 0) > ctx.startSeq ||
          (this._nodeReplaceSeq.get(id) ?? 0) > ctx.startSeq
        ) {
          throw new TransactionConflictError(`Node '${id}' was modified concurrently`);
        }
      } else if (delta.setProps.size > 0 || delta.unsetProps.size > 0) {
        if ((this._nodeReplaceSeq.get(id) ?? 0) > ctx.startSeq) {
          throw new TransactionConflictError(`Node '${id}' properties were replaced concurrently`);
        }
        const livePropSeqs = this._nodePropSeq.get(id);
        if (livePropSeqs) {
          for (const k of delta.setProps.keys()) {
            if ((livePropSeqs.get(k) ?? 0) > ctx.startSeq) {
              throw new TransactionConflictError(
                `Conflicting concurrent write on node '${id}' property '${k}'`,
              );
            }
          }
          for (const k of delta.unsetProps) {
            if ((livePropSeqs.get(k) ?? 0) > ctx.startSeq) {
              throw new TransactionConflictError(
                `Conflicting concurrent write on node '${id}' property '${k}'`,
              );
            }
          }
        }
      }
    }

    // Check created edges reference nodes that still exist (or are created in this txn) and not concurrently deleted
    for (const edge of ctx.createdEdges.values()) {
      if (arena.resolveEdgeSlot(edge.id) >= 0 && !ctx.deletedEdges.has(edge.id)) {
        throw new TransactionConflictError(`Edge '${edge.id}' was created concurrently`);
      }
      if (ctx.createdEdgesStrict.has(edge.id)) {
        const srcAlive = ctx.createdNodes.has(edge.sourceId) ||
          (arena.resolveNodeSlot(edge.sourceId) >= 0 && !ctx.deletedNodes.has(edge.sourceId));
        const tgtAlive = ctx.createdNodes.has(edge.targetId) ||
          (arena.resolveNodeSlot(edge.targetId) >= 0 && !ctx.deletedNodes.has(edge.targetId));
        if (!srcAlive || !tgtAlive) {
          throw new TransactionConflictError(
            `Endpoint node for edge '${edge.id}' was deleted concurrently`,
          );
        }
      }
    }

    // Check deleted edges weren't modified concurrently
    for (const id of ctx.deletedEdges.keys()) {
      const liveSeq = this._edgeEntitySeq.get(id) ?? 0;
      if (liveSeq > ctx.startSeq) {
        throw new TransactionConflictError(`Edge '${id}' was modified concurrently before delete`);
      }
    }

    // Check edge deltas
    for (const [id, delta] of ctx.edgeDeltas) {
      const delSeq = this._deletedEdgeSeq.get(id) ?? 0;
      if (delSeq > ctx.startSeq) {
        throw new TransactionConflictError(`Edge '${id}' was deleted concurrently`);
      }
      if (delta.replacedProps) {
        if (
          (this._edgeAnyPropSeq.get(id) ?? 0) > ctx.startSeq ||
          (this._edgeReplaceSeq.get(id) ?? 0) > ctx.startSeq
        ) {
          throw new TransactionConflictError(`Edge '${id}' was modified concurrently`);
        }
      } else if (delta.setProps.size > 0 || delta.unsetProps.size > 0) {
        if ((this._edgeReplaceSeq.get(id) ?? 0) > ctx.startSeq) {
          throw new TransactionConflictError(`Edge '${id}' properties were replaced concurrently`);
        }
        const livePropSeqs = this._edgePropSeq.get(id);
        if (livePropSeqs) {
          for (const k of delta.setProps.keys()) {
            if ((livePropSeqs.get(k) ?? 0) > ctx.startSeq) {
              throw new TransactionConflictError(
                `Conflicting concurrent write on edge '${id}' property '${k}'`,
              );
            }
          }
          for (const k of delta.unsetProps) {
            if ((livePropSeqs.get(k) ?? 0) > ctx.startSeq) {
              throw new TransactionConflictError(
                `Conflicting concurrent write on edge '${id}' property '${k}'`,
              );
            }
          }
        }
      }
    }
  }

  private _trimVersionMaps(): void {
    // Keep sparse conflict tracking bounded when no transactions remain active
    if (this._nodeEntitySeq.size > 4096) this._nodeEntitySeq.clear();
    if (this._nodePropSeq.size > 4096) this._nodePropSeq.clear();
    if (this._nodeAnyPropSeq.size > 4096) this._nodeAnyPropSeq.clear();
    if (this._nodeReplaceSeq.size > 4096) this._nodeReplaceSeq.clear();
    if (this._nodeLabelSeq.size > 4096) this._nodeLabelSeq.clear();
    if (this._edgeEntitySeq.size > 4096) this._edgeEntitySeq.clear();
    if (this._edgePropSeq.size > 4096) this._edgePropSeq.clear();
    if (this._edgeAnyPropSeq.size > 4096) this._edgeAnyPropSeq.clear();
    if (this._edgeReplaceSeq.size > 4096) this._edgeReplaceSeq.clear();
    if (this._deletedNodeSeq.size > 4096) this._deletedNodeSeq.clear();
    if (this._deletedEdgeSeq.size > 4096) this._deletedEdgeSeq.clear();
  }

  clear(): void {
    this._activeTxns.clear();
    this._nodeEntitySeq.clear();
    this._nodePropSeq.clear();
    this._nodeAnyPropSeq.clear();
    this._nodeReplaceSeq.clear();
    this._nodeLabelSeq.clear();
    this._edgeEntitySeq.clear();
    this._edgePropSeq.clear();
    this._edgeAnyPropSeq.clear();
    this._edgeReplaceSeq.clear();
    this._deletedNodeSeq.clear();
    this._deletedEdgeSeq.clear();
    this._commitSeq = 0;
  }
}
