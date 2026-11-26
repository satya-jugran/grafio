/**
 * Dense `uint32` Structure-of-Arrays (SoA) arena for nodes and edges.
 *
 * Manages slot allocation/recycling with generation counters (`nodeGen` / `edgeGen`),
 * compact O(1) arithmetic ID decoding (`@n<slot>:<gen>` / `@e<slot>:<gen>`),
 * 64-bit label masks, interned label tuples, columnar property stores, and
 * lazily-materialized `Node` / `Edge` entity caches.
 *
 * @module storage/engine/SlotArena
 */

import { Node } from '../../Node';
import { Edge } from '../../Edge';
import { StringDictionary, type Bitmask64Query } from './StringDictionary';
import { Uint32SlotSet } from './Uint32SlotSet';
import { ColumnStore } from './ColumnStore';
import type { AdjacencyStore } from './AdjacencyStore';
import { fastUUID } from '../../utils';

export type IdStrategy = 'compact' | 'uuid';
export const NONE_SLOT = 0xffffffff;

const INITIAL_NODE_CAP = 256;
const INITIAL_EDGE_CAP = 512;

export class SlotArena {
  readonly labelDict = new StringDictionary();
  readonly edgeTypeDict = new StringDictionary();
  readonly nodePropDict = new StringDictionary();
  readonly edgePropDict = new StringDictionary();

  readonly nodeColumns: ColumnStore;
  readonly edgeColumns: ColumnStore;

  private readonly _idStrategy: IdStrategy;

  // ── Node SoA columns ─────────────────────────────────────────────────────
  private _nodeCap = INITIAL_NODE_CAP;
  nodeHighWater = 0;
  private _liveNodeCount = 0;

  nodeAlive: Uint8Array;
  nodeHasCustomId: Uint8Array;
  nodeGen: Uint32Array;
  nodeVersion: Uint32Array;
  nodeLabelMaskLo: Uint32Array;
  nodeLabelMaskHi: Uint32Array;
  nodeCreatedOn: Float64Array;
  nodeUpdatedOn: Float64Array;

  nodeIds: string[];
  nodeLabelIds: (readonly number[])[];
  nodeLabelStrings: (readonly string[])[];
  nodeEntities: (Node | undefined)[];

  private _nodeFreeList: Uint32Array;
  private _nodeFreeLen = 0;
  private readonly _retiredCsrNodeSlots: number[] = [];
  private readonly _customNodeIdToSlot = new Map<string, number>();
  private readonly _nodesByLabelId: Uint32SlotSet[] = [];
  private readonly _labelTupleCache = new Map<string, readonly string[]>();

  // ── Edge SoA columns ─────────────────────────────────────────────────────
  private _edgeCap = INITIAL_EDGE_CAP;
  edgeHighWater = 0;
  private _liveEdgeCount = 0;

  edgeAlive: Uint8Array;
  edgeHasCustomId: Uint8Array;
  edgeGen: Uint32Array;
  edgeVersion: Uint32Array;
  edgeSrcSlot: Uint32Array;
  edgeTgtSlot: Uint32Array;
  edgeTypeId: Uint32Array;
  edgeCreatedOn: Float64Array;
  edgeUpdatedOn: Float64Array;

  edgeIds: string[];
  edgeEntities: (Edge | undefined)[];

  private _edgeFreeList: Uint32Array;
  private _edgeFreeLen = 0;
  private readonly _retiredCsrEdgeSlots: number[] = [];
  private readonly _customEdgeIdToSlot = new Map<string, number>();
  private readonly _edgesByTypeId: Uint32SlotSet[] = [];
  private readonly _danglingEdgeEndpoints = new Map<
    number,
    { sourceId: string; targetId: string }
  >();
  readonly danglingOutEdges = new Map<string, Set<number>>();
  readonly danglingInEdges = new Map<string, Set<number>>();

  // Optional growth listener (e.g. AdjacencyStore)
  onNodeCapacityGrow?: (newCapacity: number) => void;

