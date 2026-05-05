import type { GraphData } from './types';
import { Node } from './Node';
import { Edge } from './Edge';
import { GraphIndex } from './Graph/GraphIndex';
import { GraphTraversal } from './Graph/GraphTraversal';
import { GraphAdminOps } from './Graph/GraphAdminOps';
import { GraphTransaction } from './Graph/GraphTransaction';
import type { TraversalOptions } from './Graph/TraversalOptions';
import type { IStorageProvider } from './storage/IStorageProvider';

// Re-export for external use
export type { TraversalOptions } from './Graph/TraversalOptions';
export { GraphTransaction } from './Graph/GraphTransaction';
export { TransactionNotActiveError, TransactionFailedError } from './Graph/GraphTransaction';

/**
 * A graph database with pluggable storage backend.
 * Manages nodes and directed edges with arbitrary JSON properties.
 * Uses adjacency maps and type indexes for O(1) lookups.
 *
 * All methods are async to support both synchronous in-memory providers
 * and asynchronous network-based providers (MongoDB, PostgreSQL, etc.)
 * through a single unified API.
 *
 * By default uses an in-memory storage provider. Pass a custom
 * IStorageProvider to switch to a file-backed or remote backend.
 *
 * @example
 * // Default in-memory (existing behaviour, unchanged)
 * const graph = new Graph();
 * const node = await graph.addNode('Person', { name: 'Alice' });
 *
 * @example
 * // MongoDB-backed graph
 * import { MongoClient } from 'mongodb';
 * import { Graph, MongoStorageProvider } from 'grafio';
 * const client = new MongoClient('mongodb://localhost:27017');
 * await client.connect();
 * const provider = new MongoStorageProvider(client.db('graph'));
 * const graph = new Graph(provider);
 */
export class Graph {
  private readonly _index: GraphIndex;
  private readonly _traversal: GraphTraversal;
  private readonly _adminOps: GraphAdminOps;

  /**
   * @param storageProvider - Optional storage backend. Defaults to InMemoryStorageProvider.
   */
  constructor(storageProvider?: IStorageProvider) {
    this._index = new GraphIndex(storageProvider);
    const store = this._index._getStore();
    this._traversal = new GraphTraversal(store);
    this._adminOps = new GraphAdminOps(store);
  }

  /**
   * Checks if the storage provider supports transactions.
   * @returns true if transactions are supported, false otherwise
   */
  supportsTransactions(): boolean {
    return this._index._getStore().supportsTransactions();
  }

  /**
   * Creates a new transaction for atomic multi-operation updates.
   * @returns A new GraphTransaction instance
   */
  createTransaction(): GraphTransaction {
    return new GraphTransaction(this._index._getStore());
  }

  /**
   * Returns all nodes in the graph.
   * @param transaction - Optional transaction for consistent reads within a transaction
   */
  async getNodes(transaction?: GraphTransaction): Promise<readonly Node[]> {
    return this._index.getNodes(transaction);
  }

  /**
   * Returns all edges in the graph.
   * @param transaction - Optional transaction for consistent reads within a transaction
   */
  async getEdges(transaction?: GraphTransaction): Promise<readonly Edge[]> {
    return this._index.getEdges(transaction);
  }

  /**
   * Checks if a node exists in the graph.
   * @param id - Id of the node
   * @param transaction - Optional transaction for consistent reads within a transaction
   */
  async hasNode(id: string, transaction?: GraphTransaction): Promise<boolean> {
    return this._index.hasNode(id, transaction);
  }

