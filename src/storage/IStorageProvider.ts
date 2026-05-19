import type { NodeData, EdgeData, GraphData, StorageQueryOptions, IOrderBy, ITransactionHandle, AggregateOp, AggregateResult } from '../types';

// Re-export types from types.ts for convenience
export type { StorageQueryOptions, IOrderBy, ITransactionHandle };

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
  * Returns NodeData for multiple ids in a single call.
    * Enables batch fetching to avoid N+1 getNode() calls.
    *
    * Semantics:
    * - The returned Map contains entries only for ids that were found.
    * - Unknown ids MUST be omitted from the Map; they MUST NOT appear with
    *   an `undefined` value.
    * - Duplicate ids in `ids` do not produce duplicate Map entries; providers
    *   should treat them as repeated requests for the same id.
    *
    * Callers should use `result.has(id)` to distinguish "not found" from
    * a found node.
    *
    * @param ids - Array of node ids to fetch
    * @param transaction - Optional transaction handle
    */
  getNodesByIds(ids: string[], transaction?: ITransactionHandle): Promise<Map<string, NodeData>>;

  /**
   * Returns the number of nodes in storage matching the query options.
   * Used by CachedStorageProvider to determine cache completeness.
   * @param options - Optional query options for filtering
   */
  getNodeCount(options?: StorageQueryOptions): Promise<number>;

  /**
   * Aggregates a numeric property across nodes matching the query options.
   * @param key - The property key to aggregate
   * @param options - Optional query options for filtering
   */
  aggregateNodeProperty(
    key: string,
    options?: StorageQueryOptions
  ): Promise<AggregateResult>;

  /**
   * Returns nodes matching the specified query options.
   * Provides unified filtering, ordering, and pagination for node queries.
   *
   * @param options - Query options including filters, ordering, limit, and transaction
   * @returns Array of NodeData matching the query criteria
   *
   * @example
   * // Get all 'User' nodes
   * const users = await provider.getNodes({ filter: { types: ['User'] } });
   *
   * // Get active users with limit
   * const activeUsers = await provider.getNodes({
   *   filter: {
   *     types: ['User'],
   *     properties: [{ key: 'active', value: true }]
   *   },
   *   limit: 10,
   *   orderBy: { field: 'updatedOn', direction: 'desc' }
   * });
   */
  getNodes(options?: StorageQueryOptions): Promise<NodeData[]>;

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

  /**
   * Returns the number of edges in storage matching the query options.
   * Used by CachedStorageProvider to determine cache completeness.
   * @param options - Optional query options for filtering
   */
  getEdgeCount(options?: StorageQueryOptions): Promise<number>;

  /**
   * Aggregates a numeric property across edges matching the query options.
   * @param key - The property key to aggregate
   * @param options - Optional query options for filtering
   */
  aggregateEdgeProperty(
    key: string,
    options?: StorageQueryOptions
  ): Promise<AggregateResult>;

  /**
   * Returns edges matching the specified query options.
   * Provides unified filtering, ordering, and pagination for edge queries.
   *
   * @param options - Query options including filters, ordering, limit, and transaction
   * @returns Array of EdgeData matching the query criteria
   *
   * @example
   * // Get all 'KNOWS' edges
   * const knowsEdges = await provider.getEdges({ filter: { types: ['KNOWS'] } });
   *
   * // Get edges with weight > 0.5
   * const highWeightEdges = await provider.getEdges({
   *   filter: {
   *     properties: [{ key: 'weight', value: 0.5 }]
   *   },
   *   orderBy: { field: 'updatedOn', direction: 'desc' }
   * });
   */
  getEdges(options?: StorageQueryOptions): Promise<EdgeData[]>;

  /**
   * Returns all outgoing edges from a source node.
   * Provides unified adjacency querying with filtering and pagination.
   *
   * @param nodeId - The source node identifier
   * @param options - Query options including type filters, ordering, limit, and transaction
   * @returns Array of EdgeData representing outgoing edges from the source node
   *
   * @example
   * // Get all 'KNOWS' edges from alice
   * const friends = await provider.getEdgesBySource(aliceId, { filter: { types: ['KNOWS'] } });
   */
  getEdgesBySource(nodeId: string, options?: StorageQueryOptions): Promise<EdgeData[]>;

  /**
   * Returns all incoming edges to a target node.
   * Provides unified adjacency querying with filtering and pagination.
   *
   * @param nodeId - The target node identifier
   * @param options - Query options including type filters, ordering, limit, and transaction
   * @returns Array of EdgeData representing incoming edges to the target node
   *
   * @example
   * // Get all 'KNOWS' edges to bob
   * const friendOf = await provider.getEdgesByTarget(bobId, { filter: { types: ['KNOWS'] } });
   */
  getEdgesByTarget(nodeId: string, options?: StorageQueryOptions): Promise<EdgeData[]>;

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
   * Creates an index on one or more node or edge properties.
   * Supports both simple indexes (single property) and compound indexes (multiple properties).
   *
   * @param target - Either 'node' or 'edge'
   * @param propertyKeys - Array of property names to index. For compound indexes,
   *                       the order matters for index structure but queries can use
   *                       any subset of the indexed properties.
   *
   * Behavior:
   * - Single property ['email']: creates simple index on 'email'
   * - Multiple properties ['name', 'email']: creates compound index on (name, email)
   */
  createIndex(target: 'node' | 'edge', propertyKeys: string[]): Promise<void>;

  /**
   * Checks if an index exists that covers the given property keys.
   *
   * For compound indexes, returns true if ALL provided propertyKeys are covered
   * by the same index (the index may have additional properties).
   *
   * @param target - Either 'node' or 'edge'
   * @param propertyKeys - Array of property names to check
   * @returns true if an index exists that covers all given properties, false otherwise
   *
   * Example:
   * - Index on ['name', 'email'], query ['email'] → false (partial coverage)
   * - Index on ['name', 'email'], query ['name', 'email'] → true (full coverage)
   * - Index on ['name', 'email'], query ['email', 'name'] → true (same properties, diff order)
   */
  hasIndex(target: 'node' | 'edge', propertyKeys: string[]): Promise<boolean>;

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
