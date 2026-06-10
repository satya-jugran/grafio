export interface NodeData {
  id: string;
  labels: string[];
  createdOn?: number;
  updatedOn?: number;
  properties: Record<string, unknown>;
}

export interface EdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  createdOn?: number;
  updatedOn?: number;
  properties: Record<string, unknown>;
}

export interface GraphData {
  graphId?: string;
  nodes: NodeData[];
  edges: EdgeData[];
}

export interface ITransactionHandle {
  id: string;
  context?: unknown;
}

export class Node {
  constructor(
    labels: string | readonly string[],
    properties?: Record<string, unknown>,
    id?: string,
    createdOn?: number,
    updatedOn?: number,
  );
  get id(): string;
  get labels(): readonly string[];
  get createdOn(): number;
  get updatedOn(): number;
  get properties(): Readonly<Record<string, unknown>>;
  toJSON(): NodeData;
}

export class Edge {
  constructor(
    sourceId: string,
    targetId: string,
    type: string,
    properties?: Record<string, unknown>,
    id?: string,
    createdOn?: number,
    updatedOn?: number,
  );
  get id(): string;
  get sourceId(): string;
  get targetId(): string;
  get type(): string;
  get createdOn(): number;
  get updatedOn(): number;
  get properties(): Readonly<Record<string, unknown>>;
  toJSON(): EdgeData;
}

export interface TraversalOptions {
  method?: 'bfs' | 'dfs';
  nodeTypes?: string[];
  edgeTypes?: string[];
  maxResults?: number;
}

export interface IStorageProvider {
  readonly graphId: string;
  hasNode(id: string, handle?: ITransactionHandle): Promise<boolean>;
  getNode(id: string, handle?: ITransactionHandle): Promise<NodeData | undefined>;
  getNodesByIds(ids: string[], handle?: ITransactionHandle): Promise<Map<string, NodeData>>;
  getAllNodes(handle?: ITransactionHandle): Promise<NodeData[]>;
  getNodeCount(options?: { filter?: { types?: string[] }; transaction?: ITransactionHandle }): Promise<number>;
  hasEdge(id: string, handle?: ITransactionHandle): Promise<boolean>;
  getEdge(id: string, handle?: ITransactionHandle): Promise<EdgeData | undefined>;
  getAllEdges(handle?: ITransactionHandle): Promise<EdgeData[]>;
  getEdgeCount(options?: { filter?: { types?: string[] }; transaction?: ITransactionHandle }): Promise<number>;
  getEdgesBySource(sourceId: string, options?: { filter?: { types?: string[] }; transaction?: ITransactionHandle }): Promise<EdgeData[]>;
  getEdgesByTarget(targetId: string, options?: { filter?: { types?: string[] }; transaction?: ITransactionHandle }): Promise<EdgeData[]>;
  exportJSON(): Promise<GraphData>;
  importJSON(data: GraphData): Promise<void>;
  supportsTransactions(): boolean;
}

export interface InMemoryStorageProviderOptions {
  graphId?: string;
}

export class InMemoryStorageProvider {
  readonly graphId: string;
  constructor(opts?: InMemoryStorageProviderOptions);
}

export class GraphTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  isActive(): boolean;
}

export class Graph {
  constructor(storageProvider?: IStorageProvider);
  static importJSON(data: GraphData, storageProvider?: IStorageProvider): Promise<Graph>;
  exportJSON(): Promise<GraphData>;
  clear(): Promise<void>;
  traverse(sourceId: string | string[], targetId: string | string[], options?: TraversalOptions): Promise<string[][] | null>;
  isDAG(): Promise<boolean>;
  topologicalSort(): Promise<string[] | null>;
  supportsTransactions(): boolean;
  createTransaction(): GraphTransaction;
}

export interface MermaidOptions {
  showProperties?: boolean;
  includeEdgeLabels?: boolean;
  direction?: 'TD' | 'LR';
}

export class GraphToMermaid {
  constructor(jsonString: string, options?: MermaidOptions);
  constructor(data: GraphData, options?: MermaidOptions);
  static fromGraph(graph: Graph, options?: MermaidOptions): Promise<GraphToMermaid>;
  toString(): string;
}

export class GraphAdminOps {
  exportJSON(): Promise<GraphData>;
  importJSON(data: GraphData): Promise<void>;
}

export interface CypherEngineOptions {
  maxDegreeOfParallelism?: number;
}

export interface CypherQueryOptions {
  transaction?: GraphTransaction;
  executionPlan?: {
    format: PlanFormat;
  };
}

export interface CypherRow {
  [alias: string]: unknown;
}

export interface CypherResult {
  columns: string[];
  rows: CypherRow[];
  summary: CypherSummary;
}

export interface CypherSummary {
  queryTimeMs: number;
  nodesCreated: number;
  nodesDeleted: number;
  edgesCreated: number;
  edgesDeleted: number;
  propertiesSet: number;
  indexesCreated: number;
  indexesDeleted: number;
}

export class CypherEngine {
  constructor(graph: Graph, options?: CypherEngineOptions);
  execute(query: string, options?: CypherQueryOptions): Promise<CypherResult & { executionPlan?: string }>;
  execute(query: string, params: Record<string, unknown>, options?: CypherQueryOptions): Promise<CypherResult & { executionPlan?: string }>;
  getQueryPlan(query: string, params?: Record<string, unknown>, format?: PlanFormat): Promise<string>;
}

export type PlanFormat = 'json' | 'text' | 'mermaid';

export class PlanFormatter {
  format(plan: unknown, format?: PlanFormat, executionStats?: unknown, params?: Record<string, unknown>): string;
}

export class GraphError extends Error {
  constructor(message: string);
}

export class NodeAlreadyExistsError extends GraphError {
  constructor(nodeId: string);
}

export class EdgeAlreadyExistsError extends GraphError {
  constructor(edgeId: string);
}

export class NodeNotFoundError extends GraphError {
  constructor(nodeId: string);
}

export class EdgeNotFoundError extends GraphError {
  constructor(edgeId: string);
}

export class NodeHasEdgesError extends GraphError {
  constructor(nodeId: string, edgeCount: number);
}

export class InvalidGraphDataError extends GraphError {
  constructor(message: string);
}

export class InvalidPropertyError extends GraphError {
  constructor(propertyKey: string, propertyValue: unknown);
}

export class PropertyAlreadyExistsError extends GraphError {
  constructor(targetType: 'node' | 'edge', targetId: string, propertyKey: string);
}

export class PropertyNotFoundError extends GraphError {
  constructor(targetType: 'node' | 'edge', targetId: string, propertyKey: string);
}

export class TransactionNotActiveError extends Error {
  constructor(message?: string);
}

export class TransactionFailedError extends Error {
  constructor(message?: string);
}

export class CypherError extends GraphError {
  constructor(message: string);
}

export class CypherSyntaxError extends CypherError {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col: number);
}

export class CypherNotSupportedError extends CypherError {
  constructor(feature: string);
}

export class CypherSemanticError extends CypherError {
  constructor(message: string);
}

export class CypherRuntimeError extends CypherError {
  constructor(message: string);
}

export class UnboundParameterError extends CypherRuntimeError {
  constructor(paramName: string);
}

export class TypeMismatchError extends CypherRuntimeError {
  constructor(detail: string);
}

export function isPrimitive(value: unknown): boolean;
