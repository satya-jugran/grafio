import type { NodeData, EdgeData, GraphData } from '../types';
import type { IStorageProvider } from './IStorageProvider';
import {
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  EdgeNotFoundError,
  InvalidPropertyError,
  PropertyAlreadyExistsError,
  PropertyNotFoundError,
} from '../errors';
import { deepClone, isPrimitive } from '../utils';

/**
 * Configuration options for InMemoryStorageProvider.
 */
export interface InMemoryStorageProviderOptions {
  /**
   * Graph partition key. Stored for metadata parity with MongoStorageProvider.
   * @default 'default'
   */
  graphId?: string;
}

/**
 * Default in-memory implementation of IStorageProvider.
 *
 * Uses the same Map / Set structures that GraphIndex previously owned directly.
 * All operations are O(1) amortised (hash-map / set lookups) except
 * getAllNodes() / getAllEdges() which are O(n).
 *
 * Each instance is naturally scoped to its own Maps — graphId is stored for
 * metadata parity with MongoStorageProvider.
 *
 * All methods are async to satisfy the IStorageProvider contract, but this
 * implementation resolves immediately (synchronous) — no I/O overhead.
 */
export class InMemoryStorageProvider implements IStorageProvider {
  /** Partition key for metadata parity with MongoStorageProvider. */
  readonly graphId: string;

  constructor(opts: InMemoryStorageProviderOptions = {}) {
    this.graphId = opts.graphId ?? 'default';
  }

  // ---------------------------------------------------------------------------
  // Primary stores
  // ---------------------------------------------------------------------------
  private readonly _nodes = new Map<string, NodeData>();
  private readonly _edges = new Map<string, EdgeData>();

  // Type index maps
  private readonly _nodesByType = new Map<string, Set<string>>();
  private readonly _edgesByType = new Map<string, Set<string>>();

  // Adjacency maps
  private readonly _edgesBySource = new Map<string, Set<string>>();
  private readonly _edgesByTarget = new Map<string, Set<string>>();

  // Property value index: propKey → serializedValue → Set<nodeId>
  private readonly _nodesByProperty = new Map<string, Map<string, Set<string>>>();
  private _edgesByProperty = new Map<string, Map<string, Set<string>>>();

  /** Tracks created index keys for nodes */
  private readonly _nodeIndexedKeys = new Set<string>();

  /** Tracks created index keys for edges */
  private readonly _edgeIndexedKeys = new Set<string>();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _propKey(value: unknown): string {
    return JSON.stringify(value) ?? 'undefined';
  }

  private _indexNodeProperties(node: NodeData): void {
    for (const [key, value] of Object.entries(node.properties)) {
      const serialized = this._propKey(value);
      if (!this._nodesByProperty.has(key)) {
        this._nodesByProperty.set(key, new Map());
      }
      const valueMap = this._nodesByProperty.get(key)!;
      if (!valueMap.has(serialized)) {
        valueMap.set(serialized, new Set());
      }
      valueMap.get(serialized)!.add(node.id);
    }
  }

  private _unindexNodeProperties(node: NodeData): void {
    for (const [key, value] of Object.entries(node.properties)) {
      this._unindexNodeProperty(node.id, key, value);
    }
  }

  private _indexNodeProperty(nodeId: string, key: string, value: unknown): void {
    const serialized = this._propKey(value);
    if (!this._nodesByProperty.has(key)) {
      this._nodesByProperty.set(key, new Map());
    }
    const valueMap = this._nodesByProperty.get(key)!;
    if (!valueMap.has(serialized)) {
      valueMap.set(serialized, new Set());
    }
    valueMap.get(serialized)!.add(nodeId);
  }

  private _unindexNodeProperty(nodeId: string, key: string, value: unknown): void {
    const serialized = this._propKey(value);
    const valueMap = this._nodesByProperty.get(key);
    if (!valueMap) return;
    const idSet = valueMap.get(serialized);
    if (!idSet) return;
    idSet.delete(nodeId);
    if (idSet.size === 0) {
      valueMap.delete(serialized);
      if (valueMap.size === 0) {
        this._nodesByProperty.delete(key);
      }
    }
  }

  private _indexEdgeProperty(edgeId: string, key: string, value: unknown): void {
    const serialized = this._propKey(value);
    if (!this._edgesByProperty.has(key)) {
      this._edgesByProperty.set(key, new Map());
    }
    const valueMap = this._edgesByProperty.get(key)!;
    if (!valueMap.has(serialized)) {
      valueMap.set(serialized, new Set());
    }
    valueMap.get(serialized)!.add(edgeId);
  }

