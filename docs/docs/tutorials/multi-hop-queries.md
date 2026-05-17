# Multi-Hop Queries Tutorial

Learn pattern matching with variable-length paths.

## What You'll Build

A network where we explore multi-hop relationship patterns.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);

// Build a network
const alice = await graph.addNode('Person', { name: 'Alice' });
const bob = await graph.addNode('Person', { name: 'Bob' });
const carol = await graph.addNode('Person', { name: 'Carol' });
const dave = await graph.addNode('Person', { name: 'Dave' });
const eve = await graph.addNode('Person', { name: 'Eve' });

// Alice KNOWS Bob KNOWS Carol KNOWS Dave
await graph.addEdge(alice.id, bob.id, 'KNOWS');
await graph.addEdge(bob.id, carol.id, 'KNOWS');
await graph.addEdge(carol.id, dave.id, 'KNOWS');

// Alice also KNOWS Eve directly
await graph.addEdge(alice.id, eve.id, 'KNOWS');
```

## 1-Hop Queries (Direct Connections)

```cypher
MATCH (a:Person)-[:KNOWS]->(b:Person)
RETURN a.name, b.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS]->(b:Person)
  RETURN a.name, b.name
`);
// Alice->Bob, Bob->Carol, Carol->Dave, Alice->Eve
```

## 2-Hop Queries (Friends of Friends)

```cypher
MATCH (a:Person)-[:KNOWS*2]->(c:Person)
RETURN a.name, c.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS*2]->(c:Person)
  RETURN a.name, c.name
`);
// Alice->Carol (via Bob), Bob->Dave (via Carol)
```

## 3-Hop Queries (Friends of Friends of Friends)

```cypher
MATCH (a:Person)-[:KNOWS*3]->(d:Person)
RETURN a.name, d.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS*3]->(d:Person)
  RETURN a.name, d.name
`);
// Alice->Dave (via Bob->Carol)
```

## Variable Length: 1 to 3 Hops

```cypher
MATCH (a:Person)-[:KNOWS*1..3]->(reachable)
RETURN a.name, reachable.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS*1..3]->(r:Person)
  RETURN a.name, r.name
`);
// All people reachable within 1-3 hops
```

## Bounded Length

```cypher
MATCH (a:Person)-[:KNOWS*2..2]->(b:Person)
RETURN a.name, b.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS*2..2]->(b:Person)
  RETURN a.name, b.name
`);
// Exactly 2 hops only
```

## Unbounded (Up to 100 Hops)

```cypher
MATCH (a:Person)-[:KNOWS*]->(b:Person)
RETURN a.name, b.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS*]->(b:Person)
  RETURN a.name, b.name
`);
// All reachable (up to 100 hops default)
```

## Capture Named Paths

```cypher
MATCH p = (a:Person)-[:KNOWS*]->(b:Person)
WHERE length(p) > 1
RETURN p
```

```typescript
const result = await engine.query(`
  MATCH p = (a:Person)-[:KNOWS*]->(b:Person)
  WHERE length(p) > 1
  RETURN p
`);
```

## DISTINCT to Avoid Duplicates

```cypher
MATCH (a:Person)-[:KNOWS*1..2]->(b:Person)
RETURN DISTINCT a.name, b.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS*1..2]->(b:Person)
  RETURN DISTINCT a.name, b.name
`);
```

## Finding Shortest Path

BFS is used by default for shortest path:

```cypher
MATCH (a:Person {name: 'Alice'})-[:KNOWS*1..3]->(e:Person {name: 'Eve'})
RETURN a.name, e.name
```

```typescript
const result = await engine.query(`
  MATCH (a:Person {name: 'Alice'})-[:KNOWS*1..3]->(e:Person {name: 'Eve'})
  RETURN a.name, e.name
`);
// Alice->Eve directly (shortest path)
```

## Complete Example

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

async function main() {
  const factory = new InMemoryGraphFactory();
  const graph = factory.forGraph();
  const engine = new CypherEngine(graph);

  // Build network
  const [alice, bob, carol, dave, eve] = await Promise.all([
    graph.addNode('Person', { name: 'Alice' }),
    graph.addNode('Person', { name: 'Bob' }),
    graph.addNode('Person', { name: 'Carol' }),
    graph.addNode('Person', { name: 'Dave' }),
    graph.addNode('Person', { name: 'Eve' }),
  ]);

  await graph.addEdge(alice.id, bob.id, 'KNOWS');
  await graph.addEdge(bob.id, carol.id, 'KNOWS');
  await graph.addEdge(carol.id, dave.id, 'KNOWS');
  await graph.addEdge(alice.id, eve.id, 'KNOWS');

  // Multi-hop queries
  const foaf = await engine.query(`
    MATCH (me:Person {name: 'Alice'})-[:KNOWS*2]->(friend)
    RETURN DISTINCT friend.name
  `);

  const reachable = await engine.query(`
    MATCH (me:Person {name: 'Alice'})-[:KNOWS*1..3]->(reachable)
    RETURN DISTINCT reachable.name
    ORDER BY reachable.name
  `);

  console.log('Friends of friends:', foaf.rows);
  console.log('All reachable:', reachable.rows);
}

main();
```

## Next Steps

- [Cypher Queries Guide](../guides/cypher-queries) — full Cypher reference
- [Social Network Tutorial](../tutorials/social-network) — apply to real use case
- [Traversal Guide](../guides/traversal) — non-Cypher traversal methods