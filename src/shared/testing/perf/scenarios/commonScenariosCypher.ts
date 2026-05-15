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
  factor: number
): BenchmarkScenario[] {
  const isLarge = nodeCount >= (50_000 * factor);

  return [
    // ── Read: getNode by id ────────────────────────────────────────────────
    {
      category: 'Read',
      name: 'Get Node by id (parameterised)',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph);
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
        const engine = new CypherEngine(meta.graph);
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
        const engine = new CypherEngine(meta.graph);
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        return engine.execute('MATCH (n:Person) RETURN count(n) AS total');
      },
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Read: Get Nodes with filter.properties ─────────────────────────────────
    {
      category: 'Read',
      name: 'Get nodes by property',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph);
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        return engine.execute('MATCH (n) WHERE n.active = true RETURN count(n) AS total');
      },
      iterations: calcIterations(20, factor, isLarge, 50_000),
    },

    // ── Read: Get Nodes (full scan) ─────────────────────────────────────────
    {
      category: 'Read',
      name: 'Get all Nodes',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph);
        (meta as GraphMeta & { _engine?: CypherEngine })._engine = engine;
      },
      run: async (graph: any, meta: any) => {
        const engine = (meta as GraphMeta & { _engine?: CypherEngine })._engine!;
        return engine.execute('MATCH (n) RETURN count(n) AS total');
      },
      iterations: calcIterations(40, factor, isLarge, 50_000),
    },

    // ── Navigation: getEdgesFrom ────────────────────────────────────────────
    {
      category: 'Navigation',
      name: 'Get Edges from node by id',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph);
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
        const engine = new CypherEngine(meta.graph);
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
        const engine = new CypherEngine(meta.graph);
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
        const engine = new CypherEngine(meta.graph);
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
      iterations: calcIterations(100, factor, isLarge, 50_000),
    },

    // ── Traversal: Traversal with type filters ──────────────────────────────────
    {
      category: 'Traversal',
      name: 'Traversal with types',
      setup: (meta: GraphMeta) => {
        const engine = new CypherEngine(meta.graph);
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
        const engine = new CypherEngine(meta.graph);
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
      iterations: calcIterations(10, factor, isLarge, 50_000),
    },
  ];
}
