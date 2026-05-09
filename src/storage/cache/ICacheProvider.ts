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
   * Removes all entries whose keys start with the given prefix.
   * @param prefix - The prefix to match (e.g., "graph-a:" matches "graph-a:node-1")
   */
  invalidateByPrefix(prefix: string): Promise<void>;

  /**
   * Returns the current number of entries in the cache.
   */
  size(): Promise<number>;

  /**
   * Returns the maximum number of entries this cache can hold.
   */
  maxSize(): number;

  /**
   * Returns all cached values whose keys start with the given prefix.
   * @param prefix - The prefix to match (e.g., "graph-a:" matches "graph-a:node-1")
   * @param limit - Optional maximum number of items to return
   * @returns Array of cached values
   */
  getAll(prefix: string, limit?: number): Promise<T[]>;

  /**
   * Returns the count of entries whose keys start with the given prefix.
   * @param prefix - The prefix to match
   * @returns Number of matching entries
   */
  count(prefix: string): Promise<number>;

  // ─── Adjacency index (for edge lookups by source/target) ─────────────────

  /**
   * Adds an edge to the adjacency index for a source or target node.
   * @param graphId - The graph partition key
   * @param direction - Either 'source' or 'target'
   * @param nodeId - The source or target node id
   * @param edgeId - The edge id to associate
   */
  addToAdjacencyIndex(graphId: string, direction: 'source' | 'target', nodeId: string, edgeId: string): Promise<void>;

  /**
   * Removes an edge from the adjacency index.
   * @param graphId - The graph partition key
   * @param direction - Either 'source' or 'target'
   * @param nodeId - The source or target node id
   * @param edgeId - The edge id to remove
   */
  removeFromAdjacencyIndex(graphId: string, direction: 'source' | 'target', nodeId: string, edgeId: string): Promise<void>;

  /**
   * Gets all edge ids from the adjacency index for a source or target node.
   * @param graphId - The graph partition key
   * @param direction - Either 'source' or 'target'
   * @param nodeId - The source or target node id
   * @returns Array of edge ids
   */
  getEdgesByAdjacencyIndex(graphId: string, direction: 'source' | 'target', nodeId: string): Promise<string[]>;

  /**
   * Removes all adjacency index entries for a graphId.
   * @param graphId - The graph partition key
   */
  invalidateAdjacencyIndex(graphId: string): Promise<void>;
}