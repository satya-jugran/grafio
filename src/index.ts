// Main classes
export { Graph } from './Graph';
export { Node } from './Node';
export { Edge } from './Edge';
export { GraphToMermaid } from './Graph/GraphToMermaid';
export { GraphAdminOps } from './Graph/GraphAdminOps';
export { GraphTransaction } from './Graph/GraphTransaction';

// Type definitions
export type { NodeData, EdgeData, GraphData, ITransactionHandle, StorageQueryOptions, PrimitiveProperty, PropertyPatch } from './types';
export type { GraphQueryOptions, IOrderBy } from './Graph/GraphQueryOptions';
export type { TraversalOptions } from './Graph/TraversalOptions';
export type { MermaidOptions } from './Graph/GraphToMermaid';

// Storage abstraction
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
} from './storage/IStorageProvider';
export { InMemoryStorageProvider } from './storage/InMemoryStorageProvider';
export type { InMemoryStorageProviderOptions } from './storage/InMemoryStorageProvider';
export type { IGraphFactory } from './storage/IGraphFactory';
export { InMemoryGraphFactory } from './storage/InMemoryGraphFactory';

// Caching layer (for remote/slow IStorageProviders)
export { GraphManager } from './GraphManager';
export type { GraphManagerConfig } from './GraphManager';
export { CachedStorageProvider } from './storage/CachedStorageProvider';
export type { CacheConfig, EvictionStrategy, PreloadStrategy, CacheStoreType } from './storage/cache/CacheConfig';
export { CacheManager } from './storage/cache/CacheManager';
export type { CacheStats } from './storage/cache/CacheManager';
export type { ICacheProvider } from './storage/cache/ICacheProvider';
export { InMemoryCache } from './storage/cache/InMemoryCache';

// Cypher convenience exports
export { CypherEngine } from './cypher/CypherEngine';
export type { CypherEngineOptions, CypherQueryOptions } from './cypher/CypherEngine';
export type { CypherResult, CypherRow, CypherSummary } from './cypher/Result';

export { isPrimitive } from './utils';
export { TransactionNotActiveError, TransactionFailedError } from './Graph/GraphTransaction';
export { TransactionConflictError } from './errors';
