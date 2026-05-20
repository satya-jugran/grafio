# Data Operations

Create, update, and delete nodes and edges using Cypher.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Creating Nodes

### Single Node

```cypher
CREATE (p:Person {name: 'Alice', age: 30})
```

```typescript
await engine.execute(`
  CREATE (p:Person {name: 'Alice', age: 30})
`);
```

### Multiple Nodes

```cypher
CREATE (a:Person {name: 'Alice'}),
       (b:Person {name: 'Bob'}),
       (c:Person {name: 'Charlie'})
```

## Creating Relationships

### Basic Relationship

```cypher
MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
CREATE (a)-[:KNOWS]->(b)
```

### Relationship with Properties

```cypher
MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
CREATE (a)-[:KNOWS {since: 2020, strength: 0.8}]->(b)
```

## Updating Properties

### SET Clause

```cypher
MATCH (p:Person {name: 'Alice'})
SET p.age = 31, p.city = 'NYC'
RETURN p
```

### Update Multiple Properties

```cypher
MATCH (p:Person {name: 'Alice'})
SET p.age = p.age + 1, p.updated = true
RETURN p
```

## Deleting Nodes

### Simple Delete

```cypher
MATCH (p:Person {name: 'Bob'})
DELETE p
```

### DETACH DELETE (Cascade)

Deletes the node and all incident edges:

```cypher
MATCH (p:Person {name: 'Bob'})
DETACH DELETE p
```

This is useful when you want to delete a node without orphaned edges.

## Creating Indexes

### Node Index

```cypher
CREATE INDEX name_idx FOR (n:Person) ON (n.name)
```

### Compound Index

```cypher
CREATE INDEX name_city_idx FOR (n:Person) ON (n.name, n.city)
```

### Edge Index

```cypher
CREATE INDEX since_idx FOR ()-[r:KNOWS]-() ON (r.since)
```

## Dropping Indexes

```cypher
DROP INDEX name_idx
```

## Complete Example

```typescript
// Create nodes
await engine.execute(`
  CREATE (alice:Person {name: 'Alice', age: 30}),
         (bob:Person {name: 'Bob', age: 25}),
         (course:Course {title: 'TypeScript'})
`);

// Create relationships
await engine.execute(`
  MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
  CREATE (a)-[:KNOWS]->(b)
`);

await engine.execute(`
  MATCH (a:Person {name: 'Alice'}), (c:Course {title: 'TypeScript'})
  CREATE (a)-[:AUTHOR_OF]->(c)
`);

// Create index
await engine.execute(`
  CREATE INDEX name_idx FOR (n:Person) ON (n.name)
`);

// Query the graph
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS]->(b:Person)
  RETURN a.name, b.name
`);
```

## Next Steps

- [Cypher Language](./cypher-language) — syntax reference
- [Filtering](./filtering) — WHERE patterns
- [Transactions](./transactions) — atomic operations