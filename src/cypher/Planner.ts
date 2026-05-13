/**
 * Query planner for the Cypher execution layer.
 *
 * Transforms a semantically-validated AST ({@link QueryAst}) into a physical
 * execution plan ({@link QueryPlan}) — an ordered list of {@link PlanStep}
 * objects that the {@link Executor} walks at runtime.
 *
 * ### Planning heuristics
 *
 * 1. **Push filters early** — {@link FilterStep} is inserted immediately after
 *    the scan/expand sequence, before projection and sorting.
 * 2. **Edge expansion strategy selection** — The Planner sets
 *    {@link EdgeExpandStep.strategy} based on the pattern's hop range
 *    and whether a LIMIT clause is present:
 *    - Single-hop (`minHops === 1 && maxHops === 1`) → `'single-hop'`
 *    - Multi-hop without LIMIT → `'multi-hop-bfs'`
 *    - Multi-hop with LIMIT → `'multi-hop-dfs'`
 *      (DFS finds the first N results with lower memory: O(depth) vs O(breadth^depth))
 *
 * @module cypher/Planner
 */

import {
  QueryAst,
  PatternPath,
  PatternSegment,
  NodePattern,
  EdgePattern,
  Expression,
  IdentifierExpr,
  PropertyAccessExpr,
  PropertyMap,
  ParameterRef,
  FunctionCallExpr,
} from './ast/AstNode';
import {
  QueryPlan,
  PlanStep,
  NodeScanStep,
  EdgeExpandStep,
  FilterStep,
  ProjectStep,
  ProjectColumn,
  SortStep,
  SortSpec,
  LimitStep,
  AggregateStep,
  AggregateSpec,
} from './plan/QueryPlan';

// ── Planner ───────────────────────────────────────────────────────

/**
 * Converts a typed AST into a physical execution plan.
 *
 * Usage:
 * ```typescript
 * const plan = new Planner().plan(typedAst);
 * ```
 */
export class Planner {
  /** Set when the current query contains aggregate functions. */
  private _hasAggregates = false;

  /**
   * Translate a typed AST into a {@link QueryPlan}.
   *
   * @param ast - The semantically-validated query AST.
   * @returns A physical execution plan ready for the {@link Executor}.
   */
  public plan(ast: QueryAst): QueryPlan {
    const steps: PlanStep[] = [];

    // ── 1. Pattern expansion (MATCH) ──────────────────────────────
    this._planPatterns(ast, steps);

    // ── 2. Filter (WHERE) — push early, after scans ───────────────
    if (ast.where) {
      steps.push({
        kind: 'FilterStep',
        predicate: ast.where.expression,
      });
    }

    // ── 3. Sorting (ORDER BY) — must happen before projection
    //        so that sort expressions can reference original variables. ─
    if (ast.orderBy) {
      steps.push(this._planSort(ast));
    }

    // ── 4. Pagination (SKIP / LIMIT) — before projection ──────────
    if (ast.skip || ast.limit) {
      steps.push(this._planLimit(ast));
    }

    // ── 5. Aggregate detection & projection (RETURN) ─────────────
    const hasAggregates = ast.return.items.some((item) =>
      this._hasAggregateFunction(item.expression),
    );

    this._hasAggregates = hasAggregates;

    if (hasAggregates) {
      this._planAggregation(ast, steps);
    }

    // Projection — last, since it strips variables ────────────────
    steps.push(this._planProjection(ast));

    return { steps };
  }

  // ── Pattern planning ────────────────────────────────────────────

  /**
   * Convert MATCH patterns into scan + expand steps.
   *
   * Each {@link PatternPath} becomes:
   * 1. A {@link NodeScanStep} for the first node.
   * 2. An alternating sequence of {@link EdgeExpandStep} + {@link NodeScanStep}
   *    for each subsequent segment.
   *
   * Multiple pattern paths (comma-separated in MATCH) produce separate
   * scan/expand chains appended in order.
   */
  private _planPatterns(ast: QueryAst, steps: PlanStep[]): void {
    for (const path of ast.match.patterns) {
      this._planPatternPath(path, steps, ast);
    }
  }

  /**
   * Convert a single pattern path into plan steps.
   */
  private _planPatternPath(path: PatternPath, steps: PlanStep[], ast: QueryAst): void {
    const segments = path.segments;
    if (segments.length === 0) return;

    // The first segment is always a NodePattern.
    const firstNode = segments[0] as NodePattern;
    this._planNodeScan(firstNode, steps);

    // Walk alternating edge → node pairs.
    for (let i = 1; i < segments.length; i += 2) {
      const edge = segments[i] as EdgePattern;
      const targetNode = segments[i + 1] as NodePattern;
      this._planEdgeExpand(edge, targetNode, steps, ast);
    }
  }

