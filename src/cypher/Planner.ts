/**
 * Query planner for the Cypher execution layer.
 *
 * Transforms a semantically-validated AST ({@link QueryAst}) into a physical
 * execution plan ({@link QueryPlan}) — an ordered list of {@link PlanStep}
 * objects that the {@link Executor} walks at runtime.
 *
 * ### Architecture
 *
 * The Planner delegates to four specialist modules under
 * {@link cypher/plan}:
 *
 * - {@link WhereDecomposer} — variable collection + WHERE → PropertyFilter
 * - {@link JoinReorderer} — root-pattern reordering + id-lookup detection
 * - {@link PatternPlanner} — NodeScan / EdgeExpand / NodeSeek steps
 * - {@link ProjectionPlanner} — RETURN / ORDER BY / SKIP-LIMIT / aggregation
 *
 * @module cypher/Planner
 */

import { QueryAst, Expression } from './ast/AstNode';
import { QueryPlan, PlanStep } from './plan/QueryPlan';
import { WhereDecomposer, VarInfo } from './plan/WhereDecomposer';
import { JoinReorderer } from './plan/JoinReorderer';
import { PatternPlanner } from './plan/PatternPlanner';
import { ProjectionPlanner } from './plan/ProjectionPlanner';

// ── Planner ────────────────────────────────────────────────────────

/**
 * Converts a typed AST into a physical execution plan.
 *
 * Usage:
 * ```typescript
 * const plan = new Planner().plan(typedAst);
 * ```
 */
export class Planner {
  private readonly _whereDecomposer = new WhereDecomposer();
  private readonly _reorderer = new JoinReorderer();
  private readonly _patternPlanner = new PatternPlanner();
  private readonly _projPlanner = new ProjectionPlanner();

  /**
   * Translate a typed AST into a {@link QueryPlan}.
   */
  public plan(ast: QueryAst): QueryPlan {
    const steps: PlanStep[] = [];

    // ── 1. Collect variables + decompose WHERE ────────────────────
    const varRegistry = this._whereDecomposer.collectVariables(
      ast.match.patterns,
    );

    const { perVar, crossVar } = ast.where
      ? this._whereDecomposer.decompose(ast.where.expression, varRegistry)
      : { perVar: new Map(), crossVar: [] as Expression[] };

    // ── 2. Detect id(n)=value for NodeSeekStep ────────────────────
    const idLookups = this._reorderer.detectIdLookups(crossVar, varRegistry);
    if (idLookups.size > 0) {
      const lookupExprs = new Set<Expression>();
      this._reorderer.collectIdLookupExprs(crossVar, lookupExprs);
      this._reorderer.removeIdLookups(crossVar, lookupExprs);
    }

    // ── 3. Reorder root patterns by selectivity ───────────────────
    const orderedPatterns = this._reorderer.reorder(
      ast.match.patterns,
      varRegistry,
      perVar,
    );

    // ── 4. Emit pattern steps with per-variable predicates ────────
    for (const pattern of orderedPatterns) {
      this._patternPlanner.planPath(pattern, steps, ast, perVar, idLookups);
    }

    // ── 5. Emit remaining cross-variable filter ───────────────────
    if (crossVar.length > 0) {
      steps.push({
        kind: 'FilterStep',
        predicate: this._whereDecomposer.andAll(crossVar),
      });
    }

    // ── 6. Post-scan clauses (aggregate path vs plain path) ───────
    const hasAggregates = this._projPlanner.hasAggregates(ast);

    if (hasAggregates) {
      // Pagination before aggregation
      if (ast.skip || ast.limit) {
        steps.push(this._projPlanner.planLimit(ast));
      }

      this._projPlanner.planAggregation(ast, steps);

      // Post-aggregation HAVING / ORDER BY
      const aggStep = steps[steps.length - 1] as import('./plan/QueryPlan').AggregateStep;

      if (ast.having) {
        const { rewritten, extracted } =
          this._projPlanner.extractAndRewriteAggregates(ast.having.expression);
        aggStep.aggregates.push(...extracted);
        steps.push({ kind: 'FilterStep', predicate: rewritten });
      }

      if (ast.orderBy) {
        const items = ast.orderBy.items.map((item) => {
          const { rewritten, extracted } =
            this._projPlanner.extractAndRewriteAggregates(item.expression);
          aggStep.aggregates.push(...extracted);
          return { expression: rewritten, direction: item.direction };
        });
        steps.push({ kind: 'SortStep', items });
      }
    } else {
      // Plain (non-aggregate) path
      if (ast.orderBy) {
        steps.push(this._projPlanner.planSort(ast));
      }

      if (ast.having) {
        steps.push({ kind: 'FilterStep', predicate: ast.having.expression });
      }

      if (ast.skip || ast.limit) {
        steps.push(this._projPlanner.planLimit(ast));
      }
    }

    // ── 7. Projection — always last ───────────────────────────────
    steps.push(this._projPlanner.planProjection(ast, hasAggregates));

    return { steps };
  }

}
