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

import {
  QueryAst,
  Expression,
  NodePattern,
  EdgePattern,
  IdentifierExpr,
  getPatternSegments,
} from './ast/AstNode';
import { QueryPlan, PlanStep } from './plan/QueryPlan';
import { WhereDecomposer, VarInfo } from './plan/WhereDecomposer';
import { JoinReorderer } from './plan/JoinReorderer';
import { PatternPlanner } from './plan/PatternPlanner';
import { ProjectionPlanner } from './plan/ProjectionPlanner';
import type { Graph } from '../Graph';

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
  private readonly _whereDecomposer: WhereDecomposer;
  private readonly _reorderer: JoinReorderer;
  private readonly _patternPlanner = new PatternPlanner();
  private readonly _projPlanner = new ProjectionPlanner();

  /**
   * @param graph — Optional {@link Graph} for index-aware selectivity.
   *   When absent, indexed properties score the same as non-indexed (10).
   */
  constructor(graph?: Graph) {
    this._whereDecomposer = new WhereDecomposer();
    this._reorderer = new JoinReorderer(graph);
  }

  /**
   * Translate a typed AST into a {@link QueryPlan}.
   */
  public async plan(ast: QueryAst): Promise<QueryPlan> {
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

    // ── 3. Reorder root patterns by selectivity ───────────────────
    const orderedPatterns = await this._reorderer.reorder(
      ast.match.patterns,
      varRegistry,
      perVar,
      idLookups,
    );

    // ── 4. Emit pattern steps ──────────────────────────────────────
    // Track which id-lookups were consumed as NodeSeekStep so that
    // only those are removed from crossVar.  Unconsumed id-lookups
    // (e.g. for a deeper node in a multi-hop path) remain in
    // crossVar and become a FilterStep.
    const consumed = new Set<string>();
    for (const pattern of orderedPatterns) {
      this._patternPlanner.planPath(pattern, steps, ast, perVar, idLookups, consumed);
    }

    // ── 5. Remove consumed id-lookups from crossVar ────────────────
    if (consumed.size > 0) {
      const lookupExprs = new Set<Expression>();
      this._reorderer.collectIdLookupExprs(crossVar, lookupExprs, consumed);
      this._reorderer.removeIdLookups(crossVar, lookupExprs);
    }

    // ── 6. Emit remaining cross-variable filter ───────────────────
    if (crossVar.length > 0) {
      steps.push({
        kind: 'FilterStep',
        predicate: this._whereDecomposer.andAll(crossVar),
      });
    }

    // ── NEW: Emit CREATE steps ─────────────────────────────────────
    if (ast.create) {
      for (const pattern of ast.create.patterns) {
        this._planCreatePath(pattern, steps);
      }
    }

    // ── NEW: Emit SET steps ────────────────────────────────────────
    if (ast.set) {
      for (const item of ast.set.items) {
        const varName =
          item.variable.kind === 'Identifier'
            ? (item.variable as IdentifierExpr).name
            : '';
        if (!varName) continue;
        const entityKind = this._resolveEntityKind(varName, ast);
        steps.push({
          kind: 'SetPropertyStep',
          variable: varName,
          entityKind,
          assignments: [{ key: item.property, value: item.value }],
        });
      }
    }

    // ── NEW: Emit DELETE steps ─────────────────────────────────────
    if (ast.delete) {
      for (const varName of ast.delete.variables) {
        const entityKind = this._resolveEntityKind(varName, ast);
        steps.push({
          kind: 'DeleteEntityStep',
          variable: varName,
          entityKind,
          detach: ast.delete.detach,
        });
      }
    }

    // ── NEW: Emit REMOVE steps ─────────────────────────────────────
    if (ast.remove) {
      for (const item of ast.remove.items) {
        const entityKind = this._resolveEntityKind(item.variable.name, ast);
        steps.push({
          kind: 'RemovePropertyStep',
          variable: item.variable.name,
          entityKind,
          property: item.property,
        });
      }
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

  // ── CREATE pattern planning ──────────────────────────────────────

  /**
   * Convert a CREATE pattern path (or named path) into write plan steps.
   *
   * Walks the pattern's path elements:
   * - For each node pattern → emits a {@link CreateNodeStep}
   * - For each edge pattern → emits a {@link CreateEdgeStep} with
   *   source = previous node variable, target = current node variable
   */
  private _planCreatePath(
    pattern: import('./ast/AstNode').MatchPattern,
    steps: PlanStep[],
  ): void {
    const segments = getPatternSegments(pattern);
    if (segments.length === 0) return;

    let prevNodeVar = '';
    let createIdx = steps.length;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      if (seg.kind === 'NodePattern') {
        const node = seg as NodePattern;
        const variable =
          node.variable ??
          this._patternPlanner._syntheticVar('create_node', createIdx++);

        steps.push({
          kind: 'CreateNodeStep',
          variable,
          labels: node.labels,
          properties: node.properties,
        });

        prevNodeVar = variable;
      } else {
        // EdgePattern — emitted after the next NodePattern has been
        // processed so we know both source and target.
        const edge = seg as EdgePattern;
        // Peek at the next segment (must be a node)
        const nextSeg = segments[i + 1];
        const targetNode = nextSeg?.kind === 'NodePattern'
          ? (nextSeg as NodePattern)
          : undefined;
        const targetVar =
          targetNode?.variable ??
          this._patternPlanner._syntheticVar('create_node', createIdx++);

        const sourceVar = prevNodeVar;
        const edgeVar =
          edge.variable ??
          this._patternPlanner._syntheticVar('create_edge', createIdx++);

        steps.push({
          kind: 'CreateEdgeStep',
          variable: edgeVar,
          source: sourceVar,
          target: targetVar,
          types: edge.types,
          properties: edge.properties,
        });

        // Advance: the target node now becomes the previous node for
        // the next edge in the chain.
        // Also emit the target node as a CreateNodeStep if it hasn't
        // been emitted yet (it will be emitted when we encounter it
        // in the loop at i+1). But we need to skip that iteration
        // since we already handled it here.
        // However, the loop will process it at i+1, which would
        // double-emit. To handle this cleanly, we emit the target
        // node here and skip the next segment.
        if (targetNode) {
          steps.push({
            kind: 'CreateNodeStep',
            variable: targetVar,
            labels: targetNode.labels,
            properties: targetNode.properties,
          });
          prevNodeVar = targetVar;
          i++; // skip the already-processed target node
        }
      }
    }
  }

  // ── Entity-kind resolution ───────────────────────────────────────

  /**
   * Determine whether a variable refers to a node or an edge.
   *
   * Checks:
   * 1. MATCH patterns — node variables and edge variables
   * 2. CREATE patterns — node variables and edge variables
   *
   * Defaults to `'node'` if the variable cannot be resolved
   * (e.g., it appears in both roles, or not at all).
   */
  private _resolveEntityKind(
    varName: string,
    ast: QueryAst,
  ): 'node' | 'edge' {
    let res: 'node' | 'edge' | undefined;

    const checkPatterns = (
      patterns: import('./ast/AstNode').MatchPattern[],
    ): void => {
      for (const pattern of patterns) {
        const segs = getPatternSegments(pattern);
        for (const seg of segs) {
          if (seg.kind === 'NodePattern') {
            const np = seg as NodePattern;
            if (np.variable === varName) {
              res = res ?? 'node';
            }
          } else if (seg.kind === 'EdgePattern') {
            const ep = seg as EdgePattern;
            if (ep.variable === varName) {
              res = res ?? 'edge';
            }
          }
        }
      }
    };

    // Check MATCH patterns first
    if (ast.match?.patterns) {
      checkPatterns(ast.match.patterns);
    }

    // If still unresolved, check CREATE patterns
    if (!res && ast.create?.patterns) {
      checkPatterns(ast.create.patterns);
    }

    return res ?? 'node';
  }

}
