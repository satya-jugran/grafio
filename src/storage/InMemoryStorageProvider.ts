import type { NodeData, EdgeData, GraphData } from '../types';
import type { IStorageProvider, IOrderBy, ITransactionHandle } from './IStorageProvider';
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
    this._edgesByProperty.clear();
    // Clear transaction state so clear truly removes all stored data
    this._transactionOverlays.clear();
    this._activeTransaction = null;
  }

  // ---------------------------------------------------------------------------
  // Count queries
  // ---------------------------------------------------------------------------

  async getTotalNodeCount(transaction?: ITransactionHandle): Promise<number> {
    const overlay = this._getOverlay(transaction?.id);
    let count = this._nodes.size;

    if (overlay) {
      // Add overlay nodes that aren't overriding live nodes
      for (const [id, node] of overlay.nodes) {
        if (node && !this._nodes.has(id)) {
          count++;
        }
      }
    }

    return count;
  }

  async getTotalEdgeCount(transaction?: ITransactionHandle): Promise<number> {
    const overlay = this._getOverlay(transaction?.id);
    let count = this._edges.size;

    if (overlay) {
      // Add overlay edges that aren't overriding live edges
      for (const [id, edge] of overlay.edges) {
        if (edge && !this._edges.has(id)) {
          count++;
        }
      }
    }

    return count;
  }

  // ---------------------------------------------------------------------------
  // Node mutations
  // ---------------------------------------------------------------------------

  async insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void> {
    const now = Date.now();
    // Clone first to avoid mutating the caller's object
    const nodeToInsert = deepClone(node);
    
    // Set createdOn and updatedOn at node level if not already set
    if (nodeToInsert.createdOn === undefined) {
      nodeToInsert.createdOn = now;
    }
    if (nodeToInsert.updatedOn === undefined) {
      nodeToInsert.updatedOn = now;
    }

    const overlay = this._getOverlay(transaction?.id);

    if (overlay) {
      // Transaction active: write to overlay
      overlay.nodes.set(nodeToInsert.id, nodeToInsert);
      // Update overlay indexes
      this._overlayAddToIndex(overlay.nodesByType, nodeToInsert.type, nodeToInsert.id);
      this._overlayIndexNodeProperties(overlay, nodeToInsert);
    } else {
      // No transaction: modify live state directly
      this._insertNodeLive(nodeToInsert, true);
    }
  }

  /** @internal Used by importJSON — skips the defensive clone since the data is already owned. */
  private _insertNodeLive(node: NodeData, skipClone: boolean): void {
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

  async deleteNode(id: string, transaction?: ITransactionHandle): Promise<void> {
    const overlay = this._getOverlay(transaction?.id);

    if (overlay) {
      // Mark as deleted in overlay
      overlay.nodes.set(id, null);
      // Mark deletion in overlay indexes
      this._overlayAddToIndex(overlay.nodesByType, '', id); // Will be handled specially
    } else {
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
  }

  private _overlayAddToIndex(index: Map<string, Set<string>>, type: string, id: string): void {
    if (!type) return; // Skip for deletions
    let typeSet = index.get(type);
    if (!typeSet) {
      typeSet = new Set();
      index.set(type, typeSet);
    }
    typeSet.add(id);
  }

  private _overlayIndexNodeProperties(overlay: TransactionOverlay, node: NodeData): void {
    for (const [key, value] of Object.entries(node.properties)) {
      const serialized = JSON.stringify(value) ?? 'undefined';
      let keyMap = overlay.nodesByProperty.get(key);
      if (!keyMap) {
        keyMap = new Map();
        overlay.nodesByProperty.set(key, keyMap);
      }
      let idSet = keyMap.get(serialized);
      if (!idSet) {
        idSet = new Set();
        keyMap.set(serialized, idSet);
      }
      idSet.add(node.id);
    }
  }

  private _overlayIndexEdgeProperties(overlay: TransactionOverlay, edge: EdgeData): void {
    for (const [key, value] of Object.entries(edge.properties)) {
      const serialized = JSON.stringify(value) ?? 'undefined';
      let keyMap = overlay.edgesByProperty.get(key);
      if (!keyMap) {
        keyMap = new Map();
        overlay.edgesByProperty.set(key, keyMap);
      }
      let idSet = keyMap.get(serialized);
      if (!idSet) {
        idSet = new Set();
        keyMap.set(serialized, idSet);
      }
      idSet.add(edge.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Node queries
  // ---------------------------------------------------------------------------

  async hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    const overlay = this._getOverlay(transaction?.id);
    if (overlay) {
      // Check overlay first
      if (overlay.nodes.has(id)) {
        return overlay.nodes.get(id) !== null;
      }
    }
    return this._nodes.has(id);
  }

  async getNode(id: string, transaction?: ITransactionHandle): Promise<NodeData | undefined> {
    const overlay = this._getOverlay(transaction?.id);
    if (overlay) {
      // Check overlay first
      const overlayNode = overlay.nodes.get(id);
      if (overlayNode !== undefined) {
        return overlayNode ? deepClone(overlayNode) : undefined;
      }
    }
    const node = this._nodes.get(id);
    return node ? deepClone(node) : undefined;
  }

  async getAllNodes(limit?: number, orderBy?: IOrderBy, transaction?: ITransactionHandle): Promise<NodeData[]> {
    const overlay = this._getOverlay(transaction?.id);
    const result: NodeData[] = [];
    const seen = new Set<string>();

    if (overlay) {
      // First add all overlay nodes
      for (const [id, node] of overlay.nodes) {
        if (node) {
          result.push(deepClone(node));
          seen.add(id);
        }
      }
    }

    // Then add live nodes not overridden by overlay
    for (const [id, node] of this._nodes) {
      if (seen.has(id)) continue;
      result.push(deepClone(node));
    }

    // Apply ordering if specified
    if (orderBy) {
      result.sort((a, b) => {
        const aVal = a[orderBy.field];
        const bVal = b[orderBy.field];
        if (aVal === undefined && bVal === undefined) return 0;
        if (aVal === undefined) return orderBy.direction === 'asc' ? 1 : -1;
        if (bVal === undefined) return orderBy.direction === 'asc' ? -1 : 1;
        return orderBy.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    // Apply limit
    if (limit !== undefined) {
      return result.slice(0, limit);
    }
    return result;
  }

  async getNodesByType(type: string, transaction?: ITransactionHandle): Promise<NodeData[]> {
    const overlay = this._getOverlay(transaction?.id);
    const seen = new Set<string>();
    const result: NodeData[] = [];

    if (overlay) {
      // Check overlay nodesByType
      const overlayIds = overlay.nodesByType.get(type);
      if (overlayIds) {
        for (const id of overlayIds) {
          const node = overlay.nodes.get(id);
          if (node) {
            result.push(deepClone(node));
            seen.add(id);
          }
        }
      }
    }

    // Merge with live nodes
    const liveIds = this._nodesByType.get(type);
    if (liveIds) {
      for (const id of liveIds) {
        if (seen.has(id)) continue;
        const node = this._nodes.get(id);
        if (node) {
          // Only include if not deleted in overlay
          const overlayNode = overlay?.nodes.get(id);
          if (overlayNode !== null) {
            result.push(deepClone(node));
          }
        }
      }
    }
    return result;
  }

  async getNodesByProperty(key: string, value: unknown, nodeType?: string, transaction?: ITransactionHandle): Promise<NodeData[]> {
    const serialized = this._propKey(value);
    const overlay = this._getOverlay(transaction?.id);
    const seen = new Set<string>();
    const result: NodeData[] = [];

    if (overlay) {
      // Check overlay property index
      const keyMap = overlay.nodesByProperty.get(key);
      if (keyMap) {
        const idSet = keyMap.get(serialized);
        if (idSet) {
          for (const id of idSet) {
            const node = overlay.nodes.get(id);
            if (node) {
              if (!nodeType || nodeType === '*' || node.type === nodeType) {
                result.push(deepClone(node));
                seen.add(id);
              }
            }
          }
        }
      }
    }

    // Merge with live nodes
    const liveMap = this._nodesByProperty.get(key);
    if (liveMap) {
      const liveIds = liveMap.get(serialized);
      if (liveIds) {
        for (const id of liveIds) {
          if (seen.has(id)) continue;
          const node = this._nodes.get(id);
          if (node) {
            // Only include if not deleted in overlay
            const overlayNode = overlay?.nodes.get(id);
            if (overlayNode !== null) {
              if (!nodeType || nodeType === '*' || node.type === nodeType) {
                result.push(deepClone(node));
              }
            }
          }
        }
      }
    }
    return result;
  }

  async getEdgesByProperty(key: string, value: unknown, edgeType?: string, transaction?: ITransactionHandle): Promise<EdgeData[]> {
    const serialized = this._propKey(value);
    const overlay = this._getOverlay(transaction?.id);
    const seen = new Set<string>();
    const result: EdgeData[] = [];

    if (overlay) {
      // Check overlay property index
      const keyMap = overlay.edgesByProperty.get(key);
      if (keyMap) {
        const idSet = keyMap.get(serialized);
        if (idSet) {
          for (const id of idSet) {
            const edge = overlay.edges.get(id);
            if (edge) {
              if (!edgeType || edgeType === '*' || edge.type === edgeType) {
                result.push(deepClone(edge));
                seen.add(id);
              }
            }
          }
        }
      }
    }

    // Merge with live edges
    const liveMap = this._edgesByProperty.get(key);
    if (liveMap) {
      const liveIds = liveMap.get(serialized);
      if (liveIds) {
        for (const id of liveIds) {
          if (seen.has(id)) continue;
          const edge = this._edges.get(id);
          if (edge) {
            // Only include if not deleted in overlay
            const overlayEdge = overlay?.edges.get(id);
            if (overlayEdge !== null) {
              if (!edgeType || edgeType === '*' || edge.type === edgeType) {
                result.push(deepClone(edge));
              }
            }
          }
        }
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Edge mutations
  // ---------------------------------------------------------------------------

  async insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void> {
    const now = Date.now();
    // Clone first to avoid mutating the caller's object
    const edgeToInsert = deepClone(edge);
    
    // Set createdOn and updatedOn at edge level if not already set
    if (edgeToInsert.createdOn === undefined) {
      edgeToInsert.createdOn = now;
    }
    if (edgeToInsert.updatedOn === undefined) {
      edgeToInsert.updatedOn = now;
    }

    const overlay = this._getOverlay(transaction?.id);

    if (overlay) {
      // Transaction active: write to overlay
      overlay.edges.set(edgeToInsert.id, edgeToInsert);
      // Update overlay indexes
      this._overlayAddToIndex(overlay.edgesByType, edgeToInsert.type, edgeToInsert.id);
      this._overlayAddToIndex(overlay.edgesBySource, edgeToInsert.sourceId, edgeToInsert.id);
      this._overlayAddToIndex(overlay.edgesByTarget, edgeToInsert.targetId, edgeToInsert.id);
      this._overlayIndexEdgeProperties(overlay, edgeToInsert);
    } else {
      // No transaction: modify live state directly
      this._insertEdgeLive(edgeToInsert, true);
    }
  }

  /** @internal Used by importJSON — skips the defensive clone since the data is already owned. */
  private _insertEdgeLive(edge: EdgeData, skipClone: boolean): void {
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

    // Property value index
    this._indexEdgeProperties(stored);
  }

  async deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void> {
    const overlay = this._getOverlay(transaction?.id);

    if (overlay) {
      // Mark as deleted in overlay
      overlay.edges.set(id, null);
    } else {
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
  }

  // ---------------------------------------------------------------------------
  // Edge queries
  // ---------------------------------------------------------------------------

  async hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    const overlay = this._getOverlay(transaction?.id);
    if (overlay) {
      if (overlay.edges.has(id)) {
        return overlay.edges.get(id) !== null;
      }
    }
    return this._edges.has(id);
  }

  async getEdge(id: string, transaction?: ITransactionHandle): Promise<EdgeData | undefined> {
    const overlay = this._getOverlay(transaction?.id);
    if (overlay) {
      const overlayEdge = overlay.edges.get(id);
      if (overlayEdge !== undefined) {
        return overlayEdge ? deepClone(overlayEdge) : undefined;
      }
    }
    const edge = this._edges.get(id);
    return edge ? deepClone(edge) : undefined;
  }

  async getAllEdges(limit?: number, orderBy?: IOrderBy, transaction?: ITransactionHandle): Promise<EdgeData[]> {
    const overlay = this._getOverlay(transaction?.id);
    const result: EdgeData[] = [];
    const seen = new Set<string>();

    if (overlay) {
      for (const [id, edge] of overlay.edges) {
        if (edge) {
          result.push(deepClone(edge));
          seen.add(id);
        }
      }
    }

    for (const [id, edge] of this._edges) {
      if (seen.has(id)) continue;
      const overlayEdge = overlay?.edges.get(id);
      if (overlayEdge !== null) {
        result.push(deepClone(edge));
      }
    }

    // Apply ordering if specified
    if (orderBy) {
      result.sort((a, b) => {
        const aVal = a[orderBy.field];
        const bVal = b[orderBy.field];
        if (aVal === undefined && bVal === undefined) return 0;
        if (aVal === undefined) return orderBy.direction === 'asc' ? 1 : -1;
        if (bVal === undefined) return orderBy.direction === 'asc' ? -1 : 1;
        return orderBy.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    return limit !== undefined ? result.slice(0, limit) : result;
  }

  async getEdgesByType(type: string, transaction?: ITransactionHandle): Promise<EdgeData[]> {
    const overlay = this._getOverlay(transaction?.id);
    const seen = new Set<string>();
    const result: EdgeData[] = [];

    if (overlay) {
      const overlayIds = overlay.edgesByType.get(type);
      if (overlayIds) {
        for (const id of overlayIds) {
          const edge = overlay.edges.get(id);
          if (edge) {
            result.push(deepClone(edge));
            seen.add(id);
          }
        }
      }
    }

    const liveIds = this._edgesByType.get(type);
    if (liveIds) {
      for (const id of liveIds) {
        if (seen.has(id)) continue;
        const edge = this._edges.get(id);
        if (edge) {
          const overlayEdge = overlay?.edges.get(id);
          if (overlayEdge !== null) {
            result.push(deepClone(edge));
          }
        }
      }
    }
    return result;
  }

  async getEdgesBySource(nodeId: string, type?: string, transaction?: ITransactionHandle): Promise<EdgeData[]> {
    const overlay = this._getOverlay(transaction?.id);
    const seen = new Set<string>();
    const result: EdgeData[] = [];

    if (overlay) {
      const overlayIds = overlay.edgesBySource.get(nodeId);
      if (overlayIds) {
        for (const id of overlayIds) {
          const edge = overlay.edges.get(id);
          if (edge && (!type || edge.type === type)) {
            result.push(deepClone(edge));
            seen.add(id);
          }
        }
      }
    }

    const liveIds = this._edgesBySource.get(nodeId);
    if (liveIds) {
      for (const id of liveIds) {
        if (seen.has(id)) continue;
        const edge = this._edges.get(id);
        if (edge) {
          const overlayEdge = overlay?.edges.get(id);
          if (overlayEdge !== null && (!type || edge.type === type)) {
            result.push(deepClone(edge));
          }
        }
      }
    }
    return result;
  }

  async getEdgesByTarget(nodeId: string, type?: string, transaction?: ITransactionHandle): Promise<EdgeData[]> {
    const overlay = this._getOverlay(transaction?.id);
    const seen = new Set<string>();
    const result: EdgeData[] = [];

    if (overlay) {
      const overlayIds = overlay.edgesByTarget.get(nodeId);
      if (overlayIds) {
        for (const id of overlayIds) {
          const edge = overlay.edges.get(id);
          if (edge && (!type || edge.type === type)) {
            result.push(deepClone(edge));
            seen.add(id);
          }
        }
      }
    }

    const liveIds = this._edgesByTarget.get(nodeId);
    if (liveIds) {
      for (const id of liveIds) {
        if (seen.has(id)) continue;
        const edge = this._edges.get(id);
        if (edge) {
          const overlayEdge = overlay?.edges.get(id);
          if (overlayEdge !== null && (!type || edge.type === type)) {
            result.push(deepClone(edge));
          }
        }
      }
    }
    return result;
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
  async addProperty(target: 'node' | 'edge', id: string, key: string, value: unknown, transaction?: ITransactionHandle): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }

    const overlay = this._getOverlay(transaction?.id);
    let record: NodeData | EdgeData | null = null;
    let isOverlay = false;

    if (overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      const overlayRecord = map.get(id);
      if (overlayRecord !== undefined) {
        if (overlayRecord === null) {
          // Tombstone: deleted in this transaction — do not fall back to live store
          if (target === 'node') {
            throw new NodeNotFoundError(id);
          } else {
            throw new EdgeNotFoundError(id);
          }
        }
        record = overlayRecord;
        isOverlay = true;
      }
    }

    if (record === null) {
      record = target === 'node' ? this._nodes.get(id) ?? null : this._edges.get(id) ?? null;
    }

    if (record === null) {
      if (target === 'node') {
        throw new NodeNotFoundError(id);
      } else {
        throw new EdgeNotFoundError(id);
      }
    }

    if (key in record.properties) {
      throw new PropertyAlreadyExistsError(target, id, key);
    }

    // Clone before mutating to avoid affecting original storage
    if (overlay) {
      record = deepClone(record);
      isOverlay = true; // After cloning, treat as overlay for index updates
    }

    record.properties = { ...record.properties, [key]: value };
    record.updatedOn = Date.now();

    if (isOverlay && overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      map.set(id, record);
      const serialized = this._propKey(value);
      const propIndex = target === 'node' ? overlay.nodesByProperty : overlay.edgesByProperty;
      let keyMap = propIndex.get(key);
      if (!keyMap) {
        keyMap = new Map();
        propIndex.set(key, keyMap);
      }
      let idSet = keyMap.get(serialized);
      if (!idSet) {
        idSet = new Set();
        keyMap.set(serialized, idSet);
      }
      idSet.add(id);
    } else if (target === 'node') {
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
  async updateProperty(target: 'node' | 'edge', id: string, key: string, value: unknown, transaction?: ITransactionHandle): Promise<void> {
    if (!isPrimitive(value)) {
      throw new InvalidPropertyError(key, value);
    }

    const overlay = this._getOverlay(transaction?.id);
    let record: NodeData | EdgeData | null = null;
    let isOverlay = false;

    if (overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      const overlayRecord = map.get(id);
      if (overlayRecord !== undefined) {
        if (overlayRecord === null) {
          // Tombstone: deleted in this transaction — do not fall back to live store
          if (target === 'node') {
            throw new NodeNotFoundError(id);
          } else {
            throw new EdgeNotFoundError(id);
          }
        }
        record = overlayRecord;
        isOverlay = true;
      }
    }

    if (record === null) {
      record = target === 'node' ? this._nodes.get(id) ?? null : this._edges.get(id) ?? null;
    }

    if (record === null) {
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

    // Clone before mutating to avoid affecting original storage
    if (overlay) {
      record = deepClone(record);
      isOverlay = true; // After cloning, treat as overlay for index updates
    }

    record.properties = { ...record.properties, [key]: value };
    record.updatedOn = Date.now();

    if (isOverlay && overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      map.set(id, record);
      // Update overlay property index: remove from old, add to new
      const propIndex = target === 'node' ? overlay.nodesByProperty : overlay.edgesByProperty;
      const serialized = this._propKey(oldValue);
      const oldKeyMap = propIndex.get(key);
      if (oldKeyMap) {
        const oldIdSet = oldKeyMap.get(serialized);
        if (oldIdSet) {
          oldIdSet.delete(id);
        }
      }
      const newSerialized = this._propKey(value);
      let keyMap = propIndex.get(key);
      if (!keyMap) {
        keyMap = new Map();
        propIndex.set(key, keyMap);
      }
      let idSet = keyMap.get(newSerialized);
      if (!idSet) {
        idSet = new Set();
        keyMap.set(newSerialized, idSet);
      }
      idSet.add(id);
    } else {
      if (target === 'node') {
        this._unindexNodeProperty(id, key, oldValue);
        this._indexNodeProperty(id, key, value);
      } else {
        this._unindexEdgeProperty(id, key, oldValue);
        this._indexEdgeProperty(id, key, value);
      }
    }
  }

  /**
   * Deletes a property from a node or edge.
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   */
  async deleteProperty(target: 'node' | 'edge', id: string, key: string, transaction?: ITransactionHandle): Promise<void> {
    const overlay = this._getOverlay(transaction?.id);
    let record: NodeData | EdgeData | null = null;
    let isOverlay = false;

    if (overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      const overlayRecord = map.get(id);
      if (overlayRecord !== undefined) {
        if (overlayRecord === null) {
          // Tombstone: deleted in this transaction — do not fall back to live store
          if (target === 'node') {
            throw new NodeNotFoundError(id);
          } else {
            throw new EdgeNotFoundError(id);
          }
        }
        record = overlayRecord;
        isOverlay = true;
      }
    }

    if (record === null) {
      record = target === 'node' ? this._nodes.get(id) ?? null : this._edges.get(id) ?? null;
    }

    if (record === null) {
      if (target === 'node') {
        throw new NodeNotFoundError(id);
      } else {
        throw new EdgeNotFoundError(id);
      }
    }

    const oldValue = record.properties[key];

    // Clone before mutating to avoid affecting original storage
    if (overlay) {
      record = deepClone(record);
      isOverlay = true; // After cloning, treat as overlay for index updates
    }

    delete record.properties[key];
    record.updatedOn = Date.now();

    if (isOverlay && overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      map.set(id, record);
      const propIndex = target === 'node' ? overlay.nodesByProperty : overlay.edgesByProperty;
      const serialized = this._propKey(oldValue);
      const keyMap = propIndex.get(key);
      if (keyMap) {
        const idSet = keyMap.get(serialized);
        if (idSet) {
          idSet.delete(id);
        }
      }
    } else if (target === 'node') {
      this._unindexNodeProperty(id, key, oldValue);
    } else {
      this._unindexEdgeProperty(id, key, oldValue);
    }
  }

  /**
   * Clears all properties from a node or edge.
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   */
  async clearProperties(target: 'node' | 'edge', id: string, transaction?: ITransactionHandle): Promise<void> {
    const overlay = this._getOverlay(transaction?.id);
    let record: NodeData | EdgeData | null = null;
    let isOverlay = false;

    if (overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      const overlayRecord = map.get(id);
      if (overlayRecord !== undefined) {
        if (overlayRecord === null) {
          // Tombstone: deleted in this transaction — do not fall back to live store
          if (target === 'node') {
            throw new NodeNotFoundError(id);
          } else {
            throw new EdgeNotFoundError(id);
          }
        }
        record = overlayRecord;
        isOverlay = true;
      }
    }

    if (record === null) {
      record = target === 'node' ? this._nodes.get(id) ?? null : this._edges.get(id) ?? null;
    }

    if (record === null) {
      if (target === 'node') {
        throw new NodeNotFoundError(id);
      } else {
        throw new EdgeNotFoundError(id);
      }
    }

    // Clone before mutating to avoid affecting original storage
    if (overlay) {
      record = deepClone(record);
      isOverlay = true; // After cloning, treat as overlay for index updates
    }

    const oldProperties = { ...record.properties };

    for (const [key, value] of Object.entries(oldProperties)) {
      if (isOverlay && overlay) {
        const propIndex = target === 'node' ? overlay.nodesByProperty : overlay.edgesByProperty;
        const serialized = this._propKey(value);
        const keyMap = propIndex.get(key);
        if (keyMap) {
          const idSet = keyMap.get(serialized);
          if (idSet) {
            idSet.delete(id);
          }
        }
      } else if (target === 'node') {
        this._unindexNodeProperty(id, key, value);
      } else {
        this._unindexEdgeProperty(id, key, value);
      }
    }

    record.properties = {};

    if (isOverlay && overlay) {
      const map = target === 'node' ? overlay.nodes : overlay.edges;
      map.set(id, record);
    }
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
      this._insertNodeLive(nodeData, true);
    }

    for (const edgeData of data.edges) {
      // Validate node references before inserting
      if (!this._nodes.has(edgeData.sourceId)) {
        throw new NodeNotFoundError(edgeData.sourceId);
      }
      if (!this._nodes.has(edgeData.targetId)) {
        throw new NodeNotFoundError(edgeData.targetId);
      }
      this._insertEdgeLive(edgeData, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Transaction support
  // ---------------------------------------------------------------------------

  /**
   * In-memory transactions use copy-on-write overlays for isolation.
   * Each transaction has its own overlay that intercepts reads/writes.
   * On commit, overlay changes are applied to live state.
   * On rollback, the overlay is simply discarded.
   */
  private _transactionOverlays = new Map<string, TransactionOverlay>();
  private _activeTransaction: string | null = null;

  supportsTransactions(): boolean {
    return true;
  }

  async beginTransaction(): Promise<ITransactionHandle> {
    const txnId = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const overlay: TransactionOverlay = {
      nodes: new Map(),
      edges: new Map(),
      nodesByType: new Map(),
      edgesByType: new Map(),
      edgesBySource: new Map(),
      edgesByTarget: new Map(),
      nodesByProperty: new Map(),
      edgesByProperty: new Map(),
    };

    this._transactionOverlays.set(txnId, overlay);
    this._activeTransaction = txnId;

    return { id: txnId, context: undefined };
  }

  async commitTransaction(handle: ITransactionHandle): Promise<void> {
    const overlay = this._transactionOverlays.get(handle.id);
    if (!overlay) {
      throw new Error('No active transaction to commit');
    }

    // Apply all overlay changes to live state
    this._applyOverlayToLive(overlay);

    this._transactionOverlays.delete(handle.id);
    if (this._activeTransaction === handle.id) {
      this._activeTransaction = null;
    }
  }

  async rollbackTransaction(handle: ITransactionHandle): Promise<void> {
    if (!this._transactionOverlays.has(handle.id)) {
      return;
    }

    this._transactionOverlays.delete(handle.id);
    if (this._activeTransaction === handle.id) {
      this._activeTransaction = null;
    }
  }

  private _getOverlay(txnId?: string): TransactionOverlay | null {
    const id = txnId ?? this._activeTransaction;
    if (!id) return null;
    return this._transactionOverlays.get(id) ?? null;
  }

  private _applyOverlayToLive(overlay: TransactionOverlay): void {
    // Apply node changes
    for (const [id, node] of overlay.nodes) {
      if (node === null) {
        this._nodes.delete(id);
        // Remove from indexes
        const existing = this._nodes.get(id);
        if (existing) {
          this._unindexNodeProperties(existing);
        }
      } else {
        this._nodes.set(id, node);
        this._indexNodeProperties(node);
      }
    }

    // Apply edge changes
    for (const [id, edge] of overlay.edges) {
      if (edge === null) {
        this._edges.delete(id);
        const existing = this._edges.get(id);
        if (existing) {
          this._unindexEdgeProperties(existing);
        }
      } else {
        this._edges.set(id, edge);
        this._indexEdgeProperties(edge);
      }
    }

    // Apply index changes
    this._mergeOverlayIndexes(this._nodesByType, overlay.nodesByType);
    this._mergeOverlayIndexes(this._edgesByType, overlay.edgesByType);
    this._mergeOverlayIndexes(this._edgesBySource, overlay.edgesBySource);
    this._mergeOverlayIndexes(this._edgesByTarget, overlay.edgesByTarget);
    this._mergePropertyOverlayIndexes(this._nodesByProperty, overlay.nodesByProperty);
    this._mergePropertyOverlayIndexes(this._edgesByProperty, overlay.edgesByProperty);
  }

  private _mergeOverlayIndexes(
    live: Map<string, Set<string>>,
    overlay: Map<string, Set<string>>
  ): void {
    for (const [key, idSet] of overlay) {
      const liveSet = live.get(key);
      if (liveSet) {
        for (const id of idSet) {
          liveSet.add(id);
        }
      } else {
        live.set(key, new Set(idSet));
      }
    }
  }

  private _mergePropertyOverlayIndexes(
    live: Map<string, Map<string, Set<string>>>,
    overlay: Map<string, Map<string, Set<string>>>
  ): void {
    for (const [key, valueMap] of overlay) {
      let liveMap = live.get(key);
      if (!liveMap) {
        liveMap = new Map();
        live.set(key, liveMap);
      }
      for (const [serialized, idSet] of valueMap) {
        let liveSet = liveMap.get(serialized);
        if (!liveSet) {
          liveSet = new Set();
          liveMap.set(serialized, liveSet);
        }
        for (const id of idSet) {
          liveSet.add(id);
        }
      }
    }
  }

  private _indexEdgeProperties(edge: EdgeData): void {
    for (const [key, value] of Object.entries(edge.properties)) {
      this._indexEdgeProperty(edge.id, key, value);
    }
  }

  private _unindexEdgeProperties(edge: EdgeData): void {
    for (const [key, value] of Object.entries(edge.properties)) {
      this._unindexEdgeProperty(edge.id, key, value);
    }
  }
}

interface TransactionOverlay {
  nodes: Map<string, NodeData | null>;
  edges: Map<string, EdgeData | null>;
  nodesByType: Map<string, Set<string>>;
  edgesByType: Map<string, Set<string>>;
  edgesBySource: Map<string, Set<string>>;
  edgesByTarget: Map<string, Set<string>>;
  nodesByProperty: Map<string, Map<string, Set<string>>>;
  edgesByProperty: Map<string, Map<string, Set<string>>>;
}
