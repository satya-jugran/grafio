/**
 * Eviction strategy applied within each graphId's node/edge cache.
 */
export type EvictionStrategy = 'LRU' | 'LFU' | 'FIFO';

/**
 * Strategy used to warm-start the cache when CachedStorageProvider.warmCache()
 * is called.
 */
export type PreloadStrategy = 'none' | 'all' | 'recent' | 'first-n';

/**
 * Cache backend store type.
 */
export type CacheStoreType = 'in-memory' | 'redis';

/**
 * Configuration for the caching layer.
 *
 * @example
 * ```typescript
 * GraphManager.init({
 *   cache: {
 *     maxNodesCount: 10000,
 *     maxEdgesCount: 20000,
 *     cacheStore: 'in-memory',
 *     evictionStrategy: 'LRU',
 *     preloadStrategy: 'none',
 *   }
 * });
 * ```
 */
export interface CacheConfig {
  /**
   * Maximum total nodes cached across ALL graphId partitions.
   * When exceeded, the least-recently-used graphId is evicted.
   * @default 10000
   */
  maxNodesCount: number;

  /**
   * Maximum total edges cached across ALL graphId partitions.
   * @default 20000
   */
  maxEdgesCount: number;

  /**
   * Cache backend. 'in-memory' for single-process; 'redis' for distributed.
   * @default 'in-memory'
   */
  cacheStore: CacheStoreType;

  /**
   * Eviction strategy applied within each graphId's node/edge cache.
   * @default 'LRU'
   */
  evictionStrategy: EvictionStrategy;

  /**
   * Strategy used to warm-start the cache when CachedStorageProvider.warmCache()
   * is called.
   *
   * - 'none'    — Cache starts empty; items populate on first read (default).
   * - 'all'     — Load all nodes/edges up to budget via getAllNodes/getAllEdges.
   * - 'recent'  — Load nodes/edges sorted descending by `timestampProperty`.
   *               Requires `timestampProperty` to be set.
   * - 'first-n' — Load the first N nodes/edges as returned by the storage provider
   *               (insertion order or natural DB order). Simple and predictable.
   *
   * @default 'none'
   */
  preloadStrategy: PreloadStrategy;

  /**
   * Property name used for 'recent' preload strategy.
   * E.g. 'createdAt' or 'updatedAt'. Nodes/edges lacking this property are skipped.
   */
  timestampProperty?: string;

  /**
   * Per-graphId TTL in milliseconds. After this duration of inactivity,
   * all cached entries for the graphId are evicted.
   * When undefined, entries are retained until the global budget forces eviction.
   * @example 300000 // 5 minutes
   */
  graphIdTtlMs?: number;

  /**
   * Redis connection URL. Required when cacheStore is 'redis'.
   * @example 'redis://localhost:6379'
   */
  redisUrl?: string;
}

/**
 * Default cache configuration values.
 */
export const DEFAULT_CACHE_CONFIG: Pick<CacheConfig, 'maxNodesCount' | 'maxEdgesCount' | 'cacheStore' | 'evictionStrategy' | 'preloadStrategy'> = {
  maxNodesCount: 10000,
  maxEdgesCount: 20000,
  cacheStore: 'in-memory',
  evictionStrategy: 'LRU',
  preloadStrategy: 'none',
};