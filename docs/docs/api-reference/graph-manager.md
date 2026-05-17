# GraphManager

Application-scoped singleton for cache initialization and management.

## Import

```typescript
import { GraphManager } from 'grafio';
```

## init()

```typescript
static init(config: GraphManagerConfig): void
```

Initialize the GraphManager with cache configuration.

### GraphManagerConfig

```typescript
interface GraphManagerConfig {
  cache?: CacheConfig;
}
```

### Example

```typescript
import { GraphManager, InMemoryStorageProvider } from 'grafio';

GraphManager.init({
  cache: {
    maxNodesCount: 10000,
    maxEdgesCount: 20000,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  }
});

// Graph instances now use caching automatically
const graph = new Graph(new InMemoryStorageProvider());
```

## getCacheManager()

```typescript
static getCacheManager(): CacheManager | undefined
```

Returns the CacheManager instance if initialized with cache config.

```typescript
const cacheManager = GraphManager.getCacheManager();
if (cacheManager) {
  const stats = cacheManager.getStats('default');
}
```

## reset()

```typescript
static reset(): void
```

Reset the GraphManager singleton. Mainly for testing.

```typescript
GraphManager.reset();
GraphManager.init({ /* new config */ });
```

## Next Steps

- [Caching](../guides/caching) — cache configuration guide
- [Cache Manager API](./cache-manager) — CacheManager reference