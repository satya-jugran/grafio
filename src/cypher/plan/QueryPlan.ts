/**
 * Query plan types for the Cypher execution layer.
 *
 * The {@link Planner} transforms a typed AST into an ordered list of
 * {@link PlanStep} objects — a physical execution plan that the
 * {@link Executor} walks at runtime.
 *
 * @module cypher/plan/QueryPlan
 */

import { Expression, PropertyMap } from '../ast/AstNode';

// ── Shared filter types ───────────────────────────────────────────

/**
 * A property-level filter that mirrors the storage layer's
 * {@link QueryOptionsFilterProperty} (including nested AND/OR).
 *
 * Used by {@link NodeScanStep.propertyFilters} to push predicates into
 * the storage layer, and by {@link NodeSeekStep} for direct lookups.
 */
export interface PropertyFilter {
  key?: string;
  value?: unknown;
  op?: '=' | '<>' | '>' | '<' | '>=' | '<=' | 'CONTAINS' | 'STARTS_WITH'
     | 'ENDS_WITH' | 'IN' | 'NOT_IN' | 'IS_NULL' | 'IS_NOT_NULL';
  AND?: PropertyFilter[];
  OR?:  PropertyFilter[];
}

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
  | NodeSeekStep
  | EdgeExpandStep
  | FilterStep
  | ProjectStep
  | SortStep
  | LimitStep
  | AggregateStep
  | CreateNodeStep
  | CreateEdgeStep
  | SetPropertyStep
  | DeleteEntityStep
  | RemovePropertyStep
  | CreateIndexStep
  | DropIndexStep
  | ShowIndexesStep;

// ── Individual step types ─────────────────────────────────────────

/**
 * Scan all nodes matching optional type and property filters.
 *
 * Maps to: `graph.getNodes({ filter: { types, properties } })`
 */
export interface NodeScanStep {
  kind: 'NodeScanStep';
  /** The label (node type) to scan. */
  label: string;
  /** Node type(s) to filter by — mirrors storage's types: string[]. */
  types?: string[];
  /** The variable name to bind each scanned node to. */
  variable: string;
  /**
   * Optional property filters pushed down from inline pattern
   * properties or single-variable WHERE predicates.
   */
  propertyFilters?: PropertyFilter[];
}

/**
 * Direct node lookup via id or indexed property.
 *
 * Maps to: `graph.getNode(id)` or `graph.getNodes({ filter })`.
 * Emitted by the Planner when a predicate enables an O(1) lookup
 * rather than a full scan.
 */
export interface NodeSeekStep {
  kind: 'NodeSeekStep';
  /** 'id' → graph.getNode(value); 'property' → graph.getNodes({filter}) */
  index: 'id' | 'property';
  value: unknown;
  key?: string;
  types?: string[];
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
   * Target node label(s) to match — set from the target node pattern's
   * labels (e.g. `(ch:Chapter)`).  The executor filters out expanded
   * nodes whose `labels` array does not intersect.
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
   * The entity type(s) being aggregated (e.g., ['Person', 'Employee']).
   * Set by the Planner from the NodeScanStep.types that binds sourceVariable.
   * Multiple types use OR semantics (matches the storage layer's includes check).
   */
  sourceTypes?: string[];
  /**
   * When true, the Planner cleared all prior steps and the Executor
   * should attempt the O(1) storage-level aggregation path.
   */
  useStorageLevel?: boolean;
   /**
   * The entity kind being aggregated: 'node' or 'edge'.
   * When 'node', sourceVariable/sourceTypes identify a NodeScanStep.
   * When 'edge', sourceVariable identifies the edge variable
   * from an EdgeExpandStep.
   */
  sourceEntity?: 'node' | 'edge';
  /**
   * Edge type filter for edge-level storage aggregation.
   * Set by the Planner from the EdgeExpandStep when sourceEntity is 'edge'.
   * When empty/undefined, aggregates across all edge types.
   */
  edgeTypes?: string[];
}

// ── Write steps ─────────────────────────────────────────────────────

/** Create a node and bind it to a variable. */
export interface CreateNodeStep {
  kind: 'CreateNodeStep';
  /** Variable name to bind the newly created node. */
  variable: string;
  /** Node type(s) — e.g. `['Person']` for `CREATE (n:Person)`. */
  labels: string[];
  /** Inline properties (with ParameterRef resolved to values). */
  properties: PropertyMap;
}

/** Create an edge and bind it to a variable. */
export interface CreateEdgeStep {
  kind: 'CreateEdgeStep';
  /** Edge variable name. */
  variable: string;
  /** Source node variable (must be bound in current row). */
  source: string;
  /** Target node variable (must be bound in current row). */
  target: string;
  /** Edge type(s). */
  types: string[];
  /** Inline properties. */
  properties: PropertyMap;
}

/** Set one or more properties on a matched or created entity. */
export interface SetPropertyStep {
  kind: 'SetPropertyStep';
  /** The variable name of the entity being modified. */
  variable: string;
  /** Which kind of entity. */
  entityKind: 'node' | 'edge';
  /** Property assignments. */
  assignments: Array<{ key: string; value: Expression }>;
}

/** Delete a matched entity (node or edge). */
export interface DeleteEntityStep {
  kind: 'DeleteEntityStep';
  /** The variable name of the entity to delete. */
  variable: string;
  /** Whether this is a node or edge. */
  entityKind: 'node' | 'edge';
  /** If true, cascade-delete incident edges (DETACH DELETE). */
  detach: boolean;
}

/** Remove a property from a matched entity. */
export interface RemovePropertyStep {
  kind: 'RemovePropertyStep';
  /** The variable name of the entity. */
  variable: string;
  /** Which kind of entity. */
  entityKind: 'node' | 'edge';
  /** Property key to remove. */
  property: string;
}

// ── Index DDL steps ────────────────────────────────────────────────

/** Create a property index on nodes or edges. */
export interface CreateIndexStep {
  kind: 'CreateIndexStep';
  /** Index name — passed directly to graph.createIndex(). */
  name: string;
  /** Entity target: 'node' or 'edge'. */
  target: 'node' | 'edge';
  /** Property keys to index (single or compound). */
  propertyKeys: string[];
}

/** Drop a property index by name. */
export interface DropIndexStep {
  kind: 'DropIndexStep';
  /** Index name — passed directly to graph.deleteIndex(). */
  name: string;
}

/** List all indexes in the graph. */
export interface ShowIndexesStep {
  kind: 'ShowIndexesStep';
  /** Output aliases for projected columns. */
  columns: { alias: string; source: 'name' | 'target' | 'propertyKeys' }[];
}

// ── Execution statistics ─────────────────────────────────────────

/**
 * Execution statistics for a single plan step.
 * Collected at runtime when the {@link Executor} walks the plan.
 */
export interface PlanStepExecutionStats {
  /** The step kind (e.g., 'NodeScanStep', 'EdgeExpandStep'). */
  stepKind: string;
  /** Time spent in this step in milliseconds. */
  timeMs: number;
  /** Percentage of total query time spent in this step (0-100). */
  percentageOfTotal: number;
  /** Number of rows produced by this step. */
  rowsOut: number;
}

/**
 * Complete execution statistics for a query plan.
 * Includes per-step timing and overall query timing.
 */
export interface PlanExecutionStats {
  /** Total execution time in milliseconds. */
  totalTimeMs: number;
  /** Per-step execution statistics in plan order. */
  steps: PlanStepExecutionStats[];
}
