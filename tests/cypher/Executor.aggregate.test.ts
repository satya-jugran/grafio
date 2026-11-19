import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { Node } from '../../src/Node';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { Planner } from '../../src/cypher/Planner';
import { Executor } from '../../src/cypher/executor/Executor';

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

/** Build graph with Person nodes for aggregate testing. */
async function buildAggregateGraph(): Promise<Graph> {
  const g = new Graph();
  await g.addNode('Person', { age: 30, city: 'NYC', salary: 70000, name: 'Alice' });
  await g.addNode('Person', { age: 25, city: 'NYC', salary: 50000, name: 'Bob' });
  await g.addNode('Person', { age: 35, city: 'LA', salary: 80000, name: 'Charlie' });
  await g.addNode('Person', { age: 30, city: 'LA', salary: 60000, name: 'Diana' });
  return g;
}

describe('Executor – Aggregates', () => {
  // ── Storage-level aggregation (Path A) ────────────────────────────

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

    // Reproduction: MATCH (n) — unlabeled node with aggregate
    it('COUNT(n) with unlabeled node MATCH (n)', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (n) RETURN count(n) AS total',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].total).toBe(4);
    });

    it('COUNT(*) with unlabeled node MATCH (n)', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (n) RETURN count(*) AS total',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].total).toBe(4);
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

    // ── Edge-level COLLECT (storage-level Path A) ─────────────

    it('COLLECT(r) returns all edge objects as array', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH ()-[r:KNOWS]->() RETURN COLLECT(r) AS edges',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      const edges = result.rows[0].edges as unknown[];
      expect(edges.length).toBeGreaterThan(0);
      const first = edges[0] as { type: string; sourceId: string; targetId: string };
      expect(first.type).toBe('KNOWS');
      expect(first.sourceId).toBeDefined();
      expect(first.targetId).toBeDefined();
    });

    it('COLLECT(r.since) returns property values from edges', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH ()-[r:KNOWS]->() RETURN COLLECT(r.since) AS years',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      const years = result.rows[0].years as number[];
      expect(years.length).toBeGreaterThan(0);
      expect(years.every((y) => typeof y === 'number')).toBe(true);
    });

    it('COLLECT(DISTINCT r.since) returns distinct property values', async () => {
      const graph = await buildSocialGraph();
      const result = await executeQuery(
        'MATCH ()-[r:KNOWS]->() RETURN COLLECT(DISTINCT r.since) AS years',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      const years = result.rows[0].years as number[];
      expect(years.length).toBeGreaterThan(0);
      const unique = [...new Set(years)];
      expect(years.length).toBe(unique.length);
    });
  });

  // ── In-process aggregation (Path B) ───────────────────────────────

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

  // ── Edge cases: empty result set ──────────────────────────────────

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



  // ── ORDER BY with aggregates execution ────────────────────────────

  describe('ORDER BY with aggregates execution', () => {
    it('sorts by aggregate alias DESC', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY cnt DESC',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].cnt).toBe(2);
      expect(result.rows[1].cnt).toBe(2);
    });

    it('sorts by group-by key', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY p_city ASC',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].p_city).toBe('LA');
      expect(result.rows[1].p_city).toBe('NYC');
    });

    it('sorts by raw aggregate ORDER BY COUNT(*) DESC', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY COUNT(*) DESC',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].cnt).toBe(2);
      expect(result.rows[1].cnt).toBe(2);
    });
  });

  // ── Aggregate expression execution ────────────────────────────────

  describe('Aggregate expression execution', () => {
    it('computes COUNT(*) + 1 AS result', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN COUNT(*) + 1 AS result',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].result).toBe(5); // 4 persons + 1
    });

    it('computes SUM(p.age) / COUNT(*) AS average', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN SUM(p.age) / COUNT(*) AS average',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      // Ages: 30, 25, 35, 30 → sum=120, count=4, avg=30
      expect(result.rows[0].average).toBe(30);
    });
  });

  // ── RETURN DISTINCT execution ─────────────────────────────────────

  describe('RETURN DISTINCT execution', () => {
    it('deduplicates duplicate rows', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN DISTINCT p.city',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      const cities = result.rows.map((r) => r.p_city);
      expect(cities).toContain('NYC');
      expect(cities).toContain('LA');
    });

    it('returns all rows when no duplicates exist', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN DISTINCT p.name',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(4);
    });

    it('distinguishes scalar types, map literals, and UNION values during DISTINCT and GROUP BY', () => {
      const g = new Graph();
      g.querySync("CREATE (:Item { name: 'a' })");

      const distinctMix = g.querySync("UNWIND [1, '1', true, 'true'] AS v RETURN DISTINCT v");
      expect(distinctMix.rows.map((r) => r.v)).toEqual([1, '1', true, 'true']);

      const distinctMaps = g.querySync('UNWIND [{ a: 1 }, { a: 2 }, { a: 1 }] AS m RETURN DISTINCT m');
      expect(distinctMaps.rows.map((r) => r.m)).toEqual([{ a: 1 }, { a: 2 }]);

      const nodeVsStr = g.querySync("UNWIND ['node1'] AS x MATCH (n:Item) WITH DISTINCT x, n RETURN x");
      expect(nodeVsStr.rows).toHaveLength(1);

      const groupByTypes = g.querySync(
        "UNWIND [1, '1', { a: 1 }, { a: 2 }] AS k RETURN k, count(*) AS cnt",
      );
      expect(groupByTypes.rows).toHaveLength(4);

      const unionRes = g.querySync(
        "MATCH (n:Item) RETURN '1' AS val UNION RETURN 1 AS val",
      );
      expect(unionRes.rows.map((r) => r.val)).toEqual(['1', 1]);
    });

    it('deduplicates storage-level edge COLLECT(DISTINCT ...) symmetrically on sync kernel', async () => {
      const g = new Graph();
      const a = await g.addNode('N', { name: 'A' });
      const b = await g.addNode('N', { name: 'B' });
      await g.addEdge(a.id, b.id, 'LINKS', { tag: 1 });
      await g.addEdge(a.id, b.id, 'LINKS', { tag: '1' });
      await g.addEdge(a.id, b.id, 'LINKS', { tag: 1 });

      const tagRes = g.querySync('MATCH ()-[r:LINKS]->() RETURN collect(DISTINCT r.tag) AS tags');
      expect(tagRes.rows[0].tags).toEqual([1, '1']);

      const edgeRes = g.querySync('MATCH ()-[r:LINKS]->() RETURN collect(DISTINCT r) AS edges');
      expect(edgeRes.rows[0].edges).toHaveLength(3);
    });
  });

  describe('Fused columnar and computed-expression aggregations', () => {
    it('runs fused un-filtered NodeScan/EdgeScan -> Aggregate paths including DISTINCT and empty sets', async () => {
      const graph = new Graph();
      const [n1, n2, n3] = await graph.addNodes([
        { labels: 'Item', properties: { price: 10, tag: 'a' } },
        { labels: 'Item', properties: { price: 10, tag: 'a' } },
        { labels: 'Item', properties: { price: 30, tag: 'b' } },
      ]);
      await graph.addNode('Item', { tag: 'no-price' });
      await graph.addEdge(n1.id, n2.id, 'LINK', { w: 5 });
      await graph.addEdge(n2.id, n3.id, 'LINK', { w: 5 });
      await graph.addEdge(n1.id, n3.id, 'LINK', { w: 15 });

      const syncRes = graph.querySync(`
        MATCH (n:Item)
        RETURN count(n) AS cAll,
               count(DISTINCT n.price) AS cDist,
               sum(n.price) AS s,
               sum(DISTINCT n.price) AS sDist,
               avg(n.price) AS a,
               avg(DISTINCT n.price) AS aDist,
               min(n.price) AS mn,
               min(DISTINCT n.price) AS mnDist,
               max(n.price) AS mx,
               max(DISTINCT n.price) AS mxDist,
               collect(n.tag) AS tags,
               collect(DISTINCT n.tag) AS tagsDist
      `);
      expect(syncRes.rows[0].cAll).toBe(4);
      expect(syncRes.rows[0].cDist).toBe(2);
      expect(syncRes.rows[0].s).toBe(50);
      expect(syncRes.rows[0].sDist).toBe(40);
      expect(syncRes.rows[0].aDist).toBe(20);
      expect(syncRes.rows[0].mn).toBe(10);
      expect(syncRes.rows[0].mnDist).toBe(10);
      expect(syncRes.rows[0].mx).toBe(30);
      expect(syncRes.rows[0].mxDist).toBe(30);
      expect((syncRes.rows[0].tags as string[]).length).toBe(4);
      expect((syncRes.rows[0].tagsDist as string[]).sort()).toEqual(['a', 'b', 'no-price']);

      const asyncRes = await graph.query(`
        MATCH (n:Item)
        RETURN count(DISTINCT n.price) AS dc, sum(DISTINCT n.price) AS sd, collect(DISTINCT n.tag) AS td
      `);
      expect(asyncRes.rows[0].dc).toBe(2);
      expect(asyncRes.rows[0].sd).toBe(40);

      const emptyRes = graph.querySync(`
        MATCH (e:NonExistent)
        RETURN count(e) AS c, sum(e.x) AS s, avg(e.x) AS a, min(e.x) AS mn, max(e.x) AS mx, collect(e.x) AS col
      `);
      expect(emptyRes.rows).toEqual([{ c: 0, s: 0, a: 0, mn: null, mx: null, col: [] }]);

      // Profiled fused NodeScan -> FilterStep -> AggregateStep (text) and unfiltered fused (json)
      const fusedFilterProf = graph.querySync(
        'MATCH (n:Item) WHERE n.price + 1 > 10 RETURN count(n) AS c, sum(n.price) AS s',
        {},
        { executionPlan: { format: 'text' } },
      );
      expect(fusedFilterProf.rows).toEqual([{ c: 3, s: 50 }]);
      expect(fusedFilterProf.executionPlan).toContain('AggregateStep');

      const fusedJsonProf = graph.querySync(
        'MATCH (n:Item) RETURN count(n) AS c',
        {},
        { executionPlan: { format: 'json' } },
      );
      expect(fusedJsonProf.rows).toEqual([{ c: 4 }]);
      expect(fusedJsonProf.executionPlan).toContain('AggregateStep');

      // Sync IndexStepExecutor DDL (CREATE INDEX / SHOW INDEXES / DROP INDEX)
      const ciRes = graph.querySync('CREATE INDEX idx_sync_item FOR (n:Item) ON (n.tag)');
      expect(ciRes.summary.indexesCreated).toBe(1);
      const showIdxRes = graph.querySync('SHOW INDEXES');
      expect(showIdxRes.rows.length).toBeGreaterThanOrEqual(1);
      const diRes = graph.querySync('DROP INDEX idx_sync_item');
      expect(diRes.summary.indexesDeleted).toBe(1);

      const edgeRes = graph.querySync(`
        MATCH ()-[r:LINK]->()
        RETURN count(r) AS rc,
               count(DISTINCT r.w) AS rcd,
               sum(r.w) AS rs,
               sum(DISTINCT r.w) AS rsd,
               avg(r.w) AS ra,
               min(r.w) AS rmin,
               max(r.w) AS rmax,
               collect(DISTINCT r.w) AS rcol
      `);
      expect(edgeRes.rows[0].rc).toBe(3);
      expect(edgeRes.rows[0].rcd).toBe(2);
      expect(edgeRes.rows[0].rs).toBe(25);
      expect(edgeRes.rows[0].rsd).toBe(20);
      expect(edgeRes.rows[0].rmin).toBe(5);
      expect(edgeRes.rows[0].rmax).toBe(15);
      expect((edgeRes.rows[0].rcol as number[]).sort((x, y) => x - y)).toEqual([5, 15]);
    });

    it('evaluates computed-expression and parameterized fused aggregates', async () => {
      const aggGraph = new Graph();
      await aggGraph.addNodes([
        { labels: 'Item', properties: { price: 10 } },
        { labels: 'Item', properties: { price: 10 } },
        { labels: 'Item', properties: { price: 30 } },
      ]);
      const compAgg = aggGraph.querySync(`
        MATCH (n:Item)
        WHERE n.price > 0
        RETURN count(DISTINCT n.price + 1) AS dc,
               sum(n.price + 1) AS s,
               avg(n.price + 1) AS av,
               min(n.price + 1) AS mn,
               max(n.price + 1) AS mx,
               collect(DISTINCT n.price + 1) AS col
      `);
      expect(compAgg.rows[0].dc).toBe(2);
      expect(compAgg.rows[0].s).toBe(53);
      expect(compAgg.rows[0].mn).toBe(11);
      expect(compAgg.rows[0].mx).toBe(31);
      expect((compAgg.rows[0].col as number[]).sort((x, y) => x - y)).toEqual([11, 31]);

      const paramFused = aggGraph.querySync(
        'MATCH (n:Item) WHERE n.price = $p RETURN count(n) AS c, min(n.price) AS mn, max(n.price) AS mx, avg(n.price) AS av, collect(DISTINCT n.price) AS col',
        { p: 10 },
      );
      expect(paramFused.rows).toEqual([{ c: 2, mn: 10, mx: 10, av: 10, col: [10] }]);
      expect(() =>
        aggGraph.querySync('MATCH (n:Item) WHERE n.price = $missing RETURN count(n) AS c'),
      ).toThrow();
    });
  });
});
