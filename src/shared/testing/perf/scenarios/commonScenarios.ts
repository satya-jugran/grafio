import { Graph } from '../../../../index';
import type { GraphMeta } from '../graphGenerator';
import type { BenchmarkScenario } from '../benchmarkRunner';
import type { StorageProvider } from './iterationFactors';

/**
 * Calculates iterations based on provider factor and large graph multiplier.
 * For large graphs (nodeCount >= threshold), iterations are reduced.
 */
function calcIterations(
  baseIterations: number,
  factor: number,
  isLarge: boolean,
  _largeThreshold: number,
  largeMultiplier = 0.2
): number {
  const adjusted = isLarge
    ? Math.floor(baseIterations * largeMultiplier)
    : baseIterations;
  return Math.max(1, Math.floor(adjusted * factor));
}

/**
 * Pick a node id at a deterministic offset (avoids random overhead in hot loop)
 */
function pickId(meta: GraphMeta, offset: number): string {
  return meta.nodeIds[offset % meta.nodeIds.length];
}

/**
 * Builds all benchmark scenarios with provider-specific iteration counts.
 *
 * @param provider - The storage provider type for iteration factor calculation
 * @param nodeCount - Node count used to determine if graph is "large"
 * @param factor - Iteration multiplier for this provider
 */
