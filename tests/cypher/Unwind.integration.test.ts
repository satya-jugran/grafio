import { Graph } from '../../src/Graph';
import { CypherEngine } from '../../src/cypher/CypherEngine';

describe('Cypher UNWIND', () => {
  let graph: Graph;
  let engine: CypherEngine;

  beforeEach(() => {
    graph = new Graph();
    engine = new CypherEngine(graph);
  });

  it('unwinds a list of literal values', async () => {
    const res = await engine.execute('UNWIND [1, 2, 3] AS x RETURN x');
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0].x).toBe(1);
    expect(res.rows[1].x).toBe(2);
    expect(res.rows[2].x).toBe(3);
  });

  it('unwinds an empty list into zero rows', async () => {
    const res = await engine.execute('UNWIND [] AS x RETURN x');
    expect(res.rows).toHaveLength(0);
  });

  it('unwinds a null into zero rows', async () => {
    const res = await engine.execute('UNWIND null AS x RETURN x');
    expect(res.rows).toHaveLength(0);
  });

  it('unwinds a scalar value into one row', async () => {
    const res = await engine.execute('UNWIND 42 AS x RETURN x');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].x).toBe(42);
  });

  it('can interleave MATCH and UNWIND', async () => {
    await engine.execute('CREATE (a:Person {name: "Alice"})');
    const res = await engine.execute('MATCH (p:Person) UNWIND ["dev", "lead"] AS tag RETURN p.name AS name, tag');
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({ name: 'Alice', tag: 'dev' });
    expect(res.rows[1]).toEqual({ name: 'Alice', tag: 'lead' });
  });

  it('combines UNWIND with CREATE', async () => {
    await engine.execute('UNWIND ["Bob", "Charlie"] AS name CREATE (p:Person) SET p.name = name');
    const res = await engine.execute('MATCH (p:Person) RETURN p.name AS name ORDER BY name');
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].name).toBe('Bob');
    expect(res.rows[1].name).toBe('Charlie');
  });
});
