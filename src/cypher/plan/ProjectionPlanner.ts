/**
 * Projection, sorting, pagination, and aggregation planning for the
 * Cypher query planner.
 *
 * @module cypher/plan/ProjectionPlanner
 */

import {
  QueryAst,
  Expression,
  FunctionCallExpr,
  ReturnItem,
} from '../ast/AstNode';
import {
  PlanStep,
  ProjectStep,
  ProjectColumn,
  SortStep,
  SortSpec,
  LimitStep,
  AggregateStep,
  AggregateSpec,
  FilterStep,
  NodeScanStep,
  EdgeExpandStep,
} from './QueryPlan';
import { CypherSemanticError } from '../errors';

// ── ProjectionPlanner ──────────────────────────────────────────────

export class ProjectionPlanner {
  /** Counter for generating unique internal aggregate aliases. */
  private _aggCounter = 0;

  /** Rewritten projection expressions for aggregate queries. */
  private _rewrittenProjections?: Map<ReturnItem, Expression>;

  // ── Projection ──────────────────────────────────────────────────

  /**
   * Convert RETURN items into a {@link ProjectStep}.
   */
  planProjection(ast: QueryAst, hasAggregates: boolean): ProjectStep {
    const columns: ProjectColumn[] = ast.return.items.map((item) => {
      const alias = item.alias ?? this._deriveAlias(item.expression);

      if (hasAggregates) {
        const rewritten = this._rewrittenProjections?.get(item);
        return {
          expression: rewritten ?? { kind: 'Identifier' as const, name: alias },
          alias,
        };
      }

      return { expression: item.expression, alias };
    });

    return { kind: 'ProjectStep', columns, distinct: ast.return.distinct };
  }

  // ── Sorting ─────────────────────────────────────────────────────

  planSort(ast: QueryAst, isPostProjection: boolean = false): SortStep {
    const hasAggs = this.hasAggregates(ast);
    const returnAliases = new Map<string, Expression>();
    
    if (!hasAggs && !isPostProjection && ast.return) {
      for (const item of ast.return.items) {
        if (item.alias) {
          returnAliases.set(item.alias, item.expression);
        }
      }
    }

    const rewrite = (e: Expression): Expression => {
      if (hasAggs || isPostProjection) return e;
      if (e.kind === 'Identifier' && returnAliases.has(e.name)) {
        return returnAliases.get(e.name)!;
      }
      switch (e.kind) {
        case 'Binary': return { ...e, left: rewrite(e.left), right: rewrite(e.right) };
        case 'Unary': return { ...e, operand: rewrite(e.operand) };
        case 'FunctionCall': return { ...e, args: e.args.map(rewrite) };
        case 'PropertyAccess': return { ...e, object: rewrite(e.object) };
        case 'In': return { ...e, expression: rewrite(e.expression), list: rewrite(e.list) };
        case 'IsNull': return { ...e, expression: rewrite(e.expression) };
        case 'List': return { ...e, elements: e.elements.map(rewrite) };
        case 'Case': return { 
          ...e, 
          expression: e.expression ? rewrite(e.expression) : undefined,
          branches: e.branches.map(b => ({ when: rewrite(b.when), then: rewrite(b.then) })),
          else: e.else ? rewrite(e.else) : undefined 
        };
        default: return e;
      }
    };

    const items: SortSpec[] = ast.orderBy!.items.map((item) => ({
      expression: rewrite(item.expression),
      direction: item.direction,
    }));
    return { kind: 'SortStep', items };
  }

  // ── Pagination ──────────────────────────────────────────────────

  planLimit(ast: QueryAst): LimitStep {
    return {
      kind: 'LimitStep',
      skipExpr: ast.skip?.expression,
      limitExpr: ast.limit?.expression,
    };
  }

  // ── Aggregate detection ─────────────────────────────────────────

  /** Recognised aggregate function names. */
  static readonly AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set([
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COLLECT',
  ]);

  /**
   * Returns `true` if any RETURN item contains an aggregate function.
   */
  hasAggregates(ast: QueryAst): boolean {
    return ast.return.items.some((item) =>
      this._hasAggregateFunction(item.expression),
    );
  }

