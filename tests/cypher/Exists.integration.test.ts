import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { CypherEngine } from '../../src/cypher/CypherEngine';
import { Graph } from '../../src/Graph';

describe('Cypher EXISTS Subquery', () => {
  let engine: CypherEngine;
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
    engine = new CypherEngine(graph);

    // Seed graph data
    await engine.execute(`
      CREATE (a:Person {name: 'Alice'}),
             (b:Person {name: 'Bob', age: 30}),
             (c:Person {name: 'Charlie'}),
             (a)-[:KNOWS]->(b),
             (a)-[:KNOWS]->(c)
    `);
  });

  afterEach(async () => {
    // optional cleanup
  });

  it('should filter nodes using EXISTS with a pattern', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      WHERE EXISTS { (p)-[:KNOWS]->(:Person {name: 'Bob'}) }
      RETURN p.name AS name
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Alice');
  });

  it('should filter nodes using EXISTS with a MATCH clause', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      WHERE EXISTS { MATCH (p)-[:KNOWS]->(friend) WHERE friend.age > 25 }
      RETURN p.name AS name
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Alice');
  });

  it('should evaluate EXISTS combined with other conditions correctly', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      WHERE EXISTS { (p)-[:KNOWS]->() } AND p.name = 'Alice'
      RETURN p.name AS name
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Alice');

    const result2 = await engine.execute(`
      MATCH (p:Person)
      WHERE EXISTS { (p)-[:KNOWS]->() } AND p.name = 'Bob'
      RETURN p.name AS name
    `);

    expect(result2.rows).toHaveLength(0); // Bob exists but does not know anyone
  });

  it('should allow EXISTS in RETURN clause', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      RETURN p.name AS name, EXISTS { (p)-[:KNOWS]->() } AS hasFriends
      ORDER BY p.name
    `);

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ name: 'Alice', hasFriends: true });
    expect(result.rows[1]).toEqual({ name: 'Bob', hasFriends: false });
    expect(result.rows[2]).toEqual({ name: 'Charlie', hasFriends: false });
  });

  it('should support EXISTS in SET clause', async () => {
    await engine.execute(`
      MATCH (p:Person)
      SET p.isPopular = EXISTS { (p)-[:KNOWS]->() }
    `);

    const result = await engine.execute(`
      MATCH (p:Person)
      RETURN p.name AS name, p.isPopular AS isPopular
      ORDER BY p.name
    `);

    expect(result.rows[0]).toEqual({ name: 'Alice', isPopular: true });
    expect(result.rows[1]).toEqual({ name: 'Bob', isPopular: false });
  });

  it('should support nested EXISTS subqueries', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      WHERE EXISTS { 
        MATCH (p)-[:KNOWS]->(friend) 
        WHERE EXISTS { (friend)-[:KNOWS]->(:Person) }
      }
      RETURN p.name AS name
    `);
    
    // Alice knows Bob and Charlie, neither of whom know anyone.
    // So there is no friend of Alice who knows someone.
    expect(result.rows).toHaveLength(0);
  });

  it('should support NOT EXISTS', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      WHERE NOT EXISTS { (p)-[:KNOWS]->() }
      RETURN p.name AS name
      ORDER BY p.name
    `);
    
    // Bob and Charlie do not know anyone
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].name).toBe('Bob');
    expect(result.rows[1].name).toBe('Charlie');
  });

  it('should support EXISTS inside an OR clause', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      WHERE EXISTS { (p)-[:KNOWS]->() } OR p.age > 25
      RETURN p.name AS name
      ORDER BY p.name
    `);
    
    // Alice knows people. Bob is > 25. Charlie is neither.
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].name).toBe('Alice');
    expect(result.rows[1].name).toBe('Bob');
  });

  it('should support EXISTS inside an ORDER BY clause', async () => {
    const result = await engine.execute(`
      MATCH (p:Person)
      RETURN p.name AS name
      ORDER BY EXISTS { (p)-[:KNOWS]->() } DESC, p.name ASC
    `);
    
    // Alice (true -> DESC means true first)
    // Then Bob, Charlie (false -> alphabetical)
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].name).toBe('Alice');
    expect(result.rows[1].name).toBe('Bob');
    expect(result.rows[2].name).toBe('Charlie');
  });

});
