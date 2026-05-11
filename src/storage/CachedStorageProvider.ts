import type {
  NodeData,
  EdgeData,
  GraphData,
} from '../types';
import type {
  IStorageProvider,
  IOrderBy,
  ITransactionHandle,
  GraphQueryOptions,
} from './IStorageProvider';
import type { CacheConfig } from './cache/CacheConfig';
import type { CacheManager } from './cache/CacheManager';

/**
 * CachedStorageProvider wraps any IStorageProvider with a cache layer.
 *
 * It implements IStorageProvider so it is transparent to Graph — the Graph class
 * works with a CachedStorageProvider exactly as it would with a raw
 * MongoStorageProvider or InMemoryStorageProvider.
 *
 * ## Read path
 * 1. Check CacheManager for the item
 * 2. On cache HIT → return cached data
 * 3. On cache MISS → delegate to underlying provider → cache the result
 *
 * ## Write path
 * 1. Delegate to underlying provider
 * 2. On success → invalidate or populate cache
 *
 * ## Transaction handling
 * - Reads inside a transaction ALWAYS bypass the cache (must see uncommitted state)
 * - Writes inside a transaction use optimistic invalidation (immediate, no commit wait)
 *
 * @example
 * ```typescript
 * const mongoProvider = new MongoStorageProvider(db, { graphId: 'tenant-a' });
 * const cacheManager = GraphManager.getInstance().getCacheManager();
 * const cachedProvider = new CachedStorageProvider(mongoProvider, 'tenant-a', cacheManager);
 * const graph = new Graph(cachedProvider);
 * ```
 */
export class CachedStorageProvider implements IStorageProvider {
  constructor(
    /**
     * The underlying storage provider (e.g. MongoStorageProvider).
     * CachedStorageProvider does not implement ensureIndexes — that is
     * the caller's responsibility on the underlying provider.
     */
    private readonly _underlying: IStorageProvider,
    /**
     * The graphId partition key for this provider instance.
     * All cache keys are namespaced as `${graphId}:${nodeId}`.
     */
    private readonly _graphId: string,
    /**
     * The shared CacheManager instance (from GraphManager).
     */
    private readonly _cacheManager: CacheManager,
    /**
     * Cache configuration (used for preload strategy).
     */
    private readonly _config: CacheConfig
  ) {}

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async clear(): Promise<void> {
    await this._underlying.clear();
    await this._cacheManager.invalidateAllForGraph(this._graphId);
  }

  async getTotalNodeCount(transaction?: ITransactionHandle): Promise<number> {
    return this._underlying.getTotalNodeCount(transaction);
  }

  async getTotalEdgeCount(transaction?: ITransactionHandle): Promise<number> {
    return this._underlying.getTotalEdgeCount(transaction);
  }

  // ─── Node mutations ─────────────────────────────────────────────────────────

  async insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void> {
    await this._underlying.insertNode(node, transaction);

    // Skip cache population inside transactions — uncommitted data must not be cached
    if (transaction) return;

    // Populate cache if budget allows (inserts are write-through)
    const stats = await this._cacheManager.getStats();
    if (stats.totalNodes < this._config.maxNodesCount) {
      await this._cacheManager.setNode(this._graphId, node.id, node);
    }
  }

  async deleteNode(id: string, transaction?: ITransactionHandle): Promise<void> {
    await this._underlying.deleteNode(id, transaction);
    // Invalidate cache regardless of transaction (it's already deleted from storage)
    await this._cacheManager.invalidateNode(this._graphId, id);
  }

  // ─── Node queries ───────────────────────────────────────────────────────────

  async hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    // Bypass cache in transactions — must read uncommitted state
    if (transaction) {
      return this._underlying.hasNode(id, transaction);
    }

    const cached = await this._cacheManager.getNode(this._graphId, id);
    if (cached !== undefined) return true;

