import type {
  NodeData,
  EdgeData,
  ReadonlyNodeData,
  ReadonlyEdgeData,
  GraphData,
  StorageQueryOptions,
  IOrderBy,
  ITransactionHandle,
  AggregateResult,
  PropertyPatch,
} from '../types';
import type { Node } from '../Node';
import type { Edge } from '../Edge';
import type { SlotArena } from './engine/SlotArena';
import type { AdjacencyStore } from './engine/AdjacencyStore';
import type { PropertyIndexStore } from './engine/PropertyIndexStore';

export type { StorageQueryOptions, IOrderBy, ITransactionHandle };

/**
 * Metadata describing an index.
 */
export interface IndexMetadata {
  /** Name of the index */
  name: string;
  /** Whether the index targets nodes or edges */
  target: 'node' | 'edge';
  /** The property keys that are indexed */
  propertyKeys: string[];
  /** Optional node label or edge type scoping this index */
  labelOrType?: string;
}

/**
 * Optional options when creating an index.
 */
export interface CreateIndexOptions {
  /** Optional label (for node indexes) or relationship type (for edge indexes) */
  labelOrType?: string;
}

/**
 * Optional capability implemented by providers that can preload cache data.
 */
export interface CacheWarmableStorageProvider {
  warmCache(): Promise<void>;
}

/**
 * Runtime type guard for optional cache-warming provider capability.
 */
export function isCacheWarmableStorageProvider(
  provider: IStorageProvider,
): provider is IStorageProvider & CacheWarmableStorageProvider {
  const candidate = provider as Partial<CacheWarmableStorageProvider>;
  return typeof candidate.warmCache === 'function';
}

/**
 * Optional synchronous in-memory graph kernel capability implemented by
 * `InMemoryStorageProvider` so `Graph`, `GraphTraversal`, and `CypherEngine`
 * execute without async microtask overhead or defensive object cloning.
 */
export interface ISyncGraphKernel {
  readonly __isSyncGraphKernel: true;
  readonly indexEpoch: number;
  readonly hasActiveTransactions: boolean;
  readonly arena: SlotArena;
  readonly adjacency: AdjacencyStore;
  readonly propertyIndexes: PropertyIndexStore;

  getNodeSlot(id: string): number;
  getEdgeSlot(id: string): number;
  getNodeEntityBySlot(slot: number): Node;
  getEdgeEntityBySlot(slot: number): Edge;

  insertNodeSync(
    labels: readonly string[],
    properties: Readonly<Record<string, unknown>>,
    id?: string,
    transaction?: ITransactionHandle,
  ): Node;
  insertNodesSync(
    items: ReadonlyArray<{
      labels: readonly string[];
      properties?: Readonly<Record<string, unknown>>;
      id?: string;
    }>,
    transaction?: ITransactionHandle,
  ): Node[];
  deleteNodeByIdSync(
    id: string,
    cascade: boolean,
    transaction?: ITransactionHandle,
  ): { result: boolean; cascadeDeletedEdgesCount?: number };

  insertEdgeSync(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Readonly<Record<string, unknown>>,
    id?: string,
    transaction?: ITransactionHandle,
  ): Edge;
  insertEdgesSync(
    items: ReadonlyArray<{
      sourceId: string;
      targetId: string;
      type: string;
      properties?: Readonly<Record<string, unknown>>;
      id?: string;
    }>,
    transaction?: ITransactionHandle,
  ): Edge[];
  deleteEdgeByIdSync(id: string, transaction?: ITransactionHandle): boolean;

  patchPropertiesSync(
    target: 'node' | 'edge',
    id: string,
    patch: PropertyPatch,
    transaction?: ITransactionHandle,
  ): void;
  removeNodeLabelsSync(
    nodeId: string,
    labels: readonly string[],
    transaction?: ITransactionHandle,
  ): number;
  addNodeLabelsSync(
    nodeId: string,
    labels: readonly string[],
    transaction?: ITransactionHandle,
  ): number;

  createIndexSync(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): void;
  deleteIndexSync(name: string): void;
  getIndexesSync(): IndexMetadata[];
  hasIndexSync(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): boolean;

  queryNodeSlotsSync(options?: StorageQueryOptions): Uint32Array | number[];
  queryNodesSync(options?: StorageQueryOptions): Node[];
  queryEdgesSync(options?: StorageQueryOptions): Edge[];
  getEdgesBySourceSync(nodeId: string, options?: StorageQueryOptions): Edge[];
  getEdgesByTargetSync(nodeId: string, options?: StorageQueryOptions): Edge[];
  getNodeSync(id: string, transaction?: ITransactionHandle): Node | undefined;
  getNodesByIdsSync(
    ids: readonly string[],
    transaction?: ITransactionHandle,
  ): Map<string, Node>;
  getEdgeSync(id: string, transaction?: ITransactionHandle): Edge | undefined;

  countNodesSync(options?: StorageQueryOptions): number;
  countEdgesSync(options?: StorageQueryOptions): number;
  aggregateNodePropertySync(key: string, options?: StorageQueryOptions): AggregateResult;
  aggregateEdgePropertySync(key: string, options?: StorageQueryOptions): AggregateResult;

  beginUndoCheckpoint(): void;
  commitUndoCheckpoint(): void;
  rollbackUndoCheckpoint(): void;
  compact(): void;
}

/**
 * Runtime type guard checking whether a storage provider exposes `ISyncGraphKernel`.
 */
export function isSyncGraphKernel(
  provider: IStorageProvider,
): provider is IStorageProvider & ISyncGraphKernel {
  return (provider as Partial<ISyncGraphKernel>).__isSyncGraphKernel === true;
}

