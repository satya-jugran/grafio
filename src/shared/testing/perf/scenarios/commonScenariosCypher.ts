import { Graph } from '../../../../index';
import { CypherEngine } from '../../../../cypher/CypherEngine';
import type { GraphMeta } from '../graphGenerator';
import type { BenchmarkScenario } from '../benchmarkRunner';

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
 * Builds benchmark scenarios using Cypher queries instead of graph methods.
 * Only includes Read, Navigation, and Traversal categories since Cypher
 * is read-only and doesn't support write/delete operations.
 *
 * @param nodeCount - Node count used to determine if graph is "large"
 * @param factor - Iteration multiplier for this provider
 */
export function buildCommonScenariosCypher(
  nodeCount: number,
  factor: number,
  maxDegreeOfParallelism: number = 1
): BenchmarkScenario[] {
  const isLarge = nodeCount >= (50_000 * factor);
  return [
    // ── Write: Graph Construction ─────────────────────────────────────────
    // Only meaningful for in-memory (fast enough to benchmark construction)
    {
      category: 'Write',
      name: 'Graph Construction',
      setup: () => new Graph(),
      run: async (_graph: Graph, meta: GraphMeta) => {
        const g = new Graph();
        const ids: string[] = [];
        const batch = Math.min(500 * factor, Math.floor(meta.nodeCount / 20));
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
    },

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
        const pool = 100 * factor;
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

    // ── Read: getNode by id ────────────────────────────────────────────────
    {
      category: 'Read',
      name: 'Get Node by id (parameterised)',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const nodeId = pickId(meta, 42);
        return engine.execute('MATCH (n) WHERE id(n) = $id RETURN n', { id: nodeId });
      },
      iterations: calcIterations(50_000, factor, isLarge, 50_000),
    },

    // ── Read: Get Node by id ──────────────────────────────
    {
      category: 'Read',
      name: 'Get nodes by id',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const nodeId = pickId(meta, 7777);
        return engine.execute('MATCH (n) WHERE id(n) = $id RETURN count(n) AS cnt', { id: nodeId });
      },
      iterations: calcIterations(50_000, factor, isLarge, 50_000),
    },

    // ── Read: Get Nodes with filter.types ─────────────────────────────────────
    {
      category: 'Read',
      name: 'Get nodes by type',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        return engine.execute('MATCH (n:Person) RETURN count(n) AS total');
      },
      iterations: calcIterations(10_000, factor, isLarge, 50_000),
    },

    // ── Read: Get Nodes with filter.properties ─────────────────────────────────
    {
      category: 'Read',
      name: 'Get nodes by property',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        return engine.execute('MATCH (n) WHERE n.active = true RETURN count(n) AS total');
      },
      iterations: calcIterations(1_000, factor, isLarge, 50_000),
    },

    // ── Read: Get Nodes (full scan) ─────────────────────────────────────────
    {
      category: 'Read',
      name: 'Get all Nodes',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        return engine.execute('MATCH (n) RETURN count(n) AS total');
      },
      iterations: calcIterations(400, factor, isLarge, 50_000),
    },

    // ── Navigation: getEdgesFrom ────────────────────────────────────────────
    {
      category: 'Navigation',
      name: 'Get Edges from node by id',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const nodeId = pickId(meta, 999);
        return engine.execute('MATCH (s)-[r]->(t) WHERE id(s) = $id RETURN r', { id: nodeId });
      },
      iterations: calcIterations(2_000, factor, isLarge, 50_000),
    },

    // ── Navigation: getEdgesTo ─────────────────────────────────────────────
    {
      category: 'Navigation',
      name: 'Get Edges to node by id',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const nodeId = pickId(meta, 333);
        return engine.execute('MATCH (s)-[r]->(t) WHERE id(t) = $id RETURN r', { id: nodeId });
      },
      iterations: calcIterations(2_000, factor, isLarge, 50_000),
    },

    // ── Navigation: getDirectEdgesBetween ────────────────────────────────
    {
      category: 'Navigation',
      name: 'Get edges between nodes by ids',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const [src, tgt] = meta.traversalPairs[0];
        return engine.execute(
          'MATCH (a)-[r]->(b) WHERE id(a) = $src AND id(b) = $tgt RETURN r',
          { src, tgt }
        );
      },
      iterations: calcIterations(3_000, factor, isLarge, 50_000),
    },

    // ── Traversal: Traversal variable-length path ─────────────────────────
    {
      category: 'Traversal',
      name: 'Traversal var-length (1..5)',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const [src, tgt] = meta.traversalPairs[0];
        return engine.execute(
          'MATCH (a)-[*1..5]->(b) WHERE id(a) = $src AND id(b) = $tgt RETURN b',
          { src, tgt }
        );
      },
      iterations: calcIterations(20, factor, isLarge, 50_000),
    },

    // ── Traversal: Traversal with type filters ──────────────────────────────────
    {
      category: 'Traversal',
      name: 'Traversal with types',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const [src, tgt] = meta.traversalPairs[2];
        return engine.execute(
          'MATCH (a)-[:KNOWS|BOUGHT*1..5]->(b) WHERE id(a) = $src AND id(b) = $tgt RETURN b',
          { src, tgt }
        );
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Traversal: Wildcard source with type filters ──────────────────────
    {
      category: 'Traversal',
      name: 'Traversal wildcard with types',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const tgt = pickId(meta, 500);
        return engine.execute(
          'MATCH (a)-[:KNOWS|BOUGHT|WRITTEN*1..5]->(b) WHERE id(b) = $tgt RETURN id(a) LIMIT 10',
          { tgt }
        );
      },
      iterations: calcIterations(20, factor, isLarge, 50_000),
    },

    // ── Aggregation: Basic aggregation on score and amount ──────────────────
    {
      category: 'Aggregation',
      name: 'Aggregate score/amount by type',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        return engine.execute(
          `MATCH (n:Person)
           WHERE n.score > 50 AND n.amount > 100
           RETURN n.label AS type,
                  avg(n.score) AS avgScore,
                  min(n.score) AS minScore,
                  max(n.score) AS maxScore,
                  sum(n.amount) AS totalAmount,
                  avg(n.amount) AS avgAmount,
                  count(n) AS nodeCount`
        );
      },
      iterations: calcIterations(500, factor, isLarge, 50_000),
    },

    // ── Aggregation: JOIN across node types with aggregation ────────────────
    {
      category: 'Aggregation',
      name: 'Aggregate across two joins',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph, { maxDegreeOfParallelism });
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        const result = await engine.execute(
          `MATCH (p:Person)-[r1:BOUGHT]->(t:Product)-[r2:IN_CATEGORY]->(c:Category)
           WHERE r1.weight > 5 AND p.score > 50 and r1.weight < r2.weight
           RETURN p.label AS personLabel,
                  t.label AS productLabel,
                  c.label AS categoryLabel,
                  p.score AS personScore,
                  avg(t.score) AS avgTargetScore,
                  sum(r1.weight) AS totalWeight,
                  count(r1) AS relationshipCount
           ORDER BY personScore DESC`, { executionPlan: { format: 'text' } }
        );
        const plan = result.executionPlan;
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },
  ];
}