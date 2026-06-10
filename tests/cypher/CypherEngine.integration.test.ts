/**
 * Integration tests for the Cypher query execution layer.
 *
 * Tests the full pipeline end-to-end: {@link CypherEngine} orchestration
 * of Lexer → Parser → Semantic → Planner → Executor.
 *
 * Scenarios:
 * - Social graph: Person-KNOWS-Person relationships with filtering, sorting, pagination
 * - Education graph: Student-ENROLLED-Course, Course-TAUGHT_BY-Teacher patterns
 *
 * @module tests/cypher/CypherEngine.integration.test
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { CypherEngine, CypherNotSupportedError, CypherRuntimeError, CypherSemanticError, PlanFormat } from '../../src/cypher';
import { Edge, Node } from '../../src';

/** Build a social graph using Cypher CREATE queries. */
async function buildSocialGraph(graph: Graph): Promise<void> {
  const engine = new CypherEngine(graph);

  // Create Person nodes via Cypher
  await engine.execute(
    "CREATE (a:Person {name: 'Alice', age: 28, city: 'NYC', occupation: 'Engineer'})," +
    "(b:Person {name: 'Bob', age: 25, city: 'LA', occupation: 'Designer'})," +
    "(c:Person {name: 'Charlie', age: 32, city: 'Chicago', occupation: 'Manager'})," +
    "(d:Person {name: 'David', age: 29, city: 'Seattle', occupation: 'Developer'})," +
    "(e:Person {name: 'Eve', age: 27, city: 'Boston', occupation: 'Data Scientist'})," +
    "(f:Person {name: 'Frank', age: 35, city: 'Austin', occupation: 'Director'}), " +
    "(g:Person {name: 'Grace', age: 26, city: 'Denver', occupation: 'Designer'})," +
    "(h:Person {name: 'Henry', age: 31, city: 'Portland', occupation: 'Engineer'})"
  );

  // Create KNOWS relationships via Cypher
  await engine.execute("MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) CREATE (a)-[:KNOWS {since: 2018}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'Bob'}), (b:Person {name: 'Alice'}) CREATE (a)-[:KNOWS {since: 2018}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Charlie'}) CREATE (a)-[:KNOWS {since: 2019}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'Bob'}), (b:Person {name: 'David'}) CREATE (a)-[:KNOWS {since: 2020}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'Charlie'}), (b:Person {name: 'Eve'}) CREATE (a)-[:KNOWS {since: 2021}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'David'}), (b:Person {name: 'Frank'}) CREATE (a)-[:KNOWS {since: 2022}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'Eve'}), (b:Person {name: 'Grace'}) CREATE (a)-[:KNOWS {since: 2022}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'Henry'}), (b:Person {name: 'Alice'}) CREATE (a)-[:KNOWS {since: 2023}]->(b)");
  await engine.execute("MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'David'}) CREATE (a)-[:KNOWS {since: 2019}]->(b)");

  // Create indexes via Cypher CREATE INDEX
  await engine.execute('CREATE INDEX name_index FOR (n:Person) ON (n.name)');
  await engine.execute('CREATE INDEX age_index FOR (n:Person) ON (n.age)');
  await engine.execute('CREATE INDEX name_age_index FOR (n:Person) ON (n.name, n.age)');
  await engine.execute('CREATE INDEX city_index FOR (n:Person) ON (n.city)');
  await engine.execute('CREATE INDEX occupation_index FOR (n:Person) ON (n.occupation)');
  await engine.execute('CREATE INDEX since_index FOR ()-[r:KNOWS]-() ON (r.since)');
}

/** Build an education graph using Cypher CREATE queries. */
async function buildEducationGraph(graph: Graph): Promise<void> {
  const engine = new CypherEngine(graph);

  // Create Student nodes via Cypher
  await engine.execute(
    "CREATE (a:Student {name: 'Alice', year: 2024})," +
    "(b:Student {name: 'Bob', year: 2024})," +
    "(c:Student {name: 'Charlie', year: 2023})");

  // Create Course nodes via Cypher
  await engine.execute(
    "CREATE (a:Course {name: 'Graph Theory', credits: 3})," +
    "(b:Course {name: 'Database Systems', credits: 4})," +
    "(c:Course {name: 'Algorithms', credits: 3})"
  );

  // Create Teacher nodes via Cypher
  await engine.execute(
    "CREATE (a:Teacher {name: 'Dr. Smith', department: 'CS'})," +
    "(b:Teacher {name: 'Dr. Jones', department: 'CS'})"
  );

  // Create ENROLLED relationships via Cypher
  await engine.execute("MATCH (s:Student {name: 'Alice'}), (c:Course {name: 'Graph Theory'}) CREATE (s)-[:ENROLLED {semester: 'Fall'}]->(c)");
  await engine.execute("MATCH (s:Student {name: 'Bob'}), (c:Course {name: 'Graph Theory'}) CREATE (s)-[:ENROLLED {semester: 'Fall'}]->(c)");
  await engine.execute("MATCH (s:Student {name: 'Charlie'}), (c:Course {name: 'Graph Theory'}) CREATE (s)-[:ENROLLED {semester: 'Fall'}]->(c)");
  await engine.execute("MATCH (s:Student {name: 'Alice'}), (c:Course {name: 'Database Systems'}) CREATE (s)-[:ENROLLED {semester: 'Spring'}]->(c)");
  await engine.execute("MATCH (s:Student {name: 'Bob'}), (c:Course {name: 'Algorithms'}) CREATE (s)-[:ENROLLED {semester: 'Spring'}]->(c)");
  await engine.execute("MATCH (s:Student {name: 'Charlie'}), (c:Course {name: 'Algorithms'}) CREATE (s)-[:ENROLLED {semester: 'Spring'}]->(c)");

  // Create TEACHES relationships via Cypher
  await engine.execute("MATCH (t:Teacher {name: 'Dr. Smith'}), (c:Course {name: 'Graph Theory'}) CREATE (t)-[:TEACHES]->(c)");
  await engine.execute("MATCH (t:Teacher {name: 'Dr. Jones'}), (c:Course {name: 'Database Systems'}) CREATE (t)-[:TEACHES]->(c)");
  await engine.execute("MATCH (t:Teacher {name: 'Dr. Smith'}), (c:Course {name: 'Algorithms'}) CREATE (t)-[:TEACHES]->(c)");
}