/**
 * Specification of a single aggregate expression for {@link GroupedAggregateRequest}.
 */
export interface GroupedAggregateSpec {
  alias: string;
  fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  /** Property key on the entity, or undefined for `COUNT(*)` / `COUNT(entity)`. */
  propertyKey?: string;
  distinct?: boolean;
}

/**
 * Request descriptor for storage-level grouped aggregation pushdown.
 */
export interface GroupedAggregateRequest {
  target: 'node' | 'edge';
  groupByKeys: string[];
  aggregates: GroupedAggregateSpec[];
  options?: StorageQueryOptions;
}

/**
 * One grouped aggregate output row matching `groupByKeys` positional values
 * and `aggregates` alias results.
 */
export interface GroupedAggregateRow {
  groupValues: unknown[];
  aggValues: Record<string, unknown>;
}

/**
 * Contract that every v8 storage backend must fulfill.
 */
export interface IStorageProvider {
  /** Monotonic schema/index epoch counter incremented on createIndex/deleteIndex/clear. */
  readonly indexEpoch: number;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  clear(): Promise<void>;
  compact?(): void;

  // ---------------------------------------------------------------------------
  // Node mutations
  // ---------------------------------------------------------------------------

  insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void>;
  insertNodes(nodes: readonly NodeData[], transaction?: ITransactionHandle): Promise<void>;
  deleteNode(id: string, transaction?: ITransactionHandle): Promise<void>;

  // ---------------------------------------------------------------------------
  // Node queries
  // ---------------------------------------------------------------------------

  hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean>;
  getNode(id: string, transaction?: ITransactionHandle): Promise<ReadonlyNodeData | undefined>;
  getNodesByIds(
    ids: string[],
    transaction?: ITransactionHandle,
  ): Promise<Map<string, ReadonlyNodeData>>;
  getNodeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateNodeProperty(
    key: string,
    options?: StorageQueryOptions,
  ): Promise<AggregateResult>;
  getNodes(options?: StorageQueryOptions): Promise<ReadonlyNodeData[]>;

  // ---------------------------------------------------------------------------
  // Edge mutations
  // ---------------------------------------------------------------------------

  insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void>;
  insertEdges(edges: readonly EdgeData[], transaction?: ITransactionHandle): Promise<void>;
  deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void>;
  deleteEdges?(ids: readonly string[], transaction?: ITransactionHandle): Promise<void>;

  // ---------------------------------------------------------------------------
  // Edge queries
  // ---------------------------------------------------------------------------

  hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean>;
  getEdge(id: string, transaction?: ITransactionHandle): Promise<ReadonlyEdgeData | undefined>;
  getEdgeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateEdgeProperty(
    key: string,
    options?: StorageQueryOptions,
  ): Promise<AggregateResult>;
  getEdges(options?: StorageQueryOptions): Promise<ReadonlyEdgeData[]>;
  getEdgesBySource(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]>;
  getEdgesByTarget(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]>;
  getEdgesBySources?(
    nodeIds: readonly string[],
    options?: StorageQueryOptions,
  ): Promise<Map<string, ReadonlyEdgeData[]>>;
  getEdgesByTargets?(
    nodeIds: readonly string[],
    options?: StorageQueryOptions,
  ): Promise<Map<string, ReadonlyEdgeData[]>>;

  // ---------------------------------------------------------------------------
  // Optional pushdown capabilities
  // ---------------------------------------------------------------------------

  /**
   * Optional storage-level grouped aggregation pushdown.
   * Returns `null` when the provider/wrapper delegates fallback to in-process execution.
   */
  aggregateGrouped?(
    request: GroupedAggregateRequest,
  ): Promise<GroupedAggregateRow[] | null>;

  /**
   * Optional storage-level unweighted shortest-path traversal (`BFS` with wildcard nodes).
   * Returns `string[]` when found, `null` when endpoints are missing/unreachable,
   * or `undefined` when the provider declines and callers should fall back to iterative BFS.
   */
  traverseShortestPath?(
    sourceId: string,
    targetId: string,
    edgeTypes?: readonly string[],
  ): Promise<string[] | null | undefined>;

  // ---------------------------------------------------------------------------
  // Property and Label mutations
  // ---------------------------------------------------------------------------

  removeNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: ITransactionHandle,
  ): Promise<void>;

  addNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: ITransactionHandle,
  ): Promise<void>;

  patchProperties(
    target: 'node' | 'edge',
    id: string,
    patch: PropertyPatch,
    transaction?: ITransactionHandle,
  ): Promise<void>;

  // ---------------------------------------------------------------------------
  // Index management
  // ---------------------------------------------------------------------------

  createIndex(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): Promise<void>;

  hasIndex(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): Promise<boolean>;

  getIndex(name: string): Promise<IndexMetadata | undefined>;
  deleteIndex(name: string): Promise<void>;
  getIndexes(): Promise<IndexMetadata[]>;

  // ---------------------------------------------------------------------------
  // Data portability
  // ---------------------------------------------------------------------------

  exportJSON(): Promise<GraphData>;
  importJSON(data: GraphData): Promise<void>;

  // ---------------------------------------------------------------------------
  // Transaction support
  // ---------------------------------------------------------------------------

  supportsTransactions(): boolean;
  beginTransaction(): Promise<ITransactionHandle>;
  commitTransaction(handle: ITransactionHandle): Promise<void>;
  rollbackTransaction(handle: ITransactionHandle): Promise<void>;
}
