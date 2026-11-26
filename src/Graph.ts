import type { GraphData, AggregateResult } from './types';
import { Node } from './Node';
import { Edge } from './Edge';
import { GraphIndex } from './Graph/GraphIndex';
import { GraphTraversal } from './Graph/GraphTraversal';
import { GraphAdminOps } from './Graph/GraphAdminOps';
import { GraphTransaction } from './Graph/GraphTransaction';
import type { TraversalOptions } from './Graph/TraversalOptions';
import type { GraphQueryOptions } from './Graph/GraphQueryOptions';
import {
  isCacheWarmableStorageProvider,
  type CreateIndexOptions,
  type IndexMetadata,
  type IStorageProvider,
  type ISyncGraphKernel,
} from './storage/IStorageProvider';
import {
  CypherEngine,
  type CypherEngineOptions,
  type CypherQueryOptions,
} from './cypher/CypherEngine';
import type { CypherResult } from './cypher/Result';
import type { PlanFormat } from './cypher/plan/PlanFormatter';

export type { GraphQueryOptions } from './Graph/GraphQueryOptions';
export type { TraversalOptions } from './Graph/TraversalOptions';
export { GraphTransaction } from './Graph/GraphTransaction';
export { TransactionNotActiveError, TransactionFailedError } from './Graph/GraphTransaction';
export { TransactionConflictError } from './errors';

/**
 * High-performance graph database with built-in Cypher query execution,
 * pluggable storage, transactions, and graph analysis.
 */
export class Graph {
  private readonly _index: GraphIndex;
  private readonly _traversal: GraphTraversal;
  private readonly _adminOps: GraphAdminOps;
  private _cypher: CypherEngine | null = null;

  /**
   * @param storageProvider - Optional storage backend. Defaults to `InMemoryStorageProvider`.
   */
  constructor(storageProvider?: IStorageProvider) {
    this._index = new GraphIndex(storageProvider);
    const store = this._index._getStore();
    this._traversal = new GraphTraversal(store);
    this._adminOps = new GraphAdminOps(store);
  }

  /** @internal Exposes the synchronous kernel when backed by InMemoryStorageProvider. */
  _getSyncKernel(): ISyncGraphKernel | null {
    return this._index._getSyncKernel();
  }

  /** @internal Exposes the underlying storage provider for internal query execution fast paths. */
  _getStore(): IStorageProvider {
    return this._index._getStore();
  }

  /** Monotonic schema/index epoch counter from the backing storage provider. */
  get indexEpoch(): number {
    return this._index.indexEpoch;
  }

  private _getCypherEngine(options?: CypherEngineOptions): CypherEngine {
    if (!this._cypher) {
      this._cypher = new CypherEngine(this, options);
    }
    return this._cypher;
  }

  // ---------------------------------------------------------------------------
  // Cypher Query API (Unified Graph Interface)
  // ---------------------------------------------------------------------------

  public async query(
    cypher: string,
    options?: CypherQueryOptions,
  ): Promise<CypherResult & { executionPlan?: string }>;
  public async query(
    cypher: string,
    params: Record<string, unknown> | undefined,
    options?: CypherQueryOptions,
  ): Promise<CypherResult & { executionPlan?: string }>;
  public async query(
    cypher: string,
    paramsOrOptions?: Record<string, unknown> | CypherQueryOptions,
    options?: CypherQueryOptions,
  ): Promise<CypherResult & { executionPlan?: string }> {
    const engine = this._getCypherEngine();
    if (options !== undefined) {
      return engine.execute(cypher, (paramsOrOptions ?? {}) as Record<string, unknown>, options);
    }
    return paramsOrOptions === undefined
      ? engine.execute(cypher)
      : engine.execute(cypher, paramsOrOptions as Record<string, unknown>);
  }

  public querySync(
    cypher: string,
    options?: CypherQueryOptions,
  ): CypherResult & { executionPlan?: string };
  public querySync(
    cypher: string,
    params: Record<string, unknown> | undefined,
    options?: CypherQueryOptions,
  ): CypherResult & { executionPlan?: string };
  public querySync(
    cypher: string,
    paramsOrOptions?: Record<string, unknown> | CypherQueryOptions,
    options?: CypherQueryOptions,
  ): CypherResult & { executionPlan?: string } {
    const engine = this._getCypherEngine();
    if (options !== undefined) {
      return engine.executeSync(cypher, (paramsOrOptions ?? {}) as Record<string, unknown>, options);
    }
    return paramsOrOptions === undefined
      ? engine.executeSync(cypher)
      : engine.executeSync(cypher, paramsOrOptions as Record<string, unknown>);
  }

