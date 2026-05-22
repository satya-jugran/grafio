# Query Plans

Understand how Grafio executes your Cypher queries.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Query Plan vs Execution Plan

| Plan Type | Purpose | When to Use |
|-----------|---------|-------------|
| **Query Plan** | Logical execution strategy | Debugging query performance |
| **Execution Plan** | Runtime statistics | Performance tuning |

## Query Plans

Get the logical query plan without executing.

### Text Tree Format

```typescript
const plan = await engine.getQueryPlan(
  'MATCH (p:Person)-[:KNOWS]->(b) RETURN p.name, b.name',
  undefined,
  'text'
);
console.log(plan);
```

Output:
```
├— ProjectStep [p.name, b.name]
├— EdgeExpandStep (→) r:KNOWS → b:Person
└— NodeScanStep (p:Person)
```

### JSON Format

```typescript
const plan = await engine.getQueryPlan(
  'MATCH (p:Person) RETURN p.name',
  undefined,
  'json'
);
console.log(JSON.stringify(plan, null, 2));
```

### Mermaid Flowchart

```typescript
const plan = await engine.getQueryPlan(
  'MATCH (p:Person)-[:KNOWS]->(b) RETURN p.name, b.name',
  undefined,
  'mermaid'
);
console.log(plan);
```

## Execution Plans

Get runtime statistics with timing and row counts.

```typescript
const result = await engine.execute(
  'MATCH (p:Person) RETURN p.name AS name',
  {},
  { executionPlan: { format: 'text' } }
);
console.log(result.executionPlan);
```

Output:
```
├— ProjectStep [name] (1ms, 3.7%, 100 rows)
└— NodeScanStep (p:Person) (25ms, 96.3%, 100 rows)
```

### Available Formats

```typescript
// Text tree with statistics
{ executionPlan: { format: 'text' } }

// JSON with full statistics
{ executionPlan: { format: 'json' } }

// Mermaid flowchart
{ executionPlan: { format: 'mermaid' } }
```

## Example: Complex Query

For a query like:

```cypher
MATCH (p:Person)-[r1:BOUGHT]->(t:Product)-[r2:IN_CATEGORY]->(c:Category)
WHERE r1.weight > 5 AND r1.weight < r2.weight AND p.score > 50
RETURN p.label AS personLabel,
      t.label AS productLabel,
      c.label AS categoryLabel,
      p.score AS personScore,
      avg(t.score) AS avgTargetScore,
      sum(r1.weight) AS totalWeight,
      count(r1) AS relationshipCount
ORDER BY personScore DESC
```

### Query Plan

```
├— NodeScanStep (p:Person { score > 50 })
├— EdgeExpandStep (→) r1:BOUGHT { weight > 5 } → t:Product
├— EdgeExpandStep (→) r2:IN_CATEGORY → c:Category
├— FilterStep r1.weight < r2.weight
├— AggregateStep [AVG(avgTargetScore), SUM(totalWeight), COUNT(relationshipCount)]
├— SortStep [personScore DESC]
└— ProjectStep [personLabel, productLabel, categoryLabel, personScore, avgTargetScore, totalWeight, relationshipCount]
```

### Execution Plan

```
├— NodeScanStep (p:Person { score > 50 }) (3ms, 4.3%, 1003 rows)
├— EdgeExpandStep (→) r1:BOUGHT { weight > 5 } → t:Product (57ms, 82.6%, 122 rows)
├— EdgeExpandStep (→) r2:IN_CATEGORY → c:Category (7ms, 10.1%, 14 rows)
├— FilterStep r1.weight < r2.weight (1ms, 1.4%, 7 rows)
├— AggregateStep [AVG(avgTargetScore), SUM(totalWeight), COUNT(relationshipCount)] (0ms, 0.0%, 7 rows)
├— SortStep [personScore DESC] (0ms, 0.0%, 7 rows)
└— ProjectStep [personLabel, productLabel, categoryLabel, personScore, avgTargetScore, totalWeight, relationshipCount] (1ms, 1.4%, 7 rows)
```

## Performance Tips

### Use Indexes

```cypher
-- Without index: Full scan
MATCH (p:Person {name: 'Alice'}) RETURN p

-- With index: Fast lookup
CREATE INDEX name_idx FOR (n:Person) ON (n.name)
MATCH (p:Person {name: 'Alice'}) RETURN p
```

### Limit Results Early

```cypher
-- Limit at the end
MATCH (p:Person) RETURN p.name LIMIT 10

-- Combine with filter
MATCH (p:Person {city: 'NYC'}) RETURN p.name LIMIT 10
```

### Use CypherEngineOptions.maxDegreeOfParallelism
```typescript
const engine = new CypherEngine(graph, { maxDegreeOfParallelism: 8 })
```

## Next Steps

- [Exception Handling](./exception-handling) — error handling
- [Cypher Language](./cypher-language) — syntax reference
- [API Reference: Cypher Engine](../api-reference/cypher-engine) — full engine API