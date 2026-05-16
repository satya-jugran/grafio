import { Graph } from '../Graph';
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
   * @param graphId - Defaults to `"default"` when omitted.
   */
  forGraph(graphId: string = 'default'): Graph {
    return new Graph(new InMemoryStorageProvider({ ...this._opts, graphId }));
  }
}
