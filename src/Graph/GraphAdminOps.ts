import type { GraphData } from '../types';
import type { IStorageProvider } from '../storage/IStorageProvider';
import { isFlatRecord, isPrimitive } from '../utils';
import { InvalidPropertyError } from '../errors';

/**
 * Internal orchestrator for graph data administration operations.
 *
 * `GraphAdminOps` is intentionally thin — it holds a reference to the active
 * `IStorageProvider` and delegates every operation to it.  This means the
 * actual import/export logic lives inside each provider:
 *
 *  - `InMemoryStorageProvider`  — single-pass full iteration (O(n + e))
 *  - `MongoStorageProvider`     — aggregation pipeline / bulkWrite
 *
 * All methods are async to support both synchronous in-memory providers
 * and asynchronous network-based providers through a unified API.
 */
export class GraphAdminOps {
  constructor(private readonly _store: IStorageProvider) {}

  /**
   * Exports the entire graph as a portable JSON object.
   * Delegates to the active provider's `exportJSON()` implementation.
   *
   * @returns GraphData snapshot of the current graph state
   */
  async exportJSON(): Promise<GraphData> {
    return this._store.exportJSON();
  }

  /**
   * Imports graph data from a portable JSON object into the backing store.
   * Validates all properties are flat primitive values before delegating to the store.
   *
   * @param data - GraphData to load
   * @throws InvalidPropertyError if any node or edge has non-primitive property values
   * @throws NodeAlreadyExistsError if a node id is already present
   * @throws EdgeAlreadyExistsError if an edge id is already present
   * @throws NodeNotFoundError if an edge references a non-existent node
   */
  async importJSON(data: GraphData): Promise<void> {
    // Validate all node properties are flat primitives
    for (const node of data.nodes) {
      if (!isFlatRecord(node.properties)) {
        const invalidEntry = Object.entries(node.properties)
          .find(([, value]) => !isPrimitive(value))!;
        throw new InvalidPropertyError(invalidEntry?.[0], invalidEntry?.[1]);
      }
    }

    // Validate all edge properties are flat primitives
    for (const edge of data.edges) {
      if (!isFlatRecord(edge.properties)) {
        const invalidEntry = Object.entries(edge.properties)
          .find(([, value]) => !isPrimitive(value))!;
        throw new InvalidPropertyError(invalidEntry?.[0], invalidEntry?.[1]);
      }
    }

    return this._store.importJSON(data);
  }
}
