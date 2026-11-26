import type {
  NodeData,
  EdgeData,
  ReadonlyNodeData,
  ReadonlyEdgeData,
  GraphData,
  AggregateResult,
  QueryOptionsFilterProperty,
  PropertyPatch,
} from '../types';
import type {
  IStorageProvider,
  ITransactionHandle,
  StorageQueryOptions,
  IndexMetadata,
  CreateIndexOptions,
  GroupedAggregateRequest,
  GroupedAggregateRow,
} from './IStorageProvider';
import type { CacheConfig } from './cache/CacheConfig';
import type { CacheManager } from './cache/CacheManager';

/**
 * CachedStorageProvider wraps a remote/slow IStorageProvider (such as MongoDB)
 * with a read-through / write-invalidate cache layer.
 */
export class CachedStorageProvider implements IStorageProvider {
  constructor(
    private readonly _underlying: IStorageProvider,
    private readonly _graphId: string,
    private readonly _cacheManager: CacheManager,
    private readonly _config: CacheConfig,
  ) {}

  get indexEpoch(): number {
    return this._underlying.indexEpoch;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async clear(): Promise<void> {
    await this._underlying.clear();
    await this._cacheManager.invalidateAllForGraph(this._graphId);
  }

  compact(): void {
    this._underlying.compact?.();
  }

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
    options?: StorageQueryOptions,
  ): Promise<AggregateResult> {
    return this._underlying.aggregateNodeProperty(key, options);
  }

  /* istanbul ignore next */
  async aggregateEdgeProperty(
    key: string,
    options?: StorageQueryOptions,
  ): Promise<AggregateResult> {
    return this._underlying.aggregateEdgeProperty(key, options);
  }

  // ─── Node mutations ─────────────────────────────────────────────────────────

  async insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void> {
    await this._underlying.insertNode(node, transaction);
    if (transaction) return;

    const stats = await this._cacheManager.getStats();
    if (stats.totalNodes < this._config.maxNodesCount) {
      await this._cacheManager.setNode(this._graphId, node.id, node);
    }
  }

  async insertNodes(nodes: readonly NodeData[], transaction?: ITransactionHandle): Promise<void> {
    await this._underlying.insertNodes(nodes, transaction);
    if (transaction) return;

    const stats = await this._cacheManager.getStats();
    let total = stats.totalNodes;
    for (const node of nodes) {
      if (total >= this._config.maxNodesCount) break;
      await this._cacheManager.setNode(this._graphId, node.id, node);
      total++;
    }
  }

  async deleteNode(id: string, transaction?: ITransactionHandle): Promise<void> {
    await this._underlying.deleteNode(id, transaction);
    if (!transaction) {
      await this._cacheManager.invalidateNode(this._graphId, id);
    }
  }

  // ─── Node queries ───────────────────────────────────────────────────────────

  async hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    if (transaction) {
      return this._underlying.hasNode(id, transaction);
    }

    const cached = await this._cacheManager.getNode(this._graphId, id);
    if (cached !== undefined) return true;

