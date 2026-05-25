import { describe, expect, it, beforeEach } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { CypherEngine } from '../../src/cypher';
import { CypherSemanticError } from '../../src/cypher/errors';

describe('CypherEngine WITH Integration', () => {
  let graph: Graph;
  let engine: CypherEngine;

  beforeEach(() => {
    graph = new Graph();
    engine = new CypherEngine(graph);
  });

  it('filters rows with WITH ... WHERE', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice', age: 25}), (b:Person {name: 'Bob', age: 30})");
    const res = await engine.execute("MATCH (p:Person) WITH p.name AS name, p.age AS age WHERE age > 25 RETURN name");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].name).toBe('Bob');
  });

  it('aggregates with WITH', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice', age: 25}), (b:Person {name: 'Bob', age: 30})");
    const res = await engine.execute("MATCH (p:Person) WITH COUNT(p) AS c RETURN c");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].c).toBe(2);
  });

  it('passes variables through WITH *', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'})-[:KNOWS]->(b:Person {name: 'Bob'})");
    const res = await engine.execute("MATCH (a:Person)-[:KNOWS]->(b:Person) WITH * RETURN a.name AS aName, b.name AS bName");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].aName).toBe('Alice');
    expect(res.rows[0].bName).toBe('Bob');
  });

  it('supports multiple MATCH clauses connected by WITH', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'})-[:KNOWS]->(b:Person {name: 'Bob'})");
    const res = await engine.execute(
      "MATCH (a:Person {name: 'Alice'}) WITH a MATCH (a)-[:KNOWS]->(b:Person) RETURN b.name AS name"
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].name).toBe('Bob');
  });

  it('anchors the next MATCH to variables passed through WITH (join anchoring)', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})");
    // `n` is passed through WITH. The second MATCH uses `n` as an anchor, so it only finds Alice.
    const res = await engine.execute(
      "MATCH (n:Person {name: 'Alice'}) WITH n MATCH (n:Person) RETURN n.name AS finalName"
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].finalName).toBe('Alice');
  });

  it('allows variables dropped by WITH to be re-bound as new full scans in subsequent MATCH clauses', async () => {
    await engine.execute("CREATE (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})");
    // `n` is dropped by the WITH clause. The second MATCH binds a completely new `n` variable, doing a full node scan.
    const res = await engine.execute(
      "MATCH (n:Person {name: 'Alice'}) WITH n.name AS name MATCH (n:Person) RETURN n.name AS finalName, name ORDER BY n.name"
    );
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({ finalName: 'Alice', name: 'Alice' });
    expect(res.rows[1]).toEqual({ finalName: 'Bob', name: 'Alice' });
  });

  it('throws SemanticError if unaliased expression used in WITH', async () => {
    await expect(engine.execute("MATCH (p:Person) WITH p.age + 1 RETURN p"))
      .rejects.toThrow(CypherSemanticError);
  });

  it('supports multiple sequential MATCH and WITH clauses', async () => {
    await engine.execute(
      "CREATE (a:Person {name: 'Alice'})-[:KNOWS]->(b:Person {name: 'Bob'}), " +
      "(b)-[:WORKS_AT]->(c:Company {name: 'Acme'})"
    );
    const res = await engine.execute(
      "MATCH (a:Person {name: 'Alice'}) " +
      "WITH a " +
      "MATCH (a)-[:KNOWS]->(b:Person) " +
      "WITH a, b " +
      "MATCH (b)-[:WORKS_AT]->(c:Company) " +
      "RETURN a.name AS aName, b.name AS bName, c.name AS cName"
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].aName).toBe('Alice');
    expect(res.rows[0].bName).toBe('Bob');
    expect(res.rows[0].cName).toBe('Acme');
  });
});