export function buildCommonScenarios(
  provider: StorageProvider,
  nodeCount: number,
  factor: number
): BenchmarkScenario[] {
  const isLarge = nodeCount >= 50_000;

  return [
    // ── Write: Graph Construction ─────────────────────────────────────────
    // Only meaningful for in-memory (fast enough to benchmark construction)
    ...(provider === 'in-memory' ? [{
      category: 'Write',
      name: 'Graph Construction',
      setup: () => new Graph(),
      run: async (_graph: Graph, meta: GraphMeta) => {
        const g = new Graph();
        const ids: string[] = [];
        const batch = Math.min(500, Math.floor(meta.nodeCount / 20));
        for (let i = 0; i < batch; i++) {
          const n = await g.addNode('Person', { index: i, label: `node-${i}` });
          ids.push(n.id);
        }
        const edgeBatch = Math.min(batch * 2, ids.length - 1);
        for (let i = 0; i < edgeBatch; i++) {
          await g.addEdge(ids[i], ids[(i + 1) % ids.length], 'KNOWS');
        }
        return g;
      },
      iterations: calcIterations(isLarge ? 5 : 10, factor, isLarge, 50_000),
    }] : []),

    // ── Write: addNode ────────────────────────────────────────────────────
    {
      category: 'Write',
      name: 'addNode (single)',
      setup: () => new Graph(),
      run: async (graph, _meta) => {
        await graph.addNode('Product', { label: `product-${Math.random()}`, score: 99 });
      },
      iterations: calcIterations(10_000, factor, isLarge, 50_000),
    },

    // ── Write: addEdge ────────────────────────────────────────────────────
    {
      category: 'Write',
      name: 'addEdge (single)',
      setup: async (meta) => {
        const g = new Graph();
        const pool = provider === 'mongodb' ? 100 : 500;
        const nodeIds: string[] = [];
        for (let i = 0; i < pool; i++) {
          const n = await g.addNode('Person', { index: i });
          nodeIds.push(n.id);
        }
        (meta as GraphMeta & { _edgePool?: string[] })._edgePool = nodeIds;
        return g;
      },
      run: async (graph, meta) => {
        const pool = (meta as GraphMeta & { _edgePool?: string[] })._edgePool!;
        const src = pool[Math.floor(Math.random() * pool.length)];
        const tgt = pool[Math.floor(Math.random() * pool.length)];
        if (src !== tgt) {
          try { await graph.addEdge(src, tgt, 'KNOWS'); } catch { /* dup — skip */ }
        }
      },
      iterations: calcIterations(5_000, factor, isLarge, 50_000),
    },

    // ── Write: batch addNodes (MongoDB specific) ──────────────────────────
    ...(provider === 'mongodb' ? [{
      category: 'Write',
      name: 'addNode (batch 50)',
      setup: () => {},
      run: async (graph: any, _meta: any) => {
        const promises = [];
        for (let i = 0; i < 50; i++) {
          promises.push(graph.addNode('Product', { batchIndex: i, score: i }));
        }
        await Promise.all(promises);
      },
      iterations: calcIterations(100, factor, isLarge, 5_000),
    }] : []),

    // ── Read: getNode by id ────────────────────────────────────────────────
    {
      category: 'Read',
      name: 'getNode (by id)',
      run: async (graph: any, meta: any) => {
        return graph.getNode(pickId(meta, 42));
      },
      iterations: calcIterations(100_000, factor, isLarge, 50_000),
    },

    // ── Read: hasNode ──────────────────────────────────────────────────────
    {
      category: 'Read',
      name: 'hasNode',
      run: async (graph: any, meta: any) => {
        return graph.hasNode(pickId(meta, 7777));
      },
      iterations: calcIterations(100_000, factor, isLarge, 50_000),
    },

    // ── Read: getNodes with filter.types ─────────────────────────────────────
    {
      category: 'Read',
      name: 'getNodes with filter.types',
      run: async (graph: any, _meta: any) => {
        return graph.getNodes({ filter: { types: ['Person'] } });
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Read: getNodes with filter.properties ─────────────────────────────────
    {
      category: 'Read',
      name: 'getNodes with filter.properties',
      run: async (graph: any, _meta: any) => {
        return graph.getNodes({ filter: { properties: [{ key: 'active', value: true }] } });
      },
      iterations: calcIterations(20, factor, isLarge, 50_000),
    },

    // ── Read: getNodes (full scan) ─────────────────────────────────────────
    {
      category: 'Read',
      name: 'getNodes (all)',
      run: async (graph: any, _meta: any) => {
        return graph.getNodes();
      },
      iterations: calcIterations(40, factor, isLarge, 50_000),
    },

    // ── Navigation: getEdgesFrom ───────────────────────────────────────────
    {
      category: 'Navigation',
      name: 'getEdgesFrom',
      run: async (graph: any, meta: any) => {
        return graph.getEdgesFrom(pickId(meta, 999));
      },
      iterations: calcIterations(2_000, factor, isLarge, 50_000),
    },

    // ── Navigation: getEdgesTo ─────────────────────────────────────────────
    {
      category: 'Navigation',
      name: 'getEdgesTo',
      run: async (graph: any, meta: any) => {
        return graph.getEdgesTo(pickId(meta, 333));
      },
      iterations: calcIterations(2_000, factor, isLarge, 50_000),
    },

    // ── Navigation: getDirectEdgesBetween ────────────────────────────────
    {
      category: 'Navigation',
      name: 'getDirectEdgesBetween',
      run: async (graph: any, meta: any) => {
        const [src, tgt] = meta.traversalPairs[0];
        return graph.getDirectEdgesBetween(src, tgt);
      },
      iterations: calcIterations(3_000, factor, isLarge, 50_000),
    },

    // ── Traversal: BFS ─────────────────────────────────────────────────────
    {
      category: 'Traversal',
      name: 'traverse BFS',
      run: async (graph: any, meta: any) => {
        const [src, tgt] = meta.traversalPairs[0];
        return graph.traverse(src, tgt, { method: 'bfs' });
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Traversal: DFS ─────────────────────────────────────────────────────
    {
      category: 'Traversal',
      name: 'traverse DFS',
      run: async (graph: any, meta: any) => {
        const [src, tgt] = meta.traversalPairs[1];
        return graph.traverse(src, tgt, { method: 'dfs' });
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Traversal: BFS with type filters ──────────────────────────────────
    {
      category: 'Traversal',
      name: 'traverse BFS (typed)',
      run: async (graph: any, meta: any) => {
        const [src, tgt] = meta.traversalPairs[2];
        return graph.traverse(src, tgt, { method: 'bfs', nodeTypes: ['Person', 'Product'], edgeTypes: ['KNOWS', 'BOUGHT'] });
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Traversal: DFS with type filters ────────────────────────────────────
    {
      category: 'Traversal',
      name: 'traverse DFS (typed)',
      run: async (graph: any, meta: any) => {
        const [src, tgt] = meta.traversalPairs[2];
        return graph.traverse(src, tgt, { method: 'dfs', nodeTypes: ['Person', 'Product'], edgeTypes: ['KNOWS', 'BOUGHT'] });
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Traversal: Wildcard (typed) ─────────────────────────────────────────
    {
      category: 'Traversal',
      name: 'traverse wildcard src',
      run: async (graph: any, meta: any) => {
        const tgt = pickId(meta, 500);
        return graph.traverse('*', tgt, { method: 'bfs', maxResults: 10, nodeTypes: ['Person', 'Product', 'Review'], edgeTypes: ['KNOWS', 'BOUGHT', 'WRITTEN'] });
      },
      iterations: calcIterations(10, factor, isLarge, 50_000),
    },

    // ── Analysis: isDAG ───────────────────────────────────────────────────
    {
      category: 'Analysis',
      name: 'isDAG (DAG graph)',
      run: async (_graph: Graph, meta: GraphMeta) => {
        return meta.dagGraph.isDAG();
      },
      iterations: calcIterations(30, factor, isLarge, 50_000),
    },

    // ── Analysis: isDAG on cyclic ─────────────────────────────────────────
    {
      category: 'Analysis',
      name: 'isDAG (cyclic graph)',
      run: async (graph: any, _meta: any) => {
        return graph.isDAG();
      },
      iterations: calcIterations(15, factor, isLarge, 50_000),
    },

    // ── Analysis: topologicalSort ─────────────────────────────────────────
    {
      category: 'Analysis',
      name: 'topologicalSort (DAG)',
      run: async (_graph: Graph, meta: GraphMeta) => {
        return meta.dagGraph.topologicalSort();
      },
      iterations: calcIterations(30, factor, isLarge, 50_000),
    },

    // ── Serialization: exportJSON ─────────────────────────────────────────
    {
      category: 'Serialization',
      name: 'exportJSON',
      run: async (graph: any, _meta: any) => {
        return graph.exportJSON();
      },
      iterations: calcIterations(8, factor, isLarge, 50_000),
    },

    // ── Serialization: importJSON ─────────────────────────────────────────
    {
      category: 'Serialization',
      name: 'importJSON',
      setup: async (meta: GraphMeta) => {
        const data = await meta.graph.exportJSON();
        (meta as GraphMeta & { _serialized?: typeof data })._serialized = data;
      },
      run: async (_graph: Graph, meta: GraphMeta) => {
        const data = (meta as GraphMeta & { _serialized?: unknown })._serialized as Parameters<typeof Graph.importJSON>[0];
        return Graph.importJSON(data);
      },
      iterations: calcIterations(8, factor, isLarge, 50_000),
    },

    // ── Mutation: removeEdge ──────────────────────────────────────────────
    {
      category: 'Mutation',
      name: 'removeEdge',
      setup: async (meta: GraphMeta) => {
        const g = new Graph();
        const n = provider === 'mongodb' ? 500 : 2_000;
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
          const node = await g.addNode('Person', { i });
          ids.push(node.id);
        }
        const edgeIds: string[] = [];
        for (let i = 0; i < n - 1; i++) {
          const edge = await g.addEdge(ids[i], ids[i + 1], 'KNOWS');
          edgeIds.push(edge.id);
        }
        (meta as GraphMeta & { _removeEdgeGraph?: Graph; _removeEdgeIds?: string[] })._removeEdgeGraph = g;
        (meta as GraphMeta & { _removeEdgeIds?: string[] })._removeEdgeIds = edgeIds;
        return g;
      },
      run: async (_graph: Graph, meta: GraphMeta) => {
        const m = meta as GraphMeta & { _removeEdgeGraph?: Graph; _removeEdgeIds?: string[] };
        const ids = m._removeEdgeIds!;
        if (ids.length > 0) {
          const id = ids.pop()!;
          await m._removeEdgeGraph!.removeEdge(id);
        }
      },
      iterations: calcIterations(1_000, factor, isLarge, 50_000),
    },

    // ── Mutation: removeNode (cascade) ────────────────────────────────────
    {
      category: 'Mutation',
      name: 'removeNode (cascade)',
      setup: async (meta: GraphMeta) => {
        const g = new Graph();
        const n = provider === 'mongodb' ? 500 : 2_000;
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
          const node = await g.addNode('Person', { i });
          ids.push(node.id);
        }
        for (let i = 0; i < n - 1; i++) {
          await g.addEdge(ids[i], ids[i + 1], 'KNOWS');
        }
        (meta as GraphMeta & { _removeCascadeGraph?: Graph; _removeCascadeIds?: string[] })._removeCascadeGraph = g;
        (meta as GraphMeta & { _removeCascadeIds?: string[] })._removeCascadeIds = [...ids];
        return g;
      },
      run: async (_graph: Graph, meta: GraphMeta) => {
        const m = meta as GraphMeta & { _removeCascadeGraph?: Graph; _removeCascadeIds?: string[] };
        const ids = m._removeCascadeIds!;
        if (ids.length > 0) {
          const id = ids.pop()!;
          const exists = await m._removeCascadeGraph!.hasNode(id);
          if (exists) {
            await m._removeCascadeGraph!.removeNode(id, true);
          }
        }
      },
      iterations: calcIterations(1_000, factor, isLarge, 50_000),
    },

    // ── Mutation: clear ───────────────────────────────────────────────────
    {
      category: 'Mutation',
      name: 'clear (full graph)',
      setup: (meta: GraphMeta) => {
        const size = provider === 'mongodb'
          ? Math.min(200, Math.floor(meta.nodeCount / 10))
          : Math.min(1000, Math.floor(meta.nodeCount / 10));
        (meta as GraphMeta & { _clearSize?: number })._clearSize = size;
      },
      run: async (_graph: Graph, meta: GraphMeta) => {
        const size = (meta as GraphMeta & { _clearSize?: number })._clearSize!;
        const g = new Graph();
        const ids: string[] = [];
        for (let i = 0; i < size; i++) {
          const n = await g.addNode('Person', { i });
          ids.push(n.id);
        }
        for (let i = 0; i < size - 1; i++) {
          await g.addEdge(ids[i], ids[i + 1], 'KNOWS');
        }
        await g.clear();
      },
      iterations: calcIterations(30, factor, isLarge, 50_000),
    },
  ];
}