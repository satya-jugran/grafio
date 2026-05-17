# Aggregation

Aggregate node and edge properties using SUM, AVG, MIN, MAX operations.

## Overview

Grafio provides property aggregation functions that compute statistics across nodes or edges sharing a property key.

## aggregateNodeProperty()

```typescript
async aggregateNodeProperty(
  key: string,
  options?: GraphQueryOptions
): Promise<AggregateResult>
```

Computes aggregate statistics for a node property.

### AggregateResult

```typescript
interface AggregateResult {
  count: number;   // Count of non-null values (always present)
  sum?: number;    // Sum of values (SUM operation)
  avg?: number;    // Average of values (AVG operation)
  min?: number;    // Minimum value (MIN operation)
  max?: number;    // Maximum value (MAX operation)
}
```

### Basic Example

```typescript
import { InMemoryGraphFactory } from 'grafio';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph();

// Add products with prices
await graph.addNode('Product', { name: 'Laptop', price: 999 });
await graph.addNode('Product', { name: 'Phone', price: 699 });
await graph.addNode('Product', { name: 'Tablet', price: 449 });

// Aggregate prices
const result = await graph.aggregateNodeProperty('price');
console.log(result);
// { count: 3, sum: 2147, avg: 715.67, min: 449, max: 999 }
```

### With Type Filter

```typescript
// Only aggregate prices for Product nodes
const result = await graph.aggregateNodeProperty('price', {
  filter: { types: ['Product'] }
});
```

### Using Distinct

```typescript
// Count unique prices (deduplicate values)
const result = await graph.aggregateNodeProperty('price', {
  distinct: true
});
```

## aggregateEdgeProperty()

```typescript
async aggregateEdgeProperty(
  key: string,
  options?: GraphQueryOptions
): Promise<AggregateResult>
```

Computes aggregate statistics for an edge property.

### Example: Order Weights

```typescript
// Add shipping relationships with weights
await graph.addEdge('warehouse1', 'store1', 'SHIPS', { weight: 150 });
await graph.addEdge('warehouse1', 'store2', 'SHIPS', { weight: 200 });
await graph.addEdge('warehouse1', 'store3', 'SHIPS', { weight: 175 });

// Aggregate shipment weights
const result = await graph.aggregateEdgeProperty('weight', {
  filter: { types: ['SHIPS'] }
});
console.log(result);
// { count: 3, sum: 525, avg: 175, min: 150, max: 200 }
```

## Common Use Cases

### Average Rating

```typescript
// Products with customer ratings
await graph.addNode('Product', { name: 'Widget', rating: 4.5 });
await graph.addNode('Product', { name: 'Gadget', rating: 4.8 });
await graph.addNode('Product', { name: 'Tool', rating: 4.2 });

const result = await graph.aggregateNodeProperty('rating');
console.log(`Average rating: ${result.avg?.toFixed(1)}`); // "Average rating: 4.5"
```

### Minimum/Maximum Values

```typescript
// Find temperature ranges in sensor data
const tempResult = await graph.aggregateNodeProperty('temperature');
console.log(`Range: ${tempResult.min}°C - ${tempResult.max}°C`);
```

### Count by Type

```typescript
// Count users by status
const userCount = await graph.aggregateNodeProperty('status', {
  filter: { types: ['User'] }
});
console.log(`Total users: ${userCount.count}`);
```

## With Cypher Queries

Aggregation works seamlessly with Cypher:

```cypher
MATCH (p:Product)
RETURN count(p) AS count, avg(p.price) AS avgPrice, min(p.price) AS minPrice, max(p.price) AS maxPrice
```

## Next Steps

- [Graph Analysis](./graph-analysis) — DAG detection and topological sort
- [Cypher Queries](./cypher-queries) — aggregation in Cypher
- [API Reference](../api-reference/graph) — full method reference