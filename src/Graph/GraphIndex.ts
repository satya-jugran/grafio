import { Node } from '../Node';
import { Edge } from '../Edge';
import {
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  NodeHasEdgesError,
  InvalidPropertyError,
} from '../errors';
import { isFlatRecord, isPrimitive } from '../utils';
import type { IStorageProvider } from '../storage/IStorageProvider';
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
  async getNodes(): Promise<readonly Node[]> {
    const data = await this._store.getAllNodes();
    return data.map(d => new Node(d.type, d.properties, d.id));
  }

  /** Returns all edges in the graph. */
  async getEdges(): Promise<readonly Edge[]> {
    const data = await this._store.getAllEdges();
    return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id));
  }

  /** Checks if a node exists in the graph. */
  async hasNode(id: string): Promise<boolean> {
    return this._store.hasNode(id);
  }

  /** Checks if an edge exists in the graph. */
  async hasEdge(id: string): Promise<boolean> {
    return this._store.hasEdge(id);
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
    if (await this._store.hasNode(node.id, handle)) {
      throw new NodeAlreadyExistsError(node.id);
    }
    await this._store.insertNode(node.toJSON(), handle);
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
    if (!await this._store.hasNode(id, handle)) return false;

    const [outgoing, incoming] = await Promise.all([
      this._store.getEdgesBySource(id, undefined, handle),
      this._store.getEdgesByTarget(id, undefined, handle),
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
    return true;
  }

  /** Retrieves a node by id. */
  async getNode(id: string): Promise<Node | undefined> {
    const data = await this._store.getNode(id);
    if (!data) return undefined;
    return new Node(data.type, data.properties, data.id);
  }

  /** Retrieves nodes by their type. */
  async getNodesByType(type: string): Promise<Node[]> {
    const data = await this._store.getNodesByType(type);
    return data.map(d => new Node(d.type, d.properties, d.id));
  }

  /**
   * Retrieves nodes by a property value.
   * @param options - Optional options with nodeType filter
   */
  async getNodesByProperty(key: string, value: unknown, options?: { nodeType?: string }): Promise<Node[]> {
    const data = await this._store.getNodesByProperty(key, value, options?.nodeType);
    return data.map(d => new Node(d.type, d.properties, d.id));
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

    const handle = transaction?._getHandle();
    const [sourceExists, targetExists] = await Promise.all([
      this._store.hasNode(sourceId, handle),
      this._store.hasNode(targetId, handle),
    ]);
    if (!sourceExists) throw new NodeNotFoundError(sourceId);
    if (!targetExists) throw new NodeNotFoundError(targetId);

    const edge = new Edge(sourceId, targetId, type, properties);
    if (await this._store.hasEdge(edge.id, handle)) throw new EdgeAlreadyExistsError(edge.id);

    await this._store.insertEdge(edge.toJSON(), handle);
    return edge;
  }

  /**
   * Removes an edge from the graph.
   * @param transaction - Optional transaction to use for this operation
   * @returns true if removed, false if not found
   */
  async removeEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    if (!await this._store.hasEdge(id)) return false;
    const handle = transaction?._getHandle();
    await this._store.deleteEdge(id, handle);
    return true;
  }

  /** Retrieves an edge by id. */
  async getEdge(id: string): Promise<Edge | undefined> {
    const data = await this._store.getEdge(id);
    if (!data) return undefined;
    return new Edge(data.sourceId, data.targetId, data.type, data.properties, data.id);
  }

  /**
   * Gets the parent nodes of a given node (nodes with edges pointing TO this node).
   * @throws NodeNotFoundError if the node doesn't exist
   */
  async getParents(nodeId: string, options?: { nodeType?: string; edgeType?: string }): Promise<Node[]> {
    if (!await this._store.hasNode(nodeId)) throw new NodeNotFoundError(nodeId);

    const nodeType = options?.nodeType ?? '*';
    const edgeType = options?.edgeType ?? '*';
    const parentIds = new Set<string>();

    const edges = await this._store.getEdgesByTarget(nodeId);
    for (const edge of edges) {
      if (edgeType !== '*' && edge.type !== edgeType) continue;
      if (nodeType === '*') {
        parentIds.add(edge.sourceId);
      } else {
        const sourceData = await this._store.getNode(edge.sourceId);
        if (!sourceData) continue;
        if (sourceData.type !== nodeType) continue;
        parentIds.add(edge.sourceId);
      }
    }

    if (parentIds.size === 0) return [];
    const parentDataList = await Promise.all([...parentIds].map(id => this._store.getNode(id)));
    return parentDataList.filter((d): d is NonNullable<typeof d> => d !== undefined).map(d => new Node(d.type, d.properties, d.id));
  }

  /**
   * Gets the child nodes of a given node (nodes this node points TO).
   * @throws NodeNotFoundError if the node doesn't exist
   */
  async getChildren(nodeId: string, options?: { nodeType?: string; edgeType?: string }): Promise<Node[]> {
    if (!await this._store.hasNode(nodeId)) throw new NodeNotFoundError(nodeId);

    const nodeType = options?.nodeType ?? '*';
    const edgeType = options?.edgeType ?? '*';
    const childIds = new Set<string>();

    const edges = await this._store.getEdgesBySource(nodeId, edgeType !== '*' ? edgeType : undefined);
    for (const edge of edges) {
      if (nodeType === '*') {
        childIds.add(edge.targetId);
      } else {
        const targetData = await this._store.getNode(edge.targetId);
        if (!targetData) continue;
        if (targetData.type !== nodeType) continue;
        childIds.add(edge.targetId);
      }
    }

    if (childIds.size === 0) return [];
    const childDataList = await Promise.all([...childIds].map(id => this._store.getNode(id)));
    return childDataList.filter((d): d is NonNullable<typeof d> => d !== undefined).map(d => new Node(d.type, d.properties, d.id));
  }

  /**
   * Gets all outgoing edges from a node.
   * @throws NodeNotFoundError if the node doesn't exist
   */
  async getEdgesFrom(sourceId: string, options?: { edgeType?: string }): Promise<Edge[]> {
    if (!await this._store.hasNode(sourceId)) throw new NodeNotFoundError(sourceId);

    const edgeType = options?.edgeType ?? '*';
    const data = await this._store.getEdgesBySource(sourceId, edgeType !== '*' ? edgeType : undefined);
    return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id));
  }

  /**
   * Gets all incoming edges to a node.
   * @throws NodeNotFoundError if the node doesn't exist
   */
  async getEdgesTo(targetId: string, options?: { edgeType?: string }): Promise<Edge[]> {
    if (!await this._store.hasNode(targetId)) throw new NodeNotFoundError(targetId);

    const edgeType = options?.edgeType ?? '*';
    const data = await this._store.getEdgesByTarget(targetId, edgeType !== '*' ? edgeType : undefined);
    return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id));
  }

  /**
   * Gets all direct edges between two nodes (in either direction).
   * @throws NodeNotFoundError if either node doesn't exist
   */
  async getDirectEdgesBetween(sourceId: string, targetId: string, options?: { edgeType?: string }): Promise<Edge[]> {
    const [sourceExists, targetExists] = await Promise.all([
      this._store.hasNode(sourceId),
      this._store.hasNode(targetId),
    ]);
    if (!sourceExists) throw new NodeNotFoundError(sourceId);
    if (!targetExists) throw new NodeNotFoundError(targetId);

    const edgeType = options?.edgeType ?? '*';
    const result: Edge[] = [];

    const [outFromSource, outFromTarget] = await Promise.all([
      this._store.getEdgesBySource(sourceId, edgeType !== '*' ? edgeType : undefined),
      this._store.getEdgesBySource(targetId, edgeType !== '*' ? edgeType : undefined),
    ]);

    for (const e of outFromSource) {
      if (e.targetId === targetId) {
        result.push(new Edge(e.sourceId, e.targetId, e.type, e.properties, e.id));
      }
    }
    for (const e of outFromTarget) {
      if (e.targetId === sourceId) {
        result.push(new Edge(e.sourceId, e.targetId, e.type, e.properties, e.id));
      }
    }

    return result;
  }

  /** Gets all edges of a specific type. */
  async getEdgesByType(type: string): Promise<Edge[]> {
    const data = await this._store.getEdgesByType(type);
    return data.map(d => new Edge(d.sourceId, d.targetId, d.type, d.properties, d.id));
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
    await this._store.addProperty('node', nodeId, key, value, handle);
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
    await this._store.updateProperty('node', nodeId, key, value, handle);
  }

  /**
   * Deletes a property from a node.
   */
  async deleteNodeProperty(nodeId: string, key: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    await this._store.deleteProperty('node', nodeId, key, handle);
  }

  /**
   * Clears all properties from a node.
   */
  async clearNodeProperties(nodeId: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    await this._store.clearProperties('node', nodeId, handle);
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
    await this._store.addProperty('edge', edgeId, key, value, handle);
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
    await this._store.updateProperty('edge', edgeId, key, value, handle);
  }

  /**
   * Deletes a property from an edge.
   */
  async deleteEdgeProperty(edgeId: string, key: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    await this._store.deleteProperty('edge', edgeId, key, handle);
  }

  /**
   * Clears all properties from an edge.
   */
  async clearEdgeProperties(edgeId: string, transaction?: GraphTransaction): Promise<void> {
    const handle = transaction?._getHandle();
    await this._store.clearProperties('edge', edgeId, handle);
  }

  // ---------------------------------------------------------------------------
  // Index management
  // ---------------------------------------------------------------------------

  /**
   * Creates an index on a node or edge property.
   */
  async createIndex(target: 'node' | 'edge', propertyKey: string, type?: string): Promise<void> {
    await this._store.createIndex(target, propertyKey, type);
  }
}