  public async getQueryPlan(
    cypher: string,
    params: Record<string, unknown> = {},
    format: PlanFormat = 'json',
  ): Promise<string> {
    return this._getCypherEngine().getQueryPlan(cypher, params, format);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle & Transactions
  // ---------------------------------------------------------------------------

  supportsTransactions(): boolean {
    return this._index._getStore().supportsTransactions();
  }

  createTransaction(): GraphTransaction {
    return new GraphTransaction(this._index._getStore());
  }

  async warmCache(): Promise<void> {
    const store = this._index._getStore();
    if (isCacheWarmableStorageProvider(store)) {
      await store.warmCache();
    }
  }

  /**
   * Compacts adjacency delta buffers and dead tombstones into flat Global CSR arrays.
   */
  compact(): void {
    this._index.compact();
  }

  // ---------------------------------------------------------------------------
  // Node Queries & Mutations
  // ---------------------------------------------------------------------------

  async getNodes(options?: GraphQueryOptions): Promise<readonly Node[]> {
    return this._index.getNodes(options);
  }

  async getEdges(options?: GraphQueryOptions): Promise<readonly Edge[]> {
    return this._index.getEdges(options);
  }

  async getNodeCount(options?: GraphQueryOptions): Promise<number> {
    return this._index.getNodeCount(options);
  }

  async getEdgeCount(options?: GraphQueryOptions): Promise<number> {
    return this._index.getEdgeCount(options);
  }

  async hasNode(id: string, transaction?: GraphTransaction): Promise<boolean> {
    return this._index.hasNode(id, transaction);
  }

  async hasEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    return this._index.hasEdge(id, transaction);
  }

  async addNode(
    labels: string | string[],
    properties: Record<string, unknown> = {},
    transaction?: GraphTransaction,
    id?: string,
  ): Promise<Node> {
    return this._index.addNode(labels, properties, transaction, id);
  }

  async addNodes(
    items: ReadonlyArray<{
      labels: string | string[];
      properties?: Record<string, unknown>;
      id?: string;
    }>,
    transaction?: GraphTransaction,
  ): Promise<Node[]> {
    return this._index.addNodes(items, transaction);
  }

  async removeNode(
    id: string,
    cascade: boolean = false,
    transaction?: GraphTransaction,
  ): Promise<{ result: boolean; cascadeDeletedEdgesCount?: number }> {
    return this._index.removeNode(id, cascade, transaction);
  }

  async getNode(id: string, transaction?: GraphTransaction): Promise<Node | undefined> {
    return this._index.getNode(id, transaction);
  }

  async getNodesByIds(ids: string[], transaction?: GraphTransaction): Promise<Map<string, Node>> {
    return this._index.getNodesByIds(ids, transaction);
  }

  // ---------------------------------------------------------------------------
  // Edge Queries & Mutations
  // ---------------------------------------------------------------------------

  async addEdge(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Record<string, unknown> = {},
    transaction?: GraphTransaction,
    id?: string,
  ): Promise<Edge> {
    return this._index.addEdge(sourceId, targetId, type, properties, transaction, id);
  }

  async addEdges(
    items: ReadonlyArray<{
      sourceId: string;
      targetId: string;
      type: string;
      properties?: Record<string, unknown>;
      id?: string;
    }>,
    transaction?: GraphTransaction,
  ): Promise<Edge[]> {
    return this._index.addEdges(items, transaction);
  }

