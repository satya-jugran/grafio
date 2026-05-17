# Cypher Queries

Query your graph using the openCypher query language.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
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
```

### Mermaid Flowchart

```typescript
const plan = await engine.getQueryPlan(query, undefined, 'mermaid');
```

## Execution Plans

Use `CypherEngineOptions.executionPlan` to get the query execution plan with timing and row statistics:

```typescript
const result = await engine.execute(
  'MATCH (p:Person) RETURN p.name AS name',
  {},
  { executionPlan: { format: 'text' } }
);
console.log(result.executionPlan);
```

### Example: Complex Query with Execution Plan

For a query like:
```cypher
MATCH (p:Person|Product)-[r:KNOWS|BOUGHT]->(t:People|Product)-[r2:IN_CATEGORY]->(c:Category)
WHERE r.weight > 5 AND p.score > 90
RETURN p.label AS personLabel,
       p.score AS personScore,
       avg(t.score) AS avgTargetScore,
       sum(r.weight) AS totalWeight,
       count(r) AS relationshipCount
ORDER BY personScore DESC
```

The **query plan** shows the execution steps:
```
├— NodeScanStep (p:Person|Product { score > 90 })
├— EdgeExpandStep (→) r:KNOWS|BOUGHT → t:People|Product
├— EdgeExpandStep (→) r2:IN_CATEGORY → c:Category
├— FilterStep r.weight > 5
├— AggregateStep [AVG(avgTargetScore), SUM(totalWeight), COUNT(relationshipCount)]
├— SortStep [personScore DESC]
└— ProjectStep [personLabel, personScore, avgTargetScore, totalWeight, relationshipCount]
```

The **execution plan** includes timing, percentage, and row counts:
```
├— NodeScanStep (p:Person|Product { score > 90 }) (1ms, 3.7%, 390 rows)
├— EdgeExpandStep (→) r:KNOWS|BOUGHT → t:People|Product (21ms, 77.8%, 97 rows)
├— EdgeExpandStep (→) r2:IN_CATEGORY → c:Category (5ms, 18.5%, 15 rows)
├— FilterStep r.weight > 5 (0ms, 0.0%, 15 rows)
├— AggregateStep [AVG(avgTargetScore), SUM(totalWeight), COUNT(relationshipCount)] (0ms, 0.0%, 14 rows)
├— SortStep [personScore DESC] (0ms, 0.0%, 14 rows)
└— ProjectStep [personLabel, personScore, avgTargetScore, totalWeight, relationshipCount] (0ms, 0.0%, 14 rows)
```

### Available Formats

```typescript
// Text tree with stats (default when executionPlan is set)
{ executionPlan: { format: 'text' } }

// JSON with full statistics
{ executionPlan: { format: 'json' } }

// Mermaid flowchart
{ executionPlan: { format: 'mermaid' } }
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