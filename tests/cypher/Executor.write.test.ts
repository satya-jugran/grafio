import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { Node } from '../../src/Node';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { Planner } from '../../src/cypher/Planner';
import { Executor } from '../../src/cypher/executor/Executor';
import { CypherRuntimeError } from '../../src/cypher/errors';
import { Edge } from '../../src';

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

describe('Executor – Write Operations', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  // ── CREATE ───────────────────────────────────────────────────────
  describe('CREATE', () => {
    it('CREATE single node and return it', async () => {
      const result = await executeQuery(
        "CREATE (n:Person {name: 'Alice'}) RETURN n",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      const node = result.rows[0].n as Node;
      expect(node.labels).toEqual(['Person']);
      expect(node.properties).toEqual({ name: 'Alice' });
      expect(result.summary.nodesCreated).toBe(1);
    });

    it('CREATE single node and verify via graph API', async () => {
      const result = await executeQuery(
        "CREATE (n:Person {name: 'Alice'}) RETURN n",
        {},
        graph,
      );

      expect(result.rows).toHaveLength(1);
      const node = result.rows[0].n as Node;
      expect(node.labels).toEqual(['Person']);
      expect(node.properties).toEqual({ name: 'Alice' });
      expect(result.summary.nodesCreated).toBe(1);

      // Verify node was persisted to the graph
      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].labels).toEqual(['Person']);
      expect(nodes[0].properties).toEqual({ name: 'Alice' });
    });

    it('CREATE node with multiple properties', async () => {
      const result = await executeQuery(
        "CREATE (n:Person {name: 'Bob', age: 30}) RETURN n",
        {},
        graph,
      );

      const nodes = result.rows.map((r) => r.n as Node);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].labels).toEqual(['Person']);
      expect(nodes[0].properties.name).toBe('Bob');
      expect(nodes[0].properties.age).toBe(30);
    });

    it('CREATE edge via separate node and edge creation', async () => {
      await graph.addNode('Person', { name: 'Alice' });
      await graph.addNode('Person', { name: 'Bob' });

      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(2);

      const edge = await graph.addEdge(nodes[0].id, nodes[1].id, 'KNOWS', { since: 2024 });
      expect(edge.type).toBe('KNOWS');
      expect(edge.properties.since).toBe(2024);

      const edges = await graph.getEdges();
      expect(edges).toHaveLength(1);
    });

    it('CREATE node and edge in single query', async () => {
      const result = await executeQuery(
        "CREATE (a:Person {name: 'Alice'})-[:KNOWS {since: 2024}]->(b:Person {name: 'Bob'}) RETURN a, b",
        {},
        graph,
      );

      expect(result.rows).toHaveLength(1);

      const a = result.rows[0].a as Node;
      expect(a.labels).toEqual(['Person']);
      expect(a.properties).toEqual({ name: 'Alice' });

      const b = result.rows[0].b as Node;
      expect(b.labels).toEqual(['Person']);
      expect(b.properties).toEqual({ name: 'Bob' });

      expect(result.summary.nodesCreated).toBe(2);
      expect(result.summary.edgesCreated).toBe(1);

      // Verify both nodes and the edge were persisted
      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(2);

      const edges = await graph.getEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0].type).toBe('KNOWS');
      expect(edges[0].properties).toEqual({ since: 2024 });
      expect(edges[0].sourceId).toBe(a.id);
      expect(edges[0].targetId).toBe(b.id);
    });

    it('write counters reflect operations on fresh graph', async () => {
      const result = await executeQuery(
        "CREATE (n:Person {name: 'Alice'}) RETURN n",
        {},
        graph,
      );

      expect(result.summary.nodesCreated).toBe(1);
      expect(result.summary.edgesCreated).toBe(0);
      expect(result.summary.nodesDeleted).toBe(0);
      expect(result.summary.edgesDeleted).toBe(0);
      expect(result.summary.propertiesSet).toBe(1); // initial property set counts as 1

      const nodes = result.rows.map((r) => r.n as Node);
      expect(nodes).toHaveLength(1);
    });
  });

  // ── DELETE ──────────────────────────────────────────────────────
  describe('DELETE', () => {
    it('DELETE node without edges', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });

      const result = await executeQuery(
        'MATCH (n:Person) DELETE n RETURN n',
        {},
        graph,
      );
      const deletedNode = result.rows[0].n as Node;
      expect(deletedNode.labels).toEqual(['Person']);
      expect(deletedNode.properties).toEqual({ name: 'Alice' });

      expect(result.summary.nodesDeleted).toBeGreaterThanOrEqual(1);

      // Verify node was removed
      const retrieved = await graph.getNode(node.id);
      expect(retrieved).toBeUndefined();
    });

    it('DELETE node with edges should throw CypherRuntimeError', async () => {
      const a = await graph.addNode('Person', { name: 'Alice' });
      const b = await graph.addNode('Person', { name: 'Bob' });
      await graph.addEdge(a.id, b.id, 'KNOWS');

      await expect(
        executeQuery('MATCH (n:Person {name: "Alice"}) DELETE n RETURN n', {}, graph),
      ).rejects.toThrow(CypherRuntimeError);

      // Verify node still exists (removal was rejected)
      const nodeAfter = await graph.getNode(a.id);
      expect(nodeAfter).toBeDefined();

      // Verify edge still exists
      const edgesAfter = await graph.getEdges();
      expect(edgesAfter).toHaveLength(1);
    });

    it('DELETE edge', async () => {
      const a = await graph.addNode('Person', { name: 'Alice' });
      const b = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(a.id, b.id, 'KNOWS');

      const result = await executeQuery(
        'MATCH (:Person)-[e:KNOWS]->(:Person) DELETE e RETURN e',
        {},
        graph,
      );

      expect(result.summary.edgesDeleted).toBeGreaterThanOrEqual(1);

      // Verify edge was removed
      const hasEdge = await graph.hasEdge(edge.id);
      expect(hasEdge).toBe(false);
    });

    it('DETACH DELETE node with incident edges', async () => {
      const a = await graph.addNode('Person', { name: 'Alice' });
      const b = await graph.addNode('Person', { name: 'Bob' });
      await graph.addEdge(a.id, b.id, 'KNOWS');

      const result = await executeQuery(
        'MATCH (n:Person) DETACH DELETE n RETURN n',
        {},
        graph,
      );

      expect(result.summary.nodesDeleted).toBeGreaterThanOrEqual(1);

      // Verify cascade removal via graph state
      const nodesAfter = await graph.getNodes();
      expect(nodesAfter.length).toBeLessThan(2);
    });
  });

  // ── SET ─────────────────────────────────────────────────────────
  describe('SET', () => {
    it('SET new property on node', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const result = await executeQuery(
        "MATCH (n:Person {name: 'Alice'}) SET n.age = 30, n.city = 'Wonderland' RETURN n",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      const updatedNode = result.rows[0].n as Node;
      expect(updatedNode.properties.age).toBe(30);
      expect(updatedNode.properties.city).toBe('Wonderland');
      expect(result.summary.propertiesSet).toBeGreaterThanOrEqual(2);

      // Verify property set in persisted graph
      const reFetched = await graph.getNode(node.id);
      expect(reFetched!.properties.age).toBe(30);
      expect(reFetched!.properties.city).toBe('Wonderland');
    });

    it('SET property and new property on edge', async () => {
      const a = await graph.addNode('Person', { name: 'Alice' });
      const b = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(a.id, b.id, 'KNOWS', { since: 2020 });
      const result = await executeQuery(
        "MATCH ()-[r:KNOWS]->() SET r.since = 2024, r.status = 'active' RETURN r",
        {},
        graph,
      );
      expect(result.rows).toHaveLength(1);
      const updatedEdge = result.rows[0].r as Edge;
      expect(updatedEdge.properties.since).toBe(2024);
      expect(updatedEdge.properties.status).toBe('active');
      expect(result.summary.propertiesSet).toBeGreaterThanOrEqual(2);
    });
  });

  // ── REMOVE ──────────────────────────────────────────────────────
  describe('REMOVE', () => {
    it('REMOVE property from node (verify via graph re-fetch)', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30 });

      await executeQuery(
        'MATCH (n:Person) REMOVE n.age RETURN n',
        {},
        graph,
      );

      const updated = await graph.getNode(node.id);
      expect(updated).toBeDefined();
      expect(updated!.properties.age).toBeUndefined();
      expect(updated!.properties.name).toBe('Alice');
    });

    it('REMOVE property with MATCH before REMOVE', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', temp: 'to-remove' });

      await executeQuery(
        'MATCH (n:Person) REMOVE n.temp RETURN n',
        {},
        graph,
      );

      const updated = await graph.getNode(node.id);
      expect(updated!.properties.temp).toBeUndefined();
      expect(updated!.properties.name).toBe('Alice');
    });

    it('REMOVE single label from node', async () => {
      const node = await graph.addNode(['Person', 'Employee'], { name: 'Alice' });

      await executeQuery(
        'MATCH (n:Person) REMOVE n:Employee RETURN n',
        {},
        graph,
      );

      const updated = await graph.getNode(node.id);
      expect(updated!.labels).toEqual(['Person']);
    });

    it('REMOVE multiple labels from node', async () => {
      const node = await graph.addNode(['Person', 'Employee', 'Manager'], { name: 'Alice' });

      await executeQuery(
        'MATCH (n:Person) REMOVE n:Employee:Manager RETURN n',
        {},
        graph,
      );

      const updated = await graph.getNode(node.id);
      expect(updated!.labels).toEqual(['Person']);
    });
  });

  // ── Index DDL ───────────────────────────────────────────────────
  describe('index DDL operations', () => {
    it('executes CREATE INDEX for node', async () => {
      const g = new Graph();
      await g.addNode('Person', { name: 'Alice' });

      const result = await executeQuery(
        'CREATE INDEX email_idx FOR (n:Person) ON (n.email)',
        {},
        g,
      );

      const indexes = await g.getIndexes();
      const created = indexes.find((idx) => idx.name === 'email_idx');
      expect(created).toBeDefined();
      expect(created!.target).toBe('node');
      expect(created!.propertyKeys).toEqual(['email']);
      expect(result.summary.indexesCreated).toBe(1);
      expect(result.summary.indexesDeleted).toBe(0);
    });

    it('executes CREATE INDEX for edge', async () => {
      const g = new Graph();
      const a = await g.addNode('Person', {});
      const b = await g.addNode('Person', {});
      await g.addEdge(a.id, b.id, 'KNOWS', { since: 2020 });

      const result = await executeQuery(
        'CREATE INDEX since_idx FOR ()-[r:KNOWS]-() ON (r.since)',
        {},
        g,
      );

      const indexes = await g.getIndexes();
      const created = indexes.find((idx) => idx.name === 'since_idx');
      expect(created).toBeDefined();
      expect(created!.target).toBe('edge');
      expect(created!.propertyKeys).toEqual(['since']);
      expect(result.summary.indexesCreated).toBe(1);
    });

    it('executes CREATE INDEX with compound properties', async () => {
      const g = new Graph();
      const result = await executeQuery(
        'CREATE INDEX name_email_idx FOR (n:Person) ON (n.name, n.email)',
        {},
        g,
      );

      const indexes = await g.getIndexes();
      const created = indexes.find((idx) => idx.name === 'name_email_idx');
      expect(created).toBeDefined();
      expect(created!.propertyKeys).toEqual(expect.arrayContaining(['name', 'email']));
      expect(created!.propertyKeys).toHaveLength(2);
      expect(result.summary.indexesCreated).toBe(1);
    });

    it('executes DROP INDEX', async () => {
      const g = new Graph();
      await g.createIndex('temp_idx', 'node', ['foo']);

      const result = await executeQuery('DROP INDEX temp_idx', {}, g);

      const indexes = await g.getIndexes();
      expect(indexes.find((idx) => idx.name === 'temp_idx')).toBeUndefined();
      expect(result.summary.indexesDeleted).toBe(1);
    });

    it('executes SHOW INDEXES with data', async () => {
      const g = new Graph();
      await g.createIndex('name_idx', 'node', ['name']);
      await g.createIndex('age_idx', 'node', ['age']);

      const result = await executeQuery('SHOW INDEXES', {}, g);

      expect(result.rows).toHaveLength(2);
      expect(result.columns).toEqual(['name', 'target', 'propertyKeys']);

      const names = result.rows.map((r) => r.name);
      expect(names).toContain('name_idx');
      expect(names).toContain('age_idx');
    });

    it('executes SHOW INDEXES on empty graph', async () => {
      const g = new Graph();

      const result = await executeQuery('SHOW INDEXES', {}, g);

      expect(result.rows).toHaveLength(0);
      expect(result.columns).toEqual(['name', 'target', 'propertyKeys']);
    });

    it('increments and resets index counters correctly', async () => {
      const g = new Graph();

      const r1 = await executeQuery(
        'CREATE INDEX idx1 FOR (n:Person) ON (n.name)',
        {},
        g,
      );
      expect(r1.summary.indexesCreated).toBe(1);
      expect(r1.summary.indexesDeleted).toBe(0);

      const r2 = await executeQuery('DROP INDEX idx1', {}, g);
      expect(r2.summary.indexesCreated).toBe(0);
      expect(r2.summary.indexesDeleted).toBe(1);
    });
  });

  // ── OPTIONAL MATCH ──────────────────────────────────────────────
  describe('OPTIONAL MATCH', () => {
    it('returns null for unmatched variables', async () => {
      const g = await buildSocialGraph();
      // Charlie has no outgoing KNOWS edge
      const result = await executeQuery(
        "MATCH (a:Person) WHERE a.name = 'Charlie' OPTIONAL MATCH (a)-[:KNOWS]->(b) RETURN a.name AS name, b.name AS friend",
        {},
        g,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Charlie');
      expect(result.rows[0].friend).toBeNull();
    });

    it('returns matched rows when matches exist', async () => {
      const g = await buildSocialGraph();
      // Alice has one outgoing KNOWS edge to Bob
      const result = await executeQuery(
        "MATCH (a:Person) WHERE a.name = 'Alice' OPTIONAL MATCH (a)-[:KNOWS]->(b:Person) RETURN a.name AS name, b.name AS friend",
        {},
        g,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[0].friend).toBe('Bob');
    });

    it('preserves rows from first MATCH when OPTIONAL MATCH finds nothing', async () => {
      const g = await buildSocialGraph();
      // All people: some have outgoing WORKS_AT, some don't
      const result = await executeQuery(
        'MATCH (a:Person) OPTIONAL MATCH (a)-[:WORKS_AT]->(c:Company) RETURN a.name AS name, c.name AS company ORDER BY a.name ASC',
        {},
        g,
      );
      // Alice works at Acme; Bob and Charlie have no WORKS_AT edges
      expect(result.rows).toHaveLength(3);

      const alice = result.rows.find((r) => r.name === 'Alice');
      expect(alice!.company).toBe('Acme');

      const bob = result.rows.find((r) => r.name === 'Bob');
      expect(bob!.company).toBeNull();

      const charlie = result.rows.find((r) => r.name === 'Charlie');
      expect(charlie!.company).toBeNull();
    });

    it('multiplies rows when OPTIONAL MATCH has multiple matches', async () => {
      const g = await buildSocialGraph();
      // All persons with their optional KNOWS targets
      // Alice->Bob, Bob->Charlie, Charlie has none
      const result = await executeQuery(
        'MATCH (a:Person) OPTIONAL MATCH (a)-[:KNOWS]->(b:Person) RETURN a.name AS name, b.name AS friend ORDER BY a.name ASC, b.name ASC',
        {},
        g,
      );
      // Alice: Bob; Bob: Charlie; Charlie: null → 3 rows
      expect(result.rows).toHaveLength(3);

      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[0].friend).toBe('Bob');

      expect(result.rows[1].name).toBe('Bob');
      expect(result.rows[1].friend).toBe('Charlie');

      expect(result.rows[2].name).toBe('Charlie');
      expect(result.rows[2].friend).toBeNull();
    });

    it('supports WHERE inside OPTIONAL MATCH', async () => {
      const g = await buildSocialGraph();
      // Alice KNOWS Bob (age 25). Filter for friends older than 30 — no match.
      const result = await executeQuery(
        "MATCH (a:Person) WHERE a.name = 'Alice' OPTIONAL MATCH (a)-[:KNOWS]->(b:Person) WHERE b.age > 30 RETURN a.name AS name, b.name AS friend",
        {},
        g,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[0].friend).toBeNull();
    });

    it('chains multiple OPTIONAL MATCH clauses', async () => {
      const g = await buildSocialGraph();
      // Alice: KNOWS->Bob, WORKS_AT->Acme
      // Charlie: no KNOWS, no WORKS_AT
      const result = await executeQuery(
        'MATCH (a:Person) OPTIONAL MATCH (a)-[:KNOWS]->(b:Person) OPTIONAL MATCH (a)-[:WORKS_AT]->(c:Company) RETURN a.name AS name, b.name AS friend, c.name AS company ORDER BY a.name ASC',
        {},
        g,
      );

      const alice = result.rows.find((r) => r.name === 'Alice');
      expect(alice).toBeDefined();
      expect(alice!.friend).toBe('Bob');
      expect(alice!.company).toBe('Acme');

      const charlie = result.rows.find((r) => r.name === 'Charlie');
      expect(charlie).toBeDefined();
      expect(charlie!.friend).toBeNull();
      expect(charlie!.company).toBeNull();
    });

    it('OPTIONAL MATCH on empty graph returns null for all new vars', async () => {
      const g = new Graph();
      await g.addNode('Person', { name: 'Lonely' });

      const result = await executeQuery(
        'MATCH (a:Person) OPTIONAL MATCH (a)-[r:KNOWS]->(b) RETURN a.name AS name, b AS friend, r AS rel',
        {},
        g,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Lonely');
      expect(result.rows[0].friend).toBeNull();
      expect(result.rows[0].rel).toBeNull();
    });
  });
});