  async removeEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    return this._index.removeEdge(id, transaction);
  }

  async getEdge(id: string, transaction?: GraphTransaction): Promise<Edge | undefined> {
    return this._index.getEdge(id, transaction);
  }

  async getEdgesFrom(sourceId: string, options?: GraphQueryOptions): Promise<Edge[]> {
    return this._index.getEdgesFrom(sourceId, options);
  }

  async getEdgesTo(targetId: string, options?: GraphQueryOptions): Promise<Edge[]> {
    return this._index.getEdgesTo(targetId, options);
  }

  /** @internal Skips endpoint hasNode check for callers holding a validated Node. */
  async _getAdjacentEdges(
    direction: 'out' | 'in',
    nodeId: string,
    options?: GraphQueryOptions,
  ): Promise<Edge[]> {
    return this._index._getAdjacentEdges(direction, nodeId, options);
  }

  /** @internal Batch adjacency lookup across multiple node IDs. */
  async _getAdjacentEdgesBatch(
    direction: 'out' | 'in',
    nodeIds: readonly string[],
    options?: GraphQueryOptions,
  ): Promise<Map<string, Edge[]>> {
    return this._index._getAdjacentEdgesBatch(direction, nodeIds, options);
  }

  async getDirectEdgesBetween(
    sourceId: string,
    targetId: string,
    options?: GraphQueryOptions,
  ): Promise<Edge[]> {
    return this._index.getDirectEdgesBetween(sourceId, targetId, options);
  }

  // ---------------------------------------------------------------------------
  // Traversal & Graph Algorithms
  // ---------------------------------------------------------------------------

  async traverse(
    sourceId: string | string[],
    targetId: string | string[],
    options: TraversalOptions = {},
  ): Promise<string[][] | null> {
    return this._traversal.traverse(sourceId, targetId, options);
  }

  async isDAG(): Promise<boolean> {
    return this._traversal.isDAG();
  }

  async topologicalSort(): Promise<string[] | null> {
    return this._traversal.topologicalSort();
  }

  async clear(): Promise<void> {
    return this._index.clear();
  }

  // ---------------------------------------------------------------------------
  // Property & Label Mutations
  // ---------------------------------------------------------------------------

  async setNodeProperties(
    nodeId: string,
    properties: Record<string, unknown>,
    options?: { merge?: boolean; transaction?: GraphTransaction },
  ): Promise<void> {
    return this._index.setNodeProperties(nodeId, properties, options);
  }

  async unsetNodeProperties(
    nodeId: string,
    keys: string[],
    transaction?: GraphTransaction,
  ): Promise<void> {
    return this._index.unsetNodeProperties(nodeId, keys, transaction);
  }

  async removeNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: GraphTransaction,
  ): Promise<void> {
    return this._index.removeNodeLabels(nodeId, labels, transaction);
  }

  async addNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: GraphTransaction,
  ): Promise<void> {
    return this._index.addNodeLabels(nodeId, labels, transaction);
  }

  async setEdgeProperties(
    edgeId: string,
    properties: Record<string, unknown>,
    options?: { merge?: boolean; transaction?: GraphTransaction },
  ): Promise<void> {
    return this._index.setEdgeProperties(edgeId, properties, options);
  }

  async unsetEdgeProperties(
    edgeId: string,
    keys: string[],
    transaction?: GraphTransaction,
  ): Promise<void> {
    return this._index.unsetEdgeProperties(edgeId, keys, transaction);
  }

  // ---------------------------------------------------------------------------
  // Index Management
  // ---------------------------------------------------------------------------

  async createIndex(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): Promise<void> {
    return this._index.createIndex(name, target, propertyKeys, options);
  }

  async hasIndex(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): Promise<boolean> {
    return this._index.hasIndex(target, propertyKeys, labelOrType);
  }

  async getIndex(name: string): Promise<IndexMetadata | undefined> {
    return this._index.getIndex(name);
  }

  async deleteIndex(name: string): Promise<void> {
    return this._index.deleteIndex(name);
  }

  async getIndexes(): Promise<IndexMetadata[]> {
    return this._index.getIndexes();
  }

  // ---------------------------------------------------------------------------
  // Aggregations
  // ---------------------------------------------------------------------------

  async aggregateNodeProperty(
    key: string,
    options?: GraphQueryOptions,
  ): Promise<AggregateResult> {
    return this._index.aggregateNodeProperty(key, options);
  }

  async aggregateEdgeProperty(
    key: string,
    options?: GraphQueryOptions,
  ): Promise<AggregateResult> {
    return this._index.aggregateEdgeProperty(key, options);
  }

  // ---------------------------------------------------------------------------
  // Data Portability — export / import
  // ---------------------------------------------------------------------------

  async exportJSON(): Promise<GraphData> {
    return this._adminOps.exportJSON();
  }

  static async importJSON(data: GraphData, storageProvider?: IStorageProvider): Promise<Graph> {
    const graph = new Graph(storageProvider);
    await graph._adminOps.importJSON(data);
    return graph;
  }
}