describe('CypherEngine Integration', () => {
  describe('Social Graph', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      await buildSocialGraph(graph);
      engine = new CypherEngine(graph);
    });

    it('scans all Person nodes', async () => {
      const result = await engine.execute('MATCH (p:Person) RETURN p');
      expect(result.rows).toHaveLength(8);
      expect(result.columns).toEqual(['p']);
    });

    it('filters by name equality with parameter', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) WHERE p.name = $name RETURN p.name AS name, p.age AS age',
        { name: 'Alice' },
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[0].age).toBe(28);
    });

    it('filters by comparison (age > threshold)', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) WHERE p.age > 30 RETURN p.name AS name, p.age AS age ORDER BY p.age ASC',
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toContain('Henry');
      expect(names).toContain('Charlie');
      expect(names).toContain('Frank');
    });

    it('filter by parameter correctly', async () => {
      const result = await engine.execute(
        'MATCH (p) WHERE p.age > $age RETURN p.name AS name, p.age AS age ORDER BY p.age ASC',
        { age: 30 },
      );
      const names = result.rows.map((r) => r.name);
      expect(names).toContain('Henry');
      expect(names).toContain('Charlie');
      expect(names).toContain('Frank');
    });

    it('follows single-hop KNOWS relationship', async () => {
      const result = await engine.execute(
        "MATCH (p:Person)-[:KNOWS]->(f:Person) WHERE p.name = 'Alice' RETURN f.name AS friend ORDER BY f.name ASC",
      );
      const friends = result.rows.map((r) => r.friend);
      // Alice has outbound KNOWS to: Bob, Charlie, David (3 friends)
      expect(friends).toEqual(['Bob', 'Charlie', 'David']);
    });

    it('follows variable-length [*1..2] KNOWS traversal', async () => {
      const result = await engine.execute(
        "MATCH (p:Person)-[*1..2]->(f:Person) WHERE p.name = 'Alice' RETURN p.name AS name, f.name AS friend ORDER BY f.name ASC",
      );
      const friends = result.rows.map((r) => r.friend);
      // 1-hop: Bob, Charlie, David.  2-hop: David(via Bob), Eve(via Charlie), Frank(via David)
      // David appears twice (1-hop direct + 2-hop via Bob), duplicates are preserved in multi-hop
      expect(friends).toContain('Bob');
      expect(friends).toContain('Charlie');
      expect(friends).toContain('David');
      expect(friends).toContain('Eve');
      expect(friends).toContain('Frank');
    });

    it('applies LIMIT for pagination', async () => {
      const result = await engine.execute(
        "MATCH (p:Person)-[:KNOWS]->(f:Person) WHERE p.name = 'Alice' RETURN f.name AS friend ORDER BY f.name ASC LIMIT 2",
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].friend).toBe('Bob');
    });

    it('applies SKIP and LIMIT together', async () => {
      const result = await engine.execute(
        "MATCH (p:Person)-[:KNOWS]->(f:Person) WHERE p.name = 'Alice' RETURN f.name AS friend ORDER BY f.name ASC SKIP 1 LIMIT 2",
      );
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].friend).toBe('Charlie');
      expect(result.rows[1].friend).toBe('David');
    });

    it('filters with IS NOT NULL', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) WHERE p.occupation IS NOT NULL RETURN p.name AS name',
      );
      expect(result.rows).toHaveLength(8);
    });

    it('filters with AND operator', async () => {
      const result = await engine.execute(
        "MATCH (p:Person) WHERE p.city = 'NYC' AND p.occupation = 'Engineer' RETURN p.name AS name",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
    });

    it('filters with OR operator', async () => {
      const result = await engine.execute(
        "MATCH (p:Person) WHERE p.name = 'Alice' OR p.name = 'Bob' RETURN p.name AS name ORDER BY p.name ASC",
      );
      expect(result.rows).toHaveLength(2);
    });

    it('returns summary with query time', async () => {
      const result = await engine.execute('MATCH (p:Person) RETURN p LIMIT 1');
      expect(result.summary.queryTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.summary.nodesCreated).toBe(0);
      expect(result.summary.nodesDeleted).toBe(0);
    });

    it('orders results descending', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS name ORDER BY p.name DESC LIMIT 3',
      );
      expect(result.rows[0].name).toBe('Henry');
    });

    it('executes OPTIONAL MATCH and returns null for missing matches', async () => {
      const result = await engine.execute(
        "MATCH (p:Person {name: 'Alice'}) OPTIONAL MATCH (p)-[:KNOWS]->(f:Person {name: 'Nobody'}) RETURN p.name AS p_name, f.name AS f_name",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].p_name).toBe('Alice');
      expect(result.rows[0].f_name).toBeNull();
    });
    it('executes OPTIONAL MATCH with NamedPath and returns null for path when missing', async () => {
      const result = await engine.execute(
        "MATCH (p:Person {name: 'Alice'}) OPTIONAL MATCH path = (p)-[:KNOWS]->(f:Person {name: 'Nobody'}) RETURN p.name AS p_name, path",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].p_name).toBe('Alice');
      expect(result.rows[0].path).toBeNull();
    });
  });

  describe('Education Graph', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      await buildEducationGraph(graph);
      engine = new CypherEngine(graph);
    });

    it('matches students enrolled in a course', async () => {
      const result = await engine.execute(
        "MATCH (s:Student)-[:ENROLLED]->(c:Course) WHERE c.name = 'Graph Theory' RETURN s.name AS student ORDER BY s.name ASC",
      );
      expect(result.rows).toHaveLength(3);
      const names = result.rows.map((r) => r.student);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('matches courses taught by a teacher', async () => {
      const result = await engine.execute(
        "MATCH (t:Teacher)-[:TEACHES]->(c:Course) WHERE t.name = 'Dr. Smith' RETURN c.name AS course ORDER BY c.name ASC",
      );
      const courses = result.rows.map((r) => r.course);
      expect(courses).toContain('Algorithms');
      expect(courses).toContain('Graph Theory');
      expect(result.rows).toHaveLength(2);
    });

    it('matches all courses a student is enrolled in', async () => {
      const result = await engine.execute(
        "MATCH (s:Student)-[:ENROLLED]->(c:Course) WHERE s.name = 'Alice' RETURN c.name AS course ORDER BY c.name ASC",
      );
      const courses = result.rows.map((r) => r.course);
      expect(courses).toEqual(['Database Systems', 'Graph Theory']);
    });

    it('returns DISTINCT results', async () => {
      // All students enrolled in any course — DISTINCT deduplicates.
      const result = await engine.execute(
        'MATCH (s:Student)-[:ENROLLED]->(c:Course) RETURN DISTINCT s.name AS student ORDER BY s.name ASC',
      );
      const names = result.rows.map((r) => r.student);
      // Alice, Bob, Charlie — each appears once despite being enrolled in multiple courses
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  // ── Aggregate Queries ───────────────────────────────────────────
  describe('Aggregate Queries', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      // Reuse social graph data (8 Person nodes with ages 28,25,32,29,27,35,26,31)
      await buildSocialGraph(graph);
      engine = new CypherEngine(graph);
    });

    it('COUNT(n) returns total Person node count', async () => {
      const result = await engine.execute('MATCH (n:Person) RETURN COUNT(n)');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].count).toBe(8);
      expect(result.columns).toEqual(['count']);
    });

    it('AVG(n.age) returns correct average', async () => {
      // Ages: 28,25,32,29,27,35,26,31 → sum=233, count=8, avg=29.125
      const result = await engine.execute(
        'MATCH (n:Person) RETURN AVG(n.age) AS avg_val',
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].avg_val).toBe(29.125);
    });

    it('group-by n.occupation with COUNT(n) produces per-group counts', async () => {
      // Occupations: Engineer(2), Designer(2), Manager(1), Developer(1),
      //              Data Scientist(1), Director(1)
      const result = await engine.execute(
        'MATCH (n:Person) RETURN n.occupation, COUNT(n)',
      );
      // Should have 6 groups (6 distinct occupations)
      expect(result.rows.length).toBe(6);
      const byOccupation = new Map(
        result.rows.map((r) => [r.n_occupation, r.count]),
      );
      expect(byOccupation.get('Engineer')).toBe(2);
      expect(byOccupation.get('Designer')).toBe(2);
      expect(byOccupation.get('Manager')).toBe(1);
      expect(byOccupation.get('Developer')).toBe(1);
    });

    it('correctly returns DISTINCT aggregate results', async () => {
      // Ages: 28,25,32,29,27,35,26,31 → distinct values all unique → 8
      const result = await engine.execute(
        'MATCH (n:Person) RETURN COUNT(DISTINCT n.age) AS distinct_ages',
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].distinct_ages).toBe(8);
    });
  });

  // ── Relationship-Traversal Aggregation ─────────────────────────────
  describe('Relationship-Traversal Aggregation', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      // Minimal graph: 3 Person nodes connected by KNOWS edges
      const alice = await graph.addNode('Person', { name: 'Alice', age: 30 });
      const bob = await graph.addNode('Person', { name: 'Bob', age: 25 });
      const charlie = await graph.addNode('Person', { name: 'Charlie', age: 35 });

      // Directed KNOWS edges: Alice→Bob, Alice→Charlie, Bob→Charlie
      await graph.addEdge(alice.id, bob.id, 'KNOWS', {});
      await graph.addEdge(alice.id, charlie.id, 'KNOWS', {});
      await graph.addEdge(bob.id, charlie.id, 'KNOWS', {});

      engine = new CypherEngine(graph);
    });

    /**
     * Counts all target nodes across every KNOWS relationship.
     * Traversals: Alice→Bob, Alice→Charlie, Bob→Charlie = 3.
     */
    it('COUNT(f) across all KNOWS relationships', async () => {
      const result = await engine.execute(
        'MATCH (p:Person)-[:KNOWS]->(f:Person) RETURN COUNT(f)',
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].count).toBe(3);
    });

    /**
     * Counts friends of a specific source node (Alice).
     * Alice→Bob, Alice→Charlie = 2.
     */
    it('COUNT(f) for a specific source node via WHERE', async () => {
      const result = await engine.execute(
        "MATCH (p:Person)-[:KNOWS]->(f:Person) WHERE p.name = 'Alice' RETURN COUNT(f)",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].count).toBe(2);
    });

    /**
     * Average age of all friend nodes reached via KNOWS.
     * Target ages: Bob(25), Charlie(35), Charlie(35) → avg = 95/3 ≈ 31.67.
     */
    it('AVG(f.age) across traversed target nodes', async () => {
      const result = await engine.execute(
        'MATCH (p:Person)-[:KNOWS]->(f:Person) RETURN AVG(f.age) AS avg_friend_age',
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].avg_friend_age).toBeCloseTo(95 / 3, 5);
    });

    /**
     * Group-by source name with COUNT of outgoing friends.
     * Alice: 2 (Bob, Charlie), Bob: 1 (Charlie).
     * Charlie has no outgoing KNOWS so does not appear.
     */
    it('group-by p.name with COUNT(f) produces per-person friend counts', async () => {
      const result = await engine.execute(
        'MATCH (p:Person)-[:KNOWS]->(f:Person) RETURN p.name, COUNT(f) AS friend_count',
      );
      // Only persons with outgoing KNOWS appear: Alice and Bob
      expect(result.rows).toHaveLength(2);
      const byName = new Map(
        result.rows.map((r) => [r.p_name, r.friend_count]),
      );
      expect(byName.get('Alice')).toBe(2);
      expect(byName.get('Bob')).toBe(1);
    });

    /**
     * MIN and MAX of f.age across all KNOWS traversals.
     * Target ages: 25, 35, 35 → MIN=25, MAX=35.
     */
    it('MIN(f.age) and MAX(f.age) across traversed targets', async () => {
      const result = await engine.execute(
        'MATCH (p:Person)-[:KNOWS]->(f:Person) RETURN MIN(f.age), MAX(f.age)',
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].min).toBe(25);
      expect(result.rows[0].max).toBe(35);
    });

  });

  // ── ORDER BY, Aggregate Expressions, DISTINCT ────────────
  describe('ORDER BY, Aggregate Expressions, DISTINCT', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      await buildSocialGraph(graph);
      engine = new CypherEngine(graph);
    });



    it('orders by aggregate alias DESC', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY cnt DESC',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      // Verify descending order
      for (let i = 1; i < result.rows.length; i++) {
        expect(result.rows[i - 1].cnt as number).toBeGreaterThanOrEqual(result.rows[i].cnt as number);
      }
    });

    it('computes COUNT(*) + 1 AS result', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN COUNT(*) + 1 AS result',
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].result).toBe(9); // 8 persons + 1
    });

    it('returns DISTINCT cities', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN DISTINCT p.city AS city ORDER BY p.city ASC',
      );
      const cities = result.rows.map((r) => r.city);
      // All 8 persons have distinct cities
      expect(cities).toEqual([
        'Austin', 'Boston', 'Chicago', 'Denver',
        'LA', 'NYC', 'Portland', 'Seattle',
      ]);
    });





  });

  describe('id() function', () => {
    it('returns the internal id of a node', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH (p:Person {name: "Alice"}) RETURN id(p) AS nodeId',
      );
      expect(result.rows).toHaveLength(1);
      expect(typeof result.rows[0].nodeId).toBe('string');
      expect((result.rows[0].nodeId as string).length).toBeGreaterThan(0);
    });

    it('should throw an error when id() is used without arguments', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);
      expect(engine.execute(
        'MATCH (p:Person {name: "Alice"}) RETURN id()',
      )).rejects.toThrow(CypherRuntimeError);
    });

    it('can be used in a WHERE clause to compare ids', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      // Get Alice's id first
      const aliceResult = await engine.execute(
        'MATCH (p:Person {name: "Alice"}) RETURN id(p) AS nodeId',
      );
      const aliceId = aliceResult.rows[0].nodeId as string;

      // Use id() in WHERE
      const result = await engine.execute(
        `MATCH (p:Person) WHERE id(p) = '${aliceId}' RETURN p.name AS name`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
    });

    it('filters by id(p) = $param (NodeSeekStep with parameter)', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      // Get Alice's id first
      const aliceResult = await engine.execute(
        'MATCH (p:Person {name: "Alice"}) RETURN id(p) AS nodeId',
      );
      const aliceId = aliceResult.rows[0].nodeId as string;

      // Use id() with a $param — this should trigger NodeSeekStep
      const result = await engine.execute(
        'MATCH (p:Person) WHERE id(p) = $nodeId RETURN p.name AS name',
        { nodeId: aliceId },
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
    });

    it('returns different ids for different nodes', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH (p:Person) RETURN id(p) AS nodeId ORDER BY p.name ASC',
      );
      expect(result.rows).toHaveLength(8);
      const ids = result.rows.map((r) => r.nodeId as string);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(8); // all distinct
    });
  });

  describe('nodes() and relationships() functions', () => {
    it('extracts nodes from a named path with nodes(path)', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH path = (a:Person {name: "Alice"})-[:KNOWS]->(b:Person) RETURN nodes(path) AS nodes',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.columns).toEqual(['nodes']);

      const nodes = result.rows[0].nodes as unknown[];
      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBe(2); // source + target
      for (const n of nodes) {
        expect(n).toBeInstanceOf(Node);
      }
      // First node should be Alice, second should be the target
      expect((nodes[0] as any).properties.name).toBe('Alice');
    });

    it('extracts relationships from a named path with relationships(path)', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH path = (a:Person {name: "Alice"})-[:KNOWS]->(b:Person) RETURN relationships(path) AS rels',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.columns).toEqual(['rels']);

      const rels = result.rows[0].rels as unknown[];
      expect(Array.isArray(rels)).toBe(true);
      expect(rels.length).toBe(1); // one edge in a single-hop path
      for (const r of rels) {
        expect(r).toBeInstanceOf(Edge);
        expect((r as any).type).toBe('KNOWS');
      }
    });

    it('returns nodes and relationships together from the same path', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH path = (a:Person {name: "Alice"})-[:KNOWS]->(b:Person) RETURN DISTINCT nodes(path) AS nodes, relationships(path) AS rels',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.columns).toEqual(['nodes', 'rels']);

      const nodes = result.rows[0].nodes as unknown[];
      const rels = result.rows[0].rels as unknown[];
      expect(Array.isArray(nodes)).toBe(true);
      expect(Array.isArray(rels)).toBe(true);
      // nodes = edges + 1 for a simple path
      expect(nodes.length).toBe(rels.length + 1);
    });

    it('handles multi-hop variable-length named path with nodes(path)', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH path = (root)-[:KNOWS*2..3]-(p:Person) WHERE p.name = "Alice" RETURN nodes(path) AS nodes',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      const nodes = result.rows[0].nodes as unknown[];
      expect(Array.isArray(nodes)).toBe(true);
      // multi-hop path with 2-3 hops means 3-4 nodes
      expect(nodes.length).toBeGreaterThanOrEqual(3);
      for (const n of nodes) {
        expect(n).toBeInstanceOf(Node);
      }
      // Last node should be Alice
      const lastNode = nodes[nodes.length - 1] as any;
      expect(lastNode.properties.name).toBe('Alice');
    });

    it('returns null for nodes(null)', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH (p:Person) RETURN nodes(null) AS result',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].result).toBeNull();
    });

    it('throws for nodes() with wrong number of args', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      await expect(
        engine.execute('MATCH (p:Person) RETURN nodes() AS result'),
      ).rejects.toThrow(/nodes\(\) expects exactly 1 argument/);
    });

    it('throws for nodes() when argument is not a path', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);
      await expect(
        engine.execute('MATCH (p:Person) RETURN nodes(p) AS result'),
      ).rejects.toThrow(/nodes\(\) requires a path argument/);
    });

    it('throws for relationships() with wrong number of args', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      await expect(
        engine.execute('MATCH (p:Person) RETURN relationships(p, p) AS result'),
      ).rejects.toThrow(/relationships\(\) expects exactly 1 argument/);
    });

    it('throws for relationships() when argument is not a path', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);
      await expect(
        engine.execute('MATCH (p:Person) RETURN relationships(p) AS result'),
      ).rejects.toThrow(/relationships\(\) requires a path argument/);
    });
  });

  describe('labels() function', () => {
    it('returns the label of a node as a single-element array', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH (p:Person {name: "Alice"}) RETURN labels(p) AS label',
      );
      expect(result.rows).toHaveLength(1);
      expect(Array.isArray(result.rows[0].label)).toBe(true);
      expect(result.rows[0].label).toEqual(['Person']);
    });

    it('returns labels for all matched nodes', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH (p:Person) RETURN labels(p) AS label ORDER BY p.name ASC',
      );
      expect(result.rows).toHaveLength(8);
      for (const row of result.rows) {
        expect(row.label).toEqual(['Person']);
      }
    });

    it('can use labels() in a WHERE clause with IN', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        "MATCH (p) WHERE 'Person' IN labels(p) RETURN p.name AS name ORDER BY p.name ASC",
      );
      expect(result.rows.length).toBeGreaterThan(0);
      // All 8 Person nodes should match
      expect(result.rows).toHaveLength(8);
    });

    it('returns null for labels(null)', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH (p:Person) RETURN labels(null) AS result',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].result).toBeNull();
    });

    it('throws for labels() with wrong number of args', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      await expect(
        engine.execute('MATCH (p:Person) RETURN labels() AS result'),
      ).rejects.toThrow(/labels\(\) expects exactly 1 argument/);
    });

    it('throws for labels() when argument is not a node', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      await expect(
        engine.execute('MATCH (p:Person) RETURN labels(42) AS result'),
      ).rejects.toThrow(/labels\(\) requires a node argument/);
    });

    it('works with education graph multi-type nodes', async () => {
      const graph = new Graph();
      await buildEducationGraph(graph);
      const engine = new CypherEngine(graph);

      // Student nodes
      const studentResult = await engine.execute(
        "MATCH (s:Student {name: 'Alice'}) RETURN labels(s) AS label",
      );
      expect(studentResult.rows[0].label).toEqual(['Student']);

      // Course nodes
      const courseResult = await engine.execute(
        "MATCH (c:Course {name: 'Graph Theory'}) RETURN labels(c) AS label",
      );
      expect(courseResult.rows[0].label).toEqual(['Course']);

      // Teacher nodes
      const teacherResult = await engine.execute(
        "MATCH (t:Teacher {name: 'Dr. Smith'}) RETURN labels(t) AS label",
      );
      expect(teacherResult.rows[0].label).toEqual(['Teacher']);
    });
  });

  describe('type() function', () => {
    it('returns the type of a relationship', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        "MATCH (a:Person {name: 'Alice'})-[r]->(b:Person) RETURN type(r) AS relType",
      );
      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(row.relType).toBe('KNOWS');
      }
    });

    it('can use type() in a WHERE clause', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        "MATCH (a:Person)-[r]->(b:Person) WHERE type(r) = 'KNOWS' RETURN a.name AS name ORDER BY a.name ASC",
      );
      expect(result.rows.length).toBeGreaterThan(0);
      // Each name appears once per relationship
      expect(result.rows.map((r) => r.name)).toContain('Alice');
      expect(result.rows.map((r) => r.name)).toContain('Bob');
    });

    it('returns null for type(null)', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'MATCH (p:Person) RETURN type(null) AS result',
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].result).toBeNull();
    });

    it('throws for type() with wrong number of args', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      await expect(
        engine.execute('MATCH (a)-[r]->(b) RETURN type(r, a) AS result'),
      ).rejects.toThrow(/type\(\) expects exactly 1 argument/);
    });

    it('throws for type() when argument is not a relationship', async () => {
      const graph = new Graph();
      await buildSocialGraph(graph);
      const engine = new CypherEngine(graph);

      await expect(
        engine.execute('MATCH (p:Person) RETURN type(p) AS result'),
      ).rejects.toThrow(/type\(\) requires a relationship argument/);
    });

    it('works with different relationship types in education graph', async () => {
      const graph = new Graph();
      await buildEducationGraph(graph);
      const engine = new CypherEngine(graph);

      // ENROLLED relationships
      const enrolledResult = await engine.execute(
        "MATCH (s:Student {name: 'Alice'})-[r]->(c:Course) RETURN type(r) AS relType",
      );
      expect(enrolledResult.rows.length).toBeGreaterThan(0);
      for (const row of enrolledResult.rows) {
        expect(row.relType).toBe('ENROLLED');
      }

      // TEACHES relationships
      const teachesResult = await engine.execute(
        "MATCH (t:Teacher {name: 'Dr. Smith'})-[r]->(c:Course) RETURN type(r) AS relType",
      );
      expect(teachesResult.rows.length).toBeGreaterThan(0);
      for (const row of teachesResult.rows) {
        expect(row.relType).toBe('TEACHES');
      }
    });
  });


  describe('getQueryPlan', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeEach(() => {
      graph = new Graph();
      engine = new CypherEngine(graph);
    });

    it('returns json format by default', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p.name');
      expect(plan).toContain('"kind"');
      expect(plan).toContain('"steps"');
      expect(JSON.parse(plan)).toHaveProperty('plan.steps');
    });

    it('returns json format explicitly', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p', {}, 'json');
      expect(plan).toContain('"NodeScanStep"');
    });

    it('returns text format', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p', {}, 'text');
      expect(plan).toContain('NodeScanStep');
      expect(plan).toContain('ProjectStep');
    });

    it('returns mermaid format', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p', {}, 'mermaid');
      expect(plan).toContain('flowchart LR');
      expect(plan).toContain('-->');
    });

    it('includes all steps for a multi-hop query', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan(
        "MATCH (p:Person)-[:KNOWS]->(f:Person) WHERE p.name = 'Alice' RETURN f.name AS name",
        {},
        'json',
      );
      const parsed = JSON.parse(plan);
      expect(parsed.plan.steps.length).toBeGreaterThanOrEqual(3);
      const kinds = parsed.plan.steps.map((s: { kind: string }) => s.kind);
      expect(kinds).toContain('NodeScanStep');
      expect(kinds).toContain('EdgeExpandStep');
      expect(kinds).toContain('ProjectStep');
    });

    it('throws on invalid query syntax', async () => {
      const engine = new CypherEngine(new Graph());
      await expect(
        engine.getQueryPlan('MATCH (p PERSON) RETURN p'),
      ).rejects.toThrow();
    });

    it('accepts query parameters', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan(
        'MATCH (p:Person) WHERE p.name = $name RETURN p',
        { name: 'Alice' },
        'json',
      );
      expect(JSON.parse(plan)).toHaveProperty('plan.steps');
    });
  });

  describe('execute with plan format', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeEach(async () => {
      graph = new Graph();
      await buildSocialGraph(graph);
      engine = new CypherEngine(graph);
    });

    it('returns execution plan in result when format is provided', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS name',
        { executionPlan: { format: 'json' } },
      );
      expect(result.executionPlan).toBeDefined();
      expect(result.executionPlan).toContain('"plan"');
      expect(result.executionPlan).toContain('NodeScanStep');
    });

    it('returns execution plan in text format', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS name',
        { executionPlan: { format: 'text' } },
      );
      expect(result.executionPlan).toBeDefined();
      expect(result.executionPlan).toContain('NodeScanStep');
      expect(result.executionPlan).toContain('\u2514\u2014'); // └─
    });

    it('returns execution plan in mermaid format', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS name',
        { executionPlan: { format: 'mermaid' } },
      );
      expect(result.executionPlan).toBeDefined();
      expect(result.executionPlan).toContain('flowchart LR');
      expect(result.executionPlan).toContain('Step1');
      expect(result.executionPlan).toContain('-->');
    });

    it('includes planExecutionStats in summary', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS name',
        { executionPlan: { format: 'json' } },
      );
      expect(result.summary.planExecutionStats).toBeDefined();
      expect(result.summary.planExecutionStats!.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.summary.planExecutionStats!.steps.length).toBeGreaterThan(0);
    });

    it('step stats include timeMs and percentageOfTotal', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS name',
        { executionPlan: { format: 'json' } },
      );
      const stats = result.summary.planExecutionStats!;
      for (const step of stats.steps) {
        expect(step.timeMs).toBeGreaterThanOrEqual(0);
        expect(step.percentageOfTotal).toBeGreaterThanOrEqual(0);
        expect(step.percentageOfTotal).toBeLessThanOrEqual(100);
        expect(step.stepKind).toBeDefined();
        expect(step.rowsOut).toBeGreaterThanOrEqual(0);
      }
    });

    it('does not include executionPlan when format is not provided', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS name'
      );
      expect(result.executionPlan).toBeUndefined();
    });

    it('execution plan includes timing for multi-hop query', async () => {
      const result = await engine.execute(
        "MATCH (p:Person)-[:KNOWS]->(f:Person)-[:KNOWS]->(g:Person) WHERE p.name = 'Alice' AND f.name IN ['Bob', 'Charlie'] OR (g.name = 'David' AND g.city = 'Seattle') RETURN f.name AS name",
        { executionPlan: { format: 'text' } },
      );
      expect(result.executionPlan).toContain('ms');
      expect(result.executionPlan).toContain('%');
    });

  });

  describe('DML Queries', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph();
    });

    it('creates a new node with CREATE and verifies properties', async () => {
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        "CREATE (n:Person {name: 'Ivy', age: 24, city: 'Miami', occupation: 'Analyst'}) RETURN n",
      );

      expect(result.rows).toHaveLength(1);
      const created = result.rows[0].n as Node;
      expect(created.labels).toContain('Person');
      expect(created.properties.name).toBe('Ivy');
      expect(created.properties.age).toBe(24);
      expect(created.properties.city).toBe('Miami');
      expect(created.properties.occupation).toBe('Analyst');
    });

    it('creates a new relationship with CREATE and verifies properties', async () => {
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (a:Person {name: 'Alice', age: 28, city: 'NYC', occupation: 'Engineer'}), " +
        "(b:Person {name: 'Ivy', age: 24, city: 'Miami', occupation: 'Analyst'})",
      );

      const result = await engine.execute(
        "MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Ivy'}) CREATE (a)-[r:KNOWS {since: 2021}]->(b) RETURN r",
      );

      expect(result.rows).toHaveLength(1);
      const created = result.rows[0].r as Edge;
      expect(created.type).toBe('KNOWS');
      expect(created.properties.since).toBe(2021);
    });

    it('deletes a node with DELETE and verifies removal', async () => {
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (n:Person {name: 'Ivy', age: 24, city: 'Miami', occupation: 'Analyst'})",
      );

      const result = await engine.execute(
        "MATCH (n:Person {name: 'Ivy'}) DELETE n",
      );

      expect(result.summary.nodesDeleted).toBe(1);

      const verify = await engine.execute(
        "MATCH (n:Person {name: 'Ivy'}) RETURN n",
      );
      expect(verify.rows).toHaveLength(0);
    });

    it('deletes a relationship with DELETE and verifies removal', async () => {
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (a:Person {name: 'Ivy', age: 24, city: 'Miami', occupation: 'Analyst'})," +
        "(b:Person {name: 'Bob'})",
      );

      await engine.execute(
        "MATCH (a:Person {name: 'Ivy'}), (b:Person {name: 'Bob'}) CREATE (a)-[r:KNOWS]->(b) RETURN r",
      );

      const result = await engine.execute(
        "MATCH (a:Person {name: 'Ivy'})-[r:KNOWS]->(b:Person {name: 'Bob'}) DELETE r",
      );

      expect(result.summary.edgesDeleted).toBe(1);

      const verify = await engine.execute(
        "MATCH (a:Person {name: 'Ivy'})-[r:KNOWS]->(b:Person {name: 'Bob'}) RETURN r",
      );
      expect(verify.rows).toHaveLength(0);
    });
    it('replaces all properties on a node with SET n = {map}', async () => {
      graph.clear();
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (n:Person {name: 'Ivy', age: 24, city: 'Miami'})",
      );

      const result = await engine.execute(
        "MATCH (n:Person {name: 'Ivy'}) SET n = {name: 'Ivy New', score: 100} RETURN n",
      );

      expect(result.summary.propertiesSet).toBe(2);

      const node = result.rows[0].n as any;
      expect(node.properties.name).toBe('Ivy New');
      expect(node.properties.score).toBe(100);
      expect(node.properties.age).toBeUndefined();
      expect(node.properties.city).toBeUndefined();
    });

    it('mutates properties on a node with SET n += {map}', async () => {
      graph.clear();
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (n:Person {name: 'Ivy', age: 24, city: 'Miami'})",
      );

      const result = await engine.execute(
        "MATCH (n:Person {name: 'Ivy'}) SET n += {age: 25, score: 100} RETURN n",
      );

      expect(result.summary.propertiesSet).toBe(2);

      const node = result.rows[0].n as any;
      expect(node.properties.name).toBe('Ivy');
      expect(node.properties.age).toBe(25);
      expect(node.properties.city).toBe('Miami');
      expect(node.properties.score).toBe(100);
    });

    it('rejects non-plain objects in SET n = $map', async () => {
      graph.clear();
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (n:Person {name: 'Ivy'})",
      );

      await expect(
        engine.execute("MATCH (n:Person {name: 'Ivy'}) SET n = $map", { map: new Date() })
      ).rejects.toThrow('SET map assignment requires a plain object map value');
      
      const result = await engine.execute("MATCH (n:Person {name: 'Ivy'}) RETURN n");
      expect((result.rows[0].n as any).properties.name).toBe('Ivy');
    });

    it('rejects nested maps in SET n += $map via parameters', async () => {
      graph.clear();
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (n:Person {name: 'Ivy'})",
      );

      await expect(
        engine.execute("MATCH (n:Person {name: 'Ivy'}) SET n += $map", { map: { a: 1, b: { nested: true } } })
      ).rejects.toThrow('Map property values must be a primitive type');

      const result = await engine.execute("MATCH (n:Person {name: 'Ivy'}) RETURN n");
      expect((result.rows[0].n as any).properties.name).toBe('Ivy');
      expect((result.rows[0].n as any).properties.a).toBeUndefined();
    });

    it('deletes a node with relationships using DETACH DELETE', async () => {
      graph.clear();
      const engine = new CypherEngine(graph);

      await engine.execute(
        "CREATE (n:Person {name: 'Ivy', age: 24, city: 'Miami', occupation: 'Analyst'})," +
        "(b:Person {name: 'Bob'})",
      );

      await engine.execute(
        "MATCH (n:Person {name: 'Ivy'}), (b:Person {name: 'Bob'}) CREATE (n)-[r:KNOWS]->(b) RETURN r",
      );

      const result = await engine.execute(
        "MATCH (n:Person {name: 'Ivy'}) DETACH DELETE n",
      );

      expect(result.summary.nodesDeleted).toBe(1);
      expect(result.summary.edgesDeleted).toBe(1);

      const verifyNode = await engine.execute(
        "MATCH (n:Person {name: 'Ivy'}) RETURN n",
      );
      expect(verifyNode.rows).toHaveLength(0);

      const verifyEdge = await engine.execute(
        "MATCH (n:Person {name: 'Ivy'})-[r]->() RETURN r",
      );
      expect(verifyEdge.rows).toHaveLength(0);
    });
  });

  // ── Index DDL ────────────────────────────────────────────────────
  describe('Index DDL', () => {

    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph();
      await buildSocialGraph(graph);
    });

    it('creates a node index via Cypher and verifies with getIndexes', async () => {
      const engine = new CypherEngine(graph);

      const result = await engine.execute(
        'CREATE INDEX email_idx FOR (n:Person) ON (n.email)',
      );

      expect(result.summary.indexesCreated).toBe(1);
      expect(result.summary.indexesDeleted).toBe(0);

      const indexes = await graph.getIndexes();
      const created = indexes.find((idx) => idx.name === 'email_idx');
      expect(created).toBeDefined();
      expect(created!.target).toBe('node');
      expect(created!.propertyKeys).toEqual(['email']);
    });

    it('creates a compound index via Cypher', async () => {
      const engine = new CypherEngine(graph);

      await engine.execute(
        'CREATE INDEX ddl_compound_idx FOR (n:Person) ON (n.name, n.city)',
      );

      const indexes = await graph.getIndexes();
      const created = indexes.find((idx) => idx.name === 'ddl_compound_idx');
      expect(created).toBeDefined();
      // propertyKeys may be sorted; accept both orders
      expect(created!.propertyKeys).toEqual(expect.arrayContaining(['name', 'city']));
      expect(created!.propertyKeys).toHaveLength(2);
    });

    it('creates an edge index via Cypher', async () => {
      const engine = new CypherEngine(graph);

      // Use a property not already indexed by buildSocialGraph
      await engine.execute(
        'CREATE INDEX ddl_edge_idx FOR ()-[r:KNOWS]-() ON (r.since, r.weight)',
      );

      const indexes = await graph.getIndexes();
      const created = indexes.find((idx) => idx.name === 'ddl_edge_idx');
      expect(created).toBeDefined();
      expect(created!.target).toBe('edge');
      expect(created!.propertyKeys).toHaveLength(2);
    });

    it('drops an index via Cypher and verifies removal', async () => {
      // Create via Cypher first, then drop via Cypher
      // Use a unique property not in buildSocialGraph indexes
      const engine = new CypherEngine(graph);
      await engine.execute('CREATE INDEX ddl_drop_idx FOR (n:Person) ON (n.phone)');

      const result = await engine.execute('DROP INDEX ddl_drop_idx');

      expect(result.summary.indexesDeleted).toBe(1);

      const indexes = await graph.getIndexes();
      expect(indexes.find((idx) => idx.name === 'ddl_drop_idx')).toBeUndefined();
    });

    it('SHOW INDEXES returns all indexes with correct columns', async () => {
      const engine = new CypherEngine(graph);

      // Pre-existing indexes from buildSocialGraph: name_index, age_index, name_age_index, city_index, occupation_index, since_index
      const result = await engine.execute('SHOW INDEXES');

      expect(result.columns).toEqual(['name', 'target', 'propertyKeys']);
      // Must include the 6 pre-built indexes
      expect(result.rows.length).toBeGreaterThanOrEqual(6);

      const names = result.rows.map((r) => r.name);
      expect(names).toContain('name_index');
      expect(names).toContain('age_index');
      expect(names).toContain('since_index');
    });

    it('SHOW INDEXES returns empty result when no indexes exist', async () => {
      const emptyGraph = new Graph();
      const engine = new CypherEngine(emptyGraph);

      const result = await engine.execute('SHOW INDEXES');

      expect(result.rows).toHaveLength(0);
      expect(result.columns).toEqual(['name', 'target', 'propertyKeys']);
    });

    it('created index is functional for querying', async () => {
      const engine = new CypherEngine(graph);

      // Query by pre-existing indexed property to verify it still works
      const result = await engine.execute(
        "MATCH (p:Person) WHERE p.occupation = 'Engineer' RETURN p.name AS name",
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
      const names = result.rows.map((r) => r.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Henry');
    });

    it('duplicate index name produces error', async () => {
      const engine = new CypherEngine(graph);

      // First creation with a unique property name not in buildSocialGraph
      await engine.execute('CREATE INDEX ddl_dup_test FOR (n:Person) ON (n.score)');

      // Second creation with same name should fail
      await expect(
        engine.execute('CREATE INDEX ddl_dup_test FOR (n:Person) ON (n.score)'),
      ).rejects.toThrow();
    });

    it('dropping non-existent index produces error', async () => {
      const engine = new CypherEngine(graph);

      await expect(
        engine.execute('DROP INDEX nonexistent_ddl_idx'),
      ).rejects.toThrow();
    });

    it('DDL cannot be combined with MATCH/RETURN', async () => {
      const engine = new CypherEngine(graph);

      // Parser rejects this hybrid syntax — DDL + MATCH
      await expect(
        engine.execute('MATCH (n) CREATE INDEX idx FOR (n:Person) ON (n.name) RETURN n'),
      ).rejects.toThrow();
    });
  });

  // ── Pattern Comprehensions and Pattern Expressions ────────────────
  describe('Pattern Comprehensions and Pattern Expressions', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      await buildSocialGraph(graph);
      engine = new CypherEngine(graph);
    });

    it('evaluates Pattern Comprehensions to a list of projected values', async () => {
      // Alice has 3 friends: Bob, Charlie, David
      const result = await engine.execute(
        `MATCH (a:Person {name: 'Alice'})
         RETURN [(a)-[:KNOWS]->(b:Person) | b.name] AS friends`,
      );
      expect(result.rows).toHaveLength(1);
      const friends = result.rows[0].friends as string[];
      expect(Array.isArray(friends)).toBe(true);
      expect(friends).toHaveLength(3);
      expect(friends).toContain('Bob');
      expect(friends).toContain('Charlie');
      expect(friends).toContain('David');
    });

    it('evaluates Pattern Comprehensions with WHERE clause', async () => {
      // Alice has 3 friends: Bob, Charlie, David
      // Bob is 25, Charlie is 32, David is 29. Friends older than 28: Charlie, David.
      const result = await engine.execute(
        `MATCH (a:Person {name: 'Alice'})
         RETURN [(a)-[:KNOWS]->(b:Person) WHERE b.age > 28 | b.name] AS older_friends`,
      );
      expect(result.rows).toHaveLength(1);
      const friends = result.rows[0].older_friends as string[];
      expect(Array.isArray(friends)).toBe(true);
      expect(friends).toHaveLength(2);
      expect(friends).toContain('Charlie');
      expect(friends).toContain('David');
    });

    it('evaluates nested subqueries in Pattern Comprehension WHERE clause', async () => {
      // Alice knows Bob, Charlie, David.
      // Bob knows no one (in the graph direction, KNOWS is directed. Wait, Bob knows David).
      // Let's find friends of Alice who themselves have outgoing KNOWS relationships.
      // Alice -> Bob, Charlie, David
      // Bob -> David
      // Charlie -> Eve
      // David -> Frank
      // So all of Alice's friends (Bob, Charlie, David) have outgoing KNOWS relationships!
      // Let's find friends of Alice who know exactly 1 person.
      const result = await engine.execute(
        `MATCH (a:Person {name: 'Alice'})
         RETURN [(a)-[:KNOWS]->(b:Person) WHERE size((b)-[:KNOWS]->(:Person)) > 0 | b.name] AS friends_with_friends`,
      );
      expect(result.rows).toHaveLength(1);
      const friends = result.rows[0].friends_with_friends as string[];
      expect(Array.isArray(friends)).toBe(true);
      expect(friends).toHaveLength(3);
    });

    it('evaluates size() on Pattern Expressions to count matching paths', async () => {
      // Alice has 3 outgoing KNOWS relationships.
      const result = await engine.execute(
        `MATCH (a:Person {name: 'Alice'})
         RETURN size((a)-[:KNOWS]->(:Person)) AS friend_count`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].friend_count).toBe(3);
    });

    it('evaluates size() on Pattern Expressions in WHERE clause', async () => {
      // Persons with exactly 3 friends: Alice. (Other people have 0, 1 or 2).
      const result = await engine.execute(
        `MATCH (p:Person)
         WHERE size((p)-[:KNOWS]->(:Person)) = 3
         RETURN p.name AS name`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
    });
    
    it('evaluates size() on list', async () => {
      const result = await engine.execute(
        `RETURN size([1, 2, 3]) AS len`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].len).toBe(3);
    });
  });

  describe('New Cypher Expressions', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      await buildSocialGraph(graph);
      engine = new CypherEngine(graph);
    });

    it('evaluates CASE WHEN ... THEN ... ELSE END correctly', async () => {
      const result = await engine.execute(
        `MATCH (p:Person)
         RETURN CASE
           WHEN p.age < 26 THEN 'Young'
           WHEN p.age < 30 THEN 'Mid'
           ELSE 'Old'
         END AS ageGroup
         ORDER BY p.name ASC LIMIT 3`
      );
      // Alice (28) -> Mid, Bob (25) -> Young, Charlie (32) -> Old
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].ageGroup).toBe('Mid');
      expect(result.rows[1].ageGroup).toBe('Young');
      expect(result.rows[2].ageGroup).toBe('Old');
    });

    it('evaluates CASE expression WHEN ... THEN ... ELSE END correctly', async () => {
      const result = await engine.execute(
        `MATCH (p:Person)
         RETURN CASE p.name
           WHEN 'Alice' THEN 1
           WHEN 'Bob' THEN 2
           ELSE 3
         END AS nameScore
         ORDER BY p.name ASC LIMIT 3`
      );
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].nameScore).toBe(1);
      expect(result.rows[1].nameScore).toBe(2);
      expect(result.rows[2].nameScore).toBe(3); // Charlie
    });

    it('evaluates string matching operators: STARTS WITH, ENDS WITH, CONTAINS', async () => {
      const result = await engine.execute(
        `MATCH (p:Person)
         WHERE p.name STARTS WITH 'A' OR p.name ENDS WITH 'b' OR p.name CONTAINS 'harl'
         RETURN p.name AS name ORDER BY p.name ASC`
      );
      expect(result.rows).toHaveLength(3);
      const names = result.rows.map(r => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('evaluates math operators: %, ^', async () => {
      const result = await engine.execute(
        `RETURN 10 % 3 AS modRes, 2 ^ 3 AS powRes`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].modRes).toBe(1);
      expect(result.rows[0].powRes).toBe(8);
    });

    it('evaluates logical operator: XOR', async () => {
      const result = await engine.execute(
        `RETURN true XOR false AS a, true XOR true AS b, false XOR false AS c`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].a).toBe(true);
      expect(result.rows[0].b).toBe(false);
      expect(result.rows[0].c).toBe(false);
    });

    it('evaluates list predicates: ALL, ANY, NONE, SINGLE', async () => {
      const result = await engine.execute(
        `RETURN
          ALL(x IN [2, 4, 6] WHERE x % 2 = 0) AS allRes,
          ANY(x IN [1, 2, 3] WHERE x % 2 = 0) AS anyRes,
          NONE(x IN [1, 3, 5] WHERE x % 2 = 0) AS noneRes,
          SINGLE(x IN [1, 2, 3] WHERE x % 2 = 0) AS singleRes`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].allRes).toBe(true);
      expect(result.rows[0].anyRes).toBe(true);
      expect(result.rows[0].noneRes).toBe(true);
      expect(result.rows[0].singleRes).toBe(true);
    });
  });
});
