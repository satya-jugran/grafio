import { Graph } from '../../../index';
import { InMemoryStorageProvider } from '../../../storage/InMemoryStorageProvider';

export interface GraphMeta {
  graph: Graph;
  nodeIds: string[];
  nodeCount: number;
  edgeCount: number;
  /** Pairs of [sourceId, targetId] guaranteed to be 3+ hops apart for traversal benchmarks */
  traversalPairs: Array<[string, string]>;
  /** A separate small DAG graph for isDAG / topologicalSort benchmarks */
  dagGraph: Graph;
  dagNodeIds: string[];
  heapFootprintBytes: number;
}

const NODE_TYPES = ['Person', 'Product', 'Category', 'Tag', 'Order'];
const EDGE_TYPES = ['KNOWS', 'BOUGHT', 'TAGGED_WITH', 'IN_CATEGORY', 'PLACED'];

/** Simple seeded pseudo-random number generator (mulberry32) for reproducibility */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return function (): number {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Builds a random directed graph with the given node and edge counts.
 * Uses importJSON for efficient bulk loading (single batch insert).
 * Returns the graph plus useful metadata for benchmarks.
 */
export async function buildGraph(
  nodeCount: number,
  edgesPerNode: number,
  seed = 42,
  graphId = 'default'
): Promise<GraphMeta> {
  const rng = makeRng(seed);

  // ── Graph footprint snapshot ──────────────────────────────────────────────
  if (typeof global.gc === 'function') global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  // ── Collect nodes and edges ───────────────────────────────────────────────
  const nodes: Array<{ id: string; type: string; properties: Record<string, unknown> }> = [];
  const edges: Array<{ id: string; sourceId: string; targetId: string; type: string; properties: Record<string, unknown> }> = [];

  for (let i = 0; i < nodeCount; i++) {
    const type = NODE_TYPES[i % NODE_TYPES.length];
    nodes.push({
      id: `n${i}`,
      type,
      properties: {
        index: i,
        label: `${type}-${i}`,
        score: Math.round(rng() * 1000) / 10,
        amount: Math.round(rng() * 10000) / 100,
        active: rng() > 0.2,
      },
    });
  }

  let edgeCount = 0;
  for (let i = 0; i < nodeCount; i++) {
    const numEdges = randInt(rng, Math.max(1, edgesPerNode - 1), edgesPerNode + 1);
    const sourceId = `n${i}`;
    for (let j = 0; j < numEdges; j++) {
      let targetIdx = randInt(rng, 0, nodeCount - 1);
      if (targetIdx === i) targetIdx = (targetIdx + 1) % nodeCount;
      const targetId = `n${targetIdx}`;
      const type = EDGE_TYPES[Math.floor(rng() * EDGE_TYPES.length)];
      edges.push({
        id: `e${edgeCount++}`,
        sourceId,
        targetId,
        type,
        properties: { weight: Math.round(rng() * 100) },
      });
    }
  }

  // ── Load via importJSON (single batch insert) ─────────────────────────────
  const provider = new InMemoryStorageProvider({ graphId });
  const graph = await Graph.importJSON({ graphId, nodes, edges }, provider);

  // Create indexes for benchmark query patterns
  await graph.createIndex('node', 'active');

  if (typeof global.gc === 'function') global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const heapFootprintBytes = Math.max(0, heapAfter - heapBefore);

  // ── Pick traversal pairs ──────────────────────────────────────────────────
  const traversalPairs: Array<[string, string]> = [];
  const step = Math.floor(nodeCount / 12);
  for (let k = 0; k < 10; k++) {
    const srcIdx = (k * step) % nodeCount;
    const tgtIdx = (srcIdx + Math.floor(nodeCount * 0.3) + k * 97) % nodeCount;
    traversalPairs.push([`n${srcIdx}`, `n${tgtIdx}`]);
  }

  // ── Build a separate DAG for isDAG / topologicalSort ──────────────────────
  const dagSize = Math.min(5000, Math.floor(nodeCount * 0.05));
  const dagMeta = await buildDag(dagSize, rng, graphId);

  return {
    graph,
    nodeIds: nodes.map(n => n.id),
    nodeCount,
    edgeCount,
    traversalPairs,
    dagGraph: dagMeta.graph,
    dagNodeIds: dagMeta.nodeIds,
    heapFootprintBytes,
  };
}

/** Builds a pure DAG (linear layers with forward-only edges) */
async function buildDag(
  nodeCount: number,
  rng: () => number,
  graphId = 'default'
): Promise<{ graph: Graph; nodeIds: string[] }> {
  const dagNodes: Array<{ id: string; type: string; properties: Record<string, unknown> }> = [];
  const dagEdges: Array<{ id: string; sourceId: string; targetId: string; type: string; properties: Record<string, unknown> }> = [];

  for (let i = 0; i < nodeCount; i++) {
    dagNodes.push({ id: `dag${i}`, type: 'DAGNode', properties: { index: i } });
  }

  let edgeCount = 0;
  for (let i = 0; i < nodeCount - 1; i++) {
    const numEdges = randInt(rng, 1, 3);
    for (let j = 0; j < numEdges; j++) {
      const targetIdx = randInt(rng, i + 1, Math.min(nodeCount - 1, i + 10));
      dagEdges.push({
        id: `dag_e${edgeCount++}`,
        sourceId: `dag${i}`,
        targetId: `dag${targetIdx}`,
        type: 'DEP',
        properties: {},
      });
    }
  }

  const dagGraph = await Graph.importJSON({ graphId, nodes: dagNodes, edges: dagEdges });

  return { graph: dagGraph, nodeIds: dagNodes.map(n => n.id) };
}
