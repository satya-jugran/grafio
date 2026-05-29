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
  public async plan(originalAst: import('./ast/AstNode').Statement): Promise<QueryPlan> {
    const ast = JSON.parse(JSON.stringify(originalAst)) as import('./ast/AstNode').Statement;
    if (ast.kind === 'Union') {
      const plans: QueryPlan[] = [];
      for (const query of ast.queries) {
        plans.push(await this.plan(query));
      }
      const steps: PlanStep[] = [{
        kind: 'UnionStep',
        plans,
        all: ast.all,
      }];
      
      if (ast.orderBy) {
        steps.push(this._projPlanner.planSort({ orderBy: ast.orderBy, return: ast.queries[0].return } as any));
      }
      if (ast.skip || ast.limit) {
        steps.push(this._projPlanner.planLimit({ skip: ast.skip, limit: ast.limit } as any));
      }
      return { steps };
    }

    const steps: PlanStep[] = [];
    const knownVars = new Set<string>();

    if (ast.segments && ast.segments.length > 0) {
      for (const segment of ast.segments) {
        const fakeAst: QueryAst = {
          kind: 'Query',
          matches: segment.matches,
          create: segment.create,
          merge: segment.merge,
          set: segment.set,
          delete: segment.delete,
          remove: segment.remove,
          return: { kind: 'Return', distinct: segment.with.distinct, items: segment.with.items },
          segments: [],
        };
        await this._planSegment(fakeAst, steps, knownVars, segment.with.star);

        if (segment.with.where) {
          const rewritten = await this._extractSubqueries(segment.with.where.expression, steps, knownVars);
          steps.push({
            kind: 'FilterStep',
            predicate: rewritten,
          });
        }
        if (segment.with.orderBy) {
          steps.push(this._projPlanner.planSort({ orderBy: segment.with.orderBy, return: fakeAst.return } as any));
        }
        if (segment.with.skip || segment.with.limit) {
          steps.push(this._projPlanner.planLimit({ skip: segment.with.skip, limit: segment.with.limit } as any));
        }
      }
    }

    // Now plan the final segment
    await this._planSegment(ast, steps, knownVars, false);

    return { steps };
  }

  private async _extractSubqueries(expr: Expression, steps: PlanStep[], knownVars: Set<string>): Promise<Expression> {
    switch (expr.kind) {
      case 'ExistsSubquery': {
        const varName = this._patternPlanner._syntheticVar('exists', steps.length);
        const subPlanSteps: PlanStep[] = [];
        
        const fakeAst: QueryAst = {
          kind: 'Query',
          matches: [expr.match],
          return: { kind: 'Return', distinct: false, items: [] },
          segments: [],
        };
        
        await this._planSegment(fakeAst, subPlanSteps, new Set(knownVars), false);
        
        if (subPlanSteps.length > 0 && subPlanSteps[subPlanSteps.length - 1].kind === 'ProjectStep') {
          subPlanSteps.pop();
        }
        
        subPlanSteps.push({ kind: 'LimitStep', limitExpr: { kind: 'Literal', value: 1 } });
        
        steps.push({
          kind: 'ExistsSubqueryStep',
          subPlan: subPlanSteps,
          resultVariable: varName,
        } as import('./plan/QueryPlan').ExistsSubqueryStep);
        
        knownVars.add(varName);

        return { kind: 'Identifier', name: varName };
      }
      
      case 'PropertyAccess': {
        const obj = await this._extractSubqueries(expr.object, steps, knownVars);
        return { ...expr, object: obj };
      }
      case 'Binary': {
        const left = await this._extractSubqueries(expr.left, steps, knownVars);
        const right = await this._extractSubqueries(expr.right, steps, knownVars);
        return { ...expr, left, right };
      }
      case 'Unary': {
        const operand = await this._extractSubqueries(expr.operand, steps, knownVars);
        return { ...expr, operand };
      }
      case 'In': {
        const e1 = await this._extractSubqueries(expr.expression, steps, knownVars);
        const e2 = await this._extractSubqueries(expr.list, steps, knownVars);
        return { ...expr, expression: e1, list: e2 };
      }
      case 'IsNull': {
        const e = await this._extractSubqueries(expr.expression, steps, knownVars);
        return { ...expr, expression: e };
      }
      case 'List': {
        const elems: import('./ast/AstNode').Expression[] = [];
        for (const e of expr.elements) {
          elems.push(await this._extractSubqueries(e, steps, knownVars));
        }
        return { ...expr, elements: elems };
      }
      case 'ListComprehension': {
        const list = await this._extractSubqueries(expr.list, steps, knownVars);
        const where = expr.where ? await this._extractSubqueries(expr.where, steps, knownVars) : undefined;
        const projection = expr.projection ? await this._extractSubqueries(expr.projection, steps, knownVars) : undefined;
        return { ...expr, list, where, projection };
      }
      case 'Map': {
        const props: Record<string, Expression> = {};
        for (const [k, v] of Object.entries(expr.props)) {
          props[k] = await this._extractSubqueries(v, steps, knownVars);
        }
        return { ...expr, props };
      }
      case 'FunctionCall': {
        const args: import('./ast/AstNode').Expression[] = [];
        for (const a of expr.args) {
          args.push(await this._extractSubqueries(a, steps, knownVars));
        }
        return { ...expr, args };
      }
      case 'Identifier':
      case 'Literal':
      case 'Parameter':
      default:
        return expr;
    }
  }

  private async _planSegment(ast: QueryAst, steps: PlanStep[], knownVars: Set<string>, isWithStar: boolean): Promise<void> {

    // ── Process each MATCH / OPTIONAL MATCH clause ─────────────────
    for (const matchClause of ast.matches) {
      await this._planMatchClause(matchClause, steps, knownVars, ast);
    }

    // ── NEW: Emit CREATE steps ─────────────────────────────────────
    if (ast.create) {
      for (const pattern of ast.create.patterns) {
        this._planCreatePath(pattern, steps, knownVars);
      }
    }

    // ── NEW: Emit MERGE steps ──────────────────────────────────────
    if (ast.merge) {
      for (const mergeClause of ast.merge) {
        const onCreateItems: Array<{ variable: string; property?: string; operator: '=' | '+='; value: Expression; entityKind: 'node' | 'edge' }> = [];
        const onMatchItems: Array<{ variable: string; property?: string; operator: '=' | '+='; value: Expression; entityKind: 'node' | 'edge' }> = [];
        for (const action of mergeClause.actions) {
          const arr = action.onMatch ? onMatchItems : onCreateItems;
          for (const item of action.items) {
            item.value = await this._extractSubqueries(item.value, steps, knownVars);
            const varName = (item.variable as IdentifierExpr).name;
            const entityKind = this._resolveEntityKind(varName, ast);
            arr.push({
              variable: varName,
              property: item.property,
              operator: item.operator,
              value: item.value,
              entityKind
            });
          }
        }
        const readSteps: PlanStep[] = [];
        this._patternPlanner.planPath(mergeClause.pattern, readSteps, ast, new Map(), undefined, undefined, knownVars);

        const createSteps: PlanStep[] = [];
        this._planCreatePath(mergeClause.pattern, createSteps, new Set(knownVars));

        steps.push({
          kind: 'MergeStep',
          pattern: mergeClause.pattern,
          readSteps,
          createSteps,
          onCreateItems,
          onMatchItems
        });

        // Add variables to knownVars so subsequent SET/DELETE steps know they are bound
        const segments = getPatternSegments(mergeClause.pattern);
        if (mergeClause.pattern.kind === 'NamedPath' && mergeClause.pattern.name) {
          knownVars.add(mergeClause.pattern.name);
        }
        for (const segment of segments) {
          if (segment.variable) knownVars.add(segment.variable);
        }
      }
    }

    // ── NEW: Emit SET steps ────────────────────────────────────────
    if (ast.set) {
      for (const item of ast.set.items) {
        item.value = await this._extractSubqueries(item.value, steps, knownVars);
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
          assignments: [{ key: item.property, operator: item.operator, value: item.value }],
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

    // ── NEW: Emit CREATE INDEX step ──────────────────────────────
    if (ast.createIndex) {
      steps.push({
        kind: 'CreateIndexStep',
        name: ast.createIndex.name,
        target: ast.createIndex.target,
        propertyKeys: ast.createIndex.propertyKeys,
      });
    }

    // ── NEW: Emit DROP INDEX step ─────────────────────────────────
    if (ast.dropIndex) {
      steps.push({
        kind: 'DropIndexStep',
        name: ast.dropIndex.name,
      });
    }

    // ── NEW: Emit SHOW INDEXES step ───────────────────────────────
    if (ast.showIndexes) {
      steps.push({
        kind: 'ShowIndexesStep',
        columns: [
          { alias: 'name', source: 'name' },
          { alias: 'target', source: 'target' },
          { alias: 'propertyKeys', source: 'propertyKeys' },
        ],
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

      // Post-aggregation ORDER BY
      const aggStep = steps[steps.length - 1] as import('./plan/QueryPlan').AggregateStep;

      if (ast.orderBy) {
        for (let i = 0; i < ast.orderBy.items.length; i++) {
          ast.orderBy.items[i].expression = await this._extractSubqueries(ast.orderBy.items[i].expression, steps, knownVars);
        }
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
        for (let i = 0; i < ast.orderBy.items.length; i++) {
          ast.orderBy.items[i].expression = await this._extractSubqueries(ast.orderBy.items[i].expression, steps, knownVars);
        }
        steps.push(this._projPlanner.planSort(ast));
      }


      if (ast.skip || ast.limit) {
        steps.push(this._projPlanner.planLimit(ast));
      }
    }

    // ── 7. Projection — always last ───────────────────────────────
    for (let i = 0; i < ast.return.items.length; i++) {
      ast.return.items[i].expression = await this._extractSubqueries(ast.return.items[i].expression, steps, knownVars);
    }
    const projStep = this._projPlanner.planProjection(ast, hasAggregates);
    // If it's a WITH *, flag it so the Executor knows to preserve all rows
    if (isWithStar) {
      projStep.star = true;
    }
    steps.push(projStep);

    // ── 8. Prune knownVars based on projection ──────────────────────
    if (!isWithStar) {
      const projected = new Set<string>();
      for (const item of ast.return.items) {
        if (item.alias) projected.add(item.alias);
        else if (item.expression.kind === 'Identifier') projected.add(item.expression.name);
      }
      knownVars.clear();
      for (const p of projected) knownVars.add(p);
    } else {
      for (const item of ast.return.items) {
        if (item.alias) knownVars.add(item.alias);
      }
    }
  }

  // ── CREATE pattern planning ──────────────────────────────────────

  /**
   * Convert a CREATE pattern path (or named path) into write plan steps.
   *
   * Walks the pattern's path elements:
   * - For each node pattern → emits a {@link CreateNodeStep} **unless**
   *   the variable is already bound in {@code knownVars} (i.e. from MATCH
   *   or from a previous CREATE pattern), in which case it is treated as
   *   an existing endpoint reference.
   * - For each edge pattern → emits a {@link CreateEdgeStep} with
   *   source = previous node variable, target = current node variable.
   *
   * @param knownVars - Mutable set of already-bound variable names.
   *   When this method emits a {@code CreateNodeStep} it adds the
   *   variable to the set so that downstream callers (subsequent
   *   CREATE patterns in the same clause) see it as already-created.
   */
  private _planCreatePath(
    pattern: import('./ast/AstNode').MatchPattern,
    steps: PlanStep[],
    knownVars: Set<string>,
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

        // Skip CreateNodeStep when the variable is already bound
        // (by MATCH or by a previous CREATE pattern) — it refers
        // to an existing node, not a new one.
        if (!knownVars.has(variable)) {
          steps.push({
            kind: 'CreateNodeStep',
            variable,
            labels: node.labels,
            properties: node.properties,
          });
          // Register so subsequent patterns see this variable as
          // already-created.
          if (node.variable) {
            knownVars.add(node.variable);
          }
        }

        prevNodeVar = variable;
      } else {
        // EdgePattern — emit the target node first so it's bound
        // before the edge step tries to reference it at runtime.
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

        // Emit the target node CREATE step BEFORE the edge so both
        // endpoints are bound in the row when the edge is created.
        // Skip when the target variable is already bound (MATCH or
        // prior CREATE).
        if (targetNode && !knownVars.has(targetVar)) {
          steps.push({
            kind: 'CreateNodeStep',
            variable: targetVar,
            labels: targetNode.labels,
            properties: targetNode.properties,
          });
          // Register so subsequent patterns see this variable as
          // already-created.
          if (targetNode.variable) {
            knownVars.add(targetNode.variable);
          }
          prevNodeVar = targetVar;
          i++; // skip the already-processed target node
        } else if (targetNode) {
          // Target node already exists; record its variable so the
          // edge can reference it, but don't skip the segment
          // (the segment was not "consumed" by CreateNodeStep).
          prevNodeVar = targetVar;
          i++; // advance past this node segment
        }

        steps.push({
          kind: 'CreateEdgeStep',
          variable: edgeVar,
          source: sourceVar,
          target: targetVar,
          types: edge.types,
          properties: edge.properties,
        });
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

    // Check MATCH patterns
    for (const matchClause of ast.matches) {
      if (!res) checkPatterns(matchClause.patterns);
    }

    // If still unresolved, check CREATE patterns
    if (!res && ast.create?.patterns) {
      checkPatterns(ast.create.patterns);
    }

    if (!res && ast.merge) {
      for (const mergeClause of ast.merge) {
        if (!res) checkPatterns([mergeClause.pattern]);
      }
    }

    return res ?? 'node';
  }

  // ── MATCH clause planning (regular + optional) ───────────────────

  /**
   * Plan a single MATCH or OPTIONAL MATCH clause.
   *
   * For a regular MATCH: emits NodeScan/EdgeExpand/Filter steps directly.
   * For an OPTIONAL MATCH: wraps them in an {@link OptionalMatchStep} that
   * implements left-outer-join semantics.
   */
  private async _planMatchClause(
    matchClause: import('./ast/AstNode').MatchClause,
    steps: PlanStep[],
    knownVars: Set<string>,
    ast: QueryAst,
  ): Promise<void> {
    // 1. Collect variables from this match clause's patterns
    const varRegistry = this._whereDecomposer.collectVariables(
      matchClause.patterns,
    );

    // 2. Decompose the attached WHERE clause (if any)
    const { perVar, crossVar } = matchClause.where
      ? this._whereDecomposer.decompose(matchClause.where.expression, varRegistry)
      : { perVar: new Map(), crossVar: [] as Expression[] };

    // 3. Detect id(n)=value for NodeSeekStep
    const idLookups = this._reorderer.detectIdLookups(crossVar, varRegistry);

    // 4. Reorder root patterns by selectivity
    const orderedPatterns = await this._reorderer.reorder(
      matchClause.patterns,
      varRegistry,
      perVar,
      idLookups,
    );

    // Determine the target steps list — for optional matches, use a separate
    // buffer that will be wrapped in OptionalMatchStep.
    const targetSteps: PlanStep[] = matchClause.optional ? [] : steps;

    // 5. Emit pattern steps
    const consumed = new Set<string>();
    for (const pattern of orderedPatterns) {
      this._patternPlanner.planPath(pattern, targetSteps, ast, perVar, idLookups, consumed, knownVars);
    }

    // 6. Remove consumed id-lookups from crossVar
    if (consumed.size > 0) {
      const lookupExprs = new Set<Expression>();
      this._reorderer.collectIdLookupExprs(crossVar, lookupExprs, consumed);
      this._reorderer.removeIdLookups(crossVar, lookupExprs);
    }

    // Compute newVars BEFORE updating knownVars
    const newVars: string[] = [];
    for (const v of varRegistry.keys()) {
      if (!knownVars.has(v)) {
        newVars.push(v);
      }
    }

    // Update knownVars with all variables from this match clause before WHERE
    for (const v of newVars) knownVars.add(v);

    // 7. Emit remaining cross-variable filter
    if (crossVar.length > 0) {
      const predicate = this._whereDecomposer.andAll(crossVar);
      const rewritten = await this._extractSubqueries(predicate, targetSteps, knownVars);
      targetSteps.push({
        kind: 'FilterStep',
        predicate: rewritten,
      });
    }

    // 8. For OPTIONAL MATCH, wrap in OptionalMatchStep
    if (matchClause.optional) {
      steps.push({
        kind: 'OptionalMatchStep',
        readSteps: targetSteps,
        newVars,
      });
    }

    // (knownVars already updated above)
  }

}
