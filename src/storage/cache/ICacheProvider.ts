/**
 * Abstract cache provider interface.
 *
 * Implementations can be in-memory (e.g. LRU Map) or distributed (e.g. Redis).
 * This interface is used by CacheManager to store NodeData and EdgeData
 * with namespaced keys.
 *
 * @example
 * ```typescript
 * const cache: ICacheProvider<NodeData> = new InMemoryCache(1000);
 * await cache.set('graph-a:node-1', { id: 'node-1', type: 'Person', properties: {} });
 * const node = await cache.get('graph-a:node-1');
 * ```
 */
export interface ICacheProvider<T> {
  /**
   * Retrieves a cached value by its key.
   * @param id - The cache key (e.g. `${graphId}:${nodeId}`)
   * @returns The cached value, or undefined if not found or expired.
   */
  get(id: string): Promise<T | undefined>;

  /**
   * Stores a value in the cache.
   * If the cache is full, the eviction strategy determines which item is removed.
   * @param id - The cache key
   * @param value - The value to cache
   */
  set(id: string, value: T): Promise<void>;

  /**
   * Checks whether a key exists in the cache.
   * @param id - The cache key
   * @returns true if the key exists, false otherwise
   */
  has(id: string): Promise<boolean>;

  /**
   * Removes a specific key from the cache.
   * @param id - The cache key to invalidate
   */
  invalidate(id: string): Promise<void>;

  /**
   * Removes all entries from the cache.
   */
  invalidateAll(): Promise<void>;

  /**
   * Returns the current number of entries in the cache.
   */
  size(): Promise<number>;

  /**
   * Returns the maximum number of entries this cache can hold.
   */
  maxSize(): number;
}