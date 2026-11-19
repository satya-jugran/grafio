/**
 * Hybrid Global CSR (Compressed Sparse Row) + Per-Node Delta Adjacency Store.
 *
 * Packs static outgoing and incoming topology into two flat stride-3 `Uint32Array`
 * buffers (`[edgeSlot, neighborSlot, edgeTypeId]`) for sequential CPU-cache-friendly
 * traversals, while supporting O(1) incremental appends/deletions via sparse delta lists.
 *
 * @module storage/engine/AdjacencyStore
 */

const EMPTY_U32 = new Uint32Array(0);
const INITIAL_DELTA_WORDS = 12; // 4 stride-3 entries
const NONE_SLOT = 0xffffffff;

export class AdjacencyStore {
  private _nodeCap: number;

  // Exact live degrees per node slot
  private _outDegrees: Uint32Array;
  private _inDegrees: Uint32Array;

  // Static CSR tier (covers slots 0 .. _csrNodeBound - 1, edges 0 .. _csrEdgeSlotBound - 1)
  private _csrNodeBound = 0;
  private _csrEdgeSlotBound = 0;
  private _csrOutOffsets: Uint32Array = EMPTY_U32;
  private _csrOutEntries: Uint32Array = EMPTY_U32;
  private _csrInOffsets: Uint32Array = EMPTY_U32;
  private _csrInEntries: Uint32Array = EMPTY_U32;
  private _csrEdgeCount = 0;
  private _deadCsrEdges = 0;

  // Dynamic delta tier for post-CSR mutations
  private _deltaOutBufs: (Uint32Array | undefined)[];
  private _deltaOutWords: Uint32Array;
  private _deltaInBufs: (Uint32Array | undefined)[];
  private _deltaInWords: Uint32Array;
  private _deltaEdgeCount = 0;

  constructor(initialNodeCap = 256) {
    this._nodeCap = initialNodeCap;
    this._outDegrees = new Uint32Array(initialNodeCap);
    this._inDegrees = new Uint32Array(initialNodeCap);
    this._deltaOutBufs = new Array<Uint32Array | undefined>(initialNodeCap);
    this._deltaOutWords = new Uint32Array(initialNodeCap);
    this._deltaInBufs = new Array<Uint32Array | undefined>(initialNodeCap);
    this._deltaInWords = new Uint32Array(initialNodeCap);
  }

  get csrEdgeCount(): number {
    return this._csrEdgeCount;
  }

  get deltaEdgeCount(): number {
    return this._deltaEdgeCount;
  }

  get deadCsrEdges(): number {
    return this._deadCsrEdges;
  }

  get csrEdgeSlotBound(): number {
    return this._csrEdgeSlotBound;
  }

  growNodes(newCapacity: number): void {
    if (newCapacity <= this._nodeCap) return;
    const nextOutDeg = new Uint32Array(newCapacity);
    nextOutDeg.set(this._outDegrees);
    this._outDegrees = nextOutDeg;

    const nextInDeg = new Uint32Array(newCapacity);
    nextInDeg.set(this._inDegrees);
    this._inDegrees = nextInDeg;

    this._deltaOutBufs.length = newCapacity;
    const nextOutWords = new Uint32Array(newCapacity);
    nextOutWords.set(this._deltaOutWords);
    this._deltaOutWords = nextOutWords;

    this._deltaInBufs.length = newCapacity;
    const nextInWords = new Uint32Array(newCapacity);
    nextInWords.set(this._deltaInWords);
    this._deltaInWords = nextInWords;

    this._nodeCap = newCapacity;
  }

  outDegree(nodeSlot: number): number {
    return this._outDegrees[nodeSlot];
  }

  inDegree(nodeSlot: number): number {
    return this._inDegrees[nodeSlot];
  }

  addEdge(edgeSlot: number, srcSlot: number, tgtSlot: number, typeId: number): void {
    if (srcSlot === NONE_SLOT || tgtSlot === NONE_SLOT) return;
    this._appendDeltaOut(srcSlot, edgeSlot, tgtSlot, typeId);
    this._appendDeltaIn(tgtSlot, edgeSlot, srcSlot, typeId);
    this._outDegrees[srcSlot]++;
    this._inDegrees[tgtSlot]++;
    this._deltaEdgeCount++;
  }

