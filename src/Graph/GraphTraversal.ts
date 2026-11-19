import { isSyncGraphKernel, type IStorageProvider, type ISyncGraphKernel } from '../storage/IStorageProvider';
import type { TraversalOptions } from './TraversalOptions';
import { TraversalLimitExceededError } from '../errors';
import { Uint32RingQueue } from '../cypher/executor/RingQueue';
import type { Bitmask64Query } from '../storage/engine/StringDictionary';

/**
 * Internal class that handles graph traversal operations.
 * Uses the synchronous CSR + Delta kernel fast path when backed by
 * `InMemoryStorageProvider`, falling back to async `IStorageProvider` calls
 * for remote backends.
 */
export class GraphTraversal {
  private readonly _kernel: ISyncGraphKernel | null;

  constructor(private readonly _store: IStorageProvider) {
    this._kernel = isSyncGraphKernel(_store) ? _store : null;
  }

  private async _getTraversableChildren(
    nodeId: string,
    nodeTypes: string[] = ['*'],
    edgeTypes: string[] = ['*'],
  ): Promise<string[]> {
    const edgeTypeFilter =
      edgeTypes.length > 0 && !edgeTypes.includes('*') ? edgeTypes : undefined;
    const outEdges = await this._store.getEdgesBySource(
      nodeId,
      edgeTypeFilter ? { filter: { types: edgeTypeFilter } } : undefined,
    );
    const children: string[] = [];

    for (const edge of outEdges) {
      const targetNode = await this._store.getNode(edge.targetId);
      if (!targetNode) continue;
      const shouldFilterNode = nodeTypes.length > 0 && !nodeTypes.includes('*');
      if (shouldFilterNode && !targetNode.labels.some((l) => nodeTypes.includes(l))) {
        continue;
      }
      children.push(edge.targetId);
    }

    return children;
  }

  private async _normalizeToNodeIds(
    input: string | string[],
    nodeTypes?: string[],
  ): Promise<string[]> {
    const isWildcard = Array.isArray(input)
      ? input.length === 0 || input.includes('*')
      : input === '*';

    if (!isWildcard) {
      return Array.isArray(input) ? input : [input];
    }

    if (nodeTypes && nodeTypes.length > 0 && !nodeTypes.includes('*')) {
      const nodes = await this._store.getNodes({ filter: { types: nodeTypes } });
      return nodes.map((n) => n.id);
    }

    const LIMIT = 100;
    const all = await this._store.getNodes({ limit: LIMIT });
    if (all.length >= LIMIT) {
      throw new TraversalLimitExceededError(LIMIT);
    }
    return all.map((n) => n.id);
  }

  async traverse(
    sourceId: string | string[],
    targetId: string | string[],
    options: TraversalOptions = {},
  ): Promise<string[][] | null> {
    if (this._kernel && !this._kernel.hasActiveTransactions) {
      return this._traverseSync(this._kernel, sourceId, targetId, options);
    }

    const sources = await this._normalizeToNodeIds(sourceId, options.nodeTypes);
    const targets = await this._normalizeToNodeIds(targetId, options.nodeTypes);

    const allPaths: string[][] = [];
    const onlyOneWildcard =
      (sourceId === '*' || (Array.isArray(sourceId) && sourceId.includes('*'))) !==
      (targetId === '*' || (Array.isArray(targetId) && targetId.includes('*')));
    const bothWildcards =
      (sourceId === '*' || (Array.isArray(sourceId) && sourceId.includes('*'))) &&
      (targetId === '*' || (Array.isArray(targetId) && targetId.includes('*')));
    const requestedMaxResults = options.maxResults ?? 100;
    const maxResults = onlyOneWildcard
      ? Math.min(requestedMaxResults, 50)
      : bothWildcards
        ? Math.min(requestedMaxResults, 10)
        : requestedMaxResults;

    for (const src of sources) {
      for (const tgt of targets) {
        const path = await this._traverseSingle(src, tgt, options);
        if (path !== null) {
          allPaths.push(path);
          if (maxResults && allPaths.length >= maxResults) break;
        }
      }
      if (maxResults && allPaths.length >= maxResults) break;
    }

    return allPaths.length > 0 ? allPaths : null;
  }

