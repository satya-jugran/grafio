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

`GraphManager` provides application-scoped cache configuration for remote/async storage providers (such as `grafio-mongo` or `CachedStorageProvider` wrappers). `InMemoryGraphFactory` binds directly to `InMemoryStorageProvider` without redundant cache wrapping.

```typescript
import {
  Graph,
  GraphManager,
  CachedStorageProvider,
  InMemoryStorageProvider,
} from 'grafio';

GraphManager.init({
  cache: {
    maxNodesCount: 10000,
    maxEdgesCount: 20000,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  },
});

const manager = GraphManager.getInstance();
const cacheManager = manager.getCacheManager()!;
const cacheConfig = manager.getConfig().cache!;
const backingProvider = new InMemoryStorageProvider({ graphId: 'remote-demo' });
const cachedProvider = new CachedStorageProvider(
  backingProvider,
  'remote-demo',
  cacheManager,
  cacheConfig,
);
const graph = new Graph(cachedProvider);
```

## getInstance() & getCacheManager()

```typescript
static getInstance(): GraphManager
getCacheManager(): CacheManager | null
```

Returns the active `CacheManager` instance if initialized with a `cache` config:

```typescript
const cacheManager = GraphManager.getInstance().getCacheManager();
if (cacheManager) {
  const stats = cacheManager.getStats();
  console.log(stats.hitCount, stats.missCount, stats.hitRate);
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