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
import { CypherEngine, CypherNotSupportedError, PlanFormat } from '../../src/cypher';

/** Build a social graph with people, posts, and relationships. */
async function buildSocialGraph(graph: Graph): Promise<void> {
  // People
  const alice = await graph.addNode('Person', { name: 'Alice', age: 28, city: 'NYC', occupation: 'Engineer' });
  const bob = await graph.addNode('Person', { name: 'Bob', age: 25, city: 'LA', occupation: 'Designer' });
  const charlie = await graph.addNode('Person', { name: 'Charlie', age: 32, city: 'Chicago', occupation: 'Manager' });
  const david = await graph.addNode('Person', { name: 'David', age: 29, city: 'Seattle', occupation: 'Developer' });
  const eve = await graph.addNode('Person', { name: 'Eve', age: 27, city: 'Boston', occupation: 'Data Scientist' });
  const frank = await graph.addNode('Person', { name: 'Frank', age: 35, city: 'Austin', occupation: 'Director' });
  const grace = await graph.addNode('Person', { name: 'Grace', age: 26, city: 'Denver', occupation: 'Designer' });
  const henry = await graph.addNode('Person', { name: 'Henry', age: 31, city: 'Portland', occupation: 'Engineer' });

  // KNOWS relationships
  await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2018 });
  await graph.addEdge(bob.id, alice.id, 'KNOWS', { since: 2018 });
  await graph.addEdge(alice.id, charlie.id, 'KNOWS', { since: 2019 });
  await graph.addEdge(bob.id, david.id, 'KNOWS', { since: 2020 });
  await graph.addEdge(charlie.id, eve.id, 'KNOWS', { since: 2021 });
  await graph.addEdge(david.id, frank.id, 'KNOWS', { since: 2022 });
  await graph.addEdge(eve.id, grace.id, 'KNOWS', { since: 2022 });
  await graph.addEdge(henry.id, alice.id, 'KNOWS', { since: 2023 });
  await graph.addEdge(alice.id, david.id, 'KNOWS', { since: 2019 });

  await graph.createIndex('node', 'name');
  await graph.createIndex('node', 'age');
  await graph.createIndex('node', 'city');
  await graph.createIndex('node', 'occupation');
  await graph.createIndex('edge', 'since');
}

