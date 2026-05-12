import type { GraphTransaction } from './GraphTransaction';
import type { IOrderBy } from '../types';

// Re-export IOrderBy from types.ts for Graph layer convenience
export type { IOrderBy };

/**
 * Unified query options for Graph-level node and edge queries.
 * Used by Graph and GraphIndex. For storage layer queries, use StorageQueryOptions.
 * 
 * Unlike StorageQueryOptions which uses ITransactionHandle (storage-level),
 * this uses GraphTransaction (Graph-level) for a cleaner public API.
 */
export interface GraphQueryOptions {
  /**
   * Filter criteria - all conditions must match (AND logic).
   * If undefined, no filtering is applied.
   */
  filter?: {
    /**
     * Match nodes/edges with ANY of these types (OR within types).
     * Example: types: ['User', 'Admin'] matches both User and Admin nodes.
     */
    types?: string[];
    /**
     * Match nodes/edges where ALL specified property key-value pairs exist.
     * Example: properties: [{ key: 'active', value: true }] matches nodes
     * where node.properties.active === true.
     */
    properties?: Array<{ key: string; value: unknown }>;
  };
  /** Order results by the specified field */
  orderBy?: IOrderBy;
  /** Maximum number of results to return */
  limit?: number;
  /** Transaction for consistent reads within a transaction */
  transaction?: GraphTransaction;
}