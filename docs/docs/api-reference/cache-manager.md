# CacheManager

Manages cache across multiple graphId partitions with budget enforcement.

## Import

```typescript
import { CacheManager } from 'grafio';
```

## getStats()

```typescript
static getStats(graphId: string): CacheStats
```

Get cache statistics for a specific graph.

### CacheStats

```typescript
interface CacheStats {
  hits: number;           // Total cache hits
  misses: number;         // Total cache misses
  hitRate: number;        // Hit rate as percentage
  nodesCount: number;     // Current cached nodes
  edgesCount: number;     // Current cached edges
}
```

### Example

```typescript
import { CacheManager } from 'grafio';

const stats = CacheManager.getStats('default');
console.log(`Hits: ${stats.hits}, Misses: ${stats.misses}`);
console.log(`Hit rate: ${stats.hitRate.toFixed(2)}%`);
console.log(`Nodes: ${stats.nodesCount}, Edges: ${stats.edgesCount}`);
```

## clearCache()

```typescript
static clearCache(graphId: string): void
```

Clear cache for a specific graph.

```typescript
CacheManager.clearCache('default');
```

## clearAllCaches()

```typescript
static clearAllCaches(): void
```

Clear cache for all graphs.

```typescript
CacheManager.clearAllCaches();
```

## setBudget()

```typescript
static setBudget(graphId: string, budget: { maxNodes?: number; maxEdges?: number }): void
```

Update budget for a specific graph.

```typescript
CacheManager.setBudget('default', { maxNodes: 20000, maxEdges: 40000 });
```

## getBudget()

```typescript
static getBudget(graphId: string): { maxNodes: number; maxEdges: number } | undefined
```

Get current budget for a graph.

```typescript
const budget = CacheManager.getBudget('default');
if (budget) {
  console.log(`Max nodes: ${budget.maxNodes}`);
  console.log(`Max edges: ${budget.maxEdges}`);
}
```

## Events

The CacheManager emits events for monitoring:

```typescript
cacheManager.on('hit', ({ graphId, key }) => { /* ... */ });
cacheManager.on('miss', ({ graphId, key }) => { /* ... */ });
cacheManager.on('eviction', ({ graphId, key, reason }) => { /* ... */ });
```

## Next Steps

- [Caching](../guides/caching) — cache configuration guide
- [Graph Manager API](./graph-manager) — GraphManager reference