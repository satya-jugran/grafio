# Cypher Queries

Query your graph using the openCypher query language.

## Setup

```typescript
import { Graph } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const graph = new Graph();
// ... add nodes and edges ...

const engine = new CypherEngine(graph);
```

## Basic Queries

### Match Nodes by Type

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

### Filter with WHERE

```cypher
MATCH (p:Person) 
WHERE p.age > 25 
RETURN p.name
```

### Follow Relationships

```cypher
MATCH (a:Person)-[:KNOWS]->(b:Person) 
RETURN a.name, b.name
```

## Aggregation Functions

| Function | Description |
|----------|-------------|
| `COUNT(*)` | Count rows |
| `COUNT(expr)` | Count non-null values |
| `COUNT(DISTINCT expr)` | Count unique values |
| `AVG(expr)` | Average of numeric values |
| `SUM(expr)` | Sum of numeric values |
| `MIN(expr)` | Minimum value |
| `MAX(expr)` | Maximum value |
| `COLLECT(expr)` | Collect values into array |

### Examples

```cypher
// Count all people
MATCH (p:Person) RETURN COUNT(p) AS total

// Group by city
MATCH (p:Person) 
RETURN p.city, COUNT(*) AS cnt 
ORDER BY cnt DESC

// Multiple aggregates
MATCH (p:Person) 
RETURN MIN(p.age), MAX(p.age), AVG(p.age)
```

## Variable-Length Paths

Match paths of variable length:

```cypher
// 1 to 3 hops
MATCH (a:Person)-[:KNOWS*1..3]->(b:Person) 
RETURN a.name, b.name

// Exactly 2 hops
MATCH (a:Person)-[:KNOWS*2]->(b:Person) 
RETURN a.name, b.name

// Up to 5 hops
MATCH (a:Person)-[:KNOWS*..5]->(b:Person) 
RETURN a.name, b.name
```

## Named Paths

Capture traversal paths as variables:

```cypher
MATCH p = (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person) 
RETURN p
```

## Pagination

```cypher
MATCH (p:Person) 
RETURN p.name 
ORDER BY p.age DESC 
SKIP 0 
LIMIT 10
```

## Query Plans

### Logical Plan (JSON)

```typescript
const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p.name');
```

### Text Tree

```typescript
const plan = await engine.getQueryPlan(
  'MATCH (p:Person)-[:KNOWS]->(b) RETURN p.name, b.name',
  undefined,
  'text'
);
/*
NodeScanStep (Person)
  EdgeExpandStep (KNOWS, outgoing)
    ProjectStep [p.name, b.name]
*/
```

### Mermaid Flowchart

```typescript
const plan = await engine.getQueryPlan(query, undefined, 'mermaid');
```

## Supported Clauses

| Clause | Support | Notes |
|--------|---------|-------|
| `MATCH` | ✅ Read-only | Typed/untyped nodes, directed edges |
| `WHERE` | ✅ Full expressions | AND/OR/NOT, comparisons, IN, IS NULL |
| `RETURN` | ✅ With DISTINCT | Property access, aliases with AS |
| `ORDER BY` | ✅ ASC/DESC | Default ASC |
| `SKIP` | ✅ Literal + `$param` | Runtime evaluation |
| `LIMIT` | ✅ Literal + `$param` | Runtime evaluation |
| `CREATE/DELETE/SET` | ❌ Rejected | Read-only engine |

## Next Steps

- [Tutorials](../tutorials/multi-hop-queries) — pattern matching examples
- [API Reference](../api-reference/cypher-engine) — full engine API
- [Error Handling](../api-reference/cypher-errors) — error types