  /**
   * Checks if an edge exists in the graph.
   * @param id - Id of the edge
   * @param transaction - Optional transaction for consistent reads within a transaction
   */
  async hasEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    return this._index.hasEdge(id, transaction);
  }

  /**
   * Adds a new node to the graph.
   * @param type - The type (label) of the node
   * @param properties - Optional JSON properties
   * @param transaction - Optional transaction to use for this operation
   * @returns The newly created Node
   */
  async addNode(type: string, properties: Record<string, unknown> = {}, transaction?: GraphTransaction): Promise<Node> {
    return this._index.addNode(type, properties, transaction);
  }

  /**
   * Removes a node from the graph.
   * @param id - Id of the node to remove
   * @param cascade - If true, also removes all incident edges (default: false)
   * @param transaction - Optional transaction to use for this operation
   * @returns true if the node was removed, false if it didn't exist
   */
  async removeNode(id: string, cascade: boolean = false, transaction?: GraphTransaction): Promise<boolean> {
    return this._index.removeNode(id, cascade, transaction);
  }

  /**
   * Retrieves a node by id.
   * @param id - Id of the node
   * @param transaction - Optional transaction for consistent reads within a transaction
   * @returns The Node if found, undefined otherwise
   */
  async getNode(id: string, transaction?: GraphTransaction): Promise<Node | undefined> {
    return this._index.getNode(id, transaction);
  }

  /**
   * Retrieves nodes by their type.
   * @param type - The node type to filter by
   * @param transaction - Optional transaction for consistent reads within a transaction
   * @returns Array of Nodes with the specified type
   */
  async getNodesByType(type: string, transaction?: GraphTransaction): Promise<Node[]> {
    return this._index.getNodesByType(type, transaction);
  }

  /**
   * Retrieves nodes by a property value.
   * @param key - The property key to search
   * @param value - The property value to match
   * @param options - Optional options with nodeType filter
   * @param transaction - Optional transaction for consistent reads within a transaction
   * @returns Array of Nodes with the specified property value
   */
  async getNodesByProperty(key: string, value: unknown, options?: { nodeType?: string }, transaction?: GraphTransaction): Promise<Node[]> {
    return this._index.getNodesByProperty(key, value, options, transaction);
  }

  /**
   * Retrieves edges by a property value.
   * @param key - The property key to search for
   * @param value - The property value to match
   * @param options - Optional options with edgeType filter
   * @param transaction - Optional transaction for consistent reads within a transaction
   */
  async getEdgesByProperty(key: string, value: unknown, options?: { edgeType?: string }, transaction?: GraphTransaction): Promise<Edge[]> {
    return this._index.getEdgesByProperty(key, value, options, transaction);
  }

  /**
   * Adds a new directed edge to the graph.
   * @param sourceId - Id of the source node
   * @param targetId - Id of the target node
   * @param type - The relationship type
   * @param properties - Optional JSON properties
   * @param transaction - Optional transaction to use for this operation
   * @returns The newly created Edge
   */
  async addEdge(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Record<string, unknown> = {},
    transaction?: GraphTransaction
  ): Promise<Edge> {
    return this._index.addEdge(sourceId, targetId, type, properties, transaction);
  }

  /**
   * Removes an edge from the graph.
   * @param id - Id of the edge to remove
   * @param transaction - Optional transaction to use for this operation
   * @returns true if the edge was removed, false if it didn't exist
   */
  async removeEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    return this._index.removeEdge(id, transaction);
  }

  /**
   * Retrieves an edge by id.
   * @param id - Id of the edge
   * @param transaction - Optional transaction to use for this operation
   * @returns The Edge if found, undefined otherwise
   */
  async getEdge(id: string, transaction?: GraphTransaction): Promise<Edge | undefined> {
    return this._index.getEdge(id, transaction);
  }

  /**
   * Gets the parent nodes of a given node.
   * Parents are nodes that have edges pointing TO this node.
   * @param nodeId - Id of the target node
   * @param options - Optional traversal options with nodeType and edgeType filters
   * @param transaction - Optional transaction for consistent reads within a transaction
   * @returns Array of parent Nodes
   */
  async getParents(nodeId: string, options?: { nodeType?: string; edgeType?: string }, transaction?: GraphTransaction): Promise<Node[]> {
    return this._index.getParents(nodeId, options, transaction);
  }

  /**
   * Gets the child nodes of a given node.
   * Children are nodes that this node points TO.
   * @param nodeId - Id of the source node
   * @param options - Optional traversal options with nodeType and edgeType filters
   * @param transaction - Optional transaction for consistent reads within a transaction
   * @returns Array of child Nodes
   */
  async getChildren(nodeId: string, options?: { nodeType?: string; edgeType?: string }, transaction?: GraphTransaction): Promise<Node[]> {
    return this._index.getChildren(nodeId, options, transaction);
  }

  /**
   * Gets all edges originating from a node (outgoing edges).
   * @param sourceId - Id of the source node
   * @param options - Optional traversal options with edgeType filter
   * @returns Array of outgoing Edges
   */
  async getEdgesFrom(sourceId: string, options?: { edgeType?: string }): Promise<Edge[]> {
    return this._index.getEdgesFrom(sourceId, options);
  }

  /**
   * Gets all edges pointing to a node (incoming edges).
   * @param targetId - Id of the target node
   * @param options - Optional traversal options with edgeType filter
   * @returns Array of incoming Edges
   */
  async getEdgesTo(targetId: string, options?: { edgeType?: string }): Promise<Edge[]> {
    return this._index.getEdgesTo(targetId, options);
  }

  /**
   * Gets all direct edges between two nodes (in either direction).
   * Only returns edges where the two nodes are directly connected.
   * @param sourceId - Id of the first node
   * @param targetId - Id of the second node
   * @param options - Optional traversal options with edgeType filter
   * @returns Array of Edges between the nodes
   */
  async getDirectEdgesBetween(sourceId: string, targetId: string, options?: { edgeType?: string }): Promise<Edge[]> {
    return this._index.getDirectEdgesBetween(sourceId, targetId, options);
  }

  /**
   * Gets all edges of a specific type.
   * @param type - The edge type to filter by
   * @param transaction - Optional transaction for consistent reads within a transaction
   * @returns Array of Edges with the specified type
   */
  async getEdgesByType(type: string, transaction?: GraphTransaction): Promise<Edge[]> {
    return this._index.getEdgesByType(type, transaction);
  }

  /**
   * Traverses the graph from source to target using the specified algorithm.
   * Supports wildcards: '*' or array of ids for source/target to find multiple paths.
   * @param sourceId - Id of the source node (or '*' for all nodes, or array of ids)
   * @param targetId - Id of the target node (or '*' for all nodes, or array of ids)
   * @param options - Traversal options including method, nodeTypes, and edgeTypes filters
   * @returns Array of paths (each path is array of node ids), or null if no paths found
   */
  async traverse(
    sourceId: string | string[],
    targetId: string | string[],
    options: TraversalOptions = {}
  ): Promise<string[][] | null> {
    return this._traversal.traverse(sourceId, targetId, options);
  }

  /**
   * Check if graph is a Directed Acyclic Graph (no cycles).
   * @returns true if the graph has no cycles, false otherwise
   */
  async isDAG(): Promise<boolean> {
    return this._traversal.isDAG();
  }

  /**
   * Computes a topological ordering of the graph nodes using Kahn's algorithm.
   * Returns null if the graph is not a DAG (contains cycles).
   * @returns Array of node ids in topological order, or null if graph has cycles
   */
  async topologicalSort(): Promise<string[] | null> {
    return this._traversal.topologicalSort();
  }

  /**
   * Removes all nodes and edges from the graph.
   */
  async clear(): Promise<void> {
    return this._index.clear();
  }

  // ---------------------------------------------------------------------------
  // Node property mutations
  // ---------------------------------------------------------------------------

  /**
   * Adds a property to a node. Fails if the property key already exists.
   * @param nodeId - The id of the node
   * @param key - The property key to add
   * @param value - The property value (must be a primitive)
   */
  async addNodeProperty(nodeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    return this._index.addNodeProperty(nodeId, key, value, transaction);
  }

  /**
   * Updates an existing property on a node. Fails if the property doesn't exist.
   * @param nodeId - The id of the node
   * @param key - The property key to update
   * @param value - The new value (must be a primitive)
   */
  async updateNodeProperty(nodeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    return this._index.updateNodeProperty(nodeId, key, value, transaction);
  }

  /**
   * Deletes a property from a node.
   * @param nodeId - The id of the node
   * @param key - The property key to delete
   */
  async deleteNodeProperty(nodeId: string, key: string, transaction?: GraphTransaction): Promise<void> {
    return this._index.deleteNodeProperty(nodeId, key, transaction);
  }

  /**
   * Clears all properties from a node.
   * @param nodeId - The id of the node
   */
  async clearNodeProperties(nodeId: string, transaction?: GraphTransaction): Promise<void> {
    return this._index.clearNodeProperties(nodeId, transaction);
  }

  // ---------------------------------------------------------------------------
  // Edge property mutations
  // ---------------------------------------------------------------------------

  /**
   * Adds a property to an edge. Fails if the property key already exists.
   * @param edgeId - The id of the edge
   * @param key - The property key to add
   * @param value - The property value (must be a primitive)
   */
  async addEdgeProperty(edgeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    return this._index.addEdgeProperty(edgeId, key, value, transaction);
  }

  /**
   * Updates an existing property on an edge. Fails if the property doesn't exist.
   * @param edgeId - The id of the edge
   * @param key - The property key to update
   * @param value - The new value (must be a primitive)
   */
  async updateEdgeProperty(edgeId: string, key: string, value: unknown, transaction?: GraphTransaction): Promise<void> {
    return this._index.updateEdgeProperty(edgeId, key, value, transaction);
  }

  /**
   * Deletes a property from an edge.
   * @param edgeId - The id of the edge
   * @param key - The property key to delete
   */
  async deleteEdgeProperty(edgeId: string, key: string, transaction?: GraphTransaction): Promise<void> {
    return this._index.deleteEdgeProperty(edgeId, key, transaction);
  }

  /**
   * Clears all properties from an edge.
   * @param edgeId - The id of the edge
   */
  async clearEdgeProperties(edgeId: string, transaction?: GraphTransaction): Promise<void> {
    return this._index.clearEdgeProperties(edgeId, transaction);
  }

  /**
   * Creates an index on a node or edge property.
   *
   * @param target - Either 'node' or 'edge'
   * @param propertyKey - The property name to index
   * @param type - Optional type filter. If provided (not '*' or undefined), creates a compound index on (type, propertyKey)
   */
  async createIndex(target: 'node' | 'edge', propertyKey: string, type?: string): Promise<void> {
    return this._index.createIndex(target, propertyKey, type);
  }

  // ---------------------------------------------------------------------------
  // Data portability — export / import
  // ---------------------------------------------------------------------------

  /**
   * Exports the entire graph as a portable JSON object.
   *
   * The returned `GraphData` value can be persisted, transmitted, or used to
   * seed another graph instance via `importJSON()`, regardless of the backing
   * storage provider in use.
   *
   * @returns GraphData snapshot of the current graph state
   */
  async exportJSON(): Promise<GraphData> {
    return this._adminOps.exportJSON();
  }

  /**
   * Creates a new Graph instance populated from a portable JSON object.
   *
   * Works with any IStorageProvider — data is written through the provider's
   * own insert methods so file-backed or remote providers are populated
   * correctly.
   *
   * @param data - GraphData to load
   * @param storageProvider - Optional storage provider (defaults to InMemoryStorageProvider)
   * @returns A new Graph instance with all nodes and edges from the data
   */
  static async importJSON(data: GraphData, storageProvider?: IStorageProvider): Promise<Graph> {
    const graph = new Graph(storageProvider);
    await graph._adminOps.importJSON(data);
    return graph;
  }
}
