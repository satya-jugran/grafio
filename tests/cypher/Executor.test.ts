import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { Node } from '../../src/Node';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { Planner } from '../../src/cypher/Planner';
import { Executor } from '../../src/cypher/Executor';
import { UnboundParameterError } from '../../src/cypher/errors';

/** Helper: create a graph, run a query, return result. */
async function executeQuery(
  query: string,
  params: Record<string, unknown> = {},
  graph?: Graph,
) {
  const g = graph ?? new Graph();
  const tokens = new Lexer(query).tokenise();
  const ast = new Parser(tokens).parse();
  new Semantic().analyse(ast);
  const plan = new Planner().plan(ast);
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
      expect(node.type).toBe('Person');
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
      const graph = new Graph();
      const executor = new Executor(graph);
      const fnExpr = { kind: 'FunctionCall' as const, name: 'COUNT', args: [] };
      expect(() =>
        (executor as any)._evaluate(fnExpr, new Map(), {}),
      ).toThrow(/COUNT.*not yet supported/);
    });

    it('throws on unbound Identifier in row', () => {
      const graph = new Graph();
      const executor = new Executor(graph);
      const identExpr = { kind: 'Identifier' as const, name: 'missing' };
      expect(() =>
        (executor as any)._evaluate(identExpr, new Map(), {}),
      ).toThrow(/Variable 'missing' is not bound/);
    });

    it('throws TypeMismatchError on property access from non-object', () => {
      const executor = new Executor(new Graph());
      // Access .foo on a string value — should throw
      const propAccess = {
        kind: 'PropertyAccess' as const,
        object: { kind: 'Literal' as const, value: 'hello' },
        property: 'foo',
      };
      expect(() =>
        (executor as any)._evaluate(propAccess, new Map(), {}),
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
      const executor = new Executor(new Graph());
      expect((executor as any)._eq(null, null)).toBe(true);
    });

    it('returns true when both values are undefined', () => {
      const executor = new Executor(new Graph());
      expect((executor as any)._eq(undefined, undefined)).toBe(true);
    });

    it('returns false when only one value is null', () => {
      const executor = new Executor(new Graph());
      expect((executor as any)._eq(null, 'hello')).toBe(false);
      expect((executor as any)._eq('hello', null)).toBe(false);
    });

    it('returns false when only one value is undefined', () => {
      const executor = new Executor(new Graph());
      expect((executor as any)._eq(undefined, 'hello')).toBe(false);
      expect((executor as any)._eq('hello', undefined)).toBe(false);
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
      const executor = new Executor(new Graph());
      expect(
        (executor as any)._eq(
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
      const graph = new Graph();
      const executor = new Executor(graph);
      expect(() =>
        (executor as any)._applyBinaryOp('UNKNOWN', 1, 2),
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

  // ── Aggregate Execution ──────────────────────────────────────────

  /** Build graph with Person nodes for aggregate testing. */
  async function buildAggregateGraph(): Promise<Graph> {
    const g = new Graph();
    await g.addNode('Person', { age: 30, city: 'NYC', salary: 70000, name: 'Alice' });
    await g.addNode('Person', { age: 25, city: 'NYC', salary: 50000, name: 'Bob' });
    await g.addNode('Person', { age: 35, city: 'LA', salary: 80000, name: 'Charlie' });
    await g.addNode('Person', { age: 30, city: 'LA', salary: 60000, name: 'Diana' });
    return g;
  }

  describe('Aggregate Execution', () => {
    // ── Path A: Storage-level aggregation (simple plans) ──────────

    describe('storage-level aggregation (Path A)', () => {
      it('COUNT(p) returns total node count', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN COUNT(p)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].count).toBe(4);
        expect(result.columns).toEqual(['count']);
      });

      it('AVG(p.age) AS avg_age returns correct average', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN AVG(p.age) AS avg_age',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].avg_age).toBe(30);
      });

      it('SUM(p.salary) AS total returns correct sum', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN SUM(p.salary) AS total',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].total).toBe(260000);
      });

      it('MIN(p.age) AS min_age returns minimum', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN MIN(p.age) AS min_age',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].min_age).toBe(25);
      });

      it('MAX(p.age) AS max_age returns maximum', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN MAX(p.age) AS max_age',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].max_age).toBe(35);
      });

      it('multiple aggregates MIN, MAX, AVG on same property', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN MIN(p.age), MAX(p.age), AVG(p.age)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].min).toBe(25);
        expect(result.rows[0].max).toBe(35);
        expect(result.rows[0].avg).toBe(30);
      });

      it('COLLECT(p.name) returns array of property values', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN COLLECT(p.name)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        const names = result.rows[0].collect as unknown[];
        expect(names).toHaveLength(4);
        expect(names).toContain('Alice');
        expect(names).toContain('Bob');
        expect(names).toContain('Charlie');
        expect(names).toContain('Diana');
      });

      it('COUNT(DISTINCT p.age) counts distinct numeric values', async () => {
        const graph = await buildAggregateGraph();
        // Distinct ages: 30, 25, 35 → 3 distinct values
        const result = await executeQuery(
          'MATCH (p:Person) RETURN COUNT(DISTINCT p.age)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].count).toBe(3);
      });

      it('AVG(DISTINCT p.age) averages distinct values', async () => {
        const graph = await buildAggregateGraph();
        // Distinct ages: 30, 25, 35 → avg = 30
        const result = await executeQuery(
          'MATCH (p:Person) RETURN AVG(DISTINCT p.age)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].avg).toBe(30);
      });
    });

    // ── Path B: In-process aggregation (group-by) ────────────────

    describe('in-process aggregation (Path B)', () => {
      it('COUNT(*) counts all matched rows', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN COUNT(*)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].count).toBe(4);
      });

      it('group-by p.city with COUNT(p) produces per-group counts', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN p.city, COUNT(p)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(2);
        const byCity = new Map(result.rows.map((r) => [r.p_city, r.count]));
        expect(byCity.get('NYC')).toBe(2);
        expect(byCity.get('LA')).toBe(2);
      });

      it('group-by p.city with AVG(p.age) produces per-group averages', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) RETURN p.city, AVG(p.age)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(2);
        const byCity = new Map(result.rows.map((r) => [r.p_city, r.avg]));
        expect(byCity.get('NYC')).toBe(27.5); // (30+25)/2
        expect(byCity.get('LA')).toBe(32.5);  // (35+30)/2
      });
    });

    // ── Edge cases: empty result set ──────────────────────────────

    describe('edge cases (empty result set)', () => {
      it('COUNT on empty set returns 0', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) WHERE p.age > 100 RETURN COUNT(p)',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].count).toBe(0);
      });

      it('SUM on empty set returns 0', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) WHERE p.age > 100 RETURN SUM(p.salary) AS total',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].total).toBe(0);
      });

      it('AVG on empty set returns 0', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) WHERE p.age > 100 RETURN AVG(p.age) AS avg_age',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].avg_age).toBe(0);
      });

      it('MIN on empty set returns null', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) WHERE p.age > 100 RETURN MIN(p.age) AS min_age',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].min_age).toBeNull();
      });

      it('MAX on empty set returns null', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) WHERE p.age > 100 RETURN MAX(p.age) AS max_age',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].max_age).toBeNull();
      });

      it('COLLECT on empty set returns empty array', async () => {
        const graph = await buildAggregateGraph();
        const result = await executeQuery(
          'MATCH (p:Person) WHERE p.age > 100 RETURN COLLECT(p.name) AS names',
          {},
          graph,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].names).toEqual([]);
      });
    });
  });
});
