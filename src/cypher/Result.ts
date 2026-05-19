/**
 * Result set types returned by the Cypher execution layer.
 *
 * Returned `Node` and `Edge` objects are the same classes from
 * {@link src/Node.ts} and {@link src/Edge.ts}, so consumers can call
 * `.id`, `.type`, `.properties` directly on result values.
 *
 * @module cypher/Result
 */

import { PlanExecutionStats } from './plan/QueryPlan';

/**
 * A single row in a Cypher query result.
 *
 * Keys are the output aliases (from `AS` in RETURN, or auto-derived).
 * Values are {@link Node}, {@link Edge}, or scalar primitives.
 */
export interface CypherRow {
  [alias: string]: unknown;
}

/**
 * The complete result of executing a Cypher query.
 */
export interface CypherResult {
  /** Ordered list of column names (aliases). */
  columns: string[];
  /** The result rows. */
  rows: CypherRow[];
  /** Execution summary with timing and write counters. */
  summary: CypherSummary;
}

/**
 * Execution summary returned with every query result.
 *
 * Write counters are always `0` for read-only v1 queries; they are
 * initialised by the Executor and incremented by write steps when
 * ungated in a future version.
 */
export interface CypherSummary {
  /** Total execution time in milliseconds. */
  queryTimeMs: number;
  /** Number of nodes created */
  nodesCreated: number;
  /** Number of nodes deleted */
  nodesDeleted: number;
  /** Number of edges created */
  edgesCreated: number;
  /** Number of edges deleted */
  edgesDeleted: number;
  /** Number of properties set */
  propertiesSet: number;
  /** Number of indexes created by this query. */
  indexesCreated: number;
  /** Number of indexes deleted by this query. */
  indexesDeleted: number;
  /** Execution statistics for each plan step (optional). */
  planExecutionStats?: PlanExecutionStats;
}
