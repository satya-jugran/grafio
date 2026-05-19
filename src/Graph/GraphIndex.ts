import { Node } from '../Node';
import { Edge } from '../Edge';
import {
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  InvalidPropertyError,
  NodeHasEdgesError,
} from '../errors';
import { isFlatRecord, isPrimitive } from '../utils';
import type { IStorageProvider, StorageQueryOptions } from '../storage/IStorageProvider';
import type { AggregateResult, EdgeData } from '../types';
import type { GraphQueryOptions } from './GraphQueryOptions';
import { InMemoryStorageProvider } from '../storage/InMemoryStorageProvider';
import { GraphTransaction } from './GraphTransaction';

/**
 * Internal class that manages graph operations.
 *
 * GraphIndex is the single point of access for all node/edge CRUD.
 * It delegates all persistence and index maintenance to an IStorageProvider,
 * making the backing store swappable (in-memory, MongoDB, …) without
 * any changes to Graph, GraphTraversal, or GraphAdminOps.
 *
 * All methods are async to support both synchronous in-memory providers
 * and asynchronous network-based providers through a unified API.
 *
 * The default provider is InMemoryStorageProvider, which resolves immediately.
 */
export class GraphIndex {
  private readonly _store: IStorageProvider;

  /**
   * @param store - Storage provider to use. Defaults to InMemoryStorageProvider.
   */
  constructor(store: IStorageProvider = new InMemoryStorageProvider()) {
    this._store = store;
  }