    const exists = await this._underlying.hasNode(id, transaction);
    if (exists) {
      const node = await this._underlying.getNode(id, transaction);
      if (node) await this._cacheManager.setNode(this._graphId, id, node as NodeData);
    }
    return exists;
  }

  async getNode(id: string, transaction?: ITransactionHandle): Promise<ReadonlyNodeData | undefined> {
    if (transaction) {
      return this._underlying.getNode(id, transaction);
    }

    const cached = await this._cacheManager.getNode(this._graphId, id);
    if (cached !== undefined) return cached;

    const node = await this._underlying.getNode(id, transaction);
    if (node) {
      await this._cacheManager.setNode(this._graphId, id, node as NodeData);
    }
    return node;
  }

  async getNodesByIds(
    ids: string[],
    transaction?: ITransactionHandle,
  ): Promise<Map<string, ReadonlyNodeData>> {
    if (transaction) {
      return this._underlying.getNodesByIds(ids, transaction);
    }

    const uniqueIds = Array.from(new Set(ids));
    const cached = await this._cacheManager.getNodes(this._graphId, uniqueIds);
    const cachedIds = new Set(cached.keys());
    const missingIds = uniqueIds.filter((id) => !cachedIds.has(id));

    if (missingIds.length === 0) {
      return cached;
    }

    const fetched = await this._underlying.getNodesByIds(missingIds, transaction);
    for (const [id, node] of fetched) {
      await this._cacheManager.setNode(this._graphId, id, node as NodeData);
    }

    const result = new Map<string, ReadonlyNodeData>(cached);
    for (const [id, node] of fetched) {
      result.set(id, node);
    }
    return result;
  }

  // ─── Edge mutations ─────────────────────────────────────────────────────────

  async insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void> {
    await this._underlying.insertEdge(edge, transaction);
    if (transaction) return;

    const stats = await this._cacheManager.getStats();
    if (stats.totalEdges < this._config.maxEdgesCount) {
      await this._cacheManager.setEdge(this._graphId, edge.id, edge);
      await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
      await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
    } else {
      this._cacheManager.markNodeAdjacencyIncomplete(this._graphId, 'source', edge.sourceId);
      this._cacheManager.markNodeAdjacencyIncomplete(this._graphId, 'target', edge.targetId);
    }
  }

  async insertEdges(edges: readonly EdgeData[], transaction?: ITransactionHandle): Promise<void> {
    await this._underlying.insertEdges(edges, transaction);
    if (transaction) return;

    const stats = await this._cacheManager.getStats();
    let total = stats.totalEdges;
    for (const edge of edges) {
      if (total >= this._config.maxEdgesCount) {
        this._cacheManager.markNodeAdjacencyIncomplete(this._graphId, 'source', edge.sourceId);
        this._cacheManager.markNodeAdjacencyIncomplete(this._graphId, 'target', edge.targetId);
        continue;
      }
      await this._cacheManager.setEdge(this._graphId, edge.id, edge);
      await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
      await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
      total++;
    }
  }

  async deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void> {
    const edge = transaction ? undefined : await this._underlying.getEdge(id, transaction);
    await this._underlying.deleteEdge(id, transaction);
    if (transaction) return;
    await this._cacheManager.invalidateEdge(this._graphId, id);
    if (edge) {
      await this._cacheManager.removeEdgeFromAdjacencyIndex(this._graphId, 'source', edge.sourceId, id);
      await this._cacheManager.removeEdgeFromAdjacencyIndex(this._graphId, 'target', edge.targetId, id);
    }
  }

  async deleteEdges(ids: readonly string[], transaction?: ITransactionHandle): Promise<void> {
    if (ids.length === 0) return;

    const cachedEdges = transaction
      ? undefined
      : await Promise.all(ids.map((id) => this._cacheManager.getEdge(this._graphId, id)));

    if (this._underlying.deleteEdges) {
      await this._underlying.deleteEdges(ids, transaction);
    } else {
      for (const id of ids) {
        await this._underlying.deleteEdge(id, transaction);
      }
    }

    if (transaction) return;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      await this._cacheManager.invalidateEdge(this._graphId, id);
      const edge = cachedEdges?.[i];
      if (edge) {
        await this._cacheManager.removeEdgeFromAdjacencyIndex(this._graphId, 'source', edge.sourceId, id);
        await this._cacheManager.removeEdgeFromAdjacencyIndex(this._graphId, 'target', edge.targetId, id);
      }
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
      if (edge) await this._cacheManager.setEdge(this._graphId, id, edge as EdgeData);
    }
    return exists;
  }

  async getEdge(id: string, transaction?: ITransactionHandle): Promise<ReadonlyEdgeData | undefined> {
    if (transaction) {
      return this._underlying.getEdge(id, transaction);
    }

    const cached = await this._cacheManager.getEdge(this._graphId, id);
    if (cached !== undefined) return cached;

    const edge = await this._underlying.getEdge(id, transaction);
    if (edge) {
      await this._cacheManager.setEdge(this._graphId, id, edge as EdgeData);
    }
    return edge;
  }

  async getEdgesBySource(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]> {
    return this._getEdgesByDirection('source', nodeId, options);
  }

  async getEdgesByTarget(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]> {
    return this._getEdgesByDirection('target', nodeId, options);
  }

  async getEdgesBySources(
    nodeIds: readonly string[],
    options?: StorageQueryOptions,
  ): Promise<Map<string, ReadonlyEdgeData[]>> {
    return this._getEdgesByDirectionBatch('source', nodeIds, options);
  }

  async getEdgesByTargets(
    nodeIds: readonly string[],
    options?: StorageQueryOptions,
  ): Promise<Map<string, ReadonlyEdgeData[]>> {
    return this._getEdgesByDirectionBatch('target', nodeIds, options);
  }

  async aggregateGrouped(
    request: GroupedAggregateRequest,
  ): Promise<GroupedAggregateRow[] | null> {
    if (this._underlying.aggregateGrouped) {
      return this._underlying.aggregateGrouped(request);
    }
    return null;
  }

  async traverseShortestPath(
    sourceId: string,
    targetId: string,
    edgeTypes?: readonly string[],
  ): Promise<string[] | null | undefined> {
    if (this._underlying.traverseShortestPath) {
      return this._underlying.traverseShortestPath(sourceId, targetId, edgeTypes);
    }
    return undefined;
  }

  private async _tryReadCachedAdjacency(
    direction: 'source' | 'target',
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[] | undefined> {
    if (!this._cacheManager.isNodeAdjacencyComplete(this._graphId, direction, nodeId)) {
      return undefined;
    }

    const edgeIds = await this._cacheManager.getEdgeIdsByAdjacencyIndex(this._graphId, direction, nodeId);
    const edges: EdgeData[] = [];
    for (const edgeId of edgeIds) {
      const edge = await this._cacheManager.getEdge(this._graphId, edgeId);
      if (!edge) {
        this._cacheManager.markNodeAdjacencyIncomplete(this._graphId, direction, nodeId);
        return undefined;
      }
      const types = options?.filter?.types;
      const typeMatch = !types || types.length === 0 || types.includes(edge.type);
      if (!typeMatch) continue;

      const properties = options?.filter?.properties;
      const propertyMatch = !properties || properties.length === 0 || properties.every(
        (prop) => this._matchesPropertyFilter(edge.properties ?? {}, prop),
      );
      if (!propertyMatch) continue;

      edges.push(edge);
    }
    return this._applyOrderAndLimit(edges, options);
  }

  private async _populateAdjacencyCache(
    direction: 'source' | 'target',
    nodeId: string,
    fetched: readonly ReadonlyEdgeData[],
  ): Promise<void> {
    for (const edge of fetched) {
      await this._cacheManager.setEdge(this._graphId, edge.id, edge as EdgeData);
      await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, direction, nodeId, edge.id);
    }
    this._cacheManager.markNodeAdjacencyComplete(this._graphId, direction, nodeId);
  }

  private async _fetchUnderlyingEdgesBatch(
    direction: 'source' | 'target',
    nodeIds: readonly string[],
    options?: StorageQueryOptions,
  ): Promise<Map<string, ReadonlyEdgeData[]>> {
    if (direction === 'source' && this._underlying.getEdgesBySources) {
      return this._underlying.getEdgesBySources(nodeIds, options);
    }
    if (direction === 'target' && this._underlying.getEdgesByTargets) {
      return this._underlying.getEdgesByTargets(nodeIds, options);
    }

    if (options?.transaction) {
      const result = new Map<string, ReadonlyEdgeData[]>();
      for (const id of nodeIds) {
        const edges = direction === 'source'
          ? await this._underlying.getEdgesBySource(id, options)
          : await this._underlying.getEdgesByTarget(id, options);
        result.set(id, edges);
      }
      return result;
    }

    const entries = await Promise.all(
      nodeIds.map(async (id): Promise<[string, ReadonlyEdgeData[]]> => {
        const edges = direction === 'source'
          ? await this._underlying.getEdgesBySource(id, options)
          : await this._underlying.getEdgesByTarget(id, options);
        return [id, edges];
      }),
    );
    return new Map(entries);
  }

  private async _getEdgesByDirection(
    direction: 'source' | 'target',
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]> {
    const transaction = options?.transaction;
    if (transaction) {
      return direction === 'source'
        ? this._underlying.getEdgesBySource(nodeId, options)
        : this._underlying.getEdgesByTarget(nodeId, options);
    }

    const cached = await this._tryReadCachedAdjacency(direction, nodeId, options);
    if (cached !== undefined) {
      return cached;
    }

    const fetched = direction === 'source'
      ? await this._underlying.getEdgesBySource(nodeId, options)
      : await this._underlying.getEdgesByTarget(nodeId, options);

    // Populate read-through adjacency cache only when returning the full unfiltered set
    if (!options?.filter && !options?.orderBy && options?.limit === undefined) {
      const stats = await this._cacheManager.getStats();
      if (stats.totalEdges + fetched.length <= this._config.maxEdgesCount) {
        await this._populateAdjacencyCache(direction, nodeId, fetched);
      }
    }

    return fetched;
  }

  private async _getEdgesByDirectionBatch(
    direction: 'source' | 'target',
    nodeIds: readonly string[],
    options?: StorageQueryOptions,
  ): Promise<Map<string, ReadonlyEdgeData[]>> {
    const uniqueIds = Array.from(new Set(nodeIds));
    const result = new Map<string, ReadonlyEdgeData[]>();
    if (uniqueIds.length === 0) {
      return result;
    }

    if (options?.transaction) {
      const fetchedMap = await this._fetchUnderlyingEdgesBatch(direction, uniqueIds, options);
      for (const id of uniqueIds) {
        result.set(id, fetchedMap.get(id) ?? []);
      }
      return result;
    }

    const missingIds: string[] = [];
    for (const id of uniqueIds) {
      const cached = await this._tryReadCachedAdjacency(direction, id, options);
      if (cached !== undefined) {
        result.set(id, cached);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length === 0) {
      return result;
    }

    const fetchedMap = await this._fetchUnderlyingEdgesBatch(direction, missingIds, options);
    const shouldCache = !options?.filter && !options?.orderBy && options?.limit === undefined;
    let remainingCapacity = 0;
    if (shouldCache) {
      const stats = await this._cacheManager.getStats();
      remainingCapacity = Math.max(0, this._config.maxEdgesCount - stats.totalEdges);
    }

    for (const id of missingIds) {
      const fetched = fetchedMap.get(id) ?? [];
      result.set(id, fetched);
      if (shouldCache && fetched.length <= remainingCapacity) {
        await this._populateAdjacencyCache(direction, id, fetched);
        remainingCapacity -= fetched.length;
      }
    }

    return result;
  }

  async getNodes(options?: StorageQueryOptions): Promise<ReadonlyNodeData[]> {
    return this._underlying.getNodes(options);
  }

  async getEdges(options?: StorageQueryOptions): Promise<ReadonlyEdgeData[]> {
    return this._underlying.getEdges(options);
  }

  // ─── Property & Label mutations ─────────────────────────────────────────────

  async patchProperties(
    target: 'node' | 'edge',
    id: string,
    patch: PropertyPatch,
    transaction?: ITransactionHandle,
  ): Promise<void> {
    await this._underlying.patchProperties(target, id, patch, transaction);
    if (!transaction) {
      await this._invalidate(target, id);
    }
  }

  async removeNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: ITransactionHandle,
  ): Promise<void> {
    await this._underlying.removeNodeLabels(nodeId, labels, transaction);
    if (!transaction) {
      await this._invalidate('node', nodeId);
    }
  }

  async addNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: ITransactionHandle,
  ): Promise<void> {
    await this._underlying.addNodeLabels(nodeId, labels, transaction);
    if (!transaction) {
      await this._invalidate('node', nodeId);
    }
  }

  // ─── Index management ───────────────────────────────────────────────────────

  async createIndex(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): Promise<void> {
    if (options !== undefined) {
      return this._underlying.createIndex(name, target, propertyKeys, options);
    }
    return this._underlying.createIndex(name, target, propertyKeys);
  }

  async hasIndex(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): Promise<boolean> {
    return this._underlying.hasIndex(target, propertyKeys, labelOrType);
  }

  async getIndex(name: string): Promise<IndexMetadata | undefined> {
    return this._underlying.getIndex(name);
  }

  async deleteIndex(name: string): Promise<void> {
    return this._underlying.deleteIndex(name);
  }

  async getIndexes(): Promise<IndexMetadata[]> {
    return this._underlying.getIndexes();
  }

  // ─── Data portability ───────────────────────────────────────────────────────

  async exportJSON(): Promise<GraphData> {
    return this._underlying.exportJSON();
  }

  async importJSON(data: GraphData): Promise<void> {
    await this._underlying.importJSON(data);
    await this._cacheManager.invalidateAllForGraph(this._graphId);
  }

  // ─── Transaction support ────────────────────────────────────────────────────

  supportsTransactions(): boolean {
    return this._underlying.supportsTransactions();
  }

  async beginTransaction(): Promise<ITransactionHandle> {
    return this._underlying.beginTransaction();
  }

  async commitTransaction(handle: ITransactionHandle): Promise<void> {
    await this._underlying.commitTransaction(handle);
    await this._cacheManager.invalidateAllForGraph(this._graphId);
  }

  async rollbackTransaction(handle: ITransactionHandle): Promise<void> {
    return this._underlying.rollbackTransaction(handle);
  }

  // ─── Pre-loading ────────────────────────────────────────────────────────────

  async warmCache(): Promise<void> {
    switch (this._config.preloadStrategy) {
      case 'none':
        break;

      case 'all': {
        const nodes = await this._underlying.getNodes({ limit: this._config.maxNodesCount });
        for (const node of nodes) {
          await this._cacheManager.setNode(this._graphId, node.id, node as NodeData);
        }
        const totalEdges = await this._underlying.getEdgeCount();
        const edges = await this._underlying.getEdges({ limit: this._config.maxEdgesCount });
        let storedAllEdges = edges.length >= totalEdges;
        for (const edge of edges) {
          const alreadyCached = (await this._cacheManager.getEdge(this._graphId, edge.id)) !== undefined;
          if (!alreadyCached) {
            const stats = await this._cacheManager.getStats();
            if (stats.totalEdges >= this._config.maxEdgesCount) {
              storedAllEdges = false;
              break;
            }
          }
          await this._cacheManager.setEdge(this._graphId, edge.id, edge as EdgeData);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
        }
        if (storedAllEdges) {
          this._cacheManager.markAllAdjacencyComplete(this._graphId);
        }
        break;
      }

      case 'recent': {
        const nodes = await this._underlying.getNodes({
          limit: this._config.maxNodesCount,
          orderBy: { field: 'updatedOn', direction: 'desc' },
        });
        for (const node of nodes) {
          await this._cacheManager.setNode(this._graphId, node.id, node as NodeData);
        }
        const edges = await this._underlying.getEdges({
          limit: this._config.maxEdgesCount,
          orderBy: { field: 'updatedOn', direction: 'desc' },
        });
        for (const edge of edges) {
          await this._cacheManager.setEdge(this._graphId, edge.id, edge as EdgeData);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'source', edge.sourceId, edge.id);
          await this._cacheManager.addEdgeToAdjacencyIndex(this._graphId, 'target', edge.targetId, edge.id);
        }
        break;
      }

      case 'first-n': {
        const nodes = await this._underlying.getNodes({ limit: this._config.maxNodesCount });
        for (const node of nodes) {
          await this._cacheManager.setNode(this._graphId, node.id, node as NodeData);
        }
        const edges = await this._underlying.getEdges({ limit: this._config.maxEdgesCount });
        for (const edge of edges) {
          await this._cacheManager.setEdge(this._graphId, edge.id, edge as EdgeData);
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

  private _matchesPropertyFilter(
    properties: Readonly<Record<string, unknown>>,
    filter: QueryOptionsFilterProperty,
  ): boolean {
    if (filter.AND && filter.AND.length > 0) {
      for (const subFilter of filter.AND) {
        if (!this._matchesPropertyFilter(properties, subFilter)) return false;
      }
    }
    if (filter.OR && filter.OR.length > 0) {
      let orMatched = false;
      for (const subFilter of filter.OR) {
        if (this._matchesPropertyFilter(properties, subFilter)) {
          orMatched = true;
          break;
        }
      }
      if (!orMatched) return false;
    }
    if (filter.key === undefined) return true;
    const actualValue = properties[filter.key];
    const filterValue = filter.value;
    const op = filter.op ?? '=';

    switch (op) {
      case '=':
        return actualValue === filterValue;
      case '<>':
        return actualValue !== filterValue;
      case '>':
        return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue > filterValue) ||
          (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue > filterValue);
      case '<':
        return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue < filterValue) ||
          (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue < filterValue);
      case '>=':
        return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue >= filterValue) ||
          (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue >= filterValue);
      case '<=':
        return (typeof actualValue === 'number' && typeof filterValue === 'number' && actualValue <= filterValue) ||
          (typeof actualValue === 'string' && typeof filterValue === 'string' && actualValue <= filterValue);
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

  private _applyOrderAndLimit(
    edges: ReadonlyEdgeData[],
    options?: StorageQueryOptions,
  ): ReadonlyEdgeData[] {
    let output = edges;
    if (options?.orderBy) {
      const { field, direction } = options.orderBy;
      output = [...output].sort((a, b) => {
        const aVal = (field === 'createdOn' || field === 'updatedOn' ? a[field] : a.properties?.[field]) as number | undefined;
        const bVal = (field === 'createdOn' || field === 'updatedOn' ? b[field] : b.properties?.[field]) as number | undefined;
        if (aVal === undefined && bVal === undefined) return 0;
        if (aVal === undefined) return direction === 'asc' ? 1 : -1;
        if (bVal === undefined) return direction === 'asc' ? -1 : 1;
        if (aVal === bVal) return 0;
        return direction === 'asc' ? (aVal < bVal ? -1 : 1) : (aVal > bVal ? -1 : 1);
      });
    }
    if (options?.limit !== undefined) {
      output = output.slice(0, options.limit);
    }
    return output;
  }
}
