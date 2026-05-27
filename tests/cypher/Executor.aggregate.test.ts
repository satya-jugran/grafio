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

describe('Executor – Aggregates & HAVING', () => {
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

  // ── HAVING execution ──────────────────────────────────────────────

  describe('HAVING execution', () => {
    it('filters grouped rows with HAVING cnt > 1', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt HAVING cnt > 1',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      const byCity = new Map(result.rows.map((r) => [r.p_city, r.cnt]));
      expect(byCity.get('NYC')).toBe(2);
      expect(byCity.get('LA')).toBe(2);
    });

    it('returns empty result when HAVING matches no groups', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt HAVING cnt > 10',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(0);
    });

    it('filters non-aggregate query with HAVING', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        "MATCH (p:Person) RETURN p.name HAVING p.name = 'Alice'",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].p_name).toBe('Alice');
    });

    it('filters groups with raw aggregate HAVING COUNT(*) > 1', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt HAVING COUNT(*) > 1',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(2);
      const byCity = new Map(result.rows.map((r) => [r.p_city, r.cnt]));
      expect(byCity.get('NYC')).toBe(2);
      expect(byCity.get('LA')).toBe(2);
    });

    it('filters groups with raw aggregate HAVING COUNT(*) > 10', async () => {
      const graph = await buildAggregateGraph();
      const result = await executeQuery(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt HAVING COUNT(*) > 10',
        {},
        graph,
      );
      expect(result.rows).toHaveLength(0);
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
  });
});
