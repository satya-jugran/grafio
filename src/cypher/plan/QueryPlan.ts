/**
 * Query plan types for the Cypher execution layer.
 *
 * The {@link Planner} transforms a typed AST into an ordered list of
 * {@link PlanStep} objects — a physical execution plan that the
 * {@link Executor} walks at runtime.
 *
 * @module cypher/plan/QueryPlan
 */

import { Expression } from '../ast/AstNode';

// ── Query plan ────────────────────────────────────────────────────

/**
 * A physical execution plan: an ordered sequence of steps.
 */
export interface QueryPlan {
  /** The ordered list of execution steps. */
  steps: PlanStep[];
}

// ── Plan step discriminated union ─────────────────────────────────

/**
 * All possible plan step types.
 */
export type PlanStep =
  | NodeScanStep
  | EdgeExpandStep
  | FilterStep
  | ProjectStep
  | SortStep
  | LimitStep
  | AggregateStep;

// ── Individual step types ─────────────────────────────────────────

/**
 * Scan all nodes of a given label (type).
 *
 * Maps to: {@link Graph.getNodesByType}
 */
export interface NodeScanStep {
  kind: 'NodeScanStep';
  /** The label (node type) to scan. */
  label: string;
  /** The variable name to bind each scanned node to. */
  variable: string;
}

/**
 * Expand from a source node along matching edges to target nodes.
 *
 * The {@link strategy} field determines which {@link Graph} API method the
 * executor dispatches to:
 * - `'single-hop'`   → `getEdgesFrom` / `getEdgesTo`
 * - `'multi-hop-bfs'` → `traverse()` with BFS
 * - `'multi-hop-dfs'` → `traverse()` with DFS
 */
export interface EdgeExpandStep {
  kind: 'EdgeExpandStep';
  /** The source variable (node binding) to expand from. */
  source: string;
  /** The edge variable (binding) for the traversed relationship. */
  edgeVar?: string;
  /** The target variable (node binding) for the far end of the relationship. */
  target: string;
  /** Edge type(s) to match, or empty array for any type. */
  types: string[];
  /** Direction of traversal. */
  direction: 'out' | 'in';
  /** Minimum hops for variable-length; 1 for fixed patterns. */
  minHops: number;
  /** Maximum hops for variable-length; 1 for fixed, Infinity for unbounded. */
  maxHops: number;
  /**
   * Dispatch strategy — set by the Planner, read by the Executor.
   *
   * - `single-hop`   → direct edge lookup
   * - `multi-hop-bfs` → breadth-first traversal
   * - `multi-hop-dfs` → depth-first traversal
   */
  strategy: 'single-hop' | 'multi-hop-bfs' | 'multi-hop-dfs';
  /** Optional cap on result rows; when small, Planner may prefer DFS. */
  maxResults?: number;
}

/**
 * Filter rows using a boolean predicate expression.
 *
 * Operates in-process (no Graph API call).
 */
export interface FilterStep {
  kind: 'FilterStep';
  /** The boolean expression to evaluate against each row. */
  predicate: Expression;
}

/**
 * Select and optionally alias columns for the result set.
 *
 * Operates in-process (no Graph API call).
 */
export interface ProjectStep {
  kind: 'ProjectStep';
  /** The expressions to evaluate and their aliases. */
  columns: ProjectColumn[];
}

/**
 * A single column in a {@link ProjectStep}.
 */
export interface ProjectColumn {
  /** The expression to evaluate. */
  expression: Expression;
  /** The output alias for this column. */
  alias: string;
}

/**
 * Sort the row buffer by one or more expressions.
 *
 * Operates in-process (no Graph API call).
 */
export interface SortStep {
  kind: 'SortStep';
  /** Sort specifications, in order of precedence. */
  items: SortSpec[];
}

/**
 * A single sort specification.
 */
export interface SortSpec {
  /** The expression to sort by. */
  expression: Expression;
  /** Sort direction. */
  direction: 'ASC' | 'DESC';
}

/**
 * Apply SKIP and/or LIMIT to the row buffer.
 *
 * Operates in-process (no Graph API call).
 */
export interface LimitStep {
  kind: 'LimitStep';
  /** Number of rows to skip (0 if no SKIP clause). */
  skip: number;
  /** Maximum number of rows to return (Infinity if no LIMIT clause). */
  limit: number;
}

/**
 * Placeholder for future aggregation support.
 *
 * Currently gated by {@link CypherNotSupportedError} in {@link CypherEngine}.
 */
export interface AggregateStep {
  kind: 'AggregateStep';
  /** The aggregation function name (e.g. 'COUNT'). */
  function: string;
  /** The expression to aggregate. */
  expression: Expression;
  /** The output alias for the aggregated value. */
  alias: string;
}
