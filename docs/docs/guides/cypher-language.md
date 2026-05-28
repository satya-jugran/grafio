# Cypher Language

Learn the openCypher query language syntax for interacting with your graph.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Basic Clauses

### MATCH

Match nodes by type:

```cypher
MATCH (p:Person) 
RETURN p.name, p.age
```

```typescript
const result = await engine.query(`
  MATCH (p:Person) 
  RETURN p.name, p.age
`);
```

### WHERE

Filter with conditions:

```cypher
MATCH (p:Person) 
WHERE p.age > 25 
RETURN p.name
```

### RETURN

Return properties with aliases:

```cypher
MATCH (p:Person) 
RETURN p.name AS fullName, p.age AS years
```

### ORDER BY

Sort results:

```cypher
MATCH (p:Person) 
RETURN p.name, p.age 
ORDER BY p.age DESC
```

### DISTINCT

Remove duplicates:

```cypher
MATCH (p:Person)-[:KNOWS]->(f:Person) 
RETURN DISTINCT f.city
```

### SKIP / LIMIT

Pagination:

```cypher
MATCH (p:Person) 
RETURN p.name 
ORDER BY p.name 
SKIP 10 
LIMIT 5
```

### WITH

Chain operations:

```cypher
MATCH (p:Person)-[:KNOWS]->(f:Person) 
WITH f, COUNT(*) AS friends 
WHERE friends > 3 
RETURN f.name, friends
```

### EXISTS

Evaluate existential subqueries:

```cypher
MATCH (p:Person)
WHERE EXISTS { MATCH (p)-[:KNOWS]->(f:Person) WHERE f.age > 25 }
RETURN p.name
```


## Node Patterns

### Undirected Relationships

```cypher
MATCH (a:Person)-[:KNOWS]-(b:Person) 
RETURN a.name, b.name
```

### Directed Relationships

```cypher
MATCH (a:Person)-[:KNOWS]->(b:Person) 
RETURN a.name, b.name
```

### Type Filtering

```cypher
MATCH (p:Person|Product) 
RETURN p.name
```

## Property Access

```cypher
MATCH (p:Person {name: 'Alice'}) 
RETURN p.name, p.age
```



## Next Steps

- [Querying Graph](./querying-graph) — variable-length paths and advanced patterns
- [Filtering](./filtering) — WHERE clause patterns
- [Aggregation](./aggregation) — COUNT, AVG, SUM, GROUP BY