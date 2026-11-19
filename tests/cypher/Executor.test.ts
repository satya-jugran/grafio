import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { Node } from '../../src/Node';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { Planner } from '../../src/cypher/Planner';
import { Executor } from '../../src/cypher/executor/Executor';
import {
  ExpressionEvaluator,
  serializeCypherKey,
  serializeSlotRowKey,
} from '../../src/cypher/executor/ExpressionEvaluator';
import { UNBOUND } from '../../src/cypher/plan/CompiledPlanMeta';
import { RingQueue, Uint32RingQueue } from '../../src/cypher/executor/RingQueue';
import { InMemoryStorageProvider } from '../../src/storage/InMemoryStorageProvider';
import { CachedStorageProvider } from '../../src/storage/CachedStorageProvider';
import { CacheManager } from '../../src/storage/cache/CacheManager';
import type { CacheConfig } from '../../src/storage/cache/CacheConfig';
import { CypherRuntimeError, UnboundParameterError } from '../../src/cypher/errors';
import { Edge } from '../../src';

function createAsyncCachedGraph() {
  const cacheConfig: CacheConfig = {
    maxNodesCount: 200,
    maxEdgesCount: 400,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  };
  const cacheManager = new CacheManager(cacheConfig);
  const cached = new CachedStorageProvider(new InMemoryStorageProvider(), 'exec-async-test', cacheManager, cacheConfig);
  return { graph: new Graph(cached), cacheManager };
}

/** Helper: create a graph, run a query, return result. */
async function executeQuery(
  query: string,
  params: Record<string, unknown> = {},
  graph?: Graph,
) {
  const g = graph ?? new Graph();
  const tokens = new Lexer(query).tokenise();
  const ast = new Parser(tokens).parse();
  new Semantic().analyseStatement(ast);
  const plan = await new Planner().plan(ast);
  return new Executor(g).execute(plan, params);
}

/** Helper: build a simple social graph. */
async function buildSocialGraph(): Promise<Graph> {
  const g = new Graph();
  const alice = await g.addNode('Person', { name: 'Alice', age: 30 });
  const bob = await g.addNode('Person', { name: 'Bob', age: 25 });
  const charlie = await g.addNode('Person', { name: 'Charlie', age: 35 });
  const acme = await g.addNode('Company', { name: 'Acme' });

  await g.addEdge(alice.id, bob.id, 'KNOWS', { since: 2019 });
  await g.addEdge(bob.id, charlie.id, 'KNOWS', { since: 2020 });
  await g.addEdge(alice.id, acme.id, 'WORKS_AT', {});

  return g;
}

/** Helper: build a chain graph for multi-hop traversal tests.
 *  A → B → C → D  (all KNOWS edges, all Person type)
 */
async function buildChainGraph(): Promise<Graph> {
  const g = new Graph();
  const a = await g.addNode('Person', { name: 'A', step: 0 });
  const b = await g.addNode('Person', { name: 'B', step: 1 });
  const c = await g.addNode('Person', { name: 'C', step: 2 });
  const d = await g.addNode('Person', { name: 'D', step: 3 });

  await g.addEdge(a.id, b.id, 'KNOWS', {});
  await g.addEdge(b.id, c.id, 'KNOWS', {});
  await g.addEdge(c.id, d.id, 'KNOWS', {});

  return g;
}

/** Helper: build a complex multi-path graph for traversal.
 *
 *         A
 *        ↙ ↘
 *       B   C
 *       ↓ ↘ ↓
 *       D   E
 *        ↘ ↙
 *         F
 *
 * All edges are KNOWS, all nodes are Person.
 *
 * Key: E is a middle node reachable via TWO different 2-hop paths:
 *   A → C → E  and  A → B → E
 *
 * F is reachable via THREE different 3-hop paths:
 *   A → B → D → F
 *   A → C → E → F
 *   A → B → E → F
 *
 * This stresses the visited-Map: if E were pruned after the first visit,
 * the path A→B→E→F would be lost.
 */
async function buildDiamondGraph(): Promise<Graph> {
  const g = new Graph();
  const a = await g.addNode('Person', { name: 'A' });
  const b = await g.addNode('Person', { name: 'B' });
  const c = await g.addNode('Person', { name: 'C' });
  const d = await g.addNode('Person', { name: 'D' });
  const e = await g.addNode('Person', { name: 'E' });
  const f = await g.addNode('Person', { name: 'F' });

  await g.addEdge(a.id, b.id, 'KNOWS', {});
  await g.addEdge(a.id, c.id, 'KNOWS', {});
  await g.addEdge(b.id, d.id, 'KNOWS', {});
  await g.addEdge(b.id, e.id, 'KNOWS', {});  // B → E (second path to E)
  await g.addEdge(c.id, e.id, 'KNOWS', {});
  await g.addEdge(d.id, f.id, 'KNOWS', {});
  await g.addEdge(e.id, f.id, 'KNOWS', {});

  return g;
}