  private async _traverseSingle(
    sourceId: string,
    targetId: string,
    options: TraversalOptions,
  ): Promise<string[] | null> {
    const { method = 'bfs', nodeTypes = ['*'], edgeTypes = ['*'] } = options;

    const [sourceExists, targetExists] = await Promise.all([
      this._store.hasNode(sourceId),
      this._store.hasNode(targetId),
    ]);
    if (!sourceExists || !targetExists) return null;
    if (sourceId === targetId) return [sourceId];

    const visited = new Set<string>([sourceId]);
    const parent = new Map<string, string | null>([[sourceId, null]]);
    const frontier: string[] = [sourceId];
    let queueIndex = 0;

    while (method === 'bfs' ? queueIndex < frontier.length : frontier.length > 0) {
      const current = method === 'bfs' ? frontier[queueIndex++] : frontier.pop()!;
      if (current === targetId) {
        const path: string[] = [];
        let node: string | null = targetId;
        while (node !== null) {
          path.push(node);
          node = parent.get(node) ?? null;
        }
        return path.reverse();
      }

      const children = await this._getTraversableChildren(current, nodeTypes, edgeTypes);
      for (const childId of children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          parent.set(childId, current);
          frontier.push(childId);
        }
      }
    }

    return null;
  }

  async isDAG(): Promise<boolean> {
    if (this._kernel && !this._kernel.hasActiveTransactions) {
      return this._isDAGSync(this._kernel);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const hasCycle = async (nodeId: string): Promise<boolean> => {
      visited.add(nodeId);
      visiting.add(nodeId);

      const children = await this._getTraversableChildren(nodeId);
      for (const childId of children) {
        if (!visited.has(childId)) {
          if (await hasCycle(childId)) return true;
        } else if (visiting.has(childId)) {
          return true;
        }
      }

      visiting.delete(nodeId);
      return false;
    };

    const nodes = await this._store.getNodes();
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        if (await hasCycle(node.id)) return false;
      }
    }
    return true;
  }

  async topologicalSort(): Promise<string[] | null> {
    if (this._kernel && !this._kernel.hasActiveTransactions) {
      return this._topologicalSortSync(this._kernel);
    }

    const [nodes, edges] = await Promise.all([
      this._store.getNodes(),
      this._store.getEdges(),
    ]);

    const nodeIds = new Set(nodes.map((n) => n.id));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    for (const edge of edges) {
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
      adjacency.get(edge.sourceId)!.push(edge.targetId);
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const result: string[] = [];
    let queueIndex = 0;

    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      result.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return result.length !== nodes.length ? null : result;
  }

  // ---------------------------------------------------------------------------
  // Synchronous TypedArray CSR + Delta Fast Paths
  // ---------------------------------------------------------------------------

  private _normalizeToNodeSlotsSync(
    kernel: ISyncGraphKernel,
    input: string | string[],
    nodeTypes?: string[],
  ): number[] {
    const isWildcard = Array.isArray(input)
      ? input.length === 0 || input.includes('*')
      : input === '*';

    if (!isWildcard) {
      const ids = Array.isArray(input) ? input : [input];
      const out: number[] = [];
      for (let i = 0; i < ids.length; i++) {
        const slot = kernel.getNodeSlot(ids[i]);
        if (slot >= 0) out.push(slot);
      }
      return out;
    }

    if (nodeTypes && nodeTypes.length > 0 && !nodeTypes.includes('*')) {
      const slots = kernel.queryNodeSlotsSync({ filter: { types: nodeTypes } });
      return Array.from(slots);
    }

    const LIMIT = 100;
    const slots = kernel.queryNodeSlotsSync({ limit: LIMIT });
    if (slots.length >= LIMIT) {
      throw new TraversalLimitExceededError(LIMIT);
    }
    return Array.from(slots);
  }

  private _traverseSync(
    kernel: ISyncGraphKernel,
    sourceId: string | string[],
    targetId: string | string[],
    options: TraversalOptions,
  ): string[][] | null {
    const sources = this._normalizeToNodeSlotsSync(kernel, sourceId, options.nodeTypes);
    const targets = this._normalizeToNodeSlotsSync(kernel, targetId, options.nodeTypes);
    if (sources.length === 0 || targets.length === 0) return null;

    const { method = 'bfs', nodeTypes = ['*'], edgeTypes = ['*'] } = options;
    const nodeMaskQuery =
      nodeTypes.length > 0 && !nodeTypes.includes('*')
        ? kernel.arena.labelDict.buildQueryMask(nodeTypes)
        : undefined;
    if (nodeMaskQuery === null) return null;

    const edgeMaskQuery =
      edgeTypes.length > 0 && !edgeTypes.includes('*')
        ? kernel.arena.edgeTypeDict.buildQueryMask(edgeTypes)
        : undefined;
    if (edgeMaskQuery === null) return null;

    const onlyOneWildcard =
      (sourceId === '*' || (Array.isArray(sourceId) && sourceId.includes('*'))) !==
      (targetId === '*' || (Array.isArray(targetId) && targetId.includes('*')));
    const bothWildcards =
      (sourceId === '*' || (Array.isArray(sourceId) && sourceId.includes('*'))) &&
      (targetId === '*' || (Array.isArray(targetId) && targetId.includes('*')));
    const requestedMaxResults = options.maxResults ?? 100;
    const maxResults = onlyOneWildcard
      ? Math.min(requestedMaxResults, 50)
      : bothWildcards
        ? Math.min(requestedMaxResults, 10)
        : requestedMaxResults;

    const arena = kernel.arena;
    const adj = kernel.adjacency;
    const highN = arena.nodeHighWater;
    const visitedStamp = new Uint32Array(highN);
    const parentSlot = new Int32Array(highN);
    let stamp = 0;

    const bfsQueue = method === 'bfs' ? new Uint32RingQueue(64) : null;
    const dfsStack: number[] = method === 'dfs' ? [] : [];
    const allPaths: string[][] = [];

    for (let sIdx = 0; sIdx < sources.length; sIdx++) {
      const srcSlot = sources[sIdx];
      for (let tIdx = 0; tIdx < targets.length; tIdx++) {
        const tgtSlot = targets[tIdx];
        if (srcSlot === tgtSlot) {
          allPaths.push([arena.nodeIds[srcSlot]]);
          if (maxResults && allPaths.length >= maxResults) return allPaths;
          continue;
        }

        stamp++;
        visitedStamp[srcSlot] = stamp;
        parentSlot[srcSlot] = -1;

        let found = false;
        if (bfsQueue) {
          bfsQueue.clear();
          bfsQueue.push(srcSlot);
          while (bfsQueue.length > 0) {
            const cur = bfsQueue.shift();
            if (cur === tgtSlot) {
              found = true;
              break;
            }
            this._expandTraverseSync(
              kernel,
              cur,
              tgtSlot,
              stamp,
              visitedStamp,
              parentSlot,
              nodeMaskQuery,
              edgeMaskQuery,
              bfsQueue,
              null,
              adj,
            );
          }
        } else {
          dfsStack.length = 0;
          dfsStack.push(srcSlot);
          while (dfsStack.length > 0) {
            const cur = dfsStack.pop()!;
            if (cur === tgtSlot) {
              found = true;
              break;
            }
            this._expandTraverseSync(
              kernel,
              cur,
              tgtSlot,
              stamp,
              visitedStamp,
              parentSlot,
              nodeMaskQuery,
              edgeMaskQuery,
              null,
              dfsStack,
              adj,
            );
          }
        }

        if (found) {
          const path: string[] = [];
          let cur = tgtSlot;
          while (cur >= 0) {
            path.push(arena.nodeIds[cur]);
            cur = parentSlot[cur];
          }
          path.reverse();
          allPaths.push(path);
          if (maxResults && allPaths.length >= maxResults) return allPaths;
        }
      }
    }

    return allPaths.length > 0 ? allPaths : null;
  }

  private _expandTraverseSync(
    kernel: ISyncGraphKernel,
    cur: number,
    _tgtSlot: number,
    stamp: number,
    visitedStamp: Uint32Array,
    parentSlot: Int32Array,
    nodeMaskQuery: Bitmask64Query | undefined,
    edgeMaskQuery: Bitmask64Query | undefined,
    bfsQueue: Uint32RingQueue | null,
    dfsStack: number[] | null,
    adj: ISyncGraphKernel['adjacency'],
  ): void {
    const arena = kernel.arena;
    const edgeAlive = arena.edgeAlive;
    const nodeAlive = arena.nodeAlive;

    const csrEntries = adj.getCsrOutEntries();
    for (let i = adj.getCsrOutStart(cur), end = adj.getCsrOutEnd(cur); i < end; i += 3) {
      if (edgeAlive[csrEntries[i]] === 0) continue;
      if (edgeMaskQuery && !matchesTypeId(csrEntries[i + 2], edgeMaskQuery)) continue;
      const nbr = csrEntries[i + 1];
      if (nodeAlive[nbr] === 0 || visitedStamp[nbr] === stamp) continue;
      if (nodeMaskQuery && !arena.matchesNodeLabelMask(nbr, nodeMaskQuery)) continue;
      visitedStamp[nbr] = stamp;
      parentSlot[nbr] = cur;
      if (bfsQueue) bfsQueue.push(nbr);
      else dfsStack!.push(nbr);
    }

    const dBuf = adj.getDeltaOutBuf(cur);
    const dLen = adj.getDeltaOutWordLen(cur);
    if (dBuf && dLen > 0) {
      for (let i = 0; i < dLen; i += 3) {
        if (edgeAlive[dBuf[i]] === 0) continue;
        if (edgeMaskQuery && !matchesTypeId(dBuf[i + 2], edgeMaskQuery)) continue;
        const nbr = dBuf[i + 1];
        if (nodeAlive[nbr] === 0 || visitedStamp[nbr] === stamp) continue;
        if (nodeMaskQuery && !arena.matchesNodeLabelMask(nbr, nodeMaskQuery)) continue;
        visitedStamp[nbr] = stamp;
        parentSlot[nbr] = cur;
        if (bfsQueue) bfsQueue.push(nbr);
        else dfsStack!.push(nbr);
      }
    }
  }

  private _isDAGSync(kernel: ISyncGraphKernel): boolean {
    const arena = kernel.arena;
    const adj = kernel.adjacency;
    const highN = arena.nodeHighWater;
    const nodeAlive = arena.nodeAlive;
    const edgeAlive = arena.edgeAlive;
    const csrEntries = adj.getCsrOutEntries();

    // Iterative 3-color DFS: 0=unvisited, 1=visiting, 2=visited
    const color = new Uint8Array(highN);
    const stackNode: number[] = [];
    const stackPhase: number[] = []; // 0 = csr, 1 = delta
    const stackIdx: number[] = [];

    for (let root = 0; root < highN; root++) {
      if (nodeAlive[root] === 0 || color[root] !== 0) continue;

      color[root] = 1;
      stackNode.push(root);
      stackPhase.push(0);
      stackIdx.push(adj.getCsrOutStart(root));

      while (stackNode.length > 0) {
        const top = stackNode.length - 1;
        const u = stackNode[top];
        let phase = stackPhase[top];
        let idx = stackIdx[top];
        let pushedChild = false;

        if (phase === 0) {
          const csrEnd = adj.getCsrOutEnd(u);
          while (idx < csrEnd) {
            const eSlot = csrEntries[idx];
            const v = csrEntries[idx + 1];
            idx += 3;
            if (edgeAlive[eSlot] === 0 || nodeAlive[v] === 0) continue;
            if (color[v] === 1) return false;
            if (color[v] === 0) {
              stackIdx[top] = idx;
              color[v] = 1;
              stackNode.push(v);
              stackPhase.push(0);
              stackIdx.push(adj.getCsrOutStart(v));
              pushedChild = true;
              break;
            }
          }
          if (pushedChild) continue;
          stackPhase[top] = 1;
          stackIdx[top] = 0;
          phase = 1;
          idx = 0;
        }

        if (phase === 1) {
          const dBuf = adj.getDeltaOutBuf(u);
          const dLen = adj.getDeltaOutWordLen(u);
          if (dBuf) {
            while (idx < dLen) {
              const eSlot = dBuf[idx];
              const v = dBuf[idx + 1];
              idx += 3;
              if (edgeAlive[eSlot] === 0 || nodeAlive[v] === 0) continue;
              if (color[v] === 1) return false;
              if (color[v] === 0) {
                stackIdx[top] = idx;
                color[v] = 1;
                stackNode.push(v);
                stackPhase.push(0);
                stackIdx.push(adj.getCsrOutStart(v));
                pushedChild = true;
                break;
              }
            }
          }
          if (pushedChild) continue;
        }

        color[u] = 2;
        stackNode.pop();
        stackPhase.pop();
        stackIdx.pop();
      }
    }

    return true;
  }

  private _topologicalSortSync(kernel: ISyncGraphKernel): string[] | null {
    const arena = kernel.arena;
    const adj = kernel.adjacency;
    const highN = arena.nodeHighWater;
    const liveCount = arena.liveNodeCount;
    if (liveCount === 0) return [];

    const nodeAlive = arena.nodeAlive;
    const edgeAlive = arena.edgeAlive;
    const inDeg = new Uint32Array(highN);
    const queue = new Uint32RingQueue(Math.min(Math.max(liveCount, 32), 4096));
    const csrEntries = adj.getCsrOutEntries();

    for (let u = 0; u < highN; u++) {
      if (nodeAlive[u] === 0) continue;
      for (let i = adj.getCsrOutStart(u), end = adj.getCsrOutEnd(u); i < end; i += 3) {
        if (edgeAlive[csrEntries[i]] === 0) continue;
        const v = csrEntries[i + 1];
        if (nodeAlive[v] === 0) continue;
        inDeg[v]++;
      }
      const dBuf = adj.getDeltaOutBuf(u);
      const dLen = adj.getDeltaOutWordLen(u);
      if (dBuf && dLen > 0) {
        for (let i = 0; i < dLen; i += 3) {
          if (edgeAlive[dBuf[i]] === 0) continue;
          const v = dBuf[i + 1];
          if (nodeAlive[v] === 0) continue;
          inDeg[v]++;
        }
      }
    }

    for (let s = 0; s < highN; s++) {
      if (nodeAlive[s] === 0) continue;
      if (inDeg[s] === 0) {
        queue.push(s);
      }
    }

    const result: string[] = [];

    while (queue.length > 0) {
      const u = queue.shift();
      result.push(arena.nodeIds[u]);

      for (let i = adj.getCsrOutStart(u), end = adj.getCsrOutEnd(u); i < end; i += 3) {
        if (edgeAlive[csrEntries[i]] === 0) continue;
        const v = csrEntries[i + 1];
        if (nodeAlive[v] === 0) continue;
        const nextDeg = inDeg[v] - 1;
        inDeg[v] = nextDeg;
        if (nextDeg === 0) queue.push(v);
      }

      const dBuf = adj.getDeltaOutBuf(u);
      const dLen = adj.getDeltaOutWordLen(u);
      if (dBuf && dLen > 0) {
        for (let i = 0; i < dLen; i += 3) {
          if (edgeAlive[dBuf[i]] === 0) continue;
          const v = dBuf[i + 1];
          if (nodeAlive[v] === 0) continue;
          const nextDeg = inDeg[v] - 1;
          inDeg[v] = nextDeg;
          if (nextDeg === 0) queue.push(v);
        }
      }
    }

    return result.length !== liveCount ? null : result;
  }
}

function matchesTypeId(typeId: number, query: Bitmask64Query): boolean {
  if (typeId < 32) return ((query.lo & (1 << typeId)) >>> 0) !== 0;
  if (typeId < 64) return ((query.hi & (1 << (typeId - 32))) >>> 0) !== 0;
  return query.overflowIds ? query.overflowIds.includes(typeId) : false;
}