/** Build an education graph with courses, students, and teachers. */
async function buildEducationGraph(graph: Graph): Promise<void> {
  // Students
  const studentAlice = await graph.addNode('Student', { name: 'Alice', year: 2024 });
  const studentBob = await graph.addNode('Student', { name: 'Bob', year: 2024 });
  const studentCharlie = await graph.addNode('Student', { name: 'Charlie', year: 2023 });

  // Courses
  const graphTheory = await graph.addNode('Course', { name: 'Graph Theory', credits: 3 });
  const dbSystems = await graph.addNode('Course', { name: 'Database Systems', credits: 4 });
  const algorithms = await graph.addNode('Course', { name: 'Algorithms', credits: 3 });

  // Teachers
  const drSmith = await graph.addNode('Teacher', { name: 'Dr. Smith', department: 'CS' });
  const drJones = await graph.addNode('Teacher', { name: 'Dr. Jones', department: 'CS' });

  // Enrollments
  await graph.addEdge(studentAlice.id, graphTheory.id, 'ENROLLED', { semester: 'Fall' });
  await graph.addEdge(studentBob.id, graphTheory.id, 'ENROLLED', { semester: 'Fall' });
  await graph.addEdge(studentCharlie.id, graphTheory.id, 'ENROLLED', { semester: 'Fall' });
  await graph.addEdge(studentAlice.id, dbSystems.id, 'ENROLLED', { semester: 'Spring' });
  await graph.addEdge(studentBob.id, algorithms.id, 'ENROLLED', { semester: 'Spring' });
  await graph.addEdge(studentCharlie.id, algorithms.id, 'ENROLLED', { semester: 'Spring' });

  // Teaching assignments
  await graph.addEdge(drSmith.id, graphTheory.id, 'TEACHES', {});
  await graph.addEdge(drJones.id, dbSystems.id, 'TEACHES', {});
  await graph.addEdge(drSmith.id, algorithms.id, 'TEACHES', {});
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
        "MATCH (p:Person)-[*1..2]->(f:Person) WHERE p.name = 'Alice' RETURN f.name AS friend ORDER BY f.name ASC",
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

  // ── HAVING, ORDER BY, Aggregate Expressions, DISTINCT ────────────
  describe('HAVING, ORDER BY, Aggregate Expressions, DISTINCT', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeAll(async () => {
      graph = new Graph();
      await buildSocialGraph(graph);
      engine = new CypherEngine(graph);
    });

    it('filters groups with HAVING cnt > 1', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.occupation, COUNT(*) AS cnt HAVING cnt > 1',
      );
      // Occupations with more than 1 person: Engineer (Alice, Henry), Designer (Bob, Grace)
      const occupations = result.rows.map((r) => r.p_occupation);
      expect(occupations).toContain('Engineer');
      expect(occupations).toContain('Designer');
      // Each returned row should have cnt > 1
      for (const row of result.rows) {
        expect(row.cnt).toBeGreaterThan(1);
      }
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

    it('combines HAVING, ORDER BY, and multiple aggregates', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.occupation, COUNT(*) AS cnt, AVG(p.age) AS avg_age HAVING cnt > 1 ORDER BY avg_age DESC',
      );
      // Occupations with more than 1 person: Engineer(2), Designer(2)
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
      // Verify descending order by avg_age
      for (let i = 1; i < result.rows.length; i++) {
        expect(result.rows[i - 1].avg_age as number).toBeGreaterThanOrEqual(result.rows[i].avg_age as number);
      }
      // Verify all rows have cnt > 1
      for (const row of result.rows) {
        expect(row.cnt).toBeGreaterThan(1);
      }
    });

    it('filters groups with raw aggregate HAVING COUNT(*) > 1', async () => {
      const result = await engine.execute(
        'MATCH (p:Person) RETURN p.occupation, COUNT(*) AS cnt HAVING COUNT(*) > 1',
      );
      // Occupations with more than 1 person: Engineer (Alice, Henry), Designer (Bob, Grace)
      const occupations = result.rows.map((r) => r.p_occupation);
      expect(occupations).toContain('Engineer');
      expect(occupations).toContain('Designer');
      for (const row of result.rows) {
        expect(row.cnt).toBeGreaterThan(1);
      }
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

    it('returns ascii format', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p', {}, 'text');
      expect(plan).toContain('NodeScanStep');
      expect(plan).toContain('ProjectStep');
    });

    it('returns mermaid format', async () => {
      await buildSocialGraph(graph);
      const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p', {}, 'mermaid');
      expect(plan).toContain('flowchart TD');
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

    it('throws on unsupported clause', async () => {
      const engine = new CypherEngine(new Graph());
      await expect(
        engine.getQueryPlan('CREATE (n:Person) RETURN n'),
      ).rejects.toThrow(CypherNotSupportedError);
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

  describe('Validation Gate', () => {
    it('rejects CREATE clause', async () => {
      const graph = new Graph();
      const engine = new CypherEngine(graph);
      await expect(
        engine.execute('CREATE (n:Person {name: "Test"}) RETURN n'),
      ).rejects.toThrow(CypherNotSupportedError);
    });

    it('rejects DELETE clause', async () => {
      const engine = new CypherEngine(new Graph());
      await expect(
        engine.execute('MATCH (n) DELETE n'),
      ).rejects.toThrow(CypherNotSupportedError);
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

    it('returns execution plan in ascii format', async () => {
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
      expect(result.executionPlan).toContain('flowchart TD');
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
});