  removeEdge(edgeSlot: number, srcSlot: number, tgtSlot: number): boolean {
    if (srcSlot === NONE_SLOT || tgtSlot === NONE_SLOT) return true;
    if (this._outDegrees[srcSlot] > 0) this._outDegrees[srcSlot]--;
    if (this._inDegrees[tgtSlot] > 0) this._inDegrees[tgtSlot]--;

    const removedOut = this._removeDeltaEntry(
      this._deltaOutBufs,
      this._deltaOutWords,
      srcSlot,
      edgeSlot,
    );
    const removedIn = this._removeDeltaEntry(
      this._deltaInBufs,
      this._deltaInWords,
      tgtSlot,
      edgeSlot,
    );

    if (removedOut || removedIn) {
      if (this._deltaEdgeCount > 0) this._deltaEdgeCount--;
      return true;
    }
    // Edge belonged to static CSR (masked out via arena.edgeAlive[edgeSlot] === 0)
    this._deadCsrEdges++;
    return false;
  }

  hasCsrEntries(nodeSlot: number): boolean {
    if (nodeSlot >= this._csrNodeBound) return false;
    return (
      this._csrOutOffsets[nodeSlot] < this._csrOutOffsets[nodeSlot + 1] ||
      this._csrInOffsets[nodeSlot] < this._csrInOffsets[nodeSlot + 1]
    );
  }

  clearNodeDelta(nodeSlot: number): void {
    this._deltaOutBufs[nodeSlot] = undefined;
    this._deltaOutWords[nodeSlot] = 0;
    this._deltaInBufs[nodeSlot] = undefined;
    this._deltaInWords[nodeSlot] = 0;
    this._outDegrees[nodeSlot] = 0;
    this._inDegrees[nodeSlot] = 0;
  }

  // ── Direct Raw Slice Accessors for Tight Kernel Loops ─────────────────────

  getCsrOutEntries(): Uint32Array {
    return this._csrOutEntries;
  }

  getCsrOutStart(nodeSlot: number): number {
    return nodeSlot < this._csrNodeBound ? this._csrOutOffsets[nodeSlot] : 0;
  }

  getCsrOutEnd(nodeSlot: number): number {
    return nodeSlot < this._csrNodeBound ? this._csrOutOffsets[nodeSlot + 1] : 0;
  }

  getDeltaOutBuf(nodeSlot: number): Uint32Array | undefined {
    return this._deltaOutBufs[nodeSlot];
  }

  getDeltaOutWordLen(nodeSlot: number): number {
    return this._deltaOutWords[nodeSlot];
  }

  getCsrInEntries(): Uint32Array {
    return this._csrInEntries;
  }

  getCsrInStart(nodeSlot: number): number {
    return nodeSlot < this._csrNodeBound ? this._csrInOffsets[nodeSlot] : 0;
  }

  getCsrInEnd(nodeSlot: number): number {
    return nodeSlot < this._csrNodeBound ? this._csrInOffsets[nodeSlot + 1] : 0;
  }

  getDeltaInBuf(nodeSlot: number): Uint32Array | undefined {
    return this._deltaInBufs[nodeSlot];
  }

  getDeltaInWordLen(nodeSlot: number): number {
    return this._deltaInWords[nodeSlot];
  }

  // ── Compaction / Linear Counting-Sort CSR Builder ─────────────────────────

  /**
   * Rebuilds the Global CSR buffers in linear `O(V + E)` time, folding all delta
   * buffers and purging dead CSR tombstones.
   */
  buildCSR(
    nodeHighWater: number,
    edgeHighWater: number,
    edgeAlive: Uint8Array,
    edgeSrcSlot: Uint32Array,
    edgeTgtSlot: Uint32Array,
    edgeTypeId: Uint32Array,
  ): void {
    this._deltaOutBufs.fill(undefined);
    this._deltaOutWords.fill(0);
    this._deltaInBufs.fill(undefined);
    this._deltaInWords.fill(0);
    this._deltaEdgeCount = 0;
    this._deadCsrEdges = 0;

    if (nodeHighWater === 0) {
      this._csrNodeBound = 0;
      this._csrEdgeSlotBound = 0;
      this._csrOutOffsets = EMPTY_U32;
      this._csrOutEntries = EMPTY_U32;
      this._csrInOffsets = EMPTY_U32;
      this._csrInEntries = EMPTY_U32;
      this._csrEdgeCount = 0;
      return;
    }

    const outOffsets = new Uint32Array(nodeHighWater + 1);
    const inOffsets = new Uint32Array(nodeHighWater + 1);

    // Zero degrees then recount live edges cleanly
    this._outDegrees.fill(0, 0, nodeHighWater);
    this._inDegrees.fill(0, 0, nodeHighWater);

    let liveTotal = 0;
    for (let e = 0; e < edgeHighWater; e++) {
      if (edgeAlive[e] === 0) continue;
      const src = edgeSrcSlot[e];
      const tgt = edgeTgtSlot[e];
      if (src === NONE_SLOT || tgt === NONE_SLOT) continue;
      outOffsets[src + 1] += 3;
      inOffsets[tgt + 1] += 3;
      this._outDegrees[src]++;
      this._inDegrees[tgt]++;
      liveTotal++;
    }

    // Prefix sums
    for (let v = 1; v <= nodeHighWater; v++) {
      outOffsets[v] += outOffsets[v - 1];
      inOffsets[v] += inOffsets[v - 1];
    }

    const outEntries = new Uint32Array(liveTotal * 3);
    const inEntries = new Uint32Array(liveTotal * 3);
    const outCursor = new Uint32Array(outOffsets);
    const inCursor = new Uint32Array(inOffsets);

    for (let e = 0; e < edgeHighWater; e++) {
      if (edgeAlive[e] === 0) continue;
      const src = edgeSrcSlot[e];
      const tgt = edgeTgtSlot[e];
      if (src === NONE_SLOT || tgt === NONE_SLOT) continue;
      const typeId = edgeTypeId[e];

      const op = outCursor[src];
      outEntries[op] = e;
      outEntries[op + 1] = tgt;
      outEntries[op + 2] = typeId;
      outCursor[src] = op + 3;

      const ip = inCursor[tgt];
      inEntries[ip] = e;
      inEntries[ip + 1] = src;
      inEntries[ip + 2] = typeId;
      inCursor[tgt] = ip + 3;
    }

    this._csrNodeBound = nodeHighWater;
    this._csrEdgeSlotBound = liveTotal > 0 ? edgeHighWater : 0;
    this._csrOutOffsets = outOffsets;
    this._csrOutEntries = outEntries;
    this._csrInOffsets = inOffsets;
    this._csrInEntries = inEntries;
    this._csrEdgeCount = liveTotal;
  }

