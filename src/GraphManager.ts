import type { CacheConfig } from './storage/cache/CacheConfig';
import { CacheManager } from './storage/cache/CacheManager';

/**
 * Configuration for GraphManager.
 */
export interface GraphManagerConfig {
  /**
   * Cache configuration. When provided, caching is enabled.
   * When omitted, Graph instances operate without caching.
   */
  cache?: CacheConfig;
}

/**
 * GraphManager is the application-scoped singleton that owns the global cache budget
 * and serves as a central coordination point for graph-level concerns.
 *
 * It is designed to be extensible beyond caching (e.g. graph metadata,
 * statistics, event hooks) in future iterations.
 *
 * ## Initialization
 *
 * GraphManager must be initialized once at application startup before any
 * graph operations are performed.
 *
 * @example
 * ```typescript
 * // Application startup (e.g. NestJS main.ts, Express app.ts)
 * GraphManager.init({
 *   cache: {
 *     maxNodesCount: 10000,
 *     maxEdgesCount: 20000,
 *     cacheStore: 'in-memory',
 *     evictionStrategy: 'LRU',
 *     preloadStrategy: 'none',
 *   }
 * });
 *
 * // Later, in a request handler
 * const manager = GraphManager.getInstance();
 * const cacheManager = manager.getCacheManager();
 * const stats = cacheManager.getStats();
 * ```
 *
 * ## Lifecycle
 *
 * - Initialized once via `GraphManager.init(config)`
 * - Retrieved via `GraphManager.getInstance()` anywhere in the app
 * - Survives factory recreation (MongoGraphFactory, InMemoryGraphFactory, etc.)
 * - Never garbage collected during the application lifetime
 */
export class GraphManager {
  private static _instance: GraphManager | null = null;

  private readonly _cacheManager: CacheManager | null = null;
  private readonly _config: GraphManagerConfig;

  /**
   * Initializes the GraphManager singleton.
   * Must be called once at application startup.
   * Safe to call multiple times — subsequent calls are no-ops if already initialized.
   *
   * @param config - The GraphManager configuration
   * @throws Error if called after already initialized (unless not yet initialized)
   */
  static init(config: GraphManagerConfig): void {
    if (GraphManager._instance) {
      console.warn(
        '[GraphManager] init() called after already initialized. ' +
        'Existing instance is retained. Call reset() first to re-initialize.'
      );
      return;
    }

    GraphManager._instance = new GraphManager(config);
  }

  /**
   * Returns the singleton GraphManager instance.
   * @throws Error if GraphManager has not been initialized via init()
   */
  static getInstance(): GraphManager {
    if (!GraphManager._instance) {
      throw new Error(
        '[GraphManager] getInstance() called before init(). ' +
        'Call GraphManager.init({ cache: {...} }) at application startup first.'
      );
    }
    return GraphManager._instance;
  }

  /**
   * Returns true if GraphManager has been initialized.
   */
  static isInitialized(): boolean {
    return GraphManager._instance !== null;
  }

  /**
   * Resets the singleton. Useful for testing.
   * Not intended for production use.
   */
  static reset(): void {
    GraphManager._instance = null;
  }

  private constructor(config: GraphManagerConfig) {
    this._config = config;

    if (config.cache) {
      this._cacheManager = new CacheManager(config.cache);
    }
  }

  /**
   * Returns the CacheManager instance, or null if caching is not configured.
   */
  getCacheManager(): CacheManager | null {
    return this._cacheManager;
  }

  /**
   * Returns true if caching is enabled (i.e. a cache config was provided at init).
   */
  isCachingEnabled(): boolean {
    return this._cacheManager !== null;
  }

  /**
   * Returns the configuration used to initialize this GraphManager.
   */
  getConfig(): GraphManagerConfig {
    return this._config;
  }
}