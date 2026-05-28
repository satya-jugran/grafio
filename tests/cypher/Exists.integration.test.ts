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
});
