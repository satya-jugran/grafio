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
export { MongoStorageProvider } from './storage/MongoStorageProvider';
export type { MongoStorageProviderOptions } from './storage/MongoStorageProvider';
export type { IGraphFactory } from './storage/IGraphFactory';
export { MongoGraphFactory } from './storage/MongoGraphFactory';
export { InMemoryGraphFactory } from './storage/InMemoryGraphFactory';

// Error classes
export {
  GraphError,
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  NodeHasEdgesError,
  EdgeNotFoundError,
  InvalidGraphDataError,
  InvalidPropertyError,
  PropertyAlreadyExistsError,
  PropertyNotFoundError,
  TraversalLimitExceededError,
} from './errors';
export { TransactionNotActiveError, TransactionFailedError } from './Graph/GraphTransaction';