  private _unindexEdgeProperty(edgeId: string, key: string, value: unknown): void {
    const serialized = this._propKey(value);
    const valueMap = this._edgesByProperty.get(key);
    if (!valueMap) return;
    const idSet = valueMap.get(serialized);
    if (!idSet) return;
    idSet.delete(edgeId);
    if (idSet.size === 0) {
      valueMap.delete(serialized);
      if (valueMap.size === 0) {
        this._edgesByProperty.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async clear(): Promise<void> {
    this._nodes.clear();
    this._edges.clear();
    this._nodesByType.clear();
    this._edgesByType.clear();
    this._edgesBySource.clear();
    this._edgesByTarget.clear();
    this._nodesByProperty.clear();
  }

  // ---------------------------------------------------------------------------
  // Node mutations
  // ---------------------------------------------------------------------------

  async insertNode(node: NodeData): Promise<void> {
    this._insertNode(node, false);
  }

  /** @internal Used by importJSON — skips the defensive clone since the data is already owned. */
  private _insertNode(node: NodeData, skipClone: boolean): void {
    if (this._nodes.has(node.id)) {
      throw new NodeAlreadyExistsError(node.id);
    }
    const stored = skipClone ? node : deepClone(node);
    this._nodes.set(node.id, stored);

    // Type index
    if (!this._nodesByType.has(node.type)) {
      this._nodesByType.set(node.type, new Set());
    }
    this._nodesByType.get(node.type)!.add(node.id);

    // Property value index
    this._indexNodeProperties(stored);
  }

  async deleteNode(id: string): Promise<void> {
    const node = this._nodes.get(id);
    if (!node) return;

    // Type index
    const typeSet = this._nodesByType.get(node.type);
    if (typeSet) {
      typeSet.delete(id);
      if (typeSet.size === 0) this._nodesByType.delete(node.type);
    }

    // Property value index
    this._unindexNodeProperties(node);

    this._nodes.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Node queries
  // ---------------------------------------------------------------------------

  async hasNode(id: string): Promise<boolean> {
    return this._nodes.has(id);
  }

  async getNode(id: string): Promise<NodeData | undefined> {
    const node = this._nodes.get(id);
    return node ? deepClone(node) : undefined;
  }

  async getAllNodes(limit?: number): Promise<NodeData[]> {
    const result: NodeData[] = [];
    const iterator = this._nodes.values();
    let count = 0;
    for (const node of iterator) {
      if (limit !== undefined && count >= limit) break;
      result.push(deepClone(node));
      count++;
    }
    return result;
  }

  async getNodesByType(type: string): Promise<NodeData[]> {
    const ids = this._nodesByType.get(type);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this._nodes.get(id))
      .filter((n): n is NodeData => n !== undefined)
      .map(deepClone);
  }

  async getNodesByProperty(key: string, value: unknown, nodeType?: string): Promise<NodeData[]> {
    const serialized = this._propKey(value);
    const valueMap = this._nodesByProperty.get(key);
    if (!valueMap) return [];
    const ids = valueMap.get(serialized);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this._nodes.get(id))
      .filter((n): n is NodeData => n !== undefined)
      .filter(n => !nodeType || nodeType === '*' || n.type === nodeType)
      .map(deepClone);
  }

  // ---------------------------------------------------------------------------
  // Edge mutations
  // ---------------------------------------------------------------------------

  async insertEdge(edge: EdgeData): Promise<void> {
    this._insertEdge(edge, false);
  }

  /** @internal Used by importJSON — skips the defensive clone since the data is already owned. */
  private _insertEdge(edge: EdgeData, skipClone: boolean): void {
    if (this._edges.has(edge.id)) {
      throw new EdgeAlreadyExistsError(edge.id);
    }
    const stored = skipClone ? edge : deepClone(edge);
    this._edges.set(edge.id, stored);

    // Adjacency
    if (!this._edgesBySource.has(edge.sourceId)) {
      this._edgesBySource.set(edge.sourceId, new Set());
    }
    this._edgesBySource.get(edge.sourceId)!.add(edge.id);

    if (!this._edgesByTarget.has(edge.targetId)) {
      this._edgesByTarget.set(edge.targetId, new Set());
    }
    this._edgesByTarget.get(edge.targetId)!.add(edge.id);

    // Type index
    if (!this._edgesByType.has(edge.type)) {
      this._edgesByType.set(edge.type, new Set());
    }
    this._edgesByType.get(edge.type)!.add(edge.id);
  }

  async deleteEdge(id: string): Promise<void> {
    const edge = this._edges.get(id);
    if (!edge) return;

    // Adjacency
    const srcSet = this._edgesBySource.get(edge.sourceId);
    if (srcSet) {
      srcSet.delete(id);
      if (srcSet.size === 0) this._edgesBySource.delete(edge.sourceId);
    }

    const tgtSet = this._edgesByTarget.get(edge.targetId);
    if (tgtSet) {
      tgtSet.delete(id);
      if (tgtSet.size === 0) this._edgesByTarget.delete(edge.targetId);
    }

    // Type index
    const typeSet = this._edgesByType.get(edge.type);
    if (typeSet) {
      typeSet.delete(id);
      if (typeSet.size === 0) this._edgesByType.delete(edge.type);
    }

    this._edges.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Edge queries
  // ---------------------------------------------------------------------------

  async hasEdge(id: string): Promise<boolean> {
    return this._edges.has(id);
  }

  async getEdge(id: string): Promise<EdgeData | undefined> {
    const edge = this._edges.get(id);
    return edge ? deepClone(edge) : undefined;
  }

  async getAllEdges(): Promise<EdgeData[]> {
    return Array.from(this._edges.values()).map(deepClone);
  }

  async getEdgesByType(type: string): Promise<EdgeData[]> {
    const ids = this._edgesByType.get(type);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this._edges.get(id))
      .filter((e): e is EdgeData => e !== undefined)
      .map(deepClone);
  }

  async getEdgesBySource(nodeId: string, type?: string): Promise<EdgeData[]> {
    const ids = this._edgesBySource.get(nodeId);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this._edges.get(id))
      .filter((e): e is EdgeData => e !== undefined)
      .filter(e => !type || e.type === type)
      .map(deepClone);
  }

  async getEdgesByTarget(nodeId: string, type?: string): Promise<EdgeData[]> {
    const ids = this._edgesByTarget.get(nodeId);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this._edges.get(id))
      .filter((e): e is EdgeData => e !== undefined)
      .filter(e => !type || e.type === type)
      .map(deepClone);
  }

