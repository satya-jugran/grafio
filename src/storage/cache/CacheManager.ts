import type { NodeData, EdgeData } from '../../types';
import type { CacheConfig } from './CacheConfig';
import { InMemoryCache } from './InMemoryCache';
import { RedisCache } from './RedisCache';
import type { ICacheProvider } from './ICacheProvider';

/**
 * Metadata tracked per graphId in the registry.
 */
interface GraphIdMetadata {
  /** Unix ms timestamp of last cache access (read or write) for this graphId */
  lastAccessed: number;
  /** Number of nodes currently cached for this graphId */
  cachedNodeCount: number;
  /** Number of edges currently cached for this graphId */
  cachedEdgeCount: number;
  /** Absolute expiry timestamp (ms). Set when graphIdTtlMs is configured. */
  expiresAt?: number;
}

/**
 * Snapshot of current cache statistics.
 */
export interface CacheStats {
  totalNodes: number;
  totalEdges: number;
  totalGraphIds: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  /** Ratio of hits to total lookups (0–1). NaN when no lookups have been made. */
  hitRate: number;
}

/**
 * CacheManager manages the global cache budget across all graphId partitions.
 *
 * It owns two ICacheProvider instances (one for nodes, one for edges) and a
 * graphId registry that tracks per-partition metadata (lastAccessed, counts,
 * TTL expiry). When the global budget is exceeded, it finds the least-recently-used
 * graphId and evicts all of its cached entries.
 *
 * This class is instantiated once by GraphManager and shared across all
 * CachedStorageProvider instances.
 *
 * @example
 * ```typescript
 * const manager = new CacheManager({
 *   maxNodesCount: 10000,
 *   maxEdgesCount: 20000,
 *   cacheStore: 'in-memory',
 *   evictionStrategy: 'LRU',
 *   preloadStrategy: 'none',
 * });
 *
 * await manager.setNode('tenant-a', 'node-1', { id: 'node-1', type: 'Person', properties: {} });
 * const node = await manager.getNode('tenant-a', 'node-1');
 * ```
 */
export class CacheManager {
  private readonly _config: CacheConfig;
  private readonly _nodeCache: ICacheProvider<NodeData>;
  private readonly _edgeCache: ICacheProvider<EdgeData>;

  /** graphId → metadata */
  private readonly _registry: Map<string, GraphIdMetadata> = new Map();

  // Stats counters
  private _hitCount = 0;
  private _missCount = 0;
  private _evictionCount = 0;

  constructor(config: CacheConfig) {
    this._config = config;

    // Create the appropriate cache backend
    if (config.cacheStore === 'redis') {
      if (!config.redisUrl) {
        throw new Error('[CacheManager] redisUrl is required when cacheStore is "redis"');
      }
      this._nodeCache = new RedisCache<NodeData>(
        config.redisUrl,
        config.maxNodesCount,
        'nodes'
      );
      this._edgeCache = new RedisCache<EdgeData>(
        config.redisUrl,
        config.maxEdgesCount,
        'edges'
      );
    } else {
      this._nodeCache = new InMemoryCache<NodeData>(
        config.maxNodesCount,
        config.evictionStrategy
      );
      this._edgeCache = new InMemoryCache<EdgeData>(
        config.maxEdgesCount,
        config.evictionStrategy
      );
    }
  }

  // ─── Node operations ────────────────────────────────────────────────────────

  /**
   * Retrieves a cached node.
   * @param graphId - The graph partition key
   * @param nodeId - The node id
   * @returns The NodeData if found, undefined otherwise
   */
  async getNode(graphId: string, nodeId: string): Promise<NodeData | undefined> {
    const key = this._nodeKey(graphId, nodeId);
    const result = await this._nodeCache.get(key);

    if (result !== undefined) {
      this._hitCount++;
      this._touchGraphId(graphId);
    } else {
      this._missCount++;
    }

    return result;
  }

  /**
   * Stores a node in the cache.
   * If the global budget is exceeded, evicts the least-recently-used graphId first.
   * @param graphId - The graph partition key
   * @param nodeId - The node id
   * @param node - The NodeData to cache
   */
  async setNode(graphId: string, nodeId: string, node: NodeData): Promise<void> {
    // Sweep ALL expired graphIds before any writes — this ensures stale entries
    // are cleaned up even when the cache is not at capacity yet.
    await this._evictExpiredGraphIds();

    // Enforce global budget
    const nodeCacheSize = await this._nodeCache.size();
    if (nodeCacheSize >= this._nodeCache.maxSize()) {
      await this._evictGraphIdFromNodes();
    }

    const key = this._nodeKey(graphId, nodeId);
    const isNewEntry = !(await this._nodeCache.has(key));
    await this._nodeCache.set(key, node);
    
    // Only register new entries to keep per-graphId counts accurate
    if (isNewEntry) {
      this._registerGraphId(graphId, 'node');
    }
    this._touchGraphId(graphId);
  }