  constructor(idStrategy: IdStrategy = 'compact') {
    this._idStrategy = idStrategy;
    this.nodeColumns = new ColumnStore(this.nodePropDict, INITIAL_NODE_CAP);
    this.edgeColumns = new ColumnStore(this.edgePropDict, INITIAL_EDGE_CAP);

    this.nodeAlive = new Uint8Array(INITIAL_NODE_CAP);
    this.nodeHasCustomId = new Uint8Array(INITIAL_NODE_CAP);
    this.nodeGen = new Uint32Array(INITIAL_NODE_CAP);
    this.nodeVersion = new Uint32Array(INITIAL_NODE_CAP);
    this.nodeLabelMaskLo = new Uint32Array(INITIAL_NODE_CAP);
    this.nodeLabelMaskHi = new Uint32Array(INITIAL_NODE_CAP);
    this.nodeCreatedOn = new Float64Array(INITIAL_NODE_CAP);
    this.nodeUpdatedOn = new Float64Array(INITIAL_NODE_CAP);
    this.nodeIds = new Array<string>(INITIAL_NODE_CAP);
    this.nodeLabelIds = new Array<readonly number[]>(INITIAL_NODE_CAP);
    this.nodeLabelStrings = new Array<readonly string[]>(INITIAL_NODE_CAP);
    this.nodeEntities = new Array<Node | undefined>(INITIAL_NODE_CAP);
    this._nodeFreeList = new Uint32Array(64);

    this.edgeAlive = new Uint8Array(INITIAL_EDGE_CAP);
    this.edgeHasCustomId = new Uint8Array(INITIAL_EDGE_CAP);
    this.edgeGen = new Uint32Array(INITIAL_EDGE_CAP);
    this.edgeVersion = new Uint32Array(INITIAL_EDGE_CAP);
    this.edgeSrcSlot = new Uint32Array(INITIAL_EDGE_CAP);
    this.edgeTgtSlot = new Uint32Array(INITIAL_EDGE_CAP);
    this.edgeTypeId = new Uint32Array(INITIAL_EDGE_CAP);
    this.edgeCreatedOn = new Float64Array(INITIAL_EDGE_CAP);
    this.edgeUpdatedOn = new Float64Array(INITIAL_EDGE_CAP);
    this.edgeIds = new Array<string>(INITIAL_EDGE_CAP);
    this.edgeEntities = new Array<Edge | undefined>(INITIAL_EDGE_CAP);
    this._edgeFreeList = new Uint32Array(128);
  }

  get nodeCapacity(): number {
    return this._nodeCap;
  }

  get liveNodeCount(): number {
    return this._liveNodeCount;
  }

  get liveEdgeCount(): number {
    return this._liveEdgeCount;
  }

  // ── Label Tuple Interning & Index Sets ────────────────────────────────────

  internLabels(labels: readonly string[]): {
    frozenLabels: readonly string[];
    labelIds: readonly number[];
    maskLo: number;
    maskHi: number;
  } {
    let cacheKey = `${labels.length}#`;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      cacheKey += `${l.length}:${l}|`;
    }
    let frozenLabels = this._labelTupleCache.get(cacheKey);
    if (!frozenLabels) {
      frozenLabels = Object.freeze([...labels]);
      this._labelTupleCache.set(cacheKey, frozenLabels);
    }