  // ---------------------------------------------------------------------------
  // Index management
  // ---------------------------------------------------------------------------

  /**
   * Creates an index on a node or edge property.
   *
   * For InMemoryStorageProvider, property indexes are auto-maintained on insert/delete.
   * This method primarily tracks which properties should be indexed and rebuilds
   * compound indexes if needed.
   *
   * @param target - Either 'node' or 'edge'
   * @param propertyKey - The property name to index
   * @param type - Optional type filter. If provided (not '*' or undefined), creates a compound index on (type, propertyKey)
   */
  async createIndex(target: 'node' | 'edge', propertyKey: string, type?: string): Promise<void> {
    if (target === 'node') {
      if (!this._nodesByProperty.has(propertyKey)) {
        this._nodesByProperty.set(propertyKey, new Map());
      }

      // If type is specified, build compound index for existing nodes of that type
      if (type && type !== '*') {
        const valueMap = this._nodesByProperty.get(propertyKey)!;
        for (const node of this._nodes.values()) {
          if (node.type === type && propertyKey in node.properties) {
            const serialized = this._propKey(node.properties[propertyKey]);
            if (!valueMap.has(serialized)) {
              valueMap.set(serialized, new Set());
            }
            valueMap.get(serialized)!.add(node.id);
          }
        }
      }
    } else {
      // For edges
      this._edgeIndexedKeys.add(propertyKey);
      if (!this._edgesByProperty.has(propertyKey)) {
        this._edgesByProperty.set(propertyKey, new Map());
      }

      // If type is specified, build compound index for existing edges of that type
      if (type && type !== '*') {
        const valueMap = this._edgesByProperty.get(propertyKey)!;
        for (const edge of this._edges.values()) {
          if (edge.type === type && propertyKey in edge.properties) {
            const serialized = this._propKey(edge.properties[propertyKey]);
            if (!valueMap.has(serialized)) {
              valueMap.set(serialized, new Set());
            }
            valueMap.get(serialized)!.add(edge.id);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Property mutations
  // ---------------------------------------------------------------------------

  /**
   * Adds a property to a node or edge. Fails if the property key already exists.
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   * @throws PropertyAlreadyExistsError if the property key already exists
   * @throws InvalidPropertyError if the value is not a primitive
   */
  async addProperty(target: 'node' | 'edge', id: string, key: string, value: unknown): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }

    const record = target === 'node' ? this._nodes.get(id) : this._edges.get(id);
    if (!record) {
      if (target === 'node') {
        throw new NodeNotFoundError(id);
      } else {
        throw new EdgeNotFoundError(id);
      }
    }

    if (key in record.properties) {
      throw new PropertyAlreadyExistsError(target, id, key);
    }

    record.properties = { ...record.properties, [key]: value };

    if (target === 'node') {
      this._indexNodeProperty(id, key, value);
    } else {
      this._indexEdgeProperty(id, key, value);
    }
  }

  /**
   * Updates an existing property on a node or edge. Fails if the property doesn't exist.
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   * @throws PropertyNotFoundError if the property key doesn't exist
   * @throws InvalidPropertyError if the value is not a primitive
   */
  async updateProperty(target: 'node' | 'edge', id: string, key: string, value: unknown): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }

    const record = target === 'node' ? this._nodes.get(id) : this._edges.get(id);
    if (!record) {
      if (target === 'node') {
        throw new NodeNotFoundError(id);
      } else {
        throw new EdgeNotFoundError(id);
      }
    }

    if (!(key in record.properties)) {
      throw new PropertyNotFoundError(target, id, key);
    }

    const oldValue = record.properties[key];
    record.properties = { ...record.properties, [key]: value };

    // Update index: remove from old value map, add to new
    if (target === 'node') {
      this._unindexNodeProperty(id, key, oldValue);
      this._indexNodeProperty(id, key, value);
    } else {
      this._unindexEdgeProperty(id, key, oldValue);
      this._indexEdgeProperty(id, key, value);
    }
  }

  /**
   * Deletes a property from a node or edge.
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   */
  async deleteProperty(target: 'node' | 'edge', id: string, key: string): Promise<void> {
    const record = target === 'node' ? this._nodes.get(id) : this._edges.get(id);
    if (!record) {
      if (target === 'node') {
        throw new NodeNotFoundError(id);
      } else {
        throw new EdgeNotFoundError(id);
      }
    }

    const oldValue = record.properties[key];
    delete record.properties[key];

    if (target === 'node') {
      this._unindexNodeProperty(id, key, oldValue);
    } else {
      this._unindexEdgeProperty(id, key, oldValue);
    }
  }

  /**
   * Clears all properties from a node or edge.
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   */
  async clearProperties(target: 'node' | 'edge', id: string): Promise<void> {
    const record = target === 'node' ? this._nodes.get(id) : this._edges.get(id);
    if (!record) {
      if (target === 'node') {
        throw new NodeNotFoundError(id);
      } else {
        throw new EdgeNotFoundError(id);
      }
    }

    // Unindex all current properties
    for (const [key, value] of Object.entries(record.properties)) {
      if (target === 'node') {
        this._unindexNodeProperty(id, key, value);
      } else {
        this._unindexEdgeProperty(id, key, value);
      }
    }

    record.properties = {};
  }

  // ---------------------------------------------------------------------------
  // Data portability
  // ---------------------------------------------------------------------------

  /**
   * Exports all nodes and edges as a portable GraphData snapshot.
   * InMemory strategy: single full iteration — O(n) nodes + O(e) edges.
   */
  async exportJSON(): Promise<GraphData> {
    return {
      graphId: this.graphId,
      nodes: Array.from(this._nodes.values()).map(deepClone),
      edges: Array.from(this._edges.values()).map(deepClone),
    };
  }

  /**
   * Imports nodes and edges from a portable GraphData object.
   * InMemory strategy: single-pass insert for nodes then edges.
   *
   * @throws NodeAlreadyExistsError if a node id is already present
   * @throws EdgeAlreadyExistsError if an edge id is already present
   * @throws NodeNotFoundError if an edge references a non-existent node
   */
  async importJSON(data: GraphData): Promise<void> {
    for (const nodeData of data.nodes) {
      // _insertNode throws NodeAlreadyExistsError on duplicate ids
      this._insertNode(nodeData, true);
    }

    for (const edgeData of data.edges) {
      // Validate node references before inserting
      if (!this._nodes.has(edgeData.sourceId)) {
        throw new NodeNotFoundError(edgeData.sourceId);
      }
      if (!this._nodes.has(edgeData.targetId)) {
        throw new NodeNotFoundError(edgeData.targetId);
      }
      // _insertEdge throws EdgeAlreadyExistsError on duplicate ids
      this._insertEdge(edgeData, true);
    }
  }
}
