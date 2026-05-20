# Querying Graph

Advanced query patterns for navigating and exploring your graph.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Basic Queries

### Match All Nodes

```cypher
MATCH (n) RETURN n
```

```typescript
const result = await engine.query('MATCH (n) RETURN n');
```

### Match Nodes by Label

```cypher
MATCH (p:Person) RETURN p.name, p.age
```

### Match with WHERE Filter

```cypher
MATCH (p:Person)
WHERE p.age > 25 AND p.city = 'NYC'
RETURN p.name, p.city
```

### Follow Single Relationship

```cypher
MATCH (a:Person)-[:KNOWS]->(b:Person)
RETURN a.name, b.name
```

### Return with Aggregation

```cypher
MATCH (p:Person)
RETURN COUNT(p) AS total, AVG(p.age) AS avgAge
```

## Variable-Length Paths

Match paths of variable length between two nodes.

### Fixed Range

```cypher
// 1 to 3 hops
MATCH (a:Person)-[:KNOWS*1..3]->(b:Person) 
RETURN a.name, b.name
```

### Exact Length

```cypher
// Exactly 2 hops
MATCH (a:Person)-[:KNOWS*2]->(b:Person) 
RETURN a.name, b.name
```

### Unbounded

```cypher
// Up to 5 hops
MATCH (a:Person)-[:KNOWS*..5]->(b:Person) 
RETURN a.name, b.name
```

### Zero or More

```cypher
// Zero or more hops (includes self)
MATCH (a:Person)-[:KNOWS*]->(b:Person) 
RETURN a.name, b.name
```

## Named Paths

Capture traversal paths as variables for later use.

```cypher
MATCH p = (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person) 
WHERE length(p) > 1
RETURN p
```

### Use Cases

- Finding paths between nodes
- Analyzing network structure
- Path validation

## Pattern Combinations

### Multiple Relationship Types

```cypher
MATCH (p:Person)-[:KNOWS|FOLLOWS]->(other:Person) 
RETURN p.name, other.name
```

### Optional Type Matching

```cypher
MATCH (p:Person|Product)-[r:KNOWS|BOUGHT]->(t:People|Product) 
WHERE r.weight > 5
RETURN p.name, t.name
```

## Aggregation with Paths

```cypher
MATCH (a:Person)-[:KNOWS*1..3]->(b:Person) 
RETURN a.name, COUNT(b) AS reachableCount
ORDER BY reachableCount DESC
```

## Finding Shortest Path

```cypher
MATCH (start:Person {name: 'Alice'})-[*1..5]->(end:Person {name: 'Eve'}) 
RETURN end.name
```

Grafio uses BFS by default for shortest path queries.

## DISTINCT with Variable Length

```cypher
MATCH (a:Person)-[:KNOWS*1..2]->(b:Person) 
RETURN DISTINCT a.name, b.name
```

## Pagination

Combine with SKIP/LIMIT for paginated results:

```cypher
MATCH (p:Person)-[:KNOWS]->(f:Person) 
RETURN f.name 
ORDER BY f.name 
SKIP 0 
LIMIT 10
```

## Next Steps

- [Cypher Language](./cypher-language) — basic syntax reference
- [Filtering](./filtering) — WHERE clause patterns
- [Aggregation](./aggregation) — counting and grouping