  /**
   * Removes a specific node from the cache.
   * @param graphId - The graph partition key
   * @param nodeId - The node id
   */
  async invalidateNode(graphId: string, nodeId: string): Promise<void> {
    const key = this._nodeKey(graphId, nodeId);
    const existed = await this._nodeCache.has(key);

    await this._nodeCache.invalidate(key);

    if (existed) {
      this._decrementNodeCount(graphId);
    }
  }

  // ─── Edge operations ────────────────────────────────────────────────────────

  /**
   * Retrieves a cached edge.
   * @param graphId - The graph partition key
   * @param edgeId - The edge id
   * @returns The EdgeData if found, undefined otherwise
   */
  async getEdge(graphId: string, edgeId: string): Promise<EdgeData | undefined> {
    const key = this._edgeKey(graphId, edgeId);
    const result = await this._edgeCache.get(key);

    if (result !== undefined) {
      this._hitCount++;
      this._touchGraphId(graphId);
    } else {
      this._missCount++;
    }

    return result;
  }

  /**
   * Stores an edge in the cache.
   * If the global budget is exceeded, evicts the least-recently-used graphId first.
   * @param graphId - The graph partition key
   * @param edgeId - The edge id
   * @param edge - The EdgeData to cache
   */
  async setEdge(graphId: string, edgeId: string, edge: EdgeData): Promise<void> {
    // Sweep ALL expired graphIds before any writes — this ensures stale entries
    // are cleaned up even when the cache is not at capacity yet.
    await this._evictExpiredGraphIds();

    // Enforce global budget
    const edgeCacheSize = await this._edgeCache.size();
    if (edgeCacheSize >= this._edgeCache.maxSize()) {
      await this._evictGraphIdFromEdges();
    }

    const key = this._edgeKey(graphId, edgeId);
    const isNewEntry = !(await this._edgeCache.has(key));
    await this._edgeCache.set(key, edge);
    
    // Only register new entries to keep per-graphId counts accurate
    if (isNewEntry) {
      this._registerGraphId(graphId, 'edge');
    }
    this._touchGraphId(graphId);
  }

  /**
   * Removes a specific edge from the cache.
   * @param graphId - The graph partition key
   * @param edgeId - The edge id
   */
  async invalidateEdge(graphId: string, edgeId: string): Promise<void> {
    const key = this._edgeKey(graphId, edgeId);
    const existed = await this._edgeCache.has(key);

    await this._edgeCache.invalidate(key);

    if (existed) {
      this._decrementEdgeCount(graphId);
    }
  }

  // ─── Bulk invalidation ──────────────────────────────────────────────────────

  /**
   * Removes all cached nodes and edges for a specific graphId.
   * @param graphId - The graph partition key
   */
  async invalidateAllForGraph(graphId: string): Promise<void> {
    const meta = this._registry.get(graphId);
    if (meta) {
      // Evict all nodes by prefix (inefficient but correct for now)
      await this._invalidateNodesByPrefix(graphId);
      await this._invalidateEdgesByPrefix(graphId);
      meta.cachedNodeCount = 0;
      meta.cachedEdgeCount = 0;
    }
  }