describe('Executor', () => {
  // ── Node scan ──────────────────────────────────────────────────
  describe('node scan', () => {
    it('returns all nodes with given label', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery('MATCH (p:Person) RETURN p', {}, graph);

      expect(result.rows).toHaveLength(3);
      expect(result.columns).toEqual(['p']);
    });

    it('returns nodes as Node instances', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery('MATCH (p:Person) RETURN p', {}, graph);

      const node = result.rows[0].p as unknown as Node;
      expect(node).toBeInstanceOf(Node);
      expect(node.labels).toEqual(['Person']);
    });
  });

  // ── Edge expansion ─────────────────────────────────────────────
  describe('edge expansion', () => {
    it('follows single-hop directed edge', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (a:Person)-[:KNOWS]->(b:Person) WHERE a.name = $name RETURN b.name AS friend',
        { name: 'Alice' },
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].friend).toBe('Bob');
    });

    it('matches multi-type edge pattern [:KNOWS|WORKS_AT]', async () => {
      const graph = await buildSocialGraph();
      // Alice has KNOWS→Bob and WORKS_AT→Acme
      const result = await executeQuery(
        "MATCH (a:Person)-[:KNOWS|WORKS_AT]->(b) WHERE a.name = 'Alice' RETURN b.name AS name ORDER BY b.name ASC",
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toEqual(['Acme', 'Bob']);
    });

    it('builds full named path for two-edge pattern', async () => {
      const graph = await buildSocialGraph();
      // Alice → Bob → Charlie (both KNOWS edges)
      const result = await executeQuery(
        "MATCH p = (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person) WHERE a.name = 'Alice' RETURN p",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      const path = result.rows[0].p as Array<Record<string, unknown>>;
      // Path should have 5 elements: [Alice, edge(Alice→Bob), Bob, edge(Bob→Charlie), Charlie]
      expect(path).toHaveLength(5);
      // Verify node interleaving (name is stored in properties)
      expect((path[0] as any).properties.name).toBe('Alice');
      expect((path[2] as any).properties.name).toBe('Bob');
      expect((path[4] as any).properties.name).toBe('Charlie');
      // Verify edges are between correct nodes
      const edge1 = path[1] as { sourceId: string; targetId: string };
      const edge2 = path[3] as { sourceId: string; targetId: string };
      expect(edge1.sourceId).toBe((path[0] as { id: string }).id);
      expect(edge1.targetId).toBe((path[2] as { id: string }).id);
      expect(edge2.sourceId).toBe((path[2] as { id: string }).id);
      expect(edge2.targetId).toBe((path[4] as { id: string }).id);
    });
  });

  // ── Multi-hop (variable-length) expansion ──────────────────────
  describe('multi-hop expansion', () => {
    it('follows [*1..2] from Alice through Bob to Charlie', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (a:Person)-[*1..2]->(b:Person) WHERE a.name = 'Alice' RETURN b.name AS name ORDER BY b.name ASC",
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      // Alice → Bob (1 hop), Alice → Bob → Charlie (2 hops)
      expect(names).toContain('Bob');
      expect(names).toContain('Charlie');
    });

    it('follow [rel*1..2] with edge variable', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (a:Person)-[rel*1..2]->(b:Person) WHERE a.name = 'Alice' RETURN b.name AS name, rel.since as since ORDER BY b.name ASC",
        {},
        graph,
      );
      expect(result.rows.filter((r) => r.name === 'Bob')[0].since).toBe(2019);
      expect(result.rows.filter((r) => r.name === 'Charlie')[0].since).toBe(2020);
    });

    it('follows [*2] exact 2-hop', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (a:Person)-[*2]->(b:Person) WHERE a.name = 'Alice' RETURN b.name AS name",
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      // Only 2 hops: Alice → Bob → Charlie
      expect(names).toEqual(['Charlie']);
    });

    it('traverses 3-hop chain [*1..3]', async () => {
      const graph = await buildChainGraph();
      const result = await executeQuery(
        "MATCH (a:Person)-[*1..3]->(b:Person) WHERE a.name = 'A' RETURN b.name AS name ORDER BY b.name ASC",
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      // A → B, A → B → C, A → B → C → D
      expect(names).toEqual(['B', 'C', 'D']);
    });

    it('traverses exact 2-hop in chain', async () => {
      const graph = await buildChainGraph();
      const result = await executeQuery(
        "MATCH (a:Person)-[*2]->(b:Person) WHERE a.name = 'A' RETURN b.name AS name",
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toEqual(['C']);
    });

    it('traverses [*2..3] range in chain', async () => {
      const graph = await buildChainGraph();
      const result = await executeQuery(
        "MATCH (a:Person)-[*2..3]->(b:Person) WHERE a.name = 'A' RETURN b.name AS name ORDER BY b.name ASC",
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      // Only 2 and 3 hops
      expect(names).toEqual(['C', 'D']);
    });

    it('uses DFS with LIMIT to find first results deep in chain', async () => {
      const graph = await buildChainGraph();
      const result = await executeQuery(
        "MATCH (a:Person)-[*1..3]->(b:Person) WHERE a.name = 'A' RETURN b.name AS name LIMIT 2",
        {},
        graph,
      );
      // DFS should still find valid results; the strategy is DFS with LIMIT
      expect(result.rows).toHaveLength(2);
      const names = result.rows.map((r) => r.name);
      // Both BFS and DFS should contain B and C (DFS goes deep first, so may find D before C)
      expect(names).toHaveLength(2);
    });

    it('finds target via multiple paths in complex multi-path graph', async () => {
      const graph = await buildDiamondGraph();
      // F is reachable via THREE distinct 3-hop paths:
      //   A → B → D → F
      //   A → C → E → F
      //   A → B → E → F  (this path would be lost if E were pruned after first visit)
      const result = await executeQuery(
        "MATCH (a:Person)-[*1..3]->(b:Person) WHERE a.name = 'A' AND b.name = 'F' RETURN b.name AS name",
        {},
        graph,
      );
      // F should appear 3 times — once per unique path
      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) {
        expect(row.name).toBe('F');
      }
    });

    it('traverses intermediate nodes whose labels differ from target label across sync, tx-sync, and async providers', async () => {
      const syncGraph = new Graph();
      const { graph: asyncGraph, cacheManager } = createAsyncCachedGraph();

      for (const g of [syncGraph, asyncGraph]) {
        const a = await g.addNode('Person', { name: 'Alice' });
        const p = await g.addNode('Post', { title: 'Hello' });
        const b = await g.addNode('Person', { name: 'Bob' });
        await g.addEdge(a.id, p.id, 'WROTE');
        await g.addEdge(p.id, b.id, 'MENTIONS');
      }

      expect(
        syncGraph.querySync("MATCH (a:Person)-[*2]->(b:Person) WHERE a.name = 'Alice' RETURN b.name AS name").rows,
      ).toEqual([{ name: 'Bob' }]);

      const tx = syncGraph.createTransaction();
      await tx.begin();
      expect(
        syncGraph.querySync("MATCH (a:Person)-[*2]->(b:Person) WHERE a.name = 'Alice' RETURN b.name AS name", {
          transaction: tx,
        }).rows,
      ).toEqual([{ name: 'Bob' }]);
      await tx.rollback();

      expect(
        (await asyncGraph.query("MATCH (a:Person)-[*2]->(b:Person) WHERE a.name = 'Alice' RETURN b.name AS name")).rows,
      ).toEqual([{ name: 'Bob' }]);
      await cacheManager.invalidateAll();
    });

    it('finds exact-hop paths on shared-node DAGs without premature shortest-hop pruning', async () => {
      const syncGraph = new Graph();
      const { graph: asyncGraph, cacheManager } = createAsyncCachedGraph();

      for (const g of [syncGraph, asyncGraph]) {
        const a = await g.addNode('Item', { name: 'a' });
        const b = await g.addNode('Item', { name: 'b' });
        const x = await g.addNode('Item', { name: 'x' });
        const d = await g.addNode('Item', { name: 'd' });
        await g.addEdge(a.id, x.id, 'NEXT');
        await g.addEdge(a.id, b.id, 'NEXT');
        await g.addEdge(b.id, x.id, 'NEXT');
        await g.addEdge(x.id, d.id, 'NEXT');
      }

      const q = "MATCH (a:Item)-[*3..3]->(d:Item) WHERE a.name = 'a' RETURN d.name AS name";
      const qLimit = `${q} LIMIT 1`;

      expect(syncGraph.querySync(q).rows).toEqual([{ name: 'd' }]);
      expect(syncGraph.querySync(qLimit).rows).toEqual([{ name: 'd' }]);

      const tx = syncGraph.createTransaction();
      await tx.begin();
      expect(syncGraph.querySync(q, { transaction: tx }).rows).toEqual([{ name: 'd' }]);
      expect(syncGraph.querySync(qLimit, { transaction: tx }).rows).toEqual([{ name: 'd' }]);
      await tx.rollback();

      expect((await asyncGraph.query(q)).rows).toEqual([{ name: 'd' }]);
      expect((await asyncGraph.query(qLimit)).rows).toEqual([{ name: 'd' }]);
      await cacheManager.invalidateAll();
    });

    it('terminates on cyclic graphs using per-path relationship uniqueness', async () => {
      const g = new Graph();
      const a = await g.addNode('N', { name: 'a' });
      const b = await g.addNode('N', { name: 'b' });
      const c = await g.addNode('N', { name: 'c' });
      await g.addEdge(a.id, b.id, 'E');
      await g.addEdge(b.id, a.id, 'E');
      await g.addEdge(b.id, c.id, 'E');

      const res = g.querySync("MATCH (a:N {name: 'a'})-[*1..4]->(t:N) RETURN t.name AS name");
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows.map((r) => r.name)).toContain('c');
    });
  });

  // ── WHERE filtering ────────────────────────────────────────────
  describe('WHERE filtering', () => {
    it('filters by equality', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) WHERE p.name = $name RETURN p.age AS age',
        { name: 'Alice' },
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].age).toBe(30);
    });

    it('filters by comparison', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) WHERE p.age > 25 RETURN p.name AS name',
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Charlie');
    });

    it('filters with AND', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name = 'Alice' AND p.age = 30 RETURN p",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('filters with OR', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name = 'Alice' OR p.name = 'Bob' RETURN p.name AS name",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
    });

    it('filters with IS NOT NULL', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) WHERE p.name IS NOT NULL RETURN p.name AS name',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(3);
    });

    it('filters by node inline property', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person {name: 'Alice'}) RETURN p.age AS age",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].age).toBe(30);
    });

    it('filters by edge inline property', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (a:Person)-[:KNOWS {since: 2019}]->(b:Person) RETURN b.name AS friend',
        {},
        graph,
      );
      // Only Alice→Bob has since: 2019
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].friend).toBe('Bob');
    });

    it('filters anonymous node with inline properties', async () => {
      const graph = await buildSocialGraph();
      // Anonymous node (:Person {name: 'Alice'}) — no variable, uses synthetic
      const result = await executeQuery(
        "MATCH (:Person {name: 'Alice'}) RETURN 1 AS found",
        {},
        graph,
      );
      // Should find exactly 1 Alice
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].found).toBe(1);
    });
  });

  // ── RETURN projection ──────────────────────────────────────────
  describe('RETURN projection', () => {
    it('returns property values', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name = 'Alice' RETURN p.name AS name, p.age AS age",
        {},
        graph,
      );
      expect(result.columns).toEqual(['name', 'age']);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[0].age).toBe(30);
    });

    it('deduplicates with RETURN DISTINCT', async () => {
      const graph = await buildChainGraph();
      // A → B → C → D; scanning all Person nodes and expanding edges produces
      // duplicates (same target reached via different paths)
      const result = await executeQuery(
        'MATCH (a:Person)-[*1..3]->(b:Person) WHERE a.name = $name RETURN DISTINCT b.name AS name ORDER BY b.name ASC',
        { name: 'A' },
        graph,
      );
      const names = result.rows.map((r) => r.name);
      // B, C, D — each appears exactly once despite multi-hop duplicates
      expect(names).toEqual(['B', 'C', 'D']);
    });
  });

  // ── ORDER BY ───────────────────────────────────────────────────
  describe('ORDER BY', () => {
    it('sorts ascending', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.name AS name ORDER BY p.name ASC',
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('sorts descending', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.name AS name ORDER BY p.name DESC',
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toEqual(['Charlie', 'Bob', 'Alice']);
    });
  });

  // ── SKIP / LIMIT ───────────────────────────────────────────────
  describe('SKIP / LIMIT', () => {
    it('applies SKIP', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.name AS name ORDER BY p.name ASC SKIP 1',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].name).toBe('Bob');
    });

    it('applies LIMIT', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.name AS name ORDER BY p.name ASC LIMIT 2',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
    });

    it('supports parameterized LIMIT ($limit)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.name AS name ORDER BY p.name ASC LIMIT $limit',
        { limit: 1 },
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
    });
  });

  // ── WHERE filtering ────────────────────────────────────────────
  describe('WHERE filtering', () => {
    it('filters with NOT IN', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name NOT IN ['Alice', 'Bob'] RETURN p.name AS name ORDER BY p.name ASC",
        {},
        graph,
      );
      // Only Charlie is not in the list
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Charlie');
    });

    
  });

  // ── Parameters ─────────────────────────────────────────────────
  describe('parameters', () => {
    it('throws on unbound parameter', async () => {
      const graph = await buildSocialGraph();
      await expect(
        executeQuery('MATCH (p:Person) WHERE p.name = $name RETURN p', {}, graph),
      ).rejects.toThrow(UnboundParameterError);
    });

    it('resolves parameters correctly', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) WHERE p.name = $name RETURN p',
        { name: 'Bob' },
        graph,
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  // ── Expression evaluation coverage ─────────────────────────────
  describe('expression evaluation', () => {
    it('evaluates Unary NOT', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE NOT p.name = 'Bob' RETURN p.name AS name ORDER BY p.name ASC",
        {},
        graph,
      );
      // Alice and Charlie are not Bob
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[1].name).toBe('Charlie');
    });

    it('evaluates IN expression', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name IN ['Alice', 'Bob'] RETURN p.name AS name ORDER BY p.name ASC",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[1].name).toBe('Bob');
    });

    it('evaluates List literal (used by IN)', async () => {
      const graph = await buildSocialGraph();
      // IN evaluates the right-hand side as a list
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name IN ['Charlie'] RETURN p.name AS name",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Charlie');
    });

    it('throws on FunctionCall evaluation', () => {
      const fnExpr = { kind: 'FunctionCall' as const, name: 'COUNT', args: [] };
      expect(() =>
        new ExpressionEvaluator().evaluate(fnExpr, new Map(), {}),
      ).toThrow(/COUNT.*not yet supported/);
    });

    it('throws on unbound Identifier in row', () => {
      const identExpr = { kind: 'Identifier' as const, name: 'missing' };
      expect(() =>
        new ExpressionEvaluator().evaluate(identExpr, new Map(), {}),
      ).toThrow(/Variable 'missing' is not bound/);
    });

    it('throws TypeMismatchError on property access from non-object', () => {
      // Access .foo on a string value — should throw
      const propAccess = {
        kind: 'PropertyAccess' as const,
        object: { kind: 'Literal' as const, value: 'hello' },
        property: 'foo',
      };
      expect(() =>
        new ExpressionEvaluator().evaluate(propAccess, new Map(), {}),
      ).toThrow(/Cannot access property 'foo' on string/);
    });

    it('throws TypeMismatchError when IN right-hand side is not a list', async () => {
      const graph = await buildSocialGraph();
      await expect(
        executeQuery(
          "MATCH (p:Person) WHERE p.name IN 'not-a-list' RETURN p.name AS name",
          {},
          graph,
        ),
      ).rejects.toThrow(/Right-hand side of IN must be a list/);
    });
  });

  // ── _eq (equality) helper coverage ─────────────────────────────
  describe('_eq helper', () => {
    it('returns true when both values are null', () => {
      expect(new ExpressionEvaluator().eq(null, null)).toBe(true);
    });

    it('returns true when both values are undefined', () => {
      expect(new ExpressionEvaluator().eq(undefined, undefined)).toBe(true);
    });

    it('returns false when only one value is null', () => {
      expect(new ExpressionEvaluator().eq(null, 'hello')).toBe(false);
      expect(new ExpressionEvaluator().eq('hello', null)).toBe(false);
    });

    it('returns false when only one value is undefined', () => {
      expect(new ExpressionEvaluator().eq(undefined, 'hello')).toBe(false);
      expect(new ExpressionEvaluator().eq('hello', undefined)).toBe(false);
    });

    it('compares objects by id property', async () => {
      const graph = await buildSocialGraph();
      // Cross-product: compare two Person node variables via '='
      const result = await executeQuery(
        "MATCH (a:Person), (b:Person) WHERE a = b RETURN a.name AS name ORDER BY a.name ASC",
        {},
        graph,
      );
      // Each Person equals itself, so 3 rows (Alice=Alice, Bob=Bob, Charlie=Charlie)
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[1].name).toBe('Bob');
      expect(result.rows[2].name).toBe('Charlie');
    });

    it('returns false for objects with different ids', () => {
      expect(
        new ExpressionEvaluator().eq(
          { id: 'n1', properties: {} },
          { id: 'n2', properties: {} },
        ),
      ).toBe(false);
    });
  });

  // ── Binary operator coverage ───────────────────────────────────
  describe('binary operators', () => {
    it('evaluates <> (not equal)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name <> 'Bob' RETURN p.name AS name ORDER BY p.name ASC",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
    });

    it('evaluates =~ (regex match)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name =~ 'A.*' RETURN p.name AS name",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
    });

    it('evaluates list comprehension', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "RETURN [x IN [1, 2, 3] WHERE x > 1 | x * 2] AS list",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].list).toEqual([4, 6]);
    });

    it('evaluates < (less than)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) WHERE p.age < 30 RETURN p.name AS name ORDER BY p.name ASC',
        {},
        graph,
      );
      // Bob (25) only — Alice is 30 (not < 30)
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Bob');
    });

    it('evaluates >= (greater than or equal)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH (p:Person) WHERE p.age >= 30 RETURN p.name AS name ORDER BY p.name ASC',
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Charlie');
    });

    it('evaluates arithmetic addition (+)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name = 'Alice' RETURN p.age + 1 AS nextAge",
        {},
        graph,
      );
      expect(result.rows[0].nextAge).toBe(31);
    });

    it('evaluates arithmetic subtraction (-)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name = 'Alice' RETURN p.age - 5 AS prevAge",
        {},
        graph,
      );
      expect(result.rows[0].prevAge).toBe(25);
    });

    it('evaluates arithmetic multiplication (*)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name = 'Bob' RETURN p.age * 2 AS doubleAge",
        {},
        graph,
      );
      expect(result.rows[0].doubleAge).toBe(50);
    });

    it('evaluates arithmetic division (/)', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        "MATCH (p:Person) WHERE p.name = 'Charlie' RETURN p.age / 2 AS halfAge",
        {},
        graph,
      );
      expect(result.rows[0].halfAge).toBe(17.5);
    });

    it('throws on unknown operator', () => {
      expect(() =>
        new ExpressionEvaluator().applyBinaryOp('UNKNOWN', 1, 2),
      ).toThrow(/Unknown operator: UNKNOWN/);
    });

    it('throws on division by zero', async () => {
      const graph = await buildSocialGraph();
      await expect(
        executeQuery(
          "MATCH (p:Person) WHERE p.name = 'Alice' RETURN p.age / 0 AS bad",
          {},
          graph,
        ),
      ).rejects.toThrow(/Division by zero/);
    });
  });

  // ── Summary ────────────────────────────────────────────────────
  describe('summary', () => {
    it('includes execution time and zero write counters', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery('MATCH (p:Person) RETURN p', {}, graph);

      expect(result.summary.queryTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.summary.nodesCreated).toBe(0);
      expect(result.summary.nodesDeleted).toBe(0);
      expect(result.summary.edgesCreated).toBe(0);
      expect(result.summary.edgesDeleted).toBe(0);
      expect(result.summary.propertiesSet).toBe(0);
    });
  });
  // ── PatternExprStep predicate correctness ──────────────────────
  describe('pattern expression in WHERE predicate', () => {
    async function buildPredicateGraph(): Promise<Graph> {
      // alice -[:KNOWS]-> bob   (alice has an outgoing KNOWS edge)
      // charlie                 (charlie has NO outgoing KNOWS edge)
      const g = new Graph();
      const alice   = await g.addNode('Person', { name: 'Alice' });
      const bob     = await g.addNode('Person', { name: 'Bob' });
      const charlie = await g.addNode('Person', { name: 'Charlie' });
      await g.addEdge(alice.id, bob.id, 'KNOWS', {});
      // charlie intentionally has no KNOWS edge
      void charlie;
      return g;
    }

    it('filters out nodes with zero pattern matches (regression: empty array was truthy)', async () => {
      const graph = await buildPredicateGraph();
      // Only Alice has an outgoing KNOWS edge to a Person; Charlie must be excluded.
      const result = await executeQuery(
        'MATCH (p:Person) WHERE (p)-[:KNOWS]->(:Person) RETURN p.name AS name',
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name as string).sort();
      expect(names).toEqual(['Alice']);
    });

    it('includes nodes that satisfy the pattern predicate', async () => {
      const graph = await buildPredicateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) WHERE (p)-[:KNOWS]->(:Person) RETURN p.name AS name',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
    });

    it('negated pattern expression excludes nodes with matches', async () => {
      const graph = await buildPredicateGraph();
      // NOT (p)-[:KNOWS]->(:Person) should keep Bob and Charlie (no outgoing KNOWS to Person)
      const result = await executeQuery(
        'MATCH (p:Person) WHERE NOT (p)-[:KNOWS]->(:Person) RETURN p.name AS name',
        {},
        graph,
      );
      const names = result.rows.map((r) => r.name as string).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });
  });

  // ── Null propagation, operator type checks, key serialization & UTF-16 order ──
  describe('null propagation, type-safe operators, key serialization, and UTF-16 ordering', () => {
    it('does not coerce null or missing properties to 0 in ordering comparisons across scan pushdown and FilterStep', () => {
      const g = new Graph();
      g.querySync(`
        CREATE (:Person { name: 'NullScore', score: null }),
               (:Person { name: 'MissingScore' }),
               (:Person { name: 'ZeroScore', score: 0 }),
               (:Person { name: 'LowScore', score: 10 })
      `);

      const pushdown = g.querySync('MATCH (n:Person) WHERE n.score < 50 RETURN n.name AS name ORDER BY n.name');
      expect(pushdown.rows).toEqual([{ name: 'LowScore' }, { name: 'ZeroScore' }]);

      const filterLess = g.querySync('MATCH (n:Person) WITH n WHERE n.score < 50 RETURN n.name AS name ORDER BY n.name');
      expect(filterLess.rows).toEqual([{ name: 'LowScore' }, { name: 'ZeroScore' }]);

      const filterLteZero = g.querySync('MATCH (n:Person) WITH n WHERE n.score <= 0 RETURN n.name AS name');
      expect(filterLteZero.rows).toEqual([{ name: 'ZeroScore' }]);

      const filterGteZero = g.querySync('MATCH (n:Person) WITH n WHERE n.score >= 0 RETURN n.name AS name ORDER BY n.name');
      expect(filterGteZero.rows).toEqual([{ name: 'LowScore' }, { name: 'ZeroScore' }]);
    });

    it('propagates null in arithmetic, normalizes -0 to 0, and enforces runtime operand types', () => {
      const g = new Graph();
      g.querySync('CREATE (:Box { val: null, zero: 0 })');

      const res = g.querySync(`
        MATCH (b:Box)
        RETURN b.val + 1 AS addNull,
               'a' + b.val AS strNull,
               b.val * 5 AS mulNull,
               5 / b.val AS divNull,
               5 % b.val AS modNull,
               -b.val AS negNull,
               -b.zero AS negZero
      `);
      expect(res.rows[0].addNull).toBeNull();
      expect(res.rows[0].strNull).toBeNull();
      expect(res.rows[0].mulNull).toBeNull();
      expect(res.rows[0].divNull).toBeNull();
      expect(res.rows[0].modNull).toBeNull();
      expect(res.rows[0].negNull).toBeNull();
      expect(Object.is(res.rows[0].negZero, 0)).toBe(true);

      const ev = new ExpressionEvaluator();
      expect(ev.applyBinaryOp('<', 'a', 'b')).toBe(true);
      expect(ev.applyBinaryOp('<=', 'a', 'a')).toBe(true);
      expect(ev.applyBinaryOp('>', 'b', 'a')).toBe(true);
      expect(ev.applyBinaryOp('>=', 'b', 'b')).toBe(true);
      expect(ev.applyBinaryOp('<', 1, null)).toBeNull();
      expect(ev.applyBinaryOp('<', NaN, 1)).toBeNull();
      expect(ev.applyBinaryOp('<', 'a', 1)).toBeNull();

      expect(ev.applyBinaryOp('+', 1, 'a')).toBe('1a');
      expect(ev.applyBinaryOp('+', 'x', true)).toBe('xtrue');
      expect(ev.applyBinaryOp('+', true, 'x')).toBe('truex');
      expect(ev.applyBinaryOp('+', [1, 2], [3])).toEqual([1, 2, 3]);
      expect(ev.applyBinaryOp('+', [1, 2], 3)).toEqual([1, 2, 3]);
      expect(ev.applyBinaryOp('+', 1, [2, 3])).toEqual([1, 2, 3]);
      expect(() => ev.applyBinaryOp('+', { a: 1 }, 1)).toThrow(/Cannot apply '\+'/);

      expect(ev.applyBinaryOp('-', 10, 3)).toBe(7);
      expect(ev.applyBinaryOp('-', null, 1)).toBeNull();
      expect(ev.applyBinaryOp('*', null, 2)).toBeNull();
      expect(ev.applyBinaryOp('/', null, 2)).toBeNull();
      expect(ev.applyBinaryOp('%', 10, 3)).toBe(1);
      expect(ev.applyBinaryOp('%', null, 3)).toBeNull();
      expect(ev.applyBinaryOp('^', 2, 3)).toBe(8);
      expect(ev.applyBinaryOp('^', null, 3)).toBeNull();

      expect(() => ev.applyBinaryOp('-', 'a', 1)).toThrow();
      expect(() => ev.applyBinaryOp('%', 5, 0)).toThrow(/Modulo by zero/);
      expect(() => ev.applyBinaryOp('*', 'a', 2)).toThrow(/multiply/);
      expect(() => ev.applyBinaryOp('/', 'a', 2)).toThrow(/divide/);
      expect(() => ev.applyBinaryOp('%', 'a', 2)).toThrow(/modulo/);
      expect(() => ev.applyBinaryOp('^', 'a', 2)).toThrow(/exponentiate/);
      expect(() => g.querySync("RETURN -'abc' AS bad")).toThrow(/Unary '-' requires a number/);
    });

    it('serializes distinct values and slot rows without type or UNBOUND collisions', async () => {
      const g = new Graph();
      const n = await g.addNode('N', { k: 1 });
      const e = await g.addEdge(n.id, n.id, 'LOOP');

      expect(serializeCypherKey(UNBOUND)).toBe('u:');
      expect(serializeCypherKey(null)).toBe('0:null');
      expect(serializeCypherKey(undefined)).toBe('0:undef');
      expect(serializeCypherKey(NaN)).toBe('n:NaN');
      expect(serializeCypherKey(-0)).toBe('n:0');
      expect(serializeCypherKey(e)).toMatch(/^edge:/);
      expect(serializeCypherKey([1, n, e])).toMatch(/^a:3:/);
      expect(serializeCypherKey(Symbol('tag'))).toMatch(/^symbol:/);

      expect(serializeSlotRowKey([1, UNBOUND])).not.toBe(serializeSlotRowKey([UNBOUND, 1]));
      expect(serializeSlotRowKey(['a\x001:x', 2])).not.toBe(serializeSlotRowKey(['a', 'x', 2]));
      expect(serializeSlotRowKey([UNBOUND, 1, 'a'])).toContain('1:3:n:1');
      expect(serializeSlotRowKey([UNBOUND, 1, 'a'], [0, 1])).toBe('1:3:n:1');
    });

    it('orders strings deterministically by UTF-16 code units across compare, MIN/MAX, ORDER BY, and Graph.getNodes', async () => {
      const ev = new ExpressionEvaluator();
      expect(ev.compare('Bob', 'alice')).toBeLessThan(0);
      expect(ev.compare(null, 1)).toBe(-1);
      expect(ev.compare(1, null)).toBe(1);
      expect(ev.compare(NaN, NaN)).toBe(0);
      expect(ev.compare(NaN, 1)).toBe(1);
      expect(ev.compare(1, NaN)).toBe(-1);
      expect(ev.compare(1, 2)).toBe(-1);
      expect(ev.compare(2, 1)).toBe(1);
      expect(ev.compare(true, false)).toBe(1);
      expect(ev.compare(false, true)).toBe(-1);
      expect(ev.compare('a', 1)).toBe(1);
      expect(ev.compare([1], [2])).toBe(-1);
      expect(ev.compare([2], [1])).toBe(1);
      expect(ev.compare([1], [1])).toBe(0);

      const g = new Graph();
      await g.addNode('Word', { val: 'alice' });
      await g.addNode('Word', { val: 'Bob' });

      const cypherOrdered = g.querySync('MATCH (w:Word) RETURN w.val AS v ORDER BY w.val ASC');
      const agg = g.querySync("UNWIND ['alice', 'Bob'] AS s RETURN min(s) AS mn, max(s) AS mx");
      const apiOrdered = await g.getNodes({
        filter: { types: ['Word'] },
        orderBy: { field: 'val', direction: 'asc' },
      });

      expect(cypherOrdered.rows.map((r) => r.v)).toEqual(['Bob', 'alice']);
      expect(apiOrdered.map((n) => n.properties.val)).toEqual(['Bob', 'alice']);
      expect(agg.rows[0]).toEqual({ mn: 'Bob', mx: 'alice' });
    });
  });

  describe('RingQueue & Uint32RingQueue', () => {
    it('supports growth, wraparound, and clear()', () => {
      const rq = new RingQueue<number>(4);
      for (let i = 0; i < 40; i++) rq.push(i);
      expect(rq.shift()).toBe(0);
      expect(rq.shift()).toBe(1);
      for (let i = 40; i < 60; i++) rq.push(i);
      expect(rq.length).toBe(58);
      rq.clear();
      expect(rq.length).toBe(0);
      expect(rq.shift()).toBeUndefined();

      const uq = new Uint32RingQueue(16);
      for (let i = 0; i < 80; i++) uq.push(i);
      expect(uq.shift()).toBe(0);
      expect(uq.length).toBe(79);
      uq.clear();
      expect(uq.length).toBe(0);
    });
  });
});
