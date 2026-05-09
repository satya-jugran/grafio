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
 * Options for graph query methods that support filtering and transactions.
 * Allows combining filter options with an optional transaction in a single parameter.
 */
export interface GraphOptions<T = unknown> {
  /**
   * Optional filter criteria (e.g., nodeType, edgeType)
   */
  filter?: T;
  /**
   * Optional transaction for consistent reads within a transaction
   */
  transaction?: import('./Graph/GraphTransaction').GraphTransaction;
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
