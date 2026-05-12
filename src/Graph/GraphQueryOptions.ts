import type { GraphTransaction } from './GraphTransaction';
import type { IOrderBy, QueryOptions } from '../types';

// Re-export IOrderBy from types.ts for Graph layer convenience
export type { IOrderBy };

/**
 * Unified query options for Graph-level node and edge queries.
 * Used by Graph and GraphIndex. For storage layer queries, use StorageQueryOptions.
 * 
 * Unlike StorageQueryOptions which uses ITransactionHandle (storage-level),
 * this uses GraphTransaction (Graph-level) for a cleaner public API.
 */
export interface GraphQueryOptions extends QueryOptions {
  /** Transaction for consistent reads within a transaction */
  transaction?: GraphTransaction;
}