  clear(): void {
    this._outDegrees.fill(0);
    this._inDegrees.fill(0);
    this._csrNodeBound = 0;
    this._csrEdgeSlotBound = 0;
    this._csrOutOffsets = EMPTY_U32;
    this._csrOutEntries = EMPTY_U32;
    this._csrInOffsets = EMPTY_U32;
    this._csrInEntries = EMPTY_U32;
    this._csrEdgeCount = 0;
    this._deadCsrEdges = 0;
    this._deltaOutBufs.fill(undefined);
    this._deltaOutWords.fill(0);
    this._deltaInBufs.fill(undefined);
    this._deltaInWords.fill(0);
    this._deltaEdgeCount = 0;
  }

  private _appendDeltaOut(nodeSlot: number, edgeSlot: number, neighborSlot: number, typeId: number): void {
    let buf = this._deltaOutBufs[nodeSlot];
    const used = this._deltaOutWords[nodeSlot];
    if (!buf) {
      buf = new Uint32Array(INITIAL_DELTA_WORDS);
      this._deltaOutBufs[nodeSlot] = buf;
    } else if (used + 3 > buf.length) {
      const next = new Uint32Array(buf.length << 1);
      next.set(buf);
      buf = next;
      this._deltaOutBufs[nodeSlot] = buf;
    }
    buf[used] = edgeSlot;
    buf[used + 1] = neighborSlot;
    buf[used + 2] = typeId;
    this._deltaOutWords[nodeSlot] = used + 3;
  }

  private _appendDeltaIn(nodeSlot: number, edgeSlot: number, neighborSlot: number, typeId: number): void {
    let buf = this._deltaInBufs[nodeSlot];
    const used = this._deltaInWords[nodeSlot];
    if (!buf) {
      buf = new Uint32Array(INITIAL_DELTA_WORDS);
      this._deltaInBufs[nodeSlot] = buf;
    } else if (used + 3 > buf.length) {
      const next = new Uint32Array(buf.length << 1);
      next.set(buf);
      buf = next;
      this._deltaInBufs[nodeSlot] = buf;
    }
    buf[used] = edgeSlot;
    buf[used + 1] = neighborSlot;
    buf[used + 2] = typeId;
    this._deltaInWords[nodeSlot] = used + 3;
  }

  private _removeDeltaEntry(
    bufs: (Uint32Array | undefined)[],
    wordLens: Uint32Array,
    nodeSlot: number,
    edgeSlot: number,
  ): boolean {
    const buf = bufs[nodeSlot];
    const len = wordLens[nodeSlot];
    if (!buf || len === 0) return false;

    for (let i = len - 3; i >= 0; i -= 3) {
      if (buf[i] === edgeSlot) {
        const last = len - 3;
        if (i !== last) {
          buf[i] = buf[last];
          buf[i + 1] = buf[last + 1];
          buf[i + 2] = buf[last + 2];
        }
        wordLens[nodeSlot] = last;
        return true;
      }
    }
    return false;
  }
}