  /**
   * Removes all entries from both node and edge caches.
   */
  async invalidateAll(): Promise<void> {
    await this._nodeCache.invalidateAll();
    await this._edgeCache.invalidateAll();
    this._registry.clear();
    this._hitCount = 0;
    this._missCount = 0;
    this._evictionCount = 0;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of current cache statistics.
   */
  async getStats(): Promise<CacheStats> {
    const totalLookups = this._hitCount + this._missCount;
    return {
      totalNodes: await this._nodeCache.size(),
      totalEdges: await this._edgeCache.size(),
      totalGraphIds: this._registry.size,
      hitCount: this._hitCount,
      missCount: this._missCount,
      evictionCount: this._evictionCount,
      hitRate: totalLookups > 0 ? this._hitCount / totalLookups : NaN,
    };
  }

  /**
   * Returns all cached nodes for a specific graphId.
   * @param graphId - The graph partition key
   * @param limit - Optional maximum number of nodes to return
   */
  async getAllNodes(graphId: string, limit?: number): Promise<NodeData[]> {
    const prefix = `${graphId}:`;
    return this._nodeCache.getAll(prefix, limit);
  }

  /**
   * Returns all cached edges for a specific graphId.
   * @param graphId - The graph partition key
   * @param limit - Optional maximum number of edges to return
   */
  async getAllEdges(graphId: string, limit?: number): Promise<EdgeData[]> {
    const prefix = `${graphId}:`;
    return this._edgeCache.getAll(prefix, limit);
  }

  /**
   * Returns the count of cached nodes or edges for a specific graphId.
   * @param graphId - The graph partition key
   * @param type - Either 'node' or 'edge'
   */
  async totalCount(graphId: string, type: 'node' | 'edge'): Promise<number> {
    const prefix = `${graphId}:`;
    if (type === 'node') {
      return this._nodeCache.count(prefix);
    } else {
      return this._edgeCache.count(prefix);
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _nodeKey(graphId: string, nodeId: string): string {
    return `${graphId}:${nodeId}`;
  }

  private _edgeKey(graphId: string, edgeId: string): string {
    return `${graphId}:${edgeId}`;
  }

  private _registerGraphId(graphId: string, type: 'node' | 'edge'): void {
    if (!this._registry.has(graphId)) {
      this._registry.set(graphId, {
        lastAccessed: Date.now(),
        cachedNodeCount: 0,
        cachedEdgeCount: 0,
        expiresAt: this._config.graphIdTtlMs
          ? Date.now() + this._config.graphIdTtlMs
          : undefined,
      });
    }

    const meta = this._registry.get(graphId)!;
    if (type === 'node') meta.cachedNodeCount++;
    else meta.cachedEdgeCount++;
  }

  private _touchGraphId(graphId: string): void {
    const meta = this._registry.get(graphId);
    if (meta) {
      meta.lastAccessed = Date.now();
      // Refresh TTL on access
      if (this._config.graphIdTtlMs) {
        meta.expiresAt = Date.now() + this._config.graphIdTtlMs;
      }
    }
  }

  private _decrementNodeCount(graphId: string): void {
    const meta = this._registry.get(graphId);
    if (meta && meta.cachedNodeCount > 0) {
      meta.cachedNodeCount--;
    }
  }

  private _decrementEdgeCount(graphId: string): void {
    const meta = this._registry.get(graphId);
    if (meta && meta.cachedEdgeCount > 0) {
      meta.cachedEdgeCount--;
    }
  }

  /**
   * Evicts all nodes belonging to a specific graphId from the node cache.
   * This is expensive (O(n)) but correct for bulk invalidation.
   */
  private async _invalidateNodesByPrefix(graphId: string): Promise<void> {
    // Use prefix-based invalidation to only evict keys for this graphId
    await this._nodeCache.invalidateByPrefix(graphId);
  }

  /**
   * Evicts all edges belonging to a specific graphId from the edge cache.
   */
  private async _invalidateEdgesByPrefix(graphId: string): Promise<void> {
    // Use prefix-based invalidation to only evict keys for this graphId
    await this._edgeCache.invalidateByPrefix(graphId);
  }

  /**
   * Evicts the least-recently-used graphId's nodes from the node cache.
   * Called when the global node budget is exceeded.
   */
  private async _evictGraphIdFromNodes(): Promise<void> {
    const oldest = this._findOldestGraphId();
    if (!oldest) return;

    this._evictionCount++;
    await this._invalidateNodesByPrefix(oldest);

    const meta = this._registry.get(oldest);
    if (meta) {
      meta.cachedNodeCount = 0;
    }
  }

  /**
   * Evicts the least-recently-used graphId's edges from the edge cache.
   * Called when the global edge budget is exceeded.
   */
  private async _evictGraphIdFromEdges(): Promise<void> {
    const oldest = this._findOldestGraphId();
    if (!oldest) return;

    this._evictionCount++;
    await this._invalidateEdgesByPrefix(oldest);

    const meta = this._registry.get(oldest);
    if (meta) {
      meta.cachedEdgeCount = 0;
    }
  }

  /**
   * Finds the graphId with the oldest lastAccessed timestamp.
   */
  private _findOldestGraphId(): string | null {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [gid, meta] of this._registry) {
      if (meta.lastAccessed < oldestTime) {
        oldestTime = meta.lastAccessed;
        oldest = gid;
      }
    }

    return oldest;
  }

  /**
   * Checks if a graphId has expired based on TTL and evicts it if so.
   */
  private async _evictExpiredGraphId(graphId: string): Promise<void> {
    const meta = this._registry.get(graphId);
    if (!meta || !meta.expiresAt) return;

    if (Date.now() > meta.expiresAt) {
      this._evictionCount++;
      await this._invalidateNodesByPrefix(graphId);
      await this._invalidateEdgesByPrefix(graphId);
      meta.cachedNodeCount = 0;
      meta.cachedEdgeCount = 0;
      // Keep expired — do not reset expiresAt. This prevents the bug where
      // a re-registered graphId would get a fresh TTL instead of staying expired.
      // The graphId will only get a new expiresAt when explicitly re-registered
      // via _registerGraphId (called from setNode/setEdge for new entries).
    }
  }

  /**
   * Evicts all expired graphIds from the registry.
   * Called during global budget eviction to sweep stale partitions.
   */
  private async _evictExpiredGraphIds(): Promise<void> {
    const now = Date.now();
    for (const [graphId, meta] of this._registry) {
      if (meta.expiresAt && now > meta.expiresAt) {
        this._evictionCount++;
        await this._invalidateNodesByPrefix(graphId);
        await this._invalidateEdgesByPrefix(graphId);
        meta.cachedNodeCount = 0;
        meta.cachedEdgeCount = 0;
      }
    }
  }
}