    const labelIds = new Array<number>(labels.length);
    for (let i = 0; i < labels.length; i++) {
      labelIds[i] = this.labelDict.intern(labels[i]);
    }
    const [maskLo, maskHi] = StringDictionary.computeMask64(labelIds);
    return { frozenLabels, labelIds, maskLo, maskHi };
  }

  getNodesByLabelId(labelId: number): Uint32SlotSet | undefined {
    return this._nodesByLabelId[labelId];
  }

  getEdgesByTypeId(typeId: number): Uint32SlotSet | undefined {
    return this._edgesByTypeId[typeId];
  }

  private _addNodeToLabelSet(labelId: number, slot: number): void {
    let set = this._nodesByLabelId[labelId];
    if (!set) {
      while (this._nodesByLabelId.length <= labelId) {
        this._nodesByLabelId.push(new Uint32SlotSet());
      }
      set = this._nodesByLabelId[labelId];
    }
    set.add(slot);
  }

  private _addEdgeToTypeSet(typeId: number, slot: number): void {
    let set = this._edgesByTypeId[typeId];
    if (!set) {
      while (this._edgesByTypeId.length <= typeId) {
        this._edgesByTypeId.push(new Uint32SlotSet());
      }
      set = this._edgesByTypeId[typeId];
    }
    set.add(slot);
  }

  // ── ID Generation & O(1) Resolution ───────────────────────────────────────

  generateNodeId(slot: number, gen: number): { id: string; isCustom: boolean } {
    if (this._idStrategy === 'uuid') {
      return { id: fastUUID(), isCustom: true };
    }
    let g = gen;
    let id = `@n${slot}:${g}`;
    if (this._customNodeIdToSlot.size > 0) {
      while (this._customNodeIdToSlot.has(id)) {
        g++;
        id = `@n${slot}:${g}`;
      }
      this.nodeGen[slot] = g;
    }
    return { id, isCustom: false };
  }

  generateEdgeId(slot: number, gen: number): { id: string; isCustom: boolean } {
    if (this._idStrategy === 'uuid') {
      return { id: fastUUID(), isCustom: true };
    }
    let g = gen;
    let id = `@e${slot}:${g}`;
    if (this._customEdgeIdToSlot.size > 0) {
      while (this._customEdgeIdToSlot.has(id)) {
        g++;
        id = `@e${slot}:${g}`;
      }
      this.edgeGen[slot] = g;
    }
    return { id, isCustom: false };
  }

  /**
   * Resolves a node string ID to its dense slot in O(1) without hash lookup for
   * `@n<slot>:<gen>` IDs, falling back to the custom ID map otherwise.
   * Returns `-1` if not found.
   */
  resolveNodeSlot(id: string): number {
    const len = id.length;
    if (len >= 5 && id.charCodeAt(0) === 64 && id.charCodeAt(1) === 110) {
      const decoded = decodeSlotGen(id, 2, len);
      if (decoded !== null) {
        const slot = decoded.slot;
        if (
          slot < this.nodeHighWater &&
          this.nodeAlive[slot] === 1 &&
          this.nodeHasCustomId[slot] === 0 &&
          this.nodeGen[slot] === decoded.gen
        ) {
          return slot;
        }
      }
    }
    if (this._customNodeIdToSlot.size > 0) {
      const slot = this._customNodeIdToSlot.get(id);
      if (slot !== undefined && this.nodeAlive[slot] === 1) {
        return slot;
      }
    }
    return -1;
  }

  /**
   * Resolves an edge string ID to its dense slot in O(1) without hash lookup for
   * `@e<slot>:<gen>` IDs, falling back to the custom ID map otherwise.
   * Returns `-1` if not found.
   */
  resolveEdgeSlot(id: string): number {
    const len = id.length;
    if (len >= 5 && id.charCodeAt(0) === 64 && id.charCodeAt(1) === 101) {
      const decoded = decodeSlotGen(id, 2, len);
      if (decoded !== null) {
        const slot = decoded.slot;
        if (
          slot < this.edgeHighWater &&
          this.edgeAlive[slot] === 1 &&
          this.edgeHasCustomId[slot] === 0 &&
          this.edgeGen[slot] === decoded.gen
        ) {
          return slot;
        }
      }
    }
    if (this._customEdgeIdToSlot.size > 0) {
      const slot = this._customEdgeIdToSlot.get(id);
      if (slot !== undefined && this.edgeAlive[slot] === 1) {
        return slot;
      }
    }
    return -1;
  }

  // ── Node Allocation / Mutation / Free ─────────────────────────────────────

  allocateNode(
    labels: readonly string[],
    properties: Readonly<Record<string, unknown>>,
    explicitId?: string,
    createdOn?: number,
    updatedOn?: number,
  ): number {
    let slot: number;
    if (this._nodeFreeLen > 0) {
      slot = this._nodeFreeList[--this._nodeFreeLen];
    } else {
      slot = this.nodeHighWater;
      if (slot >= this._nodeCap) {
        this._growNodes(this._nodeCap << 1);
      }
      this.nodeHighWater = slot + 1;
    }

    const gen = this.nodeGen[slot] === 0 ? 1 : this.nodeGen[slot];
    this.nodeGen[slot] = gen;
    this.nodeAlive[slot] = 1;
    this.nodeVersion[slot] = (this.nodeVersion[slot] + 1) >>> 0;

    let id: string;
    let isCustom: boolean;
    if (explicitId !== undefined) {
      id = explicitId;
      isCustom = true;
    } else {
      const generated = this.generateNodeId(slot, gen);
      id = generated.id;
      isCustom = generated.isCustom;
    }

    this.nodeIds[slot] = id;
    this.nodeHasCustomId[slot] = isCustom ? 1 : 0;
    if (isCustom) {
      this._customNodeIdToSlot.set(id, slot);
    }

    const now = createdOn ?? Date.now();
    this.nodeCreatedOn[slot] = now;
    this.nodeUpdatedOn[slot] = updatedOn ?? now;

    const { frozenLabels, labelIds, maskLo, maskHi } = this.internLabels(labels);
    this.nodeLabelIds[slot] = labelIds;
    this.nodeLabelStrings[slot] = frozenLabels;
    this.nodeLabelMaskLo[slot] = maskLo;
    this.nodeLabelMaskHi[slot] = maskHi;
    for (let i = 0; i < labelIds.length; i++) {
      this._addNodeToLabelSet(labelIds[i], slot);
    }

    this.nodeColumns.setRecord(slot, properties);
    this.nodeEntities[slot] = undefined;
    this._liveNodeCount++;
    return slot;
  }

  freeNode(slot: number, delayReuse = false): void {
    if (this.nodeAlive[slot] === 0) return;

    this.nodeEntities[slot]?._materializeIfNeeded();
    this.nodeEntities[slot] = undefined;

    if (this.nodeHasCustomId[slot] === 1) {
      this._customNodeIdToSlot.delete(this.nodeIds[slot]);
      this.nodeHasCustomId[slot] = 0;
    }

    const labelIds = this.nodeLabelIds[slot];
    for (let i = 0; i < labelIds.length; i++) {
      this._nodesByLabelId[labelIds[i]]?.delete(slot);
    }

    this.nodeColumns.clearSlot(slot);
    this.nodeAlive[slot] = 0;
    this.nodeGen[slot] = ((this.nodeGen[slot] + 1) >>> 0) || 1;
    this.nodeVersion[slot] = (this.nodeVersion[slot] + 1) >>> 0;
    this.nodeLabelMaskLo[slot] = 0;
    this.nodeLabelMaskHi[slot] = 0;

    if (delayReuse) {
      this._retiredCsrNodeSlots.push(slot);
    } else {
      this._pushNodeFreeSlot(slot);
    }
    this._liveNodeCount--;
  }

  private _pushNodeFreeSlot(slot: number): void {
    if (this._nodeFreeLen >= this._nodeFreeList.length) {
      const next = new Uint32Array(this._nodeFreeList.length << 1);
      next.set(this._nodeFreeList);
      this._nodeFreeList = next;
    }
    this._nodeFreeList[this._nodeFreeLen++] = slot;
  }

  setNodeLabelsBySlot(slot: number, labels: readonly string[]): void {
    this.invalidateNodeEntity(slot);
    const oldIds = this.nodeLabelIds[slot];
    for (let i = 0; i < oldIds.length; i++) {
      this._nodesByLabelId[oldIds[i]]?.delete(slot);
    }

    const { frozenLabels, labelIds, maskLo, maskHi } = this.internLabels(labels);
    this.nodeLabelIds[slot] = labelIds;
    this.nodeLabelStrings[slot] = frozenLabels;
    this.nodeLabelMaskLo[slot] = maskLo;
    this.nodeLabelMaskHi[slot] = maskHi;
    for (let i = 0; i < labelIds.length; i++) {
      this._addNodeToLabelSet(labelIds[i], slot);
    }
    this.nodeUpdatedOn[slot] = Date.now();
    this.nodeVersion[slot] = (this.nodeVersion[slot] + 1) >>> 0;
  }

  detachNodeIncidentEdges(slot: number, adjacency: AdjacencyStore): void {
    const nodeId = this.nodeIds[slot];
    const seenEdges = new Set<number>();

    const csrOutEntries = adjacency.getCsrOutEntries();
    for (
      let i = adjacency.getCsrOutStart(slot), end = adjacency.getCsrOutEnd(slot);
      i < end;
      i += 3
    ) {
      const eSlot = csrOutEntries[i];
      if (
        this.edgeAlive[eSlot] === 1 &&
        this.edgeSrcSlot[eSlot] === slot &&
        this.edgeTgtSlot[eSlot] === csrOutEntries[i + 1]
      ) {
        seenEdges.add(eSlot);
      }
    }
    const dOut = adjacency.getDeltaOutBuf(slot);
    const dOutLen = adjacency.getDeltaOutWordLen(slot);
    if (dOut) {
      for (let i = 0; i < dOutLen; i += 3) {
        const eSlot = dOut[i];
        if (this.edgeAlive[eSlot] === 1) seenEdges.add(eSlot);
      }
    }

    const csrInEntries = adjacency.getCsrInEntries();
    for (
      let i = adjacency.getCsrInStart(slot), end = adjacency.getCsrInEnd(slot);
      i < end;
      i += 3
    ) {
      const eSlot = csrInEntries[i];
      if (
        this.edgeAlive[eSlot] === 1 &&
        this.edgeTgtSlot[eSlot] === slot &&
        this.edgeSrcSlot[eSlot] === csrInEntries[i + 1]
      ) {
        seenEdges.add(eSlot);
      }
    }
    const dIn = adjacency.getDeltaInBuf(slot);
    const dInLen = adjacency.getDeltaInWordLen(slot);
    if (dIn) {
      for (let i = 0; i < dInLen; i += 3) {
        const eSlot = dIn[i];
        if (this.edgeAlive[eSlot] === 1) seenEdges.add(eSlot);
      }
    }

    if (this.hasDanglingEdges) {
      const dout = this.danglingOutEdges.get(nodeId);
      if (dout) {
        for (const eSlot of dout) {
          if (this.edgeAlive[eSlot] === 1) seenEdges.add(eSlot);
        }
      }
      const din = this.danglingInEdges.get(nodeId);
      if (din) {
        for (const eSlot of din) {
          if (this.edgeAlive[eSlot] === 1) seenEdges.add(eSlot);
        }
      }
    }

    if (seenEdges.size === 0) return;

    for (const eSlot of seenEdges) {
      const sourceId = this.getEdgeSourceId(eSlot);
      const targetId = this.getEdgeTargetId(eSlot);
      const oldSrc = this.edgeSrcSlot[eSlot];
      const oldTgt = this.edgeTgtSlot[eSlot];

      adjacency.removeEdge(eSlot, oldSrc, oldTgt);
      this.invalidateEdgeEntity(eSlot);

      if (oldSrc === slot) this.edgeSrcSlot[eSlot] = NONE_SLOT;
      if (oldTgt === slot) this.edgeTgtSlot[eSlot] = NONE_SLOT;
      this.edgeVersion[eSlot] = (this.edgeVersion[eSlot] + 1) >>> 0;

      this._danglingEdgeEndpoints.set(eSlot, { sourceId, targetId });
      let outSet = this.danglingOutEdges.get(sourceId);
      if (!outSet) {
        outSet = new Set<number>();
        this.danglingOutEdges.set(sourceId, outSet);
      }
      outSet.add(eSlot);
      let inSet = this.danglingInEdges.get(targetId);
      if (!inSet) {
        inSet = new Set<number>();
        this.danglingInEdges.set(targetId, inSet);
      }
      inSet.add(eSlot);
    }
  }

  bindDanglingEdgesForNode(
    nodeId: string,
    nodeSlot: number,
    adjacency: AdjacencyStore,
  ): void {
    if (!this.hasDanglingEdges) return;

    const touched = new Set<number>();
    const outSet = this.danglingOutEdges.get(nodeId);
    if (outSet) {
      for (const eSlot of outSet) {
        if (this.edgeAlive[eSlot] === 1 && this.edgeSrcSlot[eSlot] === NONE_SLOT) {
          this.edgeSrcSlot[eSlot] = nodeSlot;
          this.invalidateEdgeEntity(eSlot);
          this.edgeVersion[eSlot] = (this.edgeVersion[eSlot] + 1) >>> 0;
          touched.add(eSlot);
        }
      }
    }

    const inSet = this.danglingInEdges.get(nodeId);
    if (inSet) {
      for (const eSlot of inSet) {
        if (this.edgeAlive[eSlot] === 1 && this.edgeTgtSlot[eSlot] === NONE_SLOT) {
          this.edgeTgtSlot[eSlot] = nodeSlot;
          this.invalidateEdgeEntity(eSlot);
          this.edgeVersion[eSlot] = (this.edgeVersion[eSlot] + 1) >>> 0;
          touched.add(eSlot);
        }
      }
    }

    for (const eSlot of touched) {
      const src = this.edgeSrcSlot[eSlot];
      const tgt = this.edgeTgtSlot[eSlot];
      if (src === NONE_SLOT || tgt === NONE_SLOT) continue;

      const endpoints = this._danglingEdgeEndpoints.get(eSlot);
      if (endpoints) {
        const dOut = this.danglingOutEdges.get(endpoints.sourceId);
        if (dOut) {
          dOut.delete(eSlot);
          if (dOut.size === 0) this.danglingOutEdges.delete(endpoints.sourceId);
        }
        const dIn = this.danglingInEdges.get(endpoints.targetId);
        if (dIn) {
          dIn.delete(eSlot);
          if (dIn.size === 0) this.danglingInEdges.delete(endpoints.targetId);
        }
        this._danglingEdgeEndpoints.delete(eSlot);
      }

      adjacency.addEdge(eSlot, src, tgt, this.edgeTypeId[eSlot]);
    }
  }

  removeNodeLabelsBySlot(slot: number, labelsToRemove: readonly string[]): string[] {
    const current = this.nodeLabelStrings[slot];
    const remaining: string[] = [];
    const removed: string[] = [];

    for (let i = 0; i < current.length; i++) {
      const lbl = current[i];
      if (labelsToRemove.includes(lbl)) {
        removed.push(lbl);
      } else {
        remaining.push(lbl);
      }
    }

    if (removed.length === 0) return removed;

    this.invalidateNodeEntity(slot);
    for (let i = 0; i < removed.length; i++) {
      const lid = this.labelDict.lookup(removed[i]);
      if (lid >= 0) this._nodesByLabelId[lid]?.delete(slot);
    }

    const { frozenLabels, labelIds, maskLo, maskHi } = this.internLabels(remaining);
    this.nodeLabelIds[slot] = labelIds;
    this.nodeLabelStrings[slot] = frozenLabels;
    this.nodeLabelMaskLo[slot] = maskLo;
    this.nodeLabelMaskHi[slot] = maskHi;
    this.nodeUpdatedOn[slot] = Date.now();
    this.nodeVersion[slot] = (this.nodeVersion[slot] + 1) >>> 0;
    return removed;
  }

  addNodeLabelsBySlot(slot: number, labelsToAdd: readonly string[]): string[] {
    const current = this.nodeLabelStrings[slot];
    const added: string[] = [];

    for (let i = 0; i < labelsToAdd.length; i++) {
      const lbl = labelsToAdd[i];
      if (!current.includes(lbl) && !added.includes(lbl)) {
        added.push(lbl);
      }
    }

    if (added.length === 0) return added;

    this.invalidateNodeEntity(slot);
    const merged = [...current, ...added];
    const { frozenLabels, labelIds, maskLo, maskHi } = this.internLabels(merged);
    this.nodeLabelIds[slot] = labelIds;
    this.nodeLabelStrings[slot] = frozenLabels;
    this.nodeLabelMaskLo[slot] = maskLo;
    this.nodeLabelMaskHi[slot] = maskHi;
    for (let i = 0; i < added.length; i++) {
      const lid = this.labelDict.lookup(added[i]);
      if (lid >= 0) this._addNodeToLabelSet(lid, slot);
    }
    this.nodeUpdatedOn[slot] = Date.now();
    this.nodeVersion[slot] = (this.nodeVersion[slot] + 1) >>> 0;
    return added;
  }

  invalidateNodeEntity(slot: number): void {
    const ent = this.nodeEntities[slot];
    if (ent) {
      ent._materializeIfNeeded();
      this.nodeEntities[slot] = undefined;
    }
  }

  getNodeEntity(slot: number): Node {
    let ent = this.nodeEntities[slot];
    if (!ent) {
      ent = Node._fromKernel(
        this.nodeIds[slot],
        this.nodeLabelStrings[slot],
        () => this.nodeColumns.materializeRecord(slot),
        this.nodeCreatedOn[slot],
        this.nodeUpdatedOn[slot],
        slot,
      );
      this.nodeEntities[slot] = ent;
    }
    return ent;
  }

  // ── Edge Allocation / Mutation / Free ─────────────────────────────────────

  allocateEdge(
    srcSlot: number,
    tgtSlot: number,
    type: string,
    properties: Readonly<Record<string, unknown>>,
    explicitId?: string,
    createdOn?: number,
    updatedOn?: number,
    rawSourceId?: string,
    rawTargetId?: string,
  ): { slot: number; typeId: number } {
    let slot: number;
    if (this._edgeFreeLen > 0) {
      slot = this._edgeFreeList[--this._edgeFreeLen];
    } else {
      slot = this.edgeHighWater;
      if (slot >= this._edgeCap) {
        this._growEdges(this._edgeCap << 1);
      }
      this.edgeHighWater = slot + 1;
    }

    const gen = this.edgeGen[slot] === 0 ? 1 : this.edgeGen[slot];
    this.edgeGen[slot] = gen;
    this.edgeAlive[slot] = 1;
    this.edgeVersion[slot] = (this.edgeVersion[slot] + 1) >>> 0;

    let id: string;
    let isCustom: boolean;
    if (explicitId !== undefined) {
      id = explicitId;
      isCustom = true;
    } else {
      const generated = this.generateEdgeId(slot, gen);
      id = generated.id;
      isCustom = generated.isCustom;
    }

    this.edgeIds[slot] = id;
    this.edgeHasCustomId[slot] = isCustom ? 1 : 0;
    if (isCustom) {
      this._customEdgeIdToSlot.set(id, slot);
    }

    const typeId = this.edgeTypeDict.intern(type);
    this.edgeSrcSlot[slot] = srcSlot;
    this.edgeTgtSlot[slot] = tgtSlot;
    this.edgeTypeId[slot] = typeId;
    this._addEdgeToTypeSet(typeId, slot);

    if (srcSlot === NONE_SLOT || tgtSlot === NONE_SLOT) {
      const sourceId = rawSourceId ?? (srcSlot !== NONE_SLOT ? this.nodeIds[srcSlot] : '');
      const targetId = rawTargetId ?? (tgtSlot !== NONE_SLOT ? this.nodeIds[tgtSlot] : '');
      this._danglingEdgeEndpoints.set(slot, { sourceId, targetId });
      let outSet = this.danglingOutEdges.get(sourceId);
      if (!outSet) {
        outSet = new Set<number>();
        this.danglingOutEdges.set(sourceId, outSet);
      }
      outSet.add(slot);
      let inSet = this.danglingInEdges.get(targetId);
      if (!inSet) {
        inSet = new Set<number>();
        this.danglingInEdges.set(targetId, inSet);
      }
      inSet.add(slot);
    }

    const now = createdOn ?? Date.now();
    this.edgeCreatedOn[slot] = now;
    this.edgeUpdatedOn[slot] = updatedOn ?? now;

    this.edgeColumns.setRecord(slot, properties);
    this.edgeEntities[slot] = undefined;
    this._liveEdgeCount++;
    return { slot, typeId };
  }

  get hasDanglingEdges(): boolean {
    return this._danglingEdgeEndpoints.size > 0;
  }

  getEdgeSourceId(slot: number): string {
    const srcSlot = this.edgeSrcSlot[slot];
    if (srcSlot === NONE_SLOT) {
      return this._danglingEdgeEndpoints.get(slot)?.sourceId ?? '';
    }
    return this.nodeIds[srcSlot];
  }

  getEdgeTargetId(slot: number): string {
    const tgtSlot = this.edgeTgtSlot[slot];
    if (tgtSlot === NONE_SLOT) {
      return this._danglingEdgeEndpoints.get(slot)?.targetId ?? '';
    }
    return this.nodeIds[tgtSlot];
  }

  freeEdge(slot: number, delayReuse = false): void {
    if (this.edgeAlive[slot] === 0) return;

    this.edgeEntities[slot]?._materializeIfNeeded();
    this.edgeEntities[slot] = undefined;

    if (this.edgeHasCustomId[slot] === 1) {
      this._customEdgeIdToSlot.delete(this.edgeIds[slot]);
      this.edgeHasCustomId[slot] = 0;
    }

    const dangling = this._danglingEdgeEndpoints.get(slot);
    if (dangling) {
      const outSet = this.danglingOutEdges.get(dangling.sourceId);
      if (outSet) {
        outSet.delete(slot);
        if (outSet.size === 0) this.danglingOutEdges.delete(dangling.sourceId);
      }
      const inSet = this.danglingInEdges.get(dangling.targetId);
      if (inSet) {
        inSet.delete(slot);
        if (inSet.size === 0) this.danglingInEdges.delete(dangling.targetId);
      }
      this._danglingEdgeEndpoints.delete(slot);
    }

    const typeId = this.edgeTypeId[slot];
    this._edgesByTypeId[typeId]?.delete(slot);

    this.edgeColumns.clearSlot(slot);
    this.edgeAlive[slot] = 0;
    this.edgeGen[slot] = ((this.edgeGen[slot] + 1) >>> 0) || 1;
    this.edgeVersion[slot] = (this.edgeVersion[slot] + 1) >>> 0;

    if (delayReuse) {
      this._retiredCsrEdgeSlots.push(slot);
    } else {
      this._pushEdgeFreeSlot(slot);
    }
    this._liveEdgeCount--;
  }

  reclaimRetiredSlots(): void {
    for (let i = 0; i < this._retiredCsrNodeSlots.length; i++) {
      this._pushNodeFreeSlot(this._retiredCsrNodeSlots[i]);
    }
    this._retiredCsrNodeSlots.length = 0;

    for (let i = 0; i < this._retiredCsrEdgeSlots.length; i++) {
      this._pushEdgeFreeSlot(this._retiredCsrEdgeSlots[i]);
    }
    this._retiredCsrEdgeSlots.length = 0;
  }

  private _pushEdgeFreeSlot(slot: number): void {
    if (this._edgeFreeLen >= this._edgeFreeList.length) {
      const next = new Uint32Array(this._edgeFreeList.length << 1);
      next.set(this._edgeFreeList);
      this._edgeFreeList = next;
    }
    this._edgeFreeList[this._edgeFreeLen++] = slot;
  }

  invalidateEdgeEntity(slot: number): void {
    const ent = this.edgeEntities[slot];
    if (ent) {
      ent._materializeIfNeeded();
      this.edgeEntities[slot] = undefined;
    }
  }

  getEdgeEntity(slot: number): Edge {
    let ent = this.edgeEntities[slot];
    if (!ent) {
      ent = Edge._fromKernel(
        this.edgeIds[slot],
        this.getEdgeSourceId(slot),
        this.getEdgeTargetId(slot),
        this.edgeTypeDict.getString(this.edgeTypeId[slot]),
        () => this.edgeColumns.materializeRecord(slot),
        this.edgeCreatedOn[slot],
        this.edgeUpdatedOn[slot],
        slot,
      );
      this.edgeEntities[slot] = ent;
    }
    return ent;
  }

  matchesNodeLabelMask(slot: number, query: Bitmask64Query): boolean {
    return StringDictionary.matchesQuery(
      this.nodeLabelMaskLo[slot],
      this.nodeLabelMaskHi[slot],
      query,
      query.overflowIds ? this.nodeLabelIds[slot] : undefined,
    );
  }

  // ── Clear & Growth ────────────────────────────────────────────────────────

  clear(): void {
    this.nodeHighWater = 0;
    this._liveNodeCount = 0;
    this._nodeFreeLen = 0;
    this._retiredCsrNodeSlots.length = 0;
    this.nodeAlive.fill(0);
    this.nodeHasCustomId.fill(0);
    this.nodeGen.fill(0);
    this.nodeVersion.fill(0);
    this.nodeLabelMaskLo.fill(0);
    this.nodeLabelMaskHi.fill(0);
    this.nodeEntities.fill(undefined);
    this._customNodeIdToSlot.clear();
    this._nodesByLabelId.length = 0;
    this._labelTupleCache.clear();
    this.nodeColumns.clearAll();

    this.edgeHighWater = 0;
    this._liveEdgeCount = 0;
    this._edgeFreeLen = 0;
    this._retiredCsrEdgeSlots.length = 0;
    this.edgeAlive.fill(0);
    this.edgeHasCustomId.fill(0);
    this.edgeGen.fill(0);
    this.edgeVersion.fill(0);
    this.edgeEntities.fill(undefined);
    this._customEdgeIdToSlot.clear();
    this._edgesByTypeId.length = 0;
    this._danglingEdgeEndpoints.clear();
    this.danglingOutEdges.clear();
    this.danglingInEdges.clear();
    this.edgeColumns.clearAll();

    this.labelDict.clear();
    this.edgeTypeDict.clear();
    this.nodePropDict.clear();
    this.edgePropDict.clear();
  }

  ensureNodeCapacity(required: number): void {
    if (required <= this._nodeCap) return;
    let next = this._nodeCap;
    while (next < required) next <<= 1;
    this._growNodes(next);
  }

  ensureEdgeCapacity(required: number): void {
    if (required <= this._edgeCap) return;
    let next = this._edgeCap;
    while (next < required) next <<= 1;
    this._growEdges(next);
  }

  private _growNodes(newCap: number): void {
    this.nodeAlive = growU8(this.nodeAlive, newCap);
    this.nodeHasCustomId = growU8(this.nodeHasCustomId, newCap);
    this.nodeGen = growU32(this.nodeGen, newCap);
    this.nodeVersion = growU32(this.nodeVersion, newCap);
    this.nodeLabelMaskLo = growU32(this.nodeLabelMaskLo, newCap);
    this.nodeLabelMaskHi = growU32(this.nodeLabelMaskHi, newCap);
    this.nodeCreatedOn = growF64(this.nodeCreatedOn, newCap);
    this.nodeUpdatedOn = growF64(this.nodeUpdatedOn, newCap);
    this.nodeIds.length = newCap;
    this.nodeLabelIds.length = newCap;
    this.nodeLabelStrings.length = newCap;
    this.nodeEntities.length = newCap;
    this.nodeColumns.grow(newCap);
    this._nodeCap = newCap;
    this.onNodeCapacityGrow?.(newCap);
  }

  private _growEdges(newCap: number): void {
    this.edgeAlive = growU8(this.edgeAlive, newCap);
    this.edgeHasCustomId = growU8(this.edgeHasCustomId, newCap);
    this.edgeGen = growU32(this.edgeGen, newCap);
    this.edgeVersion = growU32(this.edgeVersion, newCap);
    this.edgeSrcSlot = growU32(this.edgeSrcSlot, newCap);
    this.edgeTgtSlot = growU32(this.edgeTgtSlot, newCap);
    this.edgeTypeId = growU32(this.edgeTypeId, newCap);
    this.edgeCreatedOn = growF64(this.edgeCreatedOn, newCap);
    this.edgeUpdatedOn = growF64(this.edgeUpdatedOn, newCap);
    this.edgeIds.length = newCap;
    this.edgeEntities.length = newCap;
    this.edgeColumns.grow(newCap);
    this._edgeCap = newCap;
  }
}

