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
└─ ProjectStep [p.name, b.name]
   └─ EdgeExpandStep (→) r:KNOWS → b:Person
      └─ NodeScanStep (p:Person)
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
└─ ProjectStep [name] (1ms, 3.7%, 100 rows)
   └─ NodeScanStep (p:Person) (25ms, 96.3%, 100 rows)
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
MATCH (p:Person|Product)-[r:KNOWS|BOUGHT]->(t:People|Product)-[r2:IN_CATEGORY]->(c:Category)
WHERE r.weight > 5 AND p.score > 90
RETURN p.label AS personLabel,
       p.score AS personScore,
       avg(t.score) AS avgTargetScore,
       sum(r.weight) AS totalWeight,
       count(r) AS relationshipCount
ORDER BY personScore DESC
```

### Query Plan

```
└─ ProjectStep [personLabel, personScore, avgTargetScore, totalWeight, relationshipCount]
   └─ SortStep [personScore DESC]
      └─ AggregateStep [AVG(avgTargetScore), SUM(totalWeight), COUNT(relationshipCount)]
         └─ FilterStep r.weight > 5
            └─ EdgeExpandStep (→) r2:IN_CATEGORY → c:Category
               └─ EdgeExpandStep (→) r:KNOWS|BOUGHT → t:People|Product
                  └─ FilterStep p.score > 90
                     └─ NodeScanStep (p:Person|Product { score > 90 })
```

### Execution Plan

```
└─ ProjectStep [personLabel, ...] (0ms, 0.0%, 14 rows)
   └─ SortStep [personScore DESC] (0ms, 0.0%, 14 rows)
      └─ AggregateStep [AVG(avgTargetScore), ...] (0ms, 0.0%, 14 rows)
         └─ FilterStep r.weight > 5 (0ms, 0.0%, 15 rows)
            └─ EdgeExpandStep (→) r2:IN_CATEGORY → c:Category (5ms, 18.5%, 15 rows)
               └─ EdgeExpandStep (→) r:KNOWS|BOUGHT → t:People|Product (21ms, 77.8%, 97 rows)
                  └─ FilterStep p.score > 90 (0ms, 0.0%, 390 rows)
                     └─ NodeScanStep (p:Person|Product { score > 90 }) (1ms, 3.7%, 390 rows)
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

### Filter Early

```cypher
-- Less efficient: Filter after expand
MATCH (p:Person)-[:KNOWS]->(f) WHERE p.name = 'Alice' RETURN f

-- More efficient: Filter during scan
MATCH (p:Person {name: 'Alice'})-[:KNOWS]->(f) RETURN f
```

### Limit Results Early

```cypher
-- Limit at the end
MATCH (p:Person) RETURN p.name LIMIT 10

-- Combine with filter
MATCH (p:Person {city: 'NYC'}) RETURN p.name LIMIT 10
```

## Next Steps

- [Exception Handling](./exception-handling) — error handling
- [Cypher Language](./cypher-language) — syntax reference
- [API Reference: Cypher Engine](../api-reference/cypher-engine) — full engine API