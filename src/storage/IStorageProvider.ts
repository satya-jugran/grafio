import type { NodeData, EdgeData, GraphData } from '../types';

/**
 * Represents a transaction handle returned by a storage provider.
 * Contains a unique transaction identifier and optional backend-specific context.
 */
export interface ITransactionHandle {
  /** Unique transaction identifier */
  id: string;
  /** Backend-specific context (e.g., MongoDB ClientSession) */
  context?: unknown;
}

/**
 * Contract that every storage backend must fulfill.
 *
 * All methods are async (v5.0+) to support both synchronous in-memory providers
 * and asynchronous network-based providers (MongoDB, PostgreSQL, etc.) through
 * a single unified API.
 *
 * Index responsibilities:
 *  - Type index  (node/edge type → id set)
 *  - Property value index (key → value → node id set)
 *  - Adjacency index (nodeId → outgoing/incoming edge id sets)
 *
 * Each implementation owns its index maintenance internally;
 * callers (GraphIndex) only call the query / mutation methods below.
 *
 * Data portability:
 *  - exportJSON() / importJSON() are part of the provider contract so that
 *    each backend can implement the most efficient strategy for its storage
 *    model (e.g. full iteration for in-memory, bulkWrite for MongoDB).
 */
export interface IStorageProvider {
  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Remove all stored nodes, edges, and index data.
   */
  clear(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Node mutations
  // ---------------------------------------------------------------------------

  /**
   * Persist a node.  The node is identified by `node.id`.
   * Must update: node store, type index, property value index.
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void>;

  /**
   * Remove a node by id.
   * Must update: node store, type index, property value index.
   * Does NOT touch edges — the caller (GraphIndex) handles cascade logic.
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  deleteNode(id: string, transaction?: ITransactionHandle): Promise<void>;

  // ---------------------------------------------------------------------------
  // Node queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true if a node with the given id exists.
   */
  hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean>;

  /**
   * Returns the NodeData for the given id, or undefined if not found.
   */
  getNode(id: string, transaction?: ITransactionHandle): Promise<NodeData | undefined>;

  /**
   * Returns all stored nodes, optionally limited.
   * @param limit - Maximum number of nodes to return (default: unlimited)
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  getAllNodes(limit?: number, transaction?: ITransactionHandle): Promise<NodeData[]>;

  /**
   * Returns all nodes whose `type` field matches the given value.
   * Implementations must use an index (not a full scan).
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  getNodesByType(type: string, transaction?: ITransactionHandle): Promise<NodeData[]>;

  /**
   * Returns all nodes that have a property `key` equal to `value`.
   * Optionally filtered to a specific node type.
   * Implementations must use an index (not a full scan).
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  getNodesByProperty(key: string, value: unknown, nodeType?: string, transaction?: ITransactionHandle): Promise<NodeData[]>;

  // ---------------------------------------------------------------------------
  // Edge mutations
  // ---------------------------------------------------------------------------

  /**
   * Persist an edge.  The edge is identified by `edge.id`.
   * Must update: edge store, edge-type index, adjacency indexes (source + target).
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void>;

  /**
   * Remove an edge by id.
   * Must update: edge store, edge-type index, adjacency indexes (source + target).
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void>;

  // ---------------------------------------------------------------------------
  // Edge queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true if an edge with the given id exists.
   */
  hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean>;

  /**
   * Returns the EdgeData for the given id, or undefined if not found.
   */
  getEdge(id: string, transaction?: ITransactionHandle): Promise<EdgeData | undefined>;

  /** Returns all stored edges. */
  getAllEdges(transaction?: ITransactionHandle): Promise<EdgeData[]>;

  /**
   * Returns all edges whose `type` field matches the given value.
   * Implementations must use an index (not a full scan).
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  getEdgesByType(type: string, transaction?: ITransactionHandle): Promise<EdgeData[]>;

  /**
   * Returns all edges that have a property `key` equal to `value`.
   * Optionally filtered to a specific edge type.
   * Implementations must use an index (not a full scan).
   * @param transaction - Optional transaction handle for transactional storage providers
   */
  getEdgesByProperty(key: string, value: unknown, edgeType?: string, transaction?: ITransactionHandle): Promise<EdgeData[]>;

  /**
   * Returns all edges whose `sourceId` equals the given node id.
   * Optionally filtered by edge type to leverage compound adjacency indexes.
   * Implementations must use an adjacency index (not a full scan).
   */
  getEdgesBySource(nodeId: string, type?: string, transaction?: ITransactionHandle): Promise<EdgeData[]>;

  /**
   * Returns all edges whose `targetId` equals the given node id.
   * Optionally filtered by edge type to leverage compound adjacency indexes.
   * Implementations must use an adjacency index (not a full scan).
   */
  getEdgesByTarget(nodeId: string, type?: string, transaction?: ITransactionHandle): Promise<EdgeData[]>;

  // ---------------------------------------------------------------------------
  // Property mutations
  // ---------------------------------------------------------------------------

  /**
   * Adds a property to a node or edge. Fails if the property key already exists.
   * @param target - Either 'node' or 'edge'
   * @param id - The id of the node or edge
   * @param key - The property key to add
   * @param value - The property value (must be a primitive)
   * @param transaction - Optional transaction handle for transactional storage providers
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   * @throws PropertyAlreadyExistsError if the property key already exists
   * @throws InvalidPropertyError if the value is not a primitive
   */
  addProperty(target: 'node' | 'edge', id: string, key: string, value: unknown, transaction?: ITransactionHandle): Promise<void>;

  /**
   * Updates an existing property on a node or edge. Fails if the property doesn't exist.
   * @param target - Either 'node' or 'edge'
   * @param id - The id of the node or edge
   * @param key - The property key to update
   * @param value - The new value (must be a primitive)
   * @param transaction - Optional transaction handle for transactional storage providers
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   * @throws PropertyNotFoundError if the property key doesn't exist
   * @throws InvalidPropertyError if the value is not a primitive
   */
  updateProperty(target: 'node' | 'edge', id: string, key: string, value: unknown, transaction?: ITransactionHandle): Promise<void>;

  /**
   * Deletes a property from a node or edge.
   * @param target - Either 'node' or 'edge'
   * @param id - The id of the node or edge
   * @param key - The property key to delete
   * @param transaction - Optional transaction handle for transactional storage providers
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   */
  deleteProperty(target: 'node' | 'edge', id: string, key: string, transaction?: ITransactionHandle): Promise<void>;

  /**
   * Clears all properties from a node or edge.
   * @param target - Either 'node' or 'edge'
   * @param id - The id of the node or edge
   * @param transaction - Optional transaction handle for transactional storage providers
   * @throws NodeNotFoundError/EdgeNotFoundError if the target doesn't exist
   */
  clearProperties(target: 'node' | 'edge', id: string, transaction?: ITransactionHandle): Promise<void>;

  // ---------------------------------------------------------------------------
  // Index management
  // ---------------------------------------------------------------------------

  /**
   * Creates an index on a node or edge property.
   *
   * @param target - Either 'node' or 'edge'
   * @param propertyKey - The property name to index
   * @param type - Optional type filter. If provided (not '*' or undefined), creates a compound index on (type, propertyKey)
   *
   * Behavior:
   * - If type is undefined or '*': creates a simple index on propertyKey only
   * - If type is specified (e.g., 'User'): creates a compound index on (type, propertyKey)
   */
  createIndex(target: 'node' | 'edge', propertyKey: string, type?: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // Data portability
  // ---------------------------------------------------------------------------

  /**
   * Exports the entire graph as a portable JSON object.
   *
   * Implementations choose the most efficient strategy for their backing store:
   *  - InMemory: single full iteration over node/edge maps
   *  - MongoDB: aggregation pipeline
   *
   * @returns GraphData snapshot of the current graph state
   */
  exportJSON(): Promise<GraphData>;

  /**
   * Imports graph data from a portable JSON object into the backing store.
   *
   * Implementations choose the most efficient strategy:
   *  - InMemory: single pass insert
   *  - MongoDB: bulkWrite operations
   *
   * The implementation is responsible for referential integrity validation
   * (duplicate ids, missing source/target nodes for edges).
   *
   * @param data - GraphData to load
   * @throws NodeAlreadyExistsError if a node id is already present
   * @throws EdgeAlreadyExistsError if an edge id is already present
   * @throws NodeNotFoundError if an edge references a non-existent node
   */
 importJSON(data: GraphData): Promise<void>;

 // ---------------------------------------------------------------------------
 // Transaction support
 // ---------------------------------------------------------------------------

 /**
  * Checks if the storage provider supports transactions.
  * @returns true if transactions are supported, false otherwise
  */
 supportsTransactions(): boolean;

 /**
  * Starts a new transaction.
  * @returns A transaction handle that can be used to commit or rollback
  */
 beginTransaction(): Promise<ITransactionHandle>;

 /**
  * Commits the given transaction, making all changes atomic.
  * @param handle - The transaction handle returned by beginTransaction
  */
 commitTransaction(handle: ITransactionHandle): Promise<void>;

 /**
  * Rolls back the given transaction, discarding all changes.
  * @param handle - The transaction handle returned by beginTransaction
  */
 rollbackTransaction(handle: ITransactionHandle): Promise<void>;
}
