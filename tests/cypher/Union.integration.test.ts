// No vitest import, use jest globals
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { CypherEngine } from '../../src/cypher/CypherEngine';
import { CypherSemanticError } from '../../src/cypher/errors';

describe('Cypher UNION clauses', () => {
  let graph: Graph;
  let engine: CypherEngine;

  beforeEach(async () => {
    graph = new Graph();
    engine = new CypherEngine(graph);
    
    // Setup initial data
    await engine.execute('CREATE (n:Person {name: "Alice", age: 30})');
    await engine.execute('CREATE (n:Person {name: "Bob", age: 40})');
    await engine.execute('CREATE (n:Animal {name: "Charlie", age: 5})');
    await engine.execute('CREATE (n:Person {name: "Charlie", age: 30})');
  });

  afterEach(() => {
    // cleanup not strictly necessary as new graph is created per test
  });

  it('should evaluate UNION ALL correctly without deduplication', async () => {
    const res = await engine.execute(`
      MATCH (p:Person) RETURN p.name AS name
      UNION ALL
      MATCH (a:Animal) RETURN a.name AS name
      UNION ALL
      MATCH (p:Person {name: "Alice"}) RETURN p.name AS name
    `);
    
    expect(res.columns).toEqual(['name']);
    const names = res.rows.map(r => r.name);
    // Should have 3 persons + 1 animal + 1 person again = 5 total
    expect(names.length).toBe(5);
    expect(names.filter(n => n === 'Alice').length).toBe(2);
    expect(names).toContain('Charlie');
  });

  it('should evaluate UNION correctly with deduplication', async () => {
    const res = await engine.execute(`
      MATCH (p:Person) RETURN p.name AS name, p.age AS age
      UNION
      MATCH (p:Person {name: "Alice"}) RETURN p.name AS name, p.age AS age
      UNION
      MATCH (a:Animal) RETURN a.name AS name, a.age AS age
    `);
    
    expect(res.columns).toEqual(['name', 'age']);
    const names = res.rows.map(r => r.name);
    // Total distinct rows:
    // Alice, 30
    // Bob, 40
    // Charlie, 30
    // Charlie, 5
    expect(names.length).toBe(4);
    expect(names.filter(n => n === 'Alice').length).toBe(1); // Deduplicated!
  });

  it('should enforce same number of columns in UNION', async () => {
    await expect(engine.execute(`
      MATCH (p:Person) RETURN p.name AS name, p.age AS age
      UNION
      MATCH (a:Animal) RETURN a.name AS name
    `)).rejects.toThrowError(CypherSemanticError);
  });

  it('should enforce same column aliases in UNION', async () => {
    await expect(engine.execute(`
      MATCH (p:Person) RETURN p.name AS name
      UNION
      MATCH (a:Animal) RETURN a.name AS the_name
    `)).rejects.toThrowError(CypherSemanticError);
  });

  it('should apply global ORDER BY on a UNION', async () => {
    const res = await engine.execute(`
      MATCH (p:Person) RETURN p.name AS n
      UNION
      MATCH (a:Animal) RETURN a.name AS n
      ORDER BY n DESC
    `);
    const names = res.rows.map(r => r.n);
    expect(names).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('should apply global LIMIT on a UNION', async () => {
    const res = await engine.execute(`
      MATCH (p:Person) RETURN p.name AS n
      UNION
      MATCH (a:Animal) RETURN a.name AS n
      ORDER BY n ASC
      LIMIT 2
    `);
    const names = res.rows.map(r => r.n);
    expect(names).toEqual(['Alice', 'Bob']);
  });
});