  /** @internal Exposes the underlying storage provider (used by Graph to wire GraphTraversal and GraphAdminOps). */
  _getStore(): IStorageProvider {
    return this._store;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns all nodes in the graph. */
  async getNodes(options?: GraphQueryOptions): Promise<readonly Node[]> {
    if (!options) {
      const data = await this._store.getNodes(undefined);
      return data.map(d => new Node(d.type, d.properties, d.id, d.createdOn, d.updatedOn));
    }
    const handle = options.transaction?._getHandle();
    const storageOptions: StorageQueryOptions = {
      filter: options.filter,
      orderBy: options.orderBy,
      limit: options.limit,
      transaction: handle,
    };
    const data = await this._store.getNodes(storageOptions);
    return data.map(d => new Node(d.type, d.properties, d.id, d.createdOn, d.updatedOn));
  }

  /** Returns all edges in the graph. */
  async getEdges(options?: GraphQueryOptions): Promise<readonly Edge[]> {
    if (!options) {
      const data = await this._store.getEdges(undefined);
      return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id));
    }
    const handle = options.transaction?._getHandle();
    const storageOptions: StorageQueryOptions = {
      filter: options.filter,
      orderBy: options.orderBy,
      limit: options.limit,
      transaction: handle,
    };
    const data = await this._store.getEdges(storageOptions);
    return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id));
  }

  /** Returns the count of nodes matching the query options (O(1) without filter). */
  async getNodeCount(options?: GraphQueryOptions): Promise<number> {
    const handle = options?.transaction?._getHandle();
    const storageOptions: StorageQueryOptions | undefined = options ? {
      filter: options.filter,
      transaction: handle,
    } : undefined;
    return this._store.getNodeCount(storageOptions);
  }

  /** Returns the count of edges matching the query options (O(1) without filter). */
  async getEdgeCount(options?: GraphQueryOptions): Promise<number> {
    const handle = options?.transaction?._getHandle();
    const storageOptions: StorageQueryOptions | undefined = options ? {
      filter: options.filter,
      transaction: handle,
    } : undefined;
    return this._store.getEdgeCount(storageOptions);
  }

  /** Checks if a node exists in the graph. */
  async hasNode(id: string, transaction?: GraphTransaction): Promise<boolean> {
    const handle = transaction?._getHandle();
    return this._store.hasNode(id, handle);
  }

  /** Checks if an edge exists in the graph. */
  async hasEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    const handle = transaction?._getHandle();
    return this._store.hasEdge(id, handle);
  }

  /**
   * Adds a new node to the graph.
   * @throws InvalidPropertyError if properties contain non-supported primitive values
   * @throws NodeAlreadyExistsError if a node with this id already exists
   */
  async addNode(type: string, properties: Record<string, unknown> = {}, transaction?: GraphTransaction): Promise<Node> {
    // Validate properties are flat primitives
    if (!isFlatRecord(properties)) {
      const invalidEntry = Object.entries(properties).find(([, value]) => {
        if (value === null || value === undefined) return false;
        const t = typeof value;
        return t === 'object' || t === 'function';
      });
      if (invalidEntry) {
        throw new InvalidPropertyError(invalidEntry[0], invalidEntry[1]);
      }
    }

    const handle = transaction?._getHandle();
    const node = new Node(type, properties);
    try {
      if (await this._store.hasNode(node.id, handle)) {
        throw new NodeAlreadyExistsError(node.id);
      }
      await this._store.insertNode(node.toJSON(), handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return node;
  }

  /**
   * Removes a node from the graph.
   * @param cascade - If true, also removes all incident edges (default: false)
   * @param transaction - Optional transaction to use for this operation
   * @throws NodeHasEdgesError if cascade is false and the node has incident edges
   */
  async removeNode(id: string, cascade: boolean = false, transaction?: GraphTransaction): Promise<boolean> {
    const handle = transaction?._getHandle();
    try {
      if (!await this._store.hasNode(id, handle)) return false;

      const [outgoing, incoming] = await Promise.all([
        this._store.getEdgesBySource(id, { transaction: handle }),
        this._store.getEdgesByTarget(id, { transaction: handle }),
      ]);

      if (cascade) {
        for (const edge of [...outgoing, ...incoming]) {
          await this._store.deleteEdge(edge.id, handle);
        }
      } else {
        const incidentCount = outgoing.length + incoming.length;
        if (incidentCount > 0) {
          throw new NodeHasEdgesError(id, incidentCount);
        }
      }

      await this._store.deleteNode(id, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return true;
  }

  /** Retrieves a node by id. */
  async getNode(id: string, transaction?: GraphTransaction): Promise<Node | undefined> {
    const handle = transaction?._getHandle();
    const data = await this._store.getNode(id, handle);
    if (!data) return undefined;
    return new Node(data.type, data.properties, data.id, data.createdOn, data.updatedOn);
  }

  /** Returns nodes by their ids. */
  async getNodesByIds(ids: string[], transaction?: GraphTransaction): Promise<Map<string, Node>> {
    const handle = transaction?._getHandle();
    const data = await this._store.getNodesByIds(ids, handle);
    const result = new Map<string, Node>();
    for (const [id, d] of data) {
      result.set(id, new Node(d.type, d.properties, d.id, d.createdOn, d.updatedOn));
    }
    return result;
  }

  /**
   * Adds a new directed edge to the graph.
   * @throws InvalidPropertyError if properties contain non-primitive values
   * @throws NodeNotFoundError if source or target node doesn't exist
   * @throws EdgeAlreadyExistsError if an edge with this id already exists
   */
  async addEdge(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Record<string, unknown> = {},
    transaction?: GraphTransaction
  ): Promise<Edge> {
    // Validate properties are flat primitives
    if (!isFlatRecord(properties)) {
      const invalidEntry = Object.entries(properties).find(([, value]) => {
        if (value === null || value === undefined) return false;
        const t = typeof value;
        return t === 'object' || t === 'function';
      });
      if (invalidEntry) {
        throw new InvalidPropertyError(invalidEntry[0], invalidEntry[1]);
      }
    }

    const edge = new Edge(sourceId, targetId, type, properties, undefined, Date.now(), Date.now());
    const handle = transaction?._getHandle();
    try {

      const sourceExists = await this._store.hasNode(sourceId, handle);
      const targetExists = await this._store.hasNode(targetId, handle);
      if (!sourceExists) throw new NodeNotFoundError(sourceId);
      if (!targetExists) throw new NodeNotFoundError(targetId);

      if (await this._store.hasEdge(edge.id, handle)) throw new EdgeAlreadyExistsError(edge.id);

      await this._store.insertEdge(edge.toJSON(), handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return edge;
  }

  /**
   * Removes an edge from the graph.
   * @param transaction - Optional transaction to use for this operation
   * @returns true if removed, false if not found
   */
  async removeEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    const handle = transaction?._getHandle();
    try {
      if (!await this._store.hasEdge(id, handle)) return false;
      await this._store.deleteEdge(id, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return true;
  }

  /** Retrieves an edge by id. */
  async getEdge(id: string, transaction?: GraphTransaction): Promise<Edge | undefined> {
    const handle = transaction?._getHandle();
    const data = await this._store.getEdge(id, handle);
    if (!data) return undefined;
    return new Edge(data.sourceId, data.targetId, data.type, data.properties, data.id, data.createdOn, data.updatedOn);
  }

  /**
   * Gets all outgoing edges from a node.
   * @throws NodeNotFoundError if the node doesn't exist
   */
  async getEdgesFrom(sourceId: string, options?: GraphQueryOptions): Promise<Edge[]> {
    const handle = options?.transaction?._getHandle();
    if (!await this._store.hasNode(sourceId, handle)) throw new NodeNotFoundError(sourceId);

    const storageOptions = options ? {
      filter: options.filter,
      orderBy: options.orderBy,
      limit: options.limit,
      transaction: handle,
    } : undefined;
    const data = await this._store.getEdgesBySource(sourceId, storageOptions);
    return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id, d.createdOn, d.updatedOn));
  }

  /**
   * Gets all incoming edges to a node.
   * @throws NodeNotFoundError if the node doesn't exist
   */
  async getEdgesTo(targetId: string, options?: GraphQueryOptions): Promise<Edge[]> {
    const handle = options?.transaction?._getHandle();
    if (!await this._store.hasNode(targetId, handle)) throw new NodeNotFoundError(targetId);

    const storageOptions = options ? {
      filter: options.filter,
      orderBy: options.orderBy,
      limit: options.limit,
      transaction: handle,
    } : undefined;
    const data = await this._store.getEdgesByTarget(targetId, storageOptions);
    return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id, d.createdOn, d.updatedOn));
  }

  /**
   * Gets all direct edges between two nodes (in either direction).
   * @throws NodeNotFoundError if either node doesn't exist
   */
  async getDirectEdgesBetween(sourceId: string, targetId: string, options?: GraphQueryOptions): Promise<Edge[]> {
    const handle = options?.transaction?._getHandle();
    const [sourceExists, targetExists] = await Promise.all([
      this._store.hasNode(sourceId, handle),
      this._store.hasNode(targetId, handle),
    ]);
    if (!sourceExists) throw new NodeNotFoundError(sourceId);
    if (!targetExists) throw new NodeNotFoundError(targetId);

    const result: Edge[] = [];
    const storageOptions = options ? { filter: options.filter, transaction: handle } : undefined;


    const [outFromSource, outFromTarget] = await Promise.all([
      this._store.getEdgesBySource(sourceId, storageOptions),
      this._store.getEdgesBySource(targetId, storageOptions),
    ]);

    for (const e of outFromSource) {
      if (e.targetId === targetId) {
        result.push(new Edge(e.sourceId, e.targetId, e.type, e.properties, e.id, e.createdOn, e.updatedOn));
      }
    }
    for (const e of outFromTarget) {
      if (e.targetId === sourceId) {
        result.push(new Edge(e.sourceId, e.targetId, e.type, e.properties, e.id, e.createdOn, e.updatedOn));
      }
    }

    return result;
  }

  /** Clears all data and indices. */
  async clear(): Promise<void> {
    await this._store.clear();
  }

  // ---------------------------------------------------------------------------
  // Node property mutations
  // ---------------------------------------------------------------------------

  /**
   * Adds a property to a node. Fails if the property key already exists.
   * @throws InvalidPropertyError if the value is not a primitive
   */
  async addNodeProperty(nodeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }
    const handle = transaction?._getHandle();
    try {
      await this._store.addProperty('node', nodeId, key, value, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  /**
   * Updates an existing property on a node. Fails if the property doesn't exist.
   * @throws InvalidPropertyError if the value is not a primitive
   */
  async updateNodeProperty(nodeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }
    const handle = transaction?._getHandle();
    try {
      await this._store.updateProperty('node', nodeId, key, value, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  /**
   * Deletes a property from a node.
   */
  async deleteNodeProperty(nodeId: string, key: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    try {
      await this._store.deleteProperty('node', nodeId, key, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  /**
   * Clears all properties from a node.
   */
  async clearNodeProperties(nodeId: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    try {
      await this._store.clearProperties('node', nodeId, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Edge property mutations
  // ---------------------------------------------------------------------------

  /**
   * Adds a property to an edge. Fails if the property key already exists.
   * @throws InvalidPropertyError if the value is not a primitive
   */
  async addEdgeProperty(edgeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }
    const handle = transaction?._getHandle();
    try {
      await this._store.addProperty('edge', edgeId, key, value, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  /**
   * Updates an existing property on an edge. Fails if the property doesn't exist.
   * @throws InvalidPropertyError if the value is not a primitive
   */
  async updateEdgeProperty(edgeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }
    const handle = transaction?._getHandle();
    try {
      await this._store.updateProperty('edge', edgeId, key, value, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  /**
   * Deletes a property from an edge.
   */
  async deleteEdgeProperty(edgeId: string, key: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    try {
      await this._store.deleteProperty('edge', edgeId, key, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  /**
   * Clears all properties from an edge.
   */
  async clearEdgeProperties(edgeId: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    try {
      await this._store.clearProperties('edge', edgeId, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Index management
  // ---------------------------------------------------------------------------

  /**
   * Creates an index on a node or edge property.
   */
  async createIndex(target: 'node' | 'edge', propertyKey: string): Promise<void> {
    await this._store.createIndex(target, propertyKey);
  }

  async hasIndex(target: 'node' | 'edge', propertyKey: string): Promise<boolean> {
    return this._store.hasIndex(target, propertyKey);
  }

  // ---------------------------------------------------------------------------
  // Aggregation
  // ---------------------------------------------------------------------------

  /**
   * Aggregates a numeric property across nodes matching the query options.
   * @param key - The property key to aggregate
   * @param options - Optional query options for filtering
   * @returns AggregateResult with count, sum, avg, min, max
   */
  async aggregateNodeProperty(key: string, options?: GraphQueryOptions): Promise<AggregateResult> {
    const handle = options?.transaction?._getHandle();
    const storageOptions: StorageQueryOptions | undefined = options ? {
      filter: options.filter,
      distinct: options.distinct,
      transaction: handle,
    } : undefined;
    return this._store.aggregateNodeProperty(key, storageOptions);
  }

  /**
   * Aggregates a numeric property across edges matching the query options.
   * @param key - The property key to aggregate
   * @param options - Optional query options for filtering
   * @returns AggregateResult with count, sum, avg, min, max
   */
  async aggregateEdgeProperty(key: string, options?: GraphQueryOptions): Promise<AggregateResult> {
    const handle = options?.transaction?._getHandle();
    const storageOptions: StorageQueryOptions | undefined = options ? {
      filter: options.filter,
      distinct: options.distinct,
      transaction: handle,
    } : undefined;
    return this._store.aggregateEdgeProperty(key, storageOptions);
  }
}