    const exists = await this._underlying.hasNode(id, transaction);
    if (exists) {
      // Cache the node data while we know it exists
      const node = await this._underlying.getNode(id, transaction);
      if (node) await this._cacheManager.setNode(this._graphId, id, node);
    }
    return exists;
  }

  async getNode(id: string, transaction?: ITransactionHandle): Promise<NodeData | undefined> {
    // Bypass cache in transactions
    if (transaction) {
      return this._underlying.getNode(id, transaction);
    }

    const cached = await this._cacheManager.getNode(this._graphId, id);
    if (cached !== undefined) return cached;

    const node = await this._underlying.getNode(id, transaction);
    if (node) {
      await this._cacheManager.setNode(this._graphId, id, node);
    }
    return node;
  }

  // ─── Edge mutations ─────────────────────────────────────────────────────────

  async insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void> {
    const result = await this._underlying.insertEdge(edge, transaction);

    // Skip cache population inside transactions — uncommitted data must not be cached
    if (transaction) return result;

    const stats = await this._cacheManager.getStats();
    if (stats.totalEdges < this._config.maxEdgesCount) {
      await this._cacheManager.setEdge(this._graphId, edge.id, edge);
      // Update adjacency index for getEdgesBySource/getEdgesByTarget optimization
      await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
      await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
    }
    return result;
  }

  async deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void> {
    // Get edge data first for adjacency index cleanup
    const edge = await this._underlying.getEdge(id, transaction);
    await this._underlying.deleteEdge(id, transaction);
    // Invalidate cache regardless of transaction (it's already deleted from storage)
    await this._cacheManager.invalidateEdge(this._graphId, id);
    // Clean up adjacency index
    if (edge) {
      await this._cacheManager.removeEdgeFromAdjacencyIndex(this._graphId, 'source', edge.sourceId, id);
      await this._cacheManager.removeEdgeFromAdjacencyIndex(this._graphId, 'target', edge.targetId, id);
    }
  }

  // ─── Edge queries ───────────────────────────────────────────────────────────

  async hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    if (transaction) {
      return this._underlying.hasEdge(id, transaction);
    }

    const cached = await this._cacheManager.getEdge(this._graphId, id);
    if (cached !== undefined) return true;

    const exists = await this._underlying.hasEdge(id, transaction);
    if (exists) {
      const edge = await this._underlying.getEdge(id, transaction);
      if (edge) await this._cacheManager.setEdge(this._graphId, id, edge);
    }
    return exists;
  }

  async getEdge(id: string, transaction?: ITransactionHandle): Promise<EdgeData | undefined> {
    if (transaction) {
      return this._underlying.getEdge(id, transaction);
    }

    const cached = await this._cacheManager.getEdge(this._graphId, id);
    if (cached !== undefined) return cached;

    const edge = await this._underlying.getEdge(id, transaction);
    if (edge) {
      await this._cacheManager.setEdge(this._graphId, id, edge);
    }
    return edge;
  }

  async getEdgesBySource(
    nodeId: string,
    options?: GraphQueryOptions
  ): Promise<EdgeData[]> {
    const type = options?.filter?.types?.[0];
    const transaction = options?.transaction;

    // Bypass cache in transactions
    if (transaction) {
      return this._underlying.getEdgesBySource(nodeId, options);
    }

    // Try adjacency index first - if it returns non-empty, use those edges
    const edgeIds = await this._cacheManager.getEdgeIdsByAdjacencyIndex(this._graphId, 'source', nodeId);
    if (edgeIds.length > 0) {
      // Fetch each edge individually from cache by ID
      const edges: EdgeData[] = [];
      for (const edgeId of edgeIds) {
        const edge = await this._cacheManager.getEdge(this._graphId, edgeId);
        if (edge && (!type || edge.type === type)) {
          edges.push(edge);
        }
      }
      // If we got at least some edges from cache, return them
      // If all edges were evicted from cache (foundCount === 0), fall back to underlying
      if (edges.length > 0) {
        return edges;
      }
    }

    // Adjacency index returned empty - could be genuinely no edges, or cache not warmed
    // Fall back to underlying provider
    return this._underlying.getEdgesBySource(nodeId, options);
  }

  async getEdgesByTarget(
    nodeId: string,
    options?: GraphQueryOptions
  ): Promise<EdgeData[]> {
    const type = options?.filter?.types?.[0];
    const transaction = options?.transaction;

    // Bypass cache in transactions
    if (transaction) {
      return this._underlying.getEdgesByTarget(nodeId, options);
    }

    // Try adjacency index first - if it returns non-empty, use those edges
    const edgeIds = await this._cacheManager.getEdgeIdsByAdjacencyIndex(this._graphId, 'target', nodeId);
    if (edgeIds.length > 0) {
      // Fetch each edge individually from cache by ID
      const edges: EdgeData[] = [];
      for (const edgeId of edgeIds) {
        const edge = await this._cacheManager.getEdge(this._graphId, edgeId);
        if (edge && (!type || edge.type === type)) {
          edges.push(edge);
        }
      }
      // If we got at least some edges from cache, return them
      // If all edges were evicted from cache (foundCount === 0), fall back to underlying
      if (edges.length > 0) {
        return edges;
      }
    }

    // Adjacency index returned empty - could be genuinely no edges, or cache not warmed
    // Fall back to underlying provider
    return this._underlying.getEdgesByTarget(nodeId, options);
  }

  async getNodes(options?: GraphQueryOptions): Promise<NodeData[]> {
    return this._underlying.getNodes(options);
  }

  async getEdges(options?: GraphQueryOptions): Promise<EdgeData[]> {
    return this._underlying.getEdges(options);
  }

  // ─── Property mutations ─────────────────────────────────────────────────────

  async addProperty(
    target: 'node' | 'edge',
    id: string,
    key: string,
    value: unknown,
    transaction?: ITransactionHandle
  ): Promise<void> {
    await this._underlying.addProperty(target, id, key, value, transaction);
    await this._invalidate(target, id);
  }

  async updateProperty(
    target: 'node' | 'edge',
    id: string,
    key: string,
    value: unknown,
    transaction?: ITransactionHandle
  ): Promise<void> {
    await this._underlying.updateProperty(target, id, key, value, transaction);
    await this._invalidate(target, id);
  }

  async deleteProperty(
    target: 'node' | 'edge',
    id: string,
    key: string,
    transaction?: ITransactionHandle
  ): Promise<void> {
    await this._underlying.deleteProperty(target, id, key, transaction);
    await this._invalidate(target, id);
  }

  async clearProperties(
    target: 'node' | 'edge',
    id: string,
    transaction?: ITransactionHandle
  ): Promise<void> {
    await this._underlying.clearProperties(target, id, transaction);
    await this._invalidate(target, id);
  }

  // ─── Index management ────────────────────────────────────────────────────────

  async createIndex(
    target: 'node' | 'edge',
    propertyKey: string,
    type?: string
  ): Promise<void> {
    return this._underlying.createIndex(target, propertyKey, type);
  }

  // ─── Data portability ────────────────────────────────────────────────────────

  async exportJSON(): Promise<GraphData> {
    return this._underlying.exportJSON();
  }

  async importJSON(data: GraphData): Promise<void> {
    await this._underlying.importJSON(data);
    await this._cacheManager.invalidateAllForGraph(this._graphId);
  }

  // ─── Transaction support ─────────────────────────────────────────────────────

  supportsTransactions(): boolean {
    return this._underlying.supportsTransactions();
  }

  async beginTransaction(): Promise<ITransactionHandle> {
    return this._underlying.beginTransaction();
  }

  async commitTransaction(handle: ITransactionHandle): Promise<void> {
    return this._underlying.commitTransaction(handle);
  }

  async rollbackTransaction(handle: ITransactionHandle): Promise<void> {
    return this._underlying.rollbackTransaction(handle);
  }

  // ─── Pre-loading ─────────────────────────────────────────────────────────────

  /**
   * Pre-warms the cache based on the configured preloadStrategy.
   *
   * Must be called explicitly after construction when pre-loading is desired.
   * Safe to skip when preloadStrategy is 'none'.
   *
   * @returns void
   *
   * @example
   * ```typescript
   * const cachedProvider = new CachedStorageProvider(mongo, 'tenant-a', cacheManager, {
   *   ...config,
   *   preloadStrategy: 'recent',
   *   timestampProperty: 'createdAt',
   * });
   * await cachedProvider.warmCache();
   * ```
   */
  async warmCache(): Promise<void> {
    switch (this._config.preloadStrategy) {
      case 'none':
        // No pre-loading — cache starts empty
        break;

      case 'all': {
        // Load all nodes/edges up to budget
        const nodes = await this._underlying.getNodes({ limit: this._config.maxNodesCount });
        for (const node of nodes) {
          await this._cacheManager.setNode(this._graphId, node.id, node);
        }

        const edges = await this._underlying.getEdges({ limit: this._config.maxEdgesCount });
        for (const edge of edges) {
          await this._cacheManager.setEdge(this._graphId, edge.id, edge);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
        }
        break;
      }

      case 'recent': {
        // Load nodes/edges sorted by updatedOn (descending - most recent first)
        // Storage provider handles sorting natively for efficiency
        const nodes = await this._underlying.getNodes({
          limit: this._config.maxNodesCount,
          orderBy: { field: 'updatedOn', direction: 'desc' }
        });
        for (const node of nodes) {
          await this._cacheManager.setNode(this._graphId, node.id, node);
        }

        const edges = await this._underlying.getEdges({
          limit: this._config.maxEdgesCount,
          orderBy: { field: 'updatedOn', direction: 'desc' }
        });
        for (const edge of edges) {
          await this._cacheManager.setEdge(this._graphId, edge.id, edge);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
        }
        break;
      }

      case 'first-n': {
        // Load first N nodes/edges as returned by storage provider
        const nodes = await this._underlying.getNodes({ limit: this._config.maxNodesCount });
        for (const node of nodes) {
          await this._cacheManager.setNode(this._graphId, node.id, node);
        }

        const edges = await this._underlying.getEdges({ limit: this._config.maxEdgesCount });
        for (const edge of edges) {
          await this._cacheManager.setEdge(this._graphId, edge.id, edge);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
        }
        break;
      }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async _invalidate(target: 'node' | 'edge', id: string): Promise<void> {
    if (target === 'node') {
      await this._cacheManager.invalidateNode(this._graphId, id);
    } else {
      await this._cacheManager.invalidateEdge(this._graphId, id);
    }
  }

  private _sortNodes(nodes: NodeData[], orderBy: IOrderBy): NodeData[] {
    return nodes.sort((a, b) => {
      const aVal = a[orderBy.field];
      const bVal = b[orderBy.field];
      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return orderBy.direction === 'asc' ? 1 : -1;
      if (bVal === undefined) return orderBy.direction === 'asc' ? -1 : 1;
      return orderBy.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  private _sortEdges(edges: EdgeData[], orderBy: IOrderBy): EdgeData[] {
    return edges.sort((a, b) => {
      const aVal = a[orderBy.field];
      const bVal = b[orderBy.field];
      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return orderBy.direction === 'asc' ? 1 : -1;
      if (bVal === undefined) return orderBy.direction === 'asc' ? -1 : 1;
      return orderBy.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }
}