  private _hasAggregateFunction(expr: Expression): boolean {
    if (
      expr.kind === 'FunctionCall' &&
      ProjectionPlanner.AGGREGATE_FUNCTIONS.has(expr.name)
    ) {
      return true;
    }

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
      case 'ListComprehension':
        return this._hasAggregateFunction(expr.list) ||
          (expr.where ? this._hasAggregateFunction(expr.where) : false) ||
          (expr.projection ? this._hasAggregateFunction(expr.projection) : false);
      default:
        return false;
    }
  }

  // ── Aggregate planning ──────────────────────────────────────────

  /**
   * Build and insert an {@link AggregateStep} into the plan.
   */
  planAggregation(ast: QueryAst, steps: PlanStep[]): void {
    this._aggCounter = 0;

    const allAggregates: AggregateSpec[] = [];
    const groupBy: Expression[] = [];
    const groupByAliases: string[] = [];
    const rewrittenProjections = new Map<ReturnItem, Expression>();

    for (const item of ast.return.items) {
      if (!this._hasAggregateFunction(item.expression)) {
        groupBy.push(item.expression);
        const alias = item.alias ?? this._deriveAlias(item.expression);
        groupByAliases.push(alias);
        rewrittenProjections.set(item, { kind: 'Identifier', name: alias });
      } else {
        const fnCall = this._extractAggregateFunctionCall(item.expression);

        if (fnCall && this._isSimpleAggregateItem(item.expression)) {
          const aggExpr: Expression =
            fnCall.args.length > 0
              ? fnCall.args[0]
              : { kind: 'Literal', value: null };
          const alias = item.alias ?? this._deriveAlias(item.expression);
          allAggregates.push({
            function: fnCall.name as AggregateSpec['function'],
            expression: aggExpr,
            distinct: fnCall.distinct === true,
            alias,
          });
          rewrittenProjections.set(item, { kind: 'Identifier', name: alias });
        } else {
          const { rewritten, extracted } = this._extractAndRewriteAggregates(
            item.expression,
            item.alias ?? this._deriveAlias(item.expression),
          );
          allAggregates.push(...extracted);
          rewrittenProjections.set(item, rewritten);
        }
      }
    }

    this._rewrittenProjections = rewrittenProjections;

    // ── Determine sourceVariable and sourceEntity ──────────────────
    let sourceVariable: string | undefined;
    let sourceEntity: 'node' | 'edge' | undefined;
    const vars = new Set<string>();
    for (const agg of allAggregates) {
      const v = this._extractVariableName(agg.expression);
      if (v) vars.add(v);
    }
    if (vars.size === 1) {
      sourceVariable = [...vars][0];
    }

    // ── Plan shape decision ───────────────────────────────────────
    let sourceTypes: string[] | undefined;

    // Try simple node plan first
    let isSimple =
      this._isSimplePlan(steps, ast) &&
      sourceVariable !== undefined &&
      groupBy.length === 0;

    if (isSimple) {
      for (const step of steps) {
        if (
          step.kind === 'NodeScanStep' &&
          step.variable === sourceVariable
        ) {
          sourceTypes = step.types && step.types.length > 0
            ? step.types
            : undefined;
          break;
        }
      }
      sourceEntity = 'node';
      steps.length = 0;
    }

    // Fall back: try simple edge plan (new)
    let edgeTypes: string[] | undefined;
    if (!isSimple && sourceVariable !== undefined && groupBy.length === 0) {
      isSimple = this._isEdgeSimplePlan(steps, ast);

      if (isSimple) {
        // Verify all aggregates reference the edge variable (not a node)
        const edgeVar = sourceVariable;
        const edgeExpand = steps.find(
          (s) => s.kind === 'EdgeExpandStep' && s.edgeVar === edgeVar,
        ) as import('./QueryPlan').EdgeExpandStep | undefined;
        if (edgeExpand) {
          // Source type not applicable for edges — use types array
          sourceTypes = undefined;
          sourceEntity = 'edge';
          // Capture edge type(s) from the EdgeExpandStep so the executor
          // can filter storage-level calls (getEdgeCount / aggregateEdgeProperty).
          edgeTypes = edgeExpand.types.length > 0 ? edgeExpand.types : undefined;
          steps.length = 0;
        }
      }
    }

    steps.push({
      kind: 'AggregateStep',
      aggregates: allAggregates,
      groupBy,
      groupByAliases,
      sourceVariable,
      sourceTypes,
      useStorageLevel: isSimple,
      sourceEntity,                // <-- NEW
      edgeTypes,                   // <-- NEW: edge type filter for Path C
    });

  }

  /**
   * Rewrite ORDER BY expressions that contain aggregate
   * FunctionCalls, extracting them into AggregateSpec entries.
   */
  extractAndRewriteAggregates(
    expr: Expression,
  ): { rewritten: Expression; extracted: AggregateSpec[] } {
    return this._extractAndRewriteAggregates(expr, '');
  }

  /**
   * Returns the rewritten projection map (set by {@link planAggregation}).
   */
  get rewrittenProjections(): Map<ReturnItem, Expression> | undefined {
    return this._rewrittenProjections;
  }

  // ── Aggregate helpers ───────────────────────────────────────────

  private _extractAggregateFunctionCall(
    expr: Expression,
  ): FunctionCallExpr | null {
    if (
      expr.kind === 'FunctionCall' &&
      ProjectionPlanner.AGGREGATE_FUNCTIONS.has(expr.name)
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
      case 'ListComprehension':
        return (
          this._extractAggregateFunctionCall(expr.list) ??
          (expr.where ? this._extractAggregateFunctionCall(expr.where) : null) ??
          (expr.projection ? this._extractAggregateFunctionCall(expr.projection) : null)
        );
      default:
        return null;
    }
  }

  private _extractVariableName(expr: Expression): string | null {
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

  private _isSimpleAggregateItem(expr: Expression): boolean {
    return (
      expr.kind === 'FunctionCall' &&
      ProjectionPlanner.AGGREGATE_FUNCTIONS.has(expr.name)
    );
  }

  private _isAggregateFn(name: string): boolean {
    return ProjectionPlanner.AGGREGATE_FUNCTIONS.has(name);
  }

  private _generateAggAlias(): string {
    return `__agg_${this._aggCounter++}`;
  }

  private _extractAndRewriteAggregates(
    expr: Expression,
    _fallbackAlias: string,
  ): { rewritten: Expression; extracted: AggregateSpec[] } {
    const extracted: AggregateSpec[] = [];

    const rewrite = (e: Expression): Expression => {
      switch (e.kind) {
        case 'FunctionCall': {
          if (this._isAggregateFn(e.name)) {
            const internalAlias = this._generateAggAlias();
            const aggExpr: Expression =
              e.args.length > 0
                ? e.args[0]
                : { kind: 'Literal', value: null };
            extracted.push({
              function: e.name as AggregateSpec['function'],
              expression: aggExpr,
              distinct: e.distinct === true,
              alias: internalAlias,
            });
            return { kind: 'Identifier', name: internalAlias };
          }
          return e;
        }
        case 'Binary':
          return { ...e, left: rewrite(e.left), right: rewrite(e.right) };
        case 'Unary':
          return { ...e, operand: rewrite(e.operand) };
        case 'PropertyAccess':
          return { ...e, object: rewrite(e.object) };
        case 'In':
          return {
            ...e,
            expression: rewrite(e.expression),
            list: rewrite(e.list),
          };
        case 'IsNull':
          return { ...e, expression: rewrite(e.expression) };
        case 'List':
          return { ...e, elements: e.elements.map(rewrite) };
        case 'ListComprehension':
          return {
            ...e,
            list: rewrite(e.list),
            where: e.where ? rewrite(e.where) : undefined,
            projection: e.projection ? rewrite(e.projection) : undefined,
          };
        default:
          return e;
      }
    };

    const rewritten = rewrite(expr);
    return { rewritten, extracted };
  }

  /**
 * Returns true when the plan qualifies for the storage-level fast path.
 *
 * Two cases:
 *  - Simple node: 1 NodeScanStep, no EdgeExpandStep, no WHERE
 *  - Simple edge: 1 NodeScanStep + 1 EdgeExpandStep (single-hop),
 *    no WHERE, aggregates reference only the edge variable
 */
  private _isEdgeSimplePlan(steps: PlanStep[], ast: QueryAst): boolean {
    if (ast.readingClauses.some(c => c.kind === 'Match' && c.where)) return false;

    let nodeScanCount = 0;
    let edgeExpandCount = 0;

    for (const step of steps) {
      if (step.kind === 'NodeScanStep') {
        nodeScanCount++;
        // Node type restriction → can't push to edge aggregation
        if (step.types && step.types.length > 0) return false;
        // Node property filters (e.g. {name: 'Alice'}) cannot be pushed
        // into edge-level storage aggregation — stay with Path B.
        if (step.propertyFilters && step.propertyFilters.length > 0) {
          return false;
        }
      } else if (step.kind === 'EdgeExpandStep') {
        edgeExpandCount++;
        // Only single-hop edge expansions can be pushed to storage
        if (step.strategy !== 'single-hop') return false;
        // Target type restriction → can't push to edge aggregation
        if (step.targetTypes && step.targetTypes.length > 0) return false;

      } else if (step.kind === 'FilterStep' || step.kind === 'NodeSeekStep') {
        // Any filter or seek means the plan isn't "simple"
        return false;
      }
    }

    return nodeScanCount === 1 && edgeExpandCount === 1;
  }

  private _isSimplePlan(steps: PlanStep[], ast: QueryAst): boolean {
    if (ast.readingClauses.some(c => c.kind === 'Match' && c.where)) return false;

    let nodeScanCount = 0;
    for (const step of steps) {
      if (step.kind === 'EdgeExpandStep') return false;
      if (step.kind === 'NodeScanStep') nodeScanCount++;
    }

    return nodeScanCount === 1;
  }


  // ── General helpers ─────────────────────────────────────────────

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
