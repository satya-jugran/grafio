# CacheConfig

Configuration options for the caching layer.

## Import

```typescript
import type { CacheConfig, EvictionStrategy, PreloadStrategy, CacheStoreType } from 'grafio';
```

## Interface

```typescript
interface CacheConfig {
  maxNodesCount: number;        // Maximum nodes to cache
  maxEdgesCount: number;        // Maximum edges to cache
  cacheStore: CacheStoreType;   // Cache backend
  evictionStrategy: EvictionStrategy;  // Eviction algorithm
  preloadStrategy: PreloadStrategy;     // Preload strategy
  ttlSeconds?: number;          // Redis TTL (if using Redis)
}
```

## EvictionStrategy

```typescript
type EvictionStrategy = 'LRU' | 'LFU' | 'FIFO';
```

| Strategy | Full Name | Description |
|----------|-----------|-------------|
| `'LRU'` | Least Recently Used | Evicts least recently accessed items |
| `'LFU'` | Least Frequently Used | Evicts least frequently accessed items |
| `'FIFO'` | First In, First Out | Evicts oldest items first |

**Recommendation:**
- `LRU` — for temporal access patterns
- `LFU` — for frequency-based access
- `FIFO` — for simple caching needs

## PreloadStrategy

```typescript
type PreloadStrategy = 'none' | 'all' | 'first-n';
```

| Strategy | Description |
|----------|-------------|
| `'none'` | No preload (default) |
| `'all'` | Preload all existing nodes and edges |
| `'first-n'` | Preload first N items based on storage order |

**Recommendation:**
- `'none'` — for large graphs or memory constraints
- `'all'` — for small graphs that fit in memory
- `'first-n'` — for incremental warming

## CacheStoreType

```typescript
type CacheStoreType = 'in-memory' | 'redis';
```

| Type | Description | Use Case |
|------|-------------|----------|
| `'in-memory'` | In-process LRU cache | Single instance, development |
| `'redis'` | Redis distributed cache | Multi-instance, production |

## Example Configuration

```typescript
import { GraphManager, InMemoryStorageProvider, CacheConfig } from 'grafio';

// Development configuration
const devConfig: CacheConfig = {
  maxNodesCount: 10000,
  maxEdgesCount: 20000,
  cacheStore: 'in-memory',
  evictionStrategy: 'LRU',
  preloadStrategy: 'none',
};

// Production configuration with Redis
const prodConfig: CacheConfig = {
  maxNodesCount: 100000,
  maxEdgesCount: 500000,
  cacheStore: 'redis',
  evictionStrategy: 'LFU',
  preloadStrategy: 'all',
  ttlSeconds: 7200,  // 2 hours
};

GraphManager.init({ cache: devConfig });
```

## Default Configuration

```typescript
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxNodesCount: 10000,
  maxEdgesCount: 20000,
  cacheStore: 'in-memory',
  evictionStrategy: 'LRU',
  preloadStrategy: 'none',
};
```

## Next Steps

- [Caching](../guides/caching) — cache usage guide
- [Graph Manager API](./graph-manager) — GraphManager reference