function growU8(src: Uint8Array, newCap: number): Uint8Array {
  const dst = new Uint8Array(newCap);
  dst.set(src);
  return dst;
}

function growU32(src: Uint32Array, newCap: number): Uint32Array {
  const dst = new Uint32Array(newCap);
  dst.set(src);
  return dst;
}

function growF64(src: Float64Array, newCap: number): Float64Array {
  const dst = new Float64Array(newCap);
  dst.set(src);
  return dst;
}

function decodeSlotGen(
  id: string,
  start: number,
  len: number,
): { slot: number; gen: number } | null {
  let slot = 0;
  let i = start;
  let slotLen = 0;
  const firstSlotCh = id.charCodeAt(i);
  while (i < len) {
    const ch = id.charCodeAt(i);
    if (ch === 58) break; // ':'
    if (ch < 48 || ch > 57) return null;
    if (slotLen === 1 && firstSlotCh === 48) return null; // reject leading '0' when multi-digit
    slot = slot * 10 + (ch - 48);
    if (slot >= NONE_SLOT) return null;
    slotLen++;
    i++;
  }
  if (slotLen === 0 || i >= len - 1) return null;
  i++; // skip ':'
  const firstGenCh = id.charCodeAt(i);
  if (firstGenCh < 49 || firstGenCh > 57) return null; // gen >= 1, no leading '0'
  let gen = firstGenCh - 48;
  i++;
  while (i < len) {
    const ch = id.charCodeAt(i);
    if (ch < 48 || ch > 57) return null;
    gen = gen * 10 + (ch - 48);
    if (gen > 0xffffffff) return null;
    i++;
  }
  return { slot, gen };
}
