/**
 * Browser-optimized entry point for Grafio.
 *
 * Includes: Graph core, InMemoryStorageProvider, CypherEngine + full pipeline,
 * PlanFormatter, GraphToMermaid, errors, and type definitions.
 *
 * @module index.browser
 */

// ── Core graph classes ──────────────────────────────────────────
export { Graph } from '../../src/Graph';
export { Node } from '../../src/Node';
export { Edge } from '../../src/Edge';

// ── Graph internals ─────────────────────────────────────────────
export { GraphToMermaid } from '../../src/Graph/GraphToMermaid';
export { GraphAdminOps } from '../../src/Graph/GraphAdminOps';
export { GraphTransaction } from '../../src/Graph/GraphTransaction';

// ── Type definitions ────────────────────────────────────────────
export type { NodeData, EdgeData, GraphData, ITransactionHandle, PrimitiveProperty, PropertyPatch } from '../../src/types';
export type { GraphQueryOptions, IOrderBy } from '../../src/Graph/GraphQueryOptions';
export type { TraversalOptions } from '../../src/Graph/TraversalOptions';
export type { MermaidOptions } from '../../src/Graph/GraphToMermaid';

// ── Storage ─────────────────────────────────────────────────────
export {
  isCacheWarmableStorageProvider,
  isSyncGraphKernel,
  type IStorageProvider,
  type ISyncGraphKernel,
  type CacheWarmableStorageProvider,
  type IndexMetadata,
  type CreateIndexOptions,
  type GroupedAggregateSpec,
  type GroupedAggregateRequest,
  type GroupedAggregateRow,
} from '../../src/storage/IStorageProvider';
export { InMemoryStorageProvider } from '../../src/storage/InMemoryStorageProvider';
export type { InMemoryStorageProviderOptions } from '../../src/storage/InMemoryStorageProvider';

// ── Utilities ───────────────────────────────────────────────────
export { isPrimitive } from '../../src/utils';
export { TransactionNotActiveError, TransactionFailedError } from '../../src/Graph/GraphTransaction';

// ── Core errors ─────────────────────────────────────────────────
export {
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  EdgeNotFoundError,
  InvalidPropertyError,
  NodeHasEdgesError,
  InvalidGraphDataError,
  TransactionConflictError,
} from '../../src/errors';

// ── Cypher engine ───────────────────────────────────────────────
export { CypherEngine } from '../../src/cypher/CypherEngine';
export type { CypherEngineOptions, CypherQueryOptions } from '../../src/cypher/CypherEngine';
export type { CypherResult, CypherRow, CypherSummary } from '../../src/cypher/Result';
export {
  CypherError,
  CypherSyntaxError,
  CypherNotSupportedError,
  ReadOnlyQueryError,
  CypherSemanticError,
  CypherRuntimeError,
  UnboundParameterError,
  TypeMismatchError,
} from '../../src/cypher/errors';
export { PlanFormatter } from '../../src/cypher/plan/PlanFormatter';
export type { PlanFormat } from '../../src/cypher/plan/PlanFormatter';
