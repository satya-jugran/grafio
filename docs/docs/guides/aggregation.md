# Aggregation

Aggregate data using Cypher's aggregation functions.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Aggregation Functions

| Function | Description |
|----------|-------------|
| `COUNT(*)` | Count all rows |
| `COUNT(expr)` | Count non-null values |
| `COUNT(DISTINCT expr)` | Count unique values |
| `AVG(expr)` | Average of numeric values |
| `SUM(expr)` | Sum of numeric values |
| `MIN(expr)` | Minimum value |
| `MAX(expr)` | Maximum value |
| `COLLECT(expr)` | Collect values into array |

## Basic Aggregation

### Count All

```cypher
MATCH (p:Person) 
RETURN COUNT(p) AS total
```

### Average

```cypher
MATCH (p:Person) 
RETURN AVG(p.age) AS avgAge
```

### Sum

```cypher
MATCH (p:Person) 
RETURN SUM(p.age) AS totalAge
```

### Min/Max

```cypher
MATCH (p:Person) 
RETURN MIN(p.age) AS youngest, MAX(p.age) AS oldest
```

## With Type Filter

```cypher
MATCH (p:Product) 
RETURN COUNT(p) AS count, AVG(p.price) AS avgPrice
```

## With GROUP BY

```cypher
MATCH (p:Person) 
RETURN p.city, COUNT(p) AS count, AVG(p.age) AS avgAge
ORDER BY count DESC
```

## Using DISTINCT

```cypher
MATCH (p:Person)-[:KNOWS]->(f:Person) 
RETURN COUNT(DISTINCT f.city) AS uniqueCities
```

## Complex Example

```cypher
MATCH (p:Person) 
RETURN p.city AS city,
       COUNT(p) AS count,
       AVG(p.age) AS avgAge,
       MIN(p.age) AS youngest,
       MAX(p.age) AS oldest
ORDER BY count DESC
```

## Next Steps

- [Graph Analysis](./graph-analysis) — DAG detection and topological sort
- [Cypher Language](./cypher-language) — aggregation in Cypher