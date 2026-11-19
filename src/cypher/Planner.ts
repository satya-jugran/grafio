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
  Statement,
  QueryAst,
  Expression,
  MatchClause,
  MatchPattern,
  NodePattern,
  EdgePattern,
  IdentifierExpr,
  getPatternSegments,
} from './ast/AstNode';
import {
  QueryPlan,
  PlanStep,
  AggregateStep,
  ExistsSubqueryStep,
  PatternComprehensionStep,
  PatternExprStep,
  RemoveLabelStep,
  PropertyFilter,
} from './plan/QueryPlan';
import { WhereDecomposer, VarInfo } from './plan/WhereDecomposer';
import { JoinReorderer } from './plan/JoinReorderer';
import { PatternPlanner } from './plan/PatternPlanner';
import { ProjectionPlanner } from './plan/ProjectionPlanner';
import { getOrBuildCompiledPlanMeta } from './plan/CompiledPlanMeta';
import type { Graph } from '../Graph';

interface PreparedMatchClause {
  varRegistry: Map<string, VarInfo>;
  perVar: Map<string, PropertyFilter[]>;
  crossVar: Expression[];
  idLookups: Map<string, unknown>;
  orderedPatterns: MatchPattern[];
}

// ── Planner ────────────────────────────────────────────────────────

/**
 * Converts a typed AST into a physical execution plan.
 *
 * Usage:
 * ```typescript
 * const plan = new Planner().planSync(typedAst);
 * ```
 */
export class Planner {
  private readonly _graph?: Graph;
  private readonly _whereDecomposer: WhereDecomposer;
  private readonly _reorderer: JoinReorderer;
  private readonly _patternPlanner = new PatternPlanner();
  private readonly _projPlanner = new ProjectionPlanner();

  /**
   * @param graph — Optional {@link Graph} for index-aware selectivity.
   *   When absent, indexed properties score the same as non-indexed (10).
   */
  constructor(graph?: Graph) {
    this._graph = graph;
    this._whereDecomposer = new WhereDecomposer();
    this._reorderer = new JoinReorderer(graph);
  }

  /**
   * Translate a typed AST into a {@link QueryPlan} asynchronously.
   * Delegates immediately to {@link planSync} when no Graph is attached or
   * when backed by an in-memory synchronous kernel.
   */
  public async plan(originalAst: Statement): Promise<QueryPlan> {
    if (!this._graph || this._graph._getSyncKernel()) {
      return this.planSync(originalAst);
    }

    const preparedMatches = new WeakMap<MatchClause, PreparedMatchClause>();
    await this._collectPreparedMatchesAsync(originalAst, preparedMatches);
    return this._planInternalSync(originalAst, preparedMatches);
  }

  /**
   * Translate a typed AST into a {@link QueryPlan} synchronously without
   * mutating or JSON-cloning the input AST.
   */
  public planSync(originalAst: Statement): QueryPlan {
    return this._planInternalSync(originalAst, undefined);
  }

  // ── Async pre-preparation for non-kernel storage providers ─────

  private async _collectPreparedMatchesAsync(
    stmt: Statement,
    out: WeakMap<MatchClause, PreparedMatchClause>,
  ): Promise<void> {
    if (stmt.kind === 'Union') {
      for (const q of stmt.queries) {
        await this._collectPreparedMatchesAsync(q, out);
      }
      return;
    }

    if (stmt.segments) {
      for (const seg of stmt.segments) {
        for (const rc of seg.readingClauses) {
          if (rc.kind === 'Match') {
            await this._prepareMatchClauseAsync(rc, out);
          } else if (rc.kind === 'Unwind') {
            await this._collectExprMatchesAsync(rc.expression, out);
          }
        }
        if (seg.merge) {
          for (const m of seg.merge) {
            for (const a of m.actions) {
              for (const it of a.items) {
                await this._collectExprMatchesAsync(it.value, out);
              }
            }
          }
        }
        if (seg.set) {
          for (const it of seg.set.items) {
            await this._collectExprMatchesAsync(it.value, out);
          }
        }
        for (const it of seg.with.items) {
          await this._collectExprMatchesAsync(it.expression, out);
        }
        if (seg.with.where) {
          await this._collectExprMatchesAsync(seg.with.where.expression, out);
        }
      }
    }

    for (const rc of stmt.readingClauses) {
      if (rc.kind === 'Match') {
        await this._prepareMatchClauseAsync(rc, out);
      } else if (rc.kind === 'Unwind') {
        await this._collectExprMatchesAsync(rc.expression, out);
      }
    }
    if (stmt.merge) {
      for (const m of stmt.merge) {
        for (const a of m.actions) {
          for (const it of a.items) {
            await this._collectExprMatchesAsync(it.value, out);
          }
        }
      }
    }
    if (stmt.set) {
      for (const it of stmt.set.items) {
        await this._collectExprMatchesAsync(it.value, out);
      }
    }
    if (stmt.orderBy) {
      for (const it of stmt.orderBy.items) {
        await this._collectExprMatchesAsync(it.expression, out);
      }
    }
    for (const it of stmt.return.items) {
      await this._collectExprMatchesAsync(it.expression, out);
    }
  }

  private async _prepareMatchClauseAsync(
    matchClause: MatchClause,
    out: WeakMap<MatchClause, PreparedMatchClause>,
  ): Promise<void> {
    if (!out.has(matchClause)) {
      const varRegistry = this._whereDecomposer.collectVariables(matchClause.patterns);
      const { perVar, crossVar } = matchClause.where
        ? this._whereDecomposer.decompose(matchClause.where.expression, varRegistry)
        : { perVar: new Map(), crossVar: [] as Expression[] };
      const idLookups = this._reorderer.detectIdLookups(crossVar, varRegistry);
      const orderedPatterns = await this._reorderer.reorder(
        matchClause.patterns,
        varRegistry,
        perVar,
        idLookups,
      );
      out.set(matchClause, {
        varRegistry,
        perVar,
        crossVar,
        idLookups,
        orderedPatterns,
      });
    }
    if (matchClause.where) {
      await this._collectExprMatchesAsync(matchClause.where.expression, out);
    }
  }

  private async _collectExprMatchesAsync(
    expr: Expression,
    out: WeakMap<MatchClause, PreparedMatchClause>,
  ): Promise<void> {
    switch (expr.kind) {
      case 'ExistsSubquery':
        await this._prepareMatchClauseAsync(expr.match, out);
        return;
      case 'PropertyAccess':
        await this._collectExprMatchesAsync(expr.object, out);
        return;
      case 'Binary':
        await this._collectExprMatchesAsync(expr.left, out);
        await this._collectExprMatchesAsync(expr.right, out);
        return;
      case 'Unary':
        await this._collectExprMatchesAsync(expr.operand, out);
        return;
      case 'In':
        await this._collectExprMatchesAsync(expr.expression, out);
        await this._collectExprMatchesAsync(expr.list, out);
        return;
      case 'IsNull':
        await this._collectExprMatchesAsync(expr.expression, out);
        return;
      case 'List':
        for (const e of expr.elements) await this._collectExprMatchesAsync(e, out);
        return;
      case 'ListComprehension':
        await this._collectExprMatchesAsync(expr.list, out);
        if (expr.where) await this._collectExprMatchesAsync(expr.where, out);
        if (expr.projection) await this._collectExprMatchesAsync(expr.projection, out);
        return;
      case 'PatternComprehension':
        if (expr.where) await this._collectExprMatchesAsync(expr.where, out);
        await this._collectExprMatchesAsync(expr.projection, out);
        return;
      case 'Map':
        for (const v of Object.values(expr.props)) {
          await this._collectExprMatchesAsync(v, out);
        }
        return;
      case 'FunctionCall':
        for (const a of expr.args) await this._collectExprMatchesAsync(a, out);
        return;
      default:
        return;
    }
  }

  // ── Shared synchronous core planner ─────────────────────────────

  private _planInternalSync(
    ast: Statement,
    preparedMatches?: WeakMap<MatchClause, PreparedMatchClause>,
  ): QueryPlan {
    if (ast.kind === 'Union') {
      const plans: QueryPlan[] = [];
      for (const query of ast.queries) {
        plans.push(this._planInternalSync(query, preparedMatches));
      }
      const steps: PlanStep[] = [
        {
          kind: 'UnionStep',
          plans,
          all: ast.all,
        },
      ];

      const projectionAst: QueryAst = {
        kind: 'Query',
        segments: [],
        readingClauses: [],
        return: ast.queries[0].return,
      };

      if (ast.orderBy) {
        steps.push(this._projPlanner.planSort({ ...projectionAst, orderBy: ast.orderBy }, true));
      }
      if (ast.skip || ast.limit) {
        steps.push(this._projPlanner.planLimit({ ...projectionAst, skip: ast.skip, limit: ast.limit }));
      }
      const unionPlan: QueryPlan = { steps };
      getOrBuildCompiledPlanMeta(unionPlan);
      return unionPlan;
    }

    const steps: PlanStep[] = [];
    const knownVars = new Set<string>();

    if (ast.segments && ast.segments.length > 0) {
      for (const segment of ast.segments) {
        const fakeAst: QueryAst = {
          kind: 'Query',
          readingClauses: segment.readingClauses,
          create: segment.create,
          merge: segment.merge,
          set: segment.set,
          delete: segment.delete,
          remove: segment.remove,
          return: {
            kind: 'Return',
            distinct: segment.with.distinct,
            items: segment.with.items,
          },
          segments: [],
        };
        this._planSegmentSync(fakeAst, steps, knownVars, segment.with.star, preparedMatches);

        if (segment.with.where) {
          const patternExprVars = new Set<string>();
          const rewritten = this._extractSubqueriesSync(
            segment.with.where.expression,
            steps,
            knownVars,
            patternExprVars,
            preparedMatches,
          );
          steps.push({
            kind: 'FilterStep',
            predicate: this._rewritePatternExprsAsPredicate(rewritten, patternExprVars),
          });
        }
        if (segment.with.orderBy) {
          steps.push(this._projPlanner.planSort({ ...fakeAst, orderBy: segment.with.orderBy }));
        }
        if (segment.with.skip || segment.with.limit) {
          steps.push(
            this._projPlanner.planLimit({ ...fakeAst, skip: segment.with.skip, limit: segment.with.limit }),
          );
        }
      }
    }

    // Plan the final segment without mutating originalAst
    this._planSegmentSync(ast, steps, knownVars, false, preparedMatches);

    const plan: QueryPlan = { steps };
    getOrBuildCompiledPlanMeta(plan);
    return plan;
  }

  private _cloneMatchPattern(pattern: MatchPattern): MatchPattern {
    if (pattern.kind === 'NamedPath') {
      return {
        ...pattern,
        pattern: {
          ...pattern.pattern,
          segments: pattern.pattern.segments.map((s) => ({ ...s })),
        },
      };
    }
    return {
      ...pattern,
      segments: pattern.segments.map((s) => ({ ...s })),
    };
  }

  private _extractSubqueriesSync(
    expr: Expression,
    steps: PlanStep[],
    knownVars: Set<string>,
    patternExprVars?: Set<string>,
    preparedMatches?: WeakMap<MatchClause, PreparedMatchClause>,
  ): Expression {
    switch (expr.kind) {
      case 'ExistsSubquery': {
        const varName = this._patternPlanner._syntheticVar('exists', steps.length);
        const subPlanSteps: PlanStep[] = [];

        const fakeAst: QueryAst = {
          kind: 'Query',
          readingClauses: [expr.match],
          return: { kind: 'Return', distinct: false, items: [] },
          segments: [],
        };

        this._planSegmentSync(fakeAst, subPlanSteps, new Set(knownVars), false, preparedMatches);

        if (
          subPlanSteps.length > 0 &&
          subPlanSteps[subPlanSteps.length - 1].kind === 'ProjectStep'
        ) {
          subPlanSteps.pop();
        }

        subPlanSteps.push({ kind: 'LimitStep', limitExpr: { kind: 'Literal', value: 1 } });

        steps.push({
          kind: 'ExistsSubqueryStep',
          subPlan: subPlanSteps,
          resultVariable: varName,
        } as ExistsSubqueryStep);

        knownVars.add(varName);
        return { kind: 'Identifier', name: varName };
      }

      case 'PropertyAccess': {
        const obj = this._extractSubqueriesSync(
          expr.object,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        return { ...expr, object: obj };
      }
      case 'Binary': {
        const left = this._extractSubqueriesSync(
          expr.left,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        const right = this._extractSubqueriesSync(
          expr.right,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        return { ...expr, left, right };
      }
      case 'Unary': {
        const operand = this._extractSubqueriesSync(
          expr.operand,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        return { ...expr, operand };
      }
      case 'In': {
        const e1 = this._extractSubqueriesSync(
          expr.expression,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        const e2 = this._extractSubqueriesSync(
          expr.list,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        return { ...expr, expression: e1, list: e2 };
      }
      case 'IsNull': {
        const e = this._extractSubqueriesSync(
          expr.expression,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        return { ...expr, expression: e };
      }
      case 'List': {
        const elems: Expression[] = [];
        for (const e of expr.elements) {
          elems.push(
            this._extractSubqueriesSync(e, steps, knownVars, patternExprVars, preparedMatches),
          );
        }
        return { ...expr, elements: elems };
      }
      case 'ListComprehension': {
        const list = this._extractSubqueriesSync(
          expr.list,
          steps,
          knownVars,
          patternExprVars,
          preparedMatches,
        );
        const where = expr.where
          ? this._extractSubqueriesSync(expr.where, steps, knownVars, patternExprVars, preparedMatches)
          : undefined;
        const projection = expr.projection
          ? this._extractSubqueriesSync(
              expr.projection,
              steps,
              knownVars,
              patternExprVars,
              preparedMatches,
            )
          : undefined;
        return { ...expr, list, where, projection };
      }
      case 'PatternComprehension': {
        const varName = this._patternPlanner._syntheticVar('comp', steps.length);
        const subPlanSteps: PlanStep[] = [];
        const clonedPattern = this._cloneMatchPattern(expr.pattern);
        const pathVariables = this._patternPlanner.assignAndExtractPathVariables(
          clonedPattern,
          subPlanSteps,
        );
        const localKnownVars = new Set([...knownVars, ...pathVariables]);

        const fakeAst: QueryAst = {
          kind: 'Query',
          readingClauses: [],
          return: { kind: 'Return', distinct: false, items: [] },
          segments: [],
        };

        this._patternPlanner.planPath(
          clonedPattern,
          subPlanSteps,
          fakeAst,
          new Map(),
          undefined,
          undefined,
          knownVars,
        );

        const where = expr.where
          ? this._extractSubqueriesSync(
              expr.where,
              subPlanSteps,
              localKnownVars,
              undefined,
              preparedMatches,
            )
          : undefined;
        if (where) {
          subPlanSteps.push({ kind: 'FilterStep', predicate: where });
        }

        const projection = this._extractSubqueriesSync(
          expr.projection,
          subPlanSteps,
          localKnownVars,
          undefined,
          preparedMatches,
        );

        steps.push({
          kind: 'PatternComprehensionStep',
          subPlan: subPlanSteps,
          projection,
          resultVariable: varName,
        } as PatternComprehensionStep);

        knownVars.add(varName);
        return { kind: 'Identifier', name: varName };
      }
      case 'PatternExpr': {
        const varName = this._patternPlanner._syntheticVar('pexpr', steps.length);
        const subPlanSteps: PlanStep[] = [];
        const clonedPattern = this._cloneMatchPattern(expr.pattern);
        const pathVariables = this._patternPlanner.assignAndExtractPathVariables(
          clonedPattern,
          subPlanSteps,
        );

        const fakeAst: QueryAst = {
          kind: 'Query',
          readingClauses: [],
          return: { kind: 'Return', distinct: false, items: [] },
          segments: [],
        };

        this._patternPlanner.planPath(
          clonedPattern,
          subPlanSteps,
          fakeAst,
          new Map(),
          undefined,
          undefined,
          knownVars,
        );

        steps.push({
          kind: 'PatternExprStep',
          subPlan: subPlanSteps,
          pathVariables,
          resultVariable: varName,
        } as PatternExprStep);

        knownVars.add(varName);
        patternExprVars?.add(varName);
        return { kind: 'Identifier', name: varName };
      }
      case 'Map': {
        const props: Record<string, Expression> = {};
        for (const [k, v] of Object.entries(expr.props)) {
          props[k] = this._extractSubqueriesSync(
            v,
            steps,
            knownVars,
            patternExprVars,
            preparedMatches,
          );
        }
        return { ...expr, props };
      }
      case 'FunctionCall': {
        const args: Expression[] = [];
        for (const a of expr.args) {
          args.push(
            this._extractSubqueriesSync(a, steps, knownVars, patternExprVars, preparedMatches),
          );
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

  /**
   * Walk a predicate expression and replace any identifier that is the
   * result variable of a {@link PatternExprStep} with `size(x) > 0`.
   *
   * Per openCypher spec a bare pattern expression evaluates to a list of
   * paths, so `size(paths) > 0` is the correct existence check. Without
   * this rewrite, `Boolean([])` in the FilterStep executor returns `true`
   * for an empty list, letting non-matching rows through.
   */
  private _rewritePatternExprsAsPredicate(
    expr: Expression,
    patternExprVars: Set<string>,
  ): Expression {
    if (patternExprVars.size === 0) return expr;

    const rewrite = (e: Expression): Expression => {
      switch (e.kind) {
        case 'Identifier':
          if (patternExprVars.has(e.name)) {
            return {
              kind: 'Binary',
              op: '>',
              left: {
                kind: 'FunctionCall',
                name: 'size',
                args: [e],
                distinct: false,
              },
              right: { kind: 'Literal', value: 0 },
            };
          }
          return e;
        case 'Binary':
          return { ...e, left: rewrite(e.left), right: rewrite(e.right) };
        case 'Unary':
          return { ...e, operand: rewrite(e.operand) };
        default:
          return e;
      }
    };

    return rewrite(expr);
  }

  private _planSegmentSync(
    ast: QueryAst,
    steps: PlanStep[],
    knownVars: Set<string>,
    isWithStar: boolean,
    preparedMatches?: WeakMap<MatchClause, PreparedMatchClause>,
  ): void {
    // ── Process each MATCH / OPTIONAL MATCH / UNWIND clause ─────────
    for (const clause of ast.readingClauses) {
      if (clause.kind === 'Match') {
        this._planMatchClauseSync(clause, steps, knownVars, ast, preparedMatches);
      } else if (clause.kind === 'Unwind') {
        const expr = this._extractSubqueriesSync(
          clause.expression,
          steps,
          knownVars,
          undefined,
          preparedMatches,
        );
        steps.push({
          kind: 'UnwindStep',
          expression: expr,
          variable: clause.alias,
        });
        knownVars.add(clause.alias);
      }
    }

    // ── Emit CREATE steps ───────────────────────────────────────────
    if (ast.create) {
      for (const pattern of ast.create.patterns) {
        this._planCreatePath(pattern, steps, knownVars);
      }
    }

    // ── Emit MERGE steps ────────────────────────────────────────────
    if (ast.merge) {
      for (const mergeClause of ast.merge) {
        const onCreateItems: Array<{
          variable: string;
          property?: string;
          operator: '=' | '+=';
          value: Expression;
          entityKind: 'node' | 'edge';
        }> = [];
        const onMatchItems: Array<{
          variable: string;
          property?: string;
          operator: '=' | '+=';
          value: Expression;
          entityKind: 'node' | 'edge';
        }> = [];
        for (const action of mergeClause.actions) {
          const arr = action.onMatch ? onMatchItems : onCreateItems;
          for (const item of action.items) {
            const valExpr = this._extractSubqueriesSync(
              item.value,
              steps,
              knownVars,
              undefined,
              preparedMatches,
            );
            const varName = (item.variable as IdentifierExpr).name;
            const entityKind = this._resolveEntityKind(varName, ast);
            arr.push({
              variable: varName,
              property: item.property,
              operator: item.operator,
              value: valExpr,
              entityKind,
            });
          }
        }
        const readSteps: PlanStep[] = [];
        this._patternPlanner.planPath(
          mergeClause.pattern,
          readSteps,
          ast,
          new Map(),
          undefined,
          undefined,
          knownVars,
        );

        const createSteps: PlanStep[] = [];
        this._planCreatePath(mergeClause.pattern, createSteps, new Set(knownVars));

        steps.push({
          kind: 'MergeStep',
          pattern: mergeClause.pattern,
          readSteps,
          createSteps,
          onCreateItems,
          onMatchItems,
        });

        const segments = getPatternSegments(mergeClause.pattern);
        if (mergeClause.pattern.kind === 'NamedPath' && mergeClause.pattern.name) {
          knownVars.add(mergeClause.pattern.name);
        }
        for (const segment of segments) {
          if (segment.variable) knownVars.add(segment.variable);
        }
      }
    }

    // ── Emit SET steps ──────────────────────────────────────────────
    if (ast.set) {
      for (const item of ast.set.items) {
        const valExpr = this._extractSubqueriesSync(
          item.value,
          steps,
          knownVars,
          undefined,
          preparedMatches,
        );
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
          assignments: [{ key: item.property, operator: item.operator, value: valExpr }],
        });
      }
    }

    // ── Emit DELETE steps ───────────────────────────────────────────
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

    // ── Emit REMOVE steps ───────────────────────────────────────────
    if (ast.remove) {
      for (const item of ast.remove.items) {
        const entityKind = this._resolveEntityKind(item.variable.name, ast);
        if (item.labels && item.labels.length > 0) {
          steps.push({
            kind: 'RemoveLabelStep',
            variable: item.variable.name,
            labels: item.labels,
          } as RemoveLabelStep);
        } else if (item.property) {
          steps.push({
            kind: 'RemovePropertyStep',
            variable: item.variable.name,
            entityKind,
            property: item.property,
          });
        }
      }
    }

    // ── Emit CREATE INDEX step ──────────────────────────────────────
    if (ast.createIndex) {
      steps.push({
        kind: 'CreateIndexStep',
        name: ast.createIndex.name,
        target: ast.createIndex.target,
        propertyKeys: ast.createIndex.propertyKeys,
        ...(ast.createIndex.labelOrType !== undefined
          ? { labelOrType: ast.createIndex.labelOrType }
          : {}),
      });
    }

    // ── Emit DROP INDEX step ────────────────────────────────────────
    if (ast.dropIndex) {
      steps.push({
        kind: 'DropIndexStep',
        name: ast.dropIndex.name,
      });
    }

    // ── Emit SHOW INDEXES step ──────────────────────────────────────
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

    // Shallow-copy RETURN & ORDER BY items so subquery rewriting never mutates caller AST
    const workingOrderBy = ast.orderBy
      ? { ...ast.orderBy, items: ast.orderBy.items.map((it) => ({ ...it })) }
      : undefined;
    const workingReturn = {
      ...ast.return,
      items: ast.return.items.map((it) => ({ ...it })),
    };
    const workingAst: QueryAst = {
      ...ast,
      ...(workingOrderBy ? { orderBy: workingOrderBy } : {}),
      return: workingReturn,
    };

    // ── 6. Post-scan clauses (aggregate path vs plain path) ─────────
    const hasAggregates = this._projPlanner.hasAggregates(workingAst);

    if (hasAggregates) {
      if (workingAst.skip || workingAst.limit) {
        steps.push(this._projPlanner.planLimit(workingAst));
      }

      this._projPlanner.planAggregation(workingAst, steps);

      const aggStep = steps[steps.length - 1] as AggregateStep;

      if (workingOrderBy) {
        for (let i = 0; i < workingOrderBy.items.length; i++) {
          workingOrderBy.items[i].expression = this._extractSubqueriesSync(
            workingOrderBy.items[i].expression,
            steps,
            knownVars,
            undefined,
            preparedMatches,
          );
        }
        const items = workingOrderBy.items.map((item) => {
          const { rewritten, extracted } =
            this._projPlanner.extractAndRewriteAggregates(item.expression);
          aggStep.aggregates.push(...extracted);
          return { expression: rewritten, direction: item.direction };
        });
        steps.push({ kind: 'SortStep', items });
      }
    } else {
      if (workingOrderBy) {
        for (let i = 0; i < workingOrderBy.items.length; i++) {
          workingOrderBy.items[i].expression = this._extractSubqueriesSync(
            workingOrderBy.items[i].expression,
            steps,
            knownVars,
            undefined,
            preparedMatches,
          );
        }
        steps.push(this._projPlanner.planSort(workingAst));
      }

      if (workingAst.skip || workingAst.limit) {
        steps.push(this._projPlanner.planLimit(workingAst));
      }
    }

    // ── 7. Projection — always last ─────────────────────────────────
    for (let i = 0; i < workingReturn.items.length; i++) {
      workingReturn.items[i].expression = this._extractSubqueriesSync(
        workingReturn.items[i].expression,
        steps,
        knownVars,
        undefined,
        preparedMatches,
      );
    }
    const projStep = this._projPlanner.planProjection(workingAst, hasAggregates);
    if (isWithStar) {
      projStep.star = true;
    }
    steps.push(projStep);

    // ── 8. Prune knownVars based on projection ──────────────────────
    if (!isWithStar) {
      const projected = new Set<string>();
      for (const item of workingReturn.items) {
        if (item.alias) projected.add(item.alias);
        else if (item.expression.kind === 'Identifier') projected.add(item.expression.name);
      }
      knownVars.clear();
      for (const p of projected) knownVars.add(p);
    } else {
      for (const item of workingReturn.items) {
        if (item.alias) knownVars.add(item.alias);
      }
    }
  }

  // ── CREATE pattern planning ──────────────────────────────────────

  /**
   * Convert a CREATE pattern path (or named path) into write plan steps.
   */
  private _planCreatePath(
    pattern: MatchPattern,
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

        if (!knownVars.has(variable)) {
          steps.push({
            kind: 'CreateNodeStep',
            variable,
            labels: node.labels,
            properties: node.properties,
          });
          if (node.variable) {
            knownVars.add(node.variable);
          }
        }

        prevNodeVar = variable;
      } else {
        const edge = seg as EdgePattern;
        const nextSeg = segments[i + 1];
        const targetNode =
          nextSeg?.kind === 'NodePattern' ? (nextSeg as NodePattern) : undefined;
        const targetVar =
          targetNode?.variable ??
          this._patternPlanner._syntheticVar('create_node', createIdx++);

        const sourceVar = prevNodeVar;
        const edgeVar =
          edge.variable ??
          this._patternPlanner._syntheticVar('create_edge', createIdx++);

        if (targetNode && !knownVars.has(targetVar)) {
          steps.push({
            kind: 'CreateNodeStep',
            variable: targetVar,
            labels: targetNode.labels,
            properties: targetNode.properties,
          });
          if (targetNode.variable) {
            knownVars.add(targetNode.variable);
          }
          prevNodeVar = targetVar;
          i++;
        } else if (targetNode) {
          prevNodeVar = targetVar;
          i++;
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

  private _resolveEntityKind(varName: string, ast: QueryAst): 'node' | 'edge' {
    let res: 'node' | 'edge' | undefined;

    const checkPatterns = (patterns: MatchPattern[]): void => {
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

    for (const clause of ast.readingClauses) {
      if (clause.kind === 'Match') {
        if (!res) checkPatterns(clause.patterns);
      }
    }

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

  private _planMatchClauseSync(
    matchClause: MatchClause,
    steps: PlanStep[],
    knownVars: Set<string>,
    ast: QueryAst,
    preparedMatches?: WeakMap<MatchClause, PreparedMatchClause>,
  ): void {
    const pre = preparedMatches?.get(matchClause);

    const varRegistry =
      pre?.varRegistry ?? this._whereDecomposer.collectVariables(matchClause.patterns);

    const { perVar, crossVar } = pre
      ? { perVar: pre.perVar, crossVar: [...pre.crossVar] }
      : matchClause.where
        ? this._whereDecomposer.decompose(matchClause.where.expression, varRegistry)
        : { perVar: new Map(), crossVar: [] as Expression[] };

    const idLookups = pre?.idLookups ?? this._reorderer.detectIdLookups(crossVar, varRegistry);

    const orderedPatterns =
      pre?.orderedPatterns ??
      this._reorderer.reorderSync(matchClause.patterns, varRegistry, perVar, idLookups);

    const targetSteps: PlanStep[] = matchClause.optional ? [] : steps;

    const consumed = new Set<string>();
    for (const pattern of orderedPatterns) {
      this._patternPlanner.planPath(
        pattern,
        targetSteps,
        ast,
        perVar,
        idLookups,
        consumed,
        knownVars,
      );
    }

    if (consumed.size > 0) {
      const lookupExprs = new Set<Expression>();
      this._reorderer.collectIdLookupExprs(crossVar, lookupExprs, consumed);
      this._reorderer.removeIdLookups(crossVar, lookupExprs);
    }

    const newVars: string[] = [];
    for (const v of varRegistry.keys()) {
      if (!knownVars.has(v)) {
        newVars.push(v);
      }
    }

    for (const v of newVars) knownVars.add(v);

    if (crossVar.length > 0) {
      const predicate = this._whereDecomposer.andAll(crossVar);
      const patternExprVars = new Set<string>();
      const rewritten = this._extractSubqueriesSync(
        predicate,
        targetSteps,
        knownVars,
        patternExprVars,
        preparedMatches,
      );
      targetSteps.push({
        kind: 'FilterStep',
        predicate: this._rewritePatternExprsAsPredicate(rewritten, patternExprVars),
      });
    }

    if (matchClause.optional) {
      steps.push({
        kind: 'OptionalMatchStep',
        readSteps: targetSteps,
        newVars,
      });
    }
  }
}
