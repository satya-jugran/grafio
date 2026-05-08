// Main classes
export { Graph } from './Graph';
export { Node } from './Node';
export { Edge } from './Edge';
export { GraphToMermaid } from './Graph/GraphToMermaid';
export { GraphAdminOps } from './Graph/GraphAdminOps';
export { GraphTransaction } from './Graph/GraphTransaction';

// Type definitions
export type { NodeData } from './types';
export type { EdgeData } from './types';
export type { GraphData } from './types';
export type { GraphOptions } from './types';
export type { TraversalOptions } from './Graph/TraversalOptions';
export type { MermaidOptions } from './Graph/GraphToMermaid';

// Storage abstraction
export type { IStorageProvider } from './storage/IStorageProvider';
export type { ITransactionHandle } from './storage/IStorageProvider';
export { InMemoryStorageProvider } from './storage/InMemoryStorageProvider';
export type { InMemoryStorageProviderOptions } from './storage/InMemoryStorageProvider';
export type { IGraphFactory } from './storage/IGraphFactory';
export { InMemoryGraphFactory } from './storage/InMemoryGraphFactory';

// Caching layer
export { GraphManager } from './GraphManager';
export type { GraphManagerConfig } from './GraphManager';
export { CachedStorageProvider } from './storage/CachedStorageProvider';
export type { CacheConfig } from './storage/cache/CacheConfig';
export type { EvictionStrategy } from './storage/cache/CacheConfig';
export type { PreloadStrategy } from './storage/cache/CacheConfig';
export type { CacheStoreType } from './storage/cache/CacheConfig';
export { CacheManager } from './storage/cache/CacheManager';
export type { CacheStats } from './storage/cache/CacheManager';
export type { ICacheProvider } from './storage/cache/ICacheProvider';
export { InMemoryCache } from './storage/cache/InMemoryCache';

export { isPrimitive } from './utils';
export { TransactionNotActiveError, TransactionFailedError } from './Graph/GraphTransaction';