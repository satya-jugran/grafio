import type {
  NodeData,
  EdgeData,
  GraphData,
  AggregateOp,
  AggregateResult,
  QueryOptionsFilterProperty,
} from '../types';
import type {
  IStorageProvider,
  IOrderBy,
  ITransactionHandle,
  StorageQueryOptions,
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
  ) { }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async clear(): Promise<void> {
    await this._underlying.clear();
    await this._cacheManager.invalidateAllForGraph(this._graphId);
  }

  // The following comment is needed to exclude these methods from coverage
  /* istanbul ignore next */
  async getNodeCount(options?: StorageQueryOptions): Promise<number> {
    return this._underlying.getNodeCount(options);
  }

  /* istanbul ignore next */
  async getEdgeCount(options?: StorageQueryOptions): Promise<number> {
    return this._underlying.getEdgeCount(options);
  }

  /* istanbul ignore next */
  async aggregateNodeProperty(
    key: string,
    options?: StorageQueryOptions
  ): Promise<AggregateResult> {
    return this._underlying.aggregateNodeProperty(key, options);
  }

  /* istanbul ignore next */
  async aggregateEdgeProperty(
    key: string,
    options?: StorageQueryOptions
  ): Promise<AggregateResult> {
    return this._underlying.aggregateEdgeProperty(key, options);
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

  async getNodesByIds(ids: string[], transaction?: ITransactionHandle): Promise<Map<string, NodeData>> {
    if (transaction) {
      return this._underlying.getNodesByIds(ids, transaction);
    }

    // Try cache first
    const uniqueIds = Array.from(new Set(ids));
    const cached = await this._cacheManager.getNodes(this._graphId, uniqueIds);
    const cachedIds = new Set(cached.keys());
    const missingIds = uniqueIds.filter(id => !cachedIds.has(id));

    if (missingIds.length === 0) {
      return cached;
    }

    // Fetch missing from underlying provider
    const fetched = await this._underlying.getNodesByIds(missingIds, transaction);

    // Cache the fetched nodes
    for (const [id, node] of fetched) {
      await this._cacheManager.setNode(this._graphId, id, node);
    }

    // Merge cached + fetched
    const result = new Map<string, NodeData>(cached);
    for (const [id, node] of fetched) {
      result.set(id, node);
    }

    return result;
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
    options?: StorageQueryOptions
  ): Promise<EdgeData[]> {
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
        if (edge) {
          // Check if edge matches the type filter
          const types = options?.filter?.types;
          const typeMatch = !types || types.length === 0 || types.includes(edge.type);
          if (!typeMatch) continue;

          // Check if edge matches the property filters
          const properties = options?.filter?.properties;
          const propertyMatch = !properties || properties.length === 0 || properties.every(
            (prop) => this._matchesPropertyFilter(edge.properties ?? {}, prop)
          );
          if (!propertyMatch) continue;

          edges.push(edge);
        }
      }
      // If we got at least some edges from cache, apply order/limit and return
      if (edges.length > 0) {
        return this._applyOrderAndLimit(edges, options);
      }
    }

    // Adjacency index returned empty - could be genuinely no edges, or cache not warmed
    // Fall back to underlying provider
    return this._underlying.getEdgesBySource(nodeId, options);
  }

  async getEdgesByTarget(
    nodeId: string,
    options?: StorageQueryOptions
  ): Promise<EdgeData[]> {
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
        if (edge) {
          // Check if edge matches the type filter
          const types = options?.filter?.types;
          const typeMatch = !types || types.length === 0 || types.includes(edge.type);
          if (!typeMatch) continue;

          // Check if edge matches the property filters
          const properties = options?.filter?.properties;
          const propertyMatch = !properties || properties.length === 0 || properties.every(
            (prop) => this._matchesPropertyFilter(edge.properties ?? {}, prop)
          );
          if (!propertyMatch) continue;

          edges.push(edge);
        }
      }
      // If we got at least some edges from cache, apply order/limit and return
      if (edges.length > 0) {
        return this._applyOrderAndLimit(edges, options);
      }
    }

    // Adjacency index returned empty - could be genuinely no edges, or cache not warmed
    // Fall back to underlying provider
    return this._underlying.getEdgesByTarget(nodeId, options);
  }

  async getNodes(options?: StorageQueryOptions): Promise<NodeData[]> {
    return this._underlying.getNodes(options);
  }

  async getEdges(options?: StorageQueryOptions): Promise<EdgeData[]> {
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
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[]
  ): Promise<void> {
    return this._underlying.createIndex(name, target, propertyKeys);
  }

  async hasIndex(target: 'node' | 'edge', propertyKeys: string[]): Promise<boolean> {
    return this._underlying.hasIndex(target, propertyKeys);
  }

  async getIndex(name: string): Promise<{ name: string; target: 'node' | 'edge'; propertyKeys: string[] } | undefined> {
    return this._underlying.getIndex(name);
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

  /**
   * Checks if properties match a filter specification with operator AND/OR chaining support.
   * Recursively evaluates AND (all must match) and OR (any must match) sub-filters.
   */
  private _matchesPropertyFilter(properties: Record<string, unknown>, filter: QueryOptionsFilterProperty): boolean {
    // Handle AND - ALL conditions must be true
    if (filter.AND && filter.AND.length > 0) {
      for (const subFilter of filter.AND) {
        if (!this._matchesPropertyFilter(properties, subFilter)) {
          return false;
        }
      }
    }

    // Handle OR - ANY condition must be true
    if (filter.OR && filter.OR.length > 0) {
      let orMatched = false;
      for (const subFilter of filter.OR) {
        if (this._matchesPropertyFilter(properties, subFilter)) {
          orMatched = true;
          break;
        }
      }
      if (!orMatched) {
        return false;
      }
    }

    // Handle base case - single property filter with operator
    // If key is not provided, this is a structural filter (AND/OR only) - always matches for base comparison
    if (filter.key === undefined) {
      return true;
    }
    const actualValue = properties[filter.key];
    const filterValue = filter.value;
    const op = filter.op ?? '=';

    switch (op) {
      case '=':
        return actualValue === filterValue;
      case '<>':
        return actualValue !== filterValue;
      case '>':
        return typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue > filterValue;
      case '<':
        return typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue < filterValue;
      case '>=':
        return typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue >= filterValue;
      case '<=':
        return typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue <= filterValue;
      case 'CONTAINS':
        return typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue.includes(filterValue);
      case 'STARTS_WITH':
        return typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue.startsWith(filterValue);
      case 'ENDS_WITH':
        return typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue.endsWith(filterValue);
      case 'IN':
        return Array.isArray(filterValue) && filterValue.includes(actualValue);
      case 'NOT_IN':
        return Array.isArray(filterValue) && !filterValue.includes(actualValue);
      case 'IS_NULL':
        return actualValue === null || actualValue === undefined;
      case 'IS_NOT_NULL':
        return actualValue !== null && actualValue !== undefined;
      default:
        return actualValue === filterValue;
    }
  }

  private _applyOrderAndLimit(edges: EdgeData[], options?: StorageQueryOptions): EdgeData[] {
    let output = edges;

    // Apply ordering if specified
    if (options?.orderBy) {
      const { field, direction } = options.orderBy;
      output = [...output].sort((a, b) => {
        // Direct fields (createdOn, updatedOn) are on the object itself
        // Other properties are in the properties object
        const aVal = (field === 'createdOn' || field === 'updatedOn' ? a[field] : a.properties?.[field]) as number | undefined;
        const bVal = (field === 'createdOn' || field === 'updatedOn' ? b[field] : b.properties?.[field]) as number | undefined;
        if (aVal === undefined && bVal === undefined) return 0;
        if (aVal === undefined) return direction === 'asc' ? 1 : -1;
        if (bVal === undefined) return direction === 'asc' ? -1 : 1;
        if (aVal === bVal) return 0;
        return direction === 'asc' ? (aVal < bVal ? -1 : 1) : (aVal > bVal ? -1 : 1);
      });
    }

    // Apply limit
    if (options?.limit !== undefined) {
      output = output.slice(0, options.limit);
    }

    return output;
  }

}