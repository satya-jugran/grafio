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
import { CypherEngine, CypherNotSupportedError } from '../../src/cypher';

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

    it('rejects COUNT aggregation', async () => {
      const engine = new CypherEngine(new Graph());
      await expect(
        engine.execute('MATCH (n) RETURN COUNT(n)'),
      ).rejects.toThrow(CypherNotSupportedError);
    });
  });
});