  /**
   * Create a {@link NodeScanStep} from a {@link NodePattern}.
   *
   * - If the node has a label, scan by type.
   * - If the node is anonymous (no variable AND no label), we still need a
   *   variable for the executor; a synthetic variable name is generated.
   * - Anonymous nodes with labels (e.g. `(:Person)`) are scanned but
   *   assigned a synthetic variable.
   */
  private _planNodeScan(node: NodePattern, steps: PlanStep[]): void {
    // Determine the label to scan.
    const label = node.labels.length > 0 ? node.labels[0] : '';

    // Determine the variable name.
    const variable =
      node.variable ?? this._syntheticVar('node', steps.length);

    steps.push({
      kind: 'NodeScanStep',
      label,
      variable,
    });

    // Emit FilterStep for inline properties on the node pattern.
    // e.g. (s:Student {year: 2024}) → WHERE s.year = 2024
    if (node.properties && Object.keys(node.properties).length > 0) {
      const filters = this._propertyMapToFilters(variable, node.properties);
      steps.push(...filters);
    }
  }

  /**
   * Create an {@link EdgeExpandStep} from an {@link EdgePattern} and the
   * target {@link NodePattern}.
   *
   * The source variable is inferred from the most recently scanned node.
   */
  private _planEdgeExpand(
    edge: EdgePattern,
    targetNode: NodePattern,
    steps: PlanStep[],
    ast: QueryAst,
  ): void {
    // Find the source variable: it's the variable of the most recent
    // NodeScanStep or the target of the most recent EdgeExpandStep.
    const source = this._findLastNodeVar(steps);

    const target =
      targetNode.variable ?? this._syntheticVar('target', steps.length);

    // Determine the expansion strategy.
    const isMultiHop = edge.minHops !== 1 || edge.maxHops !== 1;
    let strategy: EdgeExpandStep['strategy'] = 'single-hop';

    if (isMultiHop) {
      // Use DFS when a LIMIT is present: depth-first finds the first N
      // results with lower memory (O(depth) vs O(breadth^depth) for BFS).
      strategy = ast.limit ? 'multi-hop-dfs' : 'multi-hop-bfs';
    }

    // If the edge has inline properties but no variable, generate a
    // synthetic variable so the executor binds the edge and filters work.
    const hasEdgeProps = edge.properties && Object.keys(edge.properties).length > 0;
    const edgeVar = edge.variable ??
      (hasEdgeProps ? this._syntheticVar('edge', steps.length) : undefined);

    steps.push({
      kind: 'EdgeExpandStep',
      source,
      edgeVar,
      target,
      types: edge.types,
      direction: edge.direction,
      minHops: edge.minHops,
      maxHops: edge.maxHops,
      strategy,
    });

    // Emit FilterStep for inline properties on the edge pattern.
    if (hasEdgeProps && edgeVar) {
      const filters = this._propertyMapToFilters(edgeVar, edge.properties);
      steps.push(...filters);
    }

    // Emit FilterStep for inline properties on the target node pattern.
    if (targetNode.properties && Object.keys(targetNode.properties).length > 0) {
      const filters = this._propertyMapToFilters(target, targetNode.properties);
      steps.push(...filters);
    }
  }

  // ── Projection ──────────────────────────────────────────────────

  /**
   * Convert RETURN items into a {@link ProjectStep}.
   *
   * When aggregates are present in the query, the expressions are
   * replaced with {@link IdentifierExpr} references that match the
   * aliases produced by the {@link AggregateStep}. This avoids
   * evaluating {@link FunctionCallExpr} nodes (which the generic
   * expression evaluator cannot handle) and correctly resolves
   * group-by keys from the post-aggregation row.
   */
  private _planProjection(ast: QueryAst): ProjectStep {
    const columns: ProjectColumn[] = ast.return.items.map((item) => {
      const alias = item.alias ?? this._deriveAlias(item.expression);

      if (this._hasAggregates) {
        // After AggregateStep, the row only contains aggregate and
        // group-by aliases. Emit an Identifier that matches the
        // stored key so the Executor can resolve it via normal
        // variable lookup.
        return {
          expression: { kind: 'Identifier' as const, name: alias },
          alias,
        };
      }

      return {
        expression: item.expression,
        alias,
      };
    });

    return { kind: 'ProjectStep', columns, distinct: ast.return.distinct };
  }

  // ── Sorting ─────────────────────────────────────────────────────

  /**
   * Convert ORDER BY into a {@link SortStep}.
   */
  private _planSort(ast: QueryAst): SortStep {
    const items: SortSpec[] = ast.orderBy!.items.map((item) => ({
      expression: item.expression,
      direction: item.direction,
    }));

    return { kind: 'SortStep', items };
  }

  // ── Pagination ──────────────────────────────────────────────────

