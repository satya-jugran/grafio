// Cache configuration and types
export {
  type CacheConfig,
  type EvictionStrategy,
  type PreloadStrategy,
  type CacheStoreType,
  DEFAULT_CACHE_CONFIG,
} from './CacheConfig';

// Cache provider interface and implementations
export { type ICacheProvider } from './ICacheProvider';
export { InMemoryCache } from './InMemoryCache';
export { RedisCache } from './RedisCache';

// Cache manager
export { CacheManager, type CacheStats } from './CacheManager';