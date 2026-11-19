import {
  InMemoryStorageProvider,
  type InMemoryStorageProviderOptions,
} from './InMemoryStorageProvider';
import type { IGraphFactory } from './IGraphFactory';
import { Graph } from '../Graph';
import type { GraphData } from '../types';

/**
 * In-memory factory for `Graph` instances.
 *
 * Each call to `forGraph(graphId)` returns a `Graph` backed directly by a fresh
 * `InMemoryStorageProvider` — never wrapped in `CachedStorageProvider`, ensuring
 * in-memory graphs always stay on the synchronous `ISyncGraphKernel` fast path.
 */
export class InMemoryGraphFactory implements IGraphFactory {
  private readonly _opts: Omit<InMemoryStorageProviderOptions, 'graphId'>;

  /**
   * @param opts - Optional defaults applied to every `forGraph` call.
   */
  constructor(opts: Omit<InMemoryStorageProviderOptions, 'graphId'> = {}) {
    this._opts = opts;
  }

  /**
   * Returns a `Graph` backed by a fresh `InMemoryStorageProvider` scoped to `graphId`.
   *
   * @param graphId - Defaults to `"default"` when omitted.
   */
  forGraph(graphId: string = 'default'): Graph {
    const inMemoryProvider = new InMemoryStorageProvider({ ...this._opts, graphId });
    return new Graph(inMemoryProvider);
  }

  /**
   * Creates a Graph instance and imports the given graph data into it.
   *
   * @param data - The GraphData to import
   * @param graphId - Graph partition ID (defaults to 'default')
   * @returns A Graph instance with the imported data
   */
  async fromGraphData(data: GraphData, graphId: string = 'default'): Promise<Graph> {
    const inMemoryProvider = new InMemoryStorageProvider({ ...this._opts, graphId });
    const graph = new Graph(inMemoryProvider);
    await inMemoryProvider.importJSON(data);
    return graph;
  }
}