  /**
   * Convert SKIP / LIMIT into a {@link LimitStep}.
   */
  private _planLimit(ast: QueryAst): LimitStep {
    return {
      kind: 'LimitStep',
      skipExpr: ast.skip?.expression,
      limitExpr: ast.limit?.expression,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /**
   * Convert a {@link PropertyMap} into an array of {@link FilterStep}
   * objects, one per property key-value pair.
   *
   * Each property becomes a {@link BinaryExpr} with `=` comparing the
   * property access against the literal/parameter value.
   *
   * @param variable - The bound variable name (e.g. `s` for `(s:Student)`).
   * @param properties - The inline property map from the AST.
   */
  private _propertyMapToFilters(
    variable: string,
    properties: PropertyMap,
  ): FilterStep[] {
    const steps: FilterStep[] = [];

    for (const [key, value] of Object.entries(properties)) {
      // Determine the right-hand side expression.
      const rhs: Expression =
        typeof value === 'object' && value !== null && 'kind' in value
          ? (value as Expression)              // ParameterRef or other Expression
          : { kind: 'Literal', value: value as string | number | boolean | null };

      steps.push({
        kind: 'FilterStep',
        predicate: {
          kind: 'Binary',
          op: '=',
          left: {
            kind: 'PropertyAccess',
            object: { kind: 'Identifier', name: variable },
            property: key,
          },
          right: rhs,
        },
      });
    }

    return steps;
  }

  /**
   * Find the variable of the most recently scanned or expanded-to node.
   */
  private _findLastNodeVar(steps: PlanStep[]): string {
    // Walk backwards through steps to find the last NodeScanStep or
    // EdgeExpandStep (whose target is the node we expand from).
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.kind === 'NodeScanStep') {
        return step.variable;
      }
      if (step.kind === 'EdgeExpandStep') {
        return step.target;
      }
    }
    // Should never happen if the pattern starts with a node.
    return '__root__';
  }

  /**
   * Generate a synthetic variable name for anonymous pattern elements.
   */
  private _syntheticVar(prefix: string, index: number): string {
    return `__${prefix}_${index}`;
  }

  /**
   * Derive a human-readable alias from an expression.
   *
   * Used when the user omits `AS alias` in a RETURN item.
   */
  private _deriveAlias(expr: Expression): string {
    switch (expr.kind) {
      case 'Identifier':
        return expr.name;
      case 'PropertyAccess':
        return `${this._deriveAlias(expr.object)}_${expr.property}`;
      case 'Literal':
        return String(expr.value);
      case 'Parameter':
        return expr.name;
      case 'FunctionCall':
        return expr.name.toLowerCase();
      default:
        return `expr`;
    }
  }

  // ── Aggregate planning ───────────────────────────────────────────

  /** Set of aggregate function names recognised by the planner. */
  private static readonly AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set([
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COLLECT',
  ]);

  /**
   * Recursively walk an expression tree to determine whether it contains
   * any aggregate function call ({@link FunctionCallExpr}).
   *
   * @returns `true` if the expression or any sub-expression is an
   *          aggregate function call.
   */
  private _hasAggregateFunction(expr: Expression): boolean {
    if (
      expr.kind === 'FunctionCall' &&
      Planner.AGGREGATE_FUNCTIONS.has(expr.name)
    ) {
      return true;
    }

    // Recurse into child expressions.
    switch (expr.kind) {
      case 'Binary':
        return (
          this._hasAggregateFunction(expr.left) ||
          this._hasAggregateFunction(expr.right)
        );
      case 'Unary':
        return this._hasAggregateFunction(expr.operand);
      case 'PropertyAccess':
        return this._hasAggregateFunction(expr.object);
      case 'In':
        return (
          this._hasAggregateFunction(expr.expression) ||
          this._hasAggregateFunction(expr.list)
        );
      case 'IsNull':
        return this._hasAggregateFunction(expr.expression);
      case 'FunctionCall':
        return expr.args.some((arg) => this._hasAggregateFunction(arg));
      case 'List':
        return expr.elements.some((el) => this._hasAggregateFunction(el));
      default:
        return false;
    }
  }

  /**
   * Extract the innermost {@link FunctionCallExpr} with an aggregate name
   * from an expression tree.
   *
   * For a simple aggregate like `COUNT(p)` this returns the
   * `FunctionCallExpr` itself.  For a wrapped expression like
   * `COUNT(p) + 1` it recurses into the binary operands.
   *
   * @returns The aggregate `FunctionCallExpr`, or `null` if none found.
   */
  private _extractAggregateFunctionCall(
    expr: Expression,
  ): FunctionCallExpr | null {
    if (
      expr.kind === 'FunctionCall' &&
      Planner.AGGREGATE_FUNCTIONS.has(expr.name)
    ) {
      return expr;
    }

    switch (expr.kind) {
      case 'Binary':
        return (
          this._extractAggregateFunctionCall(expr.left) ??
          this._extractAggregateFunctionCall(expr.right)
        );
      case 'Unary':
        return this._extractAggregateFunctionCall(expr.operand);
      case 'PropertyAccess':
        return this._extractAggregateFunctionCall(expr.object);
      case 'FunctionCall':
        for (const arg of expr.args) {
          const found = this._extractAggregateFunctionCall(arg);
          if (found) return found;
        }
        return null;
      default:
        return null;
    }
  }

  /**
   * Extract the root variable name from an aggregate argument expression.
   *
   * - `p`        → `'p'`
   * - `p.age`    → `'p'`
   * - `*`        → `null`  (COUNT(*) has no variable)
   * - anything   → `null`
   */
  private _extractVariableName(expr: Expression): string | null {
    // COUNT(*) sentinel — no variable reference.
    if (expr.kind === 'Literal' && expr.value === '*') {
      return null;
    }

    if (expr.kind === 'Identifier') {
      return expr.name;
    }

    if (expr.kind === 'PropertyAccess') {
      return this._extractVariableName(expr.object);
    }

    return null;
  }

  /**
   * Determine whether the current plan is "simple" — i.e. it consists of
   * a single {@link NodeScanStep} with no {@link EdgeExpandStep} and no
   * {@code WHERE} clause.
   *
   * Simple plans allow the {@link Executor} to use storage-level
   * aggregation (e.g. {@code getNodeCount}) instead of materialising
   * every row.
   */
  private _isSimplePlan(steps: PlanStep[], ast: QueryAst): boolean {
    if (ast.where) return false;

    let nodeScanCount = 0;
    for (const step of steps) {
      if (step.kind === 'EdgeExpandStep') return false;
      if (step.kind === 'NodeScanStep') nodeScanCount++;
    }

    return nodeScanCount === 1;
  }

  /**
   * Build and insert an {@link AggregateStep} into the plan, handling
   * both simple (storage-level) and complex (in-process) aggregation
   * shapes.
   *
   * ### Plan shape decision
   *
   * - **Simple plan** ({@link _isSimplePlan} returns `true` AND the
   *   aggregates reference a single variable with a known type): the
   *   existing steps are cleared and replaced with
   *   `AggregateStep → ProjectStep`.
   *
   * - **Complex plan**: the `AggregateStep` is inserted before the
   *   `ProjectStep`, keeping the full pipeline
   *   (`NodeScanStep → … → AggregateStep → ProjectStep`).
   */
  private _planAggregation(ast: QueryAst, steps: PlanStep[]): void {
    // ── Split RETURN items ───────────────────────────────────────
    const aggItems = ast.return.items.filter((item) =>
      this._hasAggregateFunction(item.expression),
    );
    const groupByItems = ast.return.items.filter(
      (item) => !this._hasAggregateFunction(item.expression),
    );

    // ── Build AggregateSpec array ─────────────────────────────────
    const aggregates: AggregateSpec[] = aggItems.map((item) => {
      const fnCall = this._extractAggregateFunctionCall(item.expression)!;

      // For COUNT(*), the Parser produces args: [{ kind: 'Literal', value: '*' }].
      // For regular aggregates, use the first argument expression.
      const aggExpr: Expression =
        fnCall.args.length > 0
          ? fnCall.args[0]
          : { kind: 'Literal', value: null };

      return {
        function: fnCall.name as AggregateSpec['function'],
        expression: aggExpr,
        distinct: (fnCall as any).distinct === true,
        alias: item.alias ?? this._deriveAlias(item.expression),
      };
    });

    // ── Build groupBy expressions ─────────────────────────────────
    const groupBy: Expression[] = groupByItems.map((item) => item.expression);

    // ── Determine sourceVariable ──────────────────────────────────
    let sourceVariable: string | undefined;
    const vars = new Set<string>();
    for (const agg of aggregates) {
      const v = this._extractVariableName(agg.expression);
      if (v) vars.add(v);
    }
    if (vars.size === 1) {
      sourceVariable = [...vars][0];
    }

    // ── Plan shape decision ───────────────────────────────────────
    let sourceType: string | undefined;
    const isSimple =
      this._isSimplePlan(steps, ast) &&
      sourceVariable !== undefined &&
      groupBy.length === 0;

    if (isSimple) {
      // Extract sourceType from the NodeScanStep that binds sourceVariable.
      for (const step of steps) {
        if (
          step.kind === 'NodeScanStep' &&
          step.variable === sourceVariable
        ) {
          sourceType = step.label || undefined;
          break;
        }
      }

      // Simple plan: replace all steps with AggregateStep → ProjectStep.
      steps.length = 0;
    }

    // ── Emit AggregateStep ────────────────────────────────────────
    steps.push({
      kind: 'AggregateStep',
      aggregates,
      groupBy,
      sourceVariable,
      sourceType,
    });
  }
}
