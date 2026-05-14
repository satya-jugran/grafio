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
 * Maps to: `graph.getNodes({ filter: { types: [label] } })`
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
  /** Reserved for future DFS optimisation: optional cap on result rows. */
  maxResults?: number;
  /**
   * Named path variable — set when this expansion is part of a named path
   * (`MATCH p = (a)-[:REL]->(b)`). The executor binds this variable to the
   * reconstructed path value (array of alternating nodes and edges).
   */
  pathVar?: string;
  /**
   * Target node type(s) to match — set from the target node pattern's
   * labels (e.g. `(ch:Chapter)`).  The executor filters out expanded
   * nodes whose `type` field does not match.
   */
  targetTypes?: string[];
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
  /** Whether DISTINCT was specified in the RETURN clause. */
  distinct: boolean;
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
 * Expressions are evaluated at runtime so that `SKIP $offset` and
 * `LIMIT $pageSize` work with parameterised queries.
 *
 * Operates in-process (no Graph API call).
 */
export interface LimitStep {
  kind: 'LimitStep';
  /** Expression evaluating to rows to skip (undefined if no SKIP clause). */
  skipExpr?: Expression;
  /** Expression evaluating to max rows (undefined if no LIMIT clause). */
  limitExpr?: Expression;
}

/**
 * A single aggregate function specification within an {@link AggregateStep}.
 */
export interface AggregateSpec {
  /** The aggregate function name. */
  function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COLLECT';
  /** The expression to aggregate. */
  expression: Expression;
  /** Whether DISTINCT was specified (e.g. `COUNT(DISTINCT p.city)`). */
  distinct: boolean;
  /** The output alias for the aggregated value. */
  alias: string;
}

/**
 * Execute one or more aggregate functions, with optional grouping.
 *
 * The {@link Planner} determines whether to emit a simple plan (direct
 * storage call) or a complex plan (full pipeline + in-process aggregation)
 * based on whether joins precede this step.
 */
export interface AggregateStep {
  kind: 'AggregateStep';
  /** Aggregate function specifications. */
  aggregates: AggregateSpec[];
  /** Group-by expressions (non-aggregated RETURN items). */
  groupBy: Expression[];
  /**
   * Output aliases for the group-by columns, in the same order as
   * {@link groupBy}.  These match the RETURN item aliases (explicit
   * `AS` name or auto-derived) so the {@link Executor} stores
   * group-by values under the same keys that {@link ProjectStep}
   * later looks up.
   */
  groupByAliases: string[];
  /**
   * The entity variable being aggregated over (e.g., 'p' in COUNT(p)).
   * Set by the Planner when the aggregate expression is a simple
   * identifier or property access on a single variable.
   */
  sourceVariable?: string;
  /**
   * The entity type (label) being aggregated (e.g., 'Person').
   * Set by the Planner from the NodeScanStep that binds sourceVariable.
   */
  sourceType?: string;
  /**
   * When true, the Planner cleared all prior steps and the Executor
   * should attempt the O(1) storage-level aggregation path.
   */
  useStorageLevel?: boolean;
}
