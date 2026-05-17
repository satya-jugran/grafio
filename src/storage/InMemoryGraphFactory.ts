import { Graph, GraphManager, CachedStorageProvider, type IStorageProvider, type GraphData } from 'grafio';
import {
  InMemoryStorageProvider,
  type InMemoryStorageProviderOptions,
} from './InMemoryStorageProvider';
import type { IGraphFactory } from './IGraphFactory';

/**
 * In-memory factory for `Graph` instances.
 *
 * Each call to `forGraph(graphId)` returns a `Graph` backed by a **fresh**
 * `InMemoryStorageProvider` — no state is shared between calls. This mirrors
 * the natural isolation that `MongoGraphFactory` provides per `graphId`.
 *
 * Useful for:
 * - Isolated per-request in-memory graphs
 * - Swapping in-memory graphs in tests without touching IoC bindings
 * - Scenarios where no persistence is desired
 *
 * @example With caching enabled:
 * GraphManager.init({
 *   cache: {
 *     maxNodesCount: 10000,
 *     maxEdgesCount: 20000,
 *     cacheStore: 'in-memory',
 *     evictionStrategy: 'LRU',
 *   }
 * });
 *
 * const factory = new InMemoryGraphFactory();
 * const graph = factory.forGraph('default');
 * // All reads/writes go through CachedStorageProvider when cache is enabled
 */
export class InMemoryGraphFactory implements IGraphFactory {
  private readonly _opts: Omit<InMemoryStorageProviderOptions, 'graphId'>;

  /**
   * @param opts - Optional defaults applied to every `forGraph` call (e.g. no-op hooks).
   */
  constructor(opts: Omit<InMemoryStorageProviderOptions, 'graphId'> = {}) {
    this._opts = opts;
  }

  /**
   * Returns a `Graph` backed by a fresh `InMemoryStorageProvider` scoped to `graphId`.
   *
   * Each call produces an independent in-memory graph — no data is shared between
   * calls even when `graphId` is the same.
   *
   * If `GraphManager.init()` was called with cache config, the Graph will use
   * CachedStorageProvider for improved read performance.
   *
   * @param graphId - Defaults to `"default"` when omitted.
   */
  forGraph(graphId: string = 'default'): Graph {
    const inMemoryProvider = new InMemoryStorageProvider({ ...this._opts, graphId });
    const provider = this._wrapWithCacheIfEnabled(inMemoryProvider, graphId);
    return new Graph(provider);
  }

  /**
   * Creates a Graph instance and imports the given graph data into it.
   * Convenience method that combines forGraph() + importJSON().
   *
   * @param data - The GraphData to import
   * @param graphId - Graph partition ID (defaults to 'default')
   * @returns A Graph instance with the imported data
   */
  async fromGraphData(data: GraphData, graphId: string = 'default'): Promise<Graph> {
    const inMemoryProvider = new InMemoryStorageProvider({ ...this._opts, graphId });
    const provider = this._wrapWithCacheIfEnabled(inMemoryProvider, graphId);
    const graph = new Graph(provider);
    await Graph.importJSON(data, provider);
    return graph;
  }

  /**
   * Wraps the given storage provider with CachedStorageProvider if caching is enabled
   * via GraphManager configuration. Returns the original provider if caching is disabled.
   */
  private _wrapWithCacheIfEnabled(
    storageProvider: InMemoryStorageProvider,
    graphId: string
  ): IStorageProvider {
    if (!GraphManager.isInitialized()) {
      return storageProvider;
    }

    const manager = GraphManager.getInstance();
    const cacheManager = manager.getCacheManager();
    if (!cacheManager) {
      return storageProvider;
    }

    const cacheConfig = manager.getConfig()?.cache;
    if (!cacheConfig) {
      return storageProvider;
    }

    return new CachedStorageProvider(
      storageProvider,
      graphId,
      cacheManager,
      cacheConfig
    );
  }
}