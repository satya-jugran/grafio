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
 *    {@link EdgeExpandStep.strategy} based on the pattern's hop range:
 *    - Single-hop → `'single-hop'`
 *    - Multi-hop (default) → `'multi-hop-bfs'`
 *    - Multi-hop with small result cap → `'multi-hop-dfs'`
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

    // ── 5. Projection (RETURN) — last, since it strips variables ──
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
      this._planPatternPath(path, steps);
    }
  }

  /**
   * Convert a single pattern path into plan steps.
   */
  private _planPatternPath(path: PatternPath, steps: PlanStep[]): void {
    const segments = path.segments;
    if (segments.length === 0) return;

    // The first segment is always a NodePattern.
    const firstNode = segments[0] as NodePattern;
    this._planNodeScan(firstNode, steps);

    // Walk alternating edge → node pairs.
    for (let i = 1; i < segments.length; i += 2) {
      const edge = segments[i] as EdgePattern;
      const targetNode = segments[i + 1] as NodePattern;
      this._planEdgeExpand(edge, targetNode, steps);
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
      // Default to BFS for multi-hop.
      strategy = 'multi-hop-bfs';
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
   */
  private _planProjection(ast: QueryAst): ProjectStep {
    const columns: ProjectColumn[] = ast.return.items.map((item) => ({
      expression: item.expression,
      alias: item.alias ?? this._deriveAlias(item.expression),
    }));

    return { kind: 'ProjectStep', columns };
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
    let skip = 0;
    let limit = Infinity;

    if (ast.skip) {
      skip = this._evalConstInt(ast.skip.expression);
    }
    if (ast.limit) {
      limit = this._evalConstInt(ast.limit.expression);
    }

    return { kind: 'LimitStep', skip, limit };
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
   * Try to evaluate an expression to a constant integer at plan time.
   *
   * Only literal integers, float→int conversion, and $param references
   * are evaluated. Anything else returns 0 (the executor will resolve
   * parameters at runtime through the LimitStep interface).
   */
  private _evalConstInt(expr: Expression): number {
    if (expr.kind === 'Literal') {
      if (typeof expr.value === 'number') {
        return Math.floor(expr.value);
      }
      return 0;
    }
    if (expr.kind === 'Parameter') {
      // Parameters are resolved at runtime; return 0 as a safe default.
      // The Executor will override these when params are available.
      return 0;
    }
    // For other expression types, return 0 and let the executor handle
    // runtime evaluation.
    return 0;
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
}
