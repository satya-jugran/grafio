/**
 * Represents a transaction handle returned by a storage provider.
 * Contains a unique transaction identifier and optional backend-specific context.
 */
export interface ITransactionHandle {
  /** Unique transaction identifier */
  id: string;
  /** Backend-specific context (e.g., MongoDB ClientSession) */
  context?: unknown;
}

/**
 * Ordering options for collection queries.
 */
export interface IOrderBy {
  /** Field to order by */
  field: string;
  /** Sort direction */
  direction: 'asc' | 'desc';
}

/**
 * Supported aggregate operations for property aggregation.
 */
export type AggregateOp = 'SUM' | 'AVG' | 'MIN' | 'MAX';

/**
 * Result of an aggregate operation on a property.
 */
export interface AggregateResult {
  /** Count of non-null values (always populated) */
  count: number;
  /** Sum of values (SUM operation) */
  sum?: number;
  /** Average of values (AVG operation) */
  avg?: number;
  /** Minimum value (MIN operation) */
  min?: number;
  /** Maximum value (MAX operation) */
  max?: number;
}

/**
 * Unified query options for storage layer node and edge queries.
 * For Graph-level queries, use GraphQueryOptions.
 */
export interface QueryOptions {
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
  /**
   * When true, deduplicate property values before computing aggregates.
   * Applies to: aggregateNodeProperty, aggregateEdgeProperty.
   */
  distinct?: boolean;
}

export interface StorageQueryOptions extends QueryOptions {
  /** Transaction handle for transactional storage providers */
  transaction?: ITransactionHandle;
}

/**
 * Data transfer object for Node serialization
 */
export interface NodeData {
  id: string;
  type: string;
  createdOn?: number;
  updatedOn?: number;
  properties: Record<string, unknown>;
}

/**
 * Data transfer object for Edge serialization
 */
export interface EdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  createdOn?: number;
  updatedOn?: number;
  properties: Record<string, unknown>;
}

/**
 * Data transfer object for Graph serialization.
 * Optionally carries the graph partition key when round-tripping through a
 * partitioned storage provider.
 */
export interface GraphData {
  /**
   * Graph partition key. Populated by exportJSON to preserve partition context.
   * When passed to importJSON, callers are responsible for ensuring the target
   * provider uses a matching graphId — importJSON does not automatically
   * re-partition data based on this field.
   */
  graphId?: string;
  nodes: NodeData[];
  edges: EdgeData[];
}
