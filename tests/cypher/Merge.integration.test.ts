import { describe, expect, it, beforeEach } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { CypherEngine } from '../../src/cypher';

describe('CypherEngine MERGE Integration', () => {
  let graph: Graph;
  let engine: CypherEngine;

  beforeEach(() => {
    graph = new Graph();
    engine = new CypherEngine(graph);
  });

  it('creates a node if it does not exist', async () => {
    await engine.execute("MERGE (a:Person {name: 'Alice'})");
    const res = await engine.execute('MATCH (a:Person) RETURN a.name AS name');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].name).toBe('Alice');
  });

  it('does not create a node if it already exists', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'})");
    await engine.execute("MERGE (a:Person {name: 'Alice'})");
    const res = await engine.execute('MATCH (a:Person) RETURN a.name AS name');
    expect(res.rows).toHaveLength(1);
  });

  it('applies ON CREATE SET when node is created', async () => {
    await engine.execute(
      "MERGE (a:Person {name: 'Alice'}) ON CREATE SET a.age = 30"
    );
    const res = await engine.execute('MATCH (a:Person) RETURN a.age AS age');
    expect(res.rows[0].age).toBe(30);
  });

  it('applies ON MATCH SET when node already exists', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice', age: 25})");
    await engine.execute(
      "MERGE (a:Person {name: 'Alice'}) ON MATCH SET a.age = 30"
    );
    const res = await engine.execute('MATCH (a:Person) RETURN a.age AS age');
    expect(res.rows[0].age).toBe(30);
  });

  it('creates edges between existing bound variables', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})");
    await engine.execute(
      "MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) MERGE (a)-[r:KNOWS]->(b) ON CREATE SET r.since = 2020"
    );
    const res = await engine.execute('MATCH ()-[r:KNOWS]->() RETURN r.since AS since');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].since).toBe(2020);
  });

  it('matches edges between existing bound variables', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})");
    await engine.execute(
      "MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) CREATE (a)-[r:KNOWS {since: 2020}]->(b)"
    );
    await engine.execute(
      "MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) MERGE (a)-[r:KNOWS]->(b) ON MATCH SET r.since = 2021"
    );
    const res = await engine.execute('MATCH ()-[r:KNOWS]->() RETURN r.since AS since');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].since).toBe(2021);
  });

  it('ignores conflicting inline properties on a bound node during MERGE creation', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'})");
    // 'a' is bound to Alice. MERGE checks if Alice matches name='Charlie'. She doesn't.
    // So MERGE falls back to CREATE.
    // During CREATE, 'a' is already bound, so it DOES NOT create a new node for 'a'.
    // Instead, it creates 'b' (Bob) and an edge from the bound 'a' (Alice) to 'b'.
    await engine.execute(
      "MATCH (a:Person {name: 'Alice'}) MERGE (a:Person {name: 'Charlie'})-[r:KNOWS]->(b:Person {name: 'Bob'})"
    );
    const res = await engine.execute('MATCH (p:Person) RETURN p.name AS name');
    // We should have Alice and Bob only. The 'Charlie' property is discarded during CREATE because 'a' is bound.
    expect(res.rows).toHaveLength(2);
    
    // Verify edge is from Alice to Bob
    const edgeRes = await engine.execute('MATCH (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN r');
    expect(edgeRes.rows).toHaveLength(1);
  });
});
