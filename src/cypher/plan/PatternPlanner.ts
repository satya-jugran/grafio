/**
 * Pattern-to-plan-step conversion for the Cypher query planner.
 *
 * Translates MATCH pattern AST nodes into physical execution steps:
 * {@link NodeScanStep}, {@link EdgeExpandStep}, and optionally
 * {@link NodeSeekStep} for id-lookup predicates.
 *
 * @module cypher/plan/PatternPlanner
 */

import {
  QueryAst,
  PatternPath,
  NamedPath,
  PatternSegment,
  getPatternSegments,
  NodePattern,
  EdgePattern,
  Expression,
  PropertyMap,
} from '../ast/AstNode';
import {
  PlanStep,
  NodeScanStep,
  NodeSeekStep,
  PropertyFilter,
  EdgeExpandStep,
  FilterStep,
} from './QueryPlan';

// ── PatternPlanner ─────────────────────────────────────────────────

export class PatternPlanner {
  /**
   * Convert a pattern path (or named path) into plan steps,
   * injecting per-variable WHERE predicates into NodeScanSteps.
   *
   * When the root variable has an id-lookup predicate, a
   * {@link NodeSeekStep} is emitted instead of {@link NodeScanStep}.
   */
  planPath(
    pattern: PatternPath | NamedPath,
    steps: PlanStep[],
    ast: QueryAst,
    perVar: Map<string, PropertyFilter[]>,
    perEdgeVar?: Map<string, PropertyFilter[]>,
    idLookups?: Map<string, unknown>,
    consumed?: Set<string>,
  ): void {
    const segments = getPatternSegments(pattern);
    if (segments.length === 0) return;

    const pathVar = pattern.kind === 'NamedPath' ? pattern.name : undefined;

    // The first segment is always a NodePattern.
    const firstNode = segments[0] as NodePattern;
    const firstVar = firstNode.variable ?? this._syntheticVar('node', steps.length);

    // ── Root id-lookup → NodeSeekStep for first node ────────────
    if (firstNode.variable && idLookups?.has(firstNode.variable)) {
      const idValue = idLookups.get(firstNode.variable);
      steps.push({
        kind: 'NodeSeekStep',
        index: 'id',
        value: idValue,
        variable: firstVar,
      });
      consumed?.add(firstNode.variable);
      this._planTrailingSegments(segments, steps, ast, pattern, perEdgeVar);
      this._emitPerVarFilters(firstNode.variable, perVar, steps);
      return;
    }

    // ── Dependent-variable id-lookup on first edge target ──────
    // Reverse the pattern: seek the target, then expand backwards.
    if (segments.length >= 3 && idLookups) {
      const firstEdge = segments[1] as EdgePattern;
      const targetNode = segments[2] as NodePattern;
      if (targetNode.variable && idLookups.has(targetNode.variable)) {
        const idValue = idLookups.get(targetNode.variable);
        const targetVar = targetNode.variable ??
          this._syntheticVar('target', steps.length);

        steps.push({
          kind: 'NodeSeekStep',
          index: 'id',
          value: idValue,
          variable: targetVar,
        });
        consumed?.add(targetNode.variable);

        // Expand in the reversed direction
        const revDirection: 'out' | 'in' =
          firstEdge.direction === 'out' ? 'in' : 'out';
        const reversedEdge: EdgePattern = {
          ...firstEdge,
          direction: revDirection,
        };

        this.planEdgeExpand(reversedEdge, firstNode, steps, ast, pathVar, perEdgeVar);

        // Handle any remaining segments after the first edge→node pair
        for (let i = 3; i < segments.length; i += 2) {
          const edge = segments[i] as EdgePattern;
          const nextNode = segments[i + 1] as NodePattern;
          this.planEdgeExpand(edge, nextNode, steps, ast, pathVar, perEdgeVar);
        }
        this._emitPerVarFilters(firstNode.variable, perVar, steps);
        return;
      }
    }

    const extraFilters = perVar.get(firstVar) ?? [];
    this.planNodeScan(firstNode, steps, extraFilters);

    // Walk alternating edge → node pairs.
    for (let i = 1; i < segments.length; i += 2) {
      const edge = segments[i] as EdgePattern;
      const targetNode = segments[i + 1] as NodePattern;
      this.planEdgeExpand(edge, targetNode, steps, ast, pathVar, perEdgeVar);
    }
  }

  /**
   * Create a {@link NodeScanStep} from a {@link NodePattern}.
   */
  planNodeScan(
    node: NodePattern,
    steps: PlanStep[],
    extraFilters?: PropertyFilter[],
  ): void {
    const label = node.labels.length > 0 ? node.labels[0] : '';
    const variable = node.variable ?? this._syntheticVar('node', steps.length);

    const inlineFilters: PropertyFilter[] =
      node.properties && Object.keys(node.properties).length > 0
        ? Object.entries(node.properties).map(([key, value]) => ({
            key,
            value,
            op: '=' as const,
          }))
        : [];

    const allFilters = [...inlineFilters, ...(extraFilters ?? [])];
    const propertyFilters: PropertyFilter[] | undefined =
      allFilters.length > 0 ? allFilters : undefined;

    steps.push({
      kind: 'NodeScanStep',
      label,
      types: node.labels.length > 0 ? node.labels : undefined,
      variable,
      propertyFilters,
    });
  }

  /**
   * Create an {@link EdgeExpandStep} from an {@link EdgePattern} and
   * target {@link NodePattern}.
   */
  planEdgeExpand(
    edge: EdgePattern,
    targetNode: NodePattern,
    steps: PlanStep[],
    ast: QueryAst,
    pathVar?: string,
    perEdgeVar?: Map<string, PropertyFilter[]>,
  ): void {
    const source = this._findLastNodeVar(steps);
    const target =
      targetNode.variable ?? this._syntheticVar('target', steps.length);

    const isMultiHop = edge.minHops !== 1 || edge.maxHops !== 1;
    let strategy: EdgeExpandStep['strategy'] = 'single-hop';

    if (isMultiHop) {
      strategy = ast.limit ? 'multi-hop-dfs' : 'multi-hop-bfs';
    }

    const hasEdgeProps =
      edge.properties && Object.keys(edge.properties).length > 0;
    const edgeVar =
      edge.variable ??
      (hasEdgeProps ? this._syntheticVar('edge', steps.length) : undefined);

    const expandStep: EdgeExpandStep = {
      kind: 'EdgeExpandStep',
      source,
      edgeVar,
      target,
      types: edge.types,
      direction: edge.direction,
      minHops: edge.minHops,
      maxHops: edge.maxHops,
      strategy,
    };

    if (pathVar) {
      expandStep.pathVar = pathVar;
    }

    if (targetNode.labels.length > 0) {
      expandStep.targetTypes = targetNode.labels;
    }

    // Apply per-edge-variable WHERE predicates (e.g. r1.weight > 5)
    // to EdgeExpandStep.edgePropertyFilters so the executor can push
    // them into the storage-layer getEdgesFrom / getEdgesTo call.
    if (edgeVar && perEdgeVar) {
      const edgeFilters = perEdgeVar.get(edgeVar);
      if (edgeFilters && edgeFilters.length > 0) {
        expandStep.edgePropertyFilters = edgeFilters;
      }
    }

    steps.push(expandStep);

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

  /**
   * Plan the remaining edge→node segments of a pattern path after the
   * first node has been handled by a {@link NodeSeekStep}.
   */
  private _planTrailingSegments(
    segments: PatternSegment[],
    steps: PlanStep[],
    ast: QueryAst,
    pattern: PatternPath | NamedPath,
    perEdgeVar?: Map<string, PropertyFilter[]>,
  ): void {
    const pathVar = pattern.kind === 'NamedPath' ? pattern.name : undefined;
    for (let i = 1; i < segments.length; i += 2) {
      const edge = segments[i] as EdgePattern;
      const targetNode = segments[i + 1] as NodePattern;
      this.planEdgeExpand(edge, targetNode, steps, ast, pathVar, perEdgeVar);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /**
   * Convert a {@link PropertyMap} into an array of {@link FilterStep}
   * objects, one per property key-value pair.
   */
  private _propertyMapToFilters(
    variable: string,
    properties: PropertyMap,
  ): FilterStep[] {
    const steps: FilterStep[] = [];

    for (const [key, value] of Object.entries(properties)) {
      const rhs: Expression =
        typeof value === 'object' && value !== null && 'kind' in value
          ? (value as Expression)
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
   * Emit per-variable WHERE predicates as FilterSteps for a variable
   * that was not scanned via {@link planNodeScan} (e.g. when the
   * root is reached via a reversed edge in the id-lookup reversal
   * branch, or when the root itself is sought via NodeSeekStep).
   */
  private _emitPerVarFilters(
    varName: string | undefined,
    perVar: Map<string, PropertyFilter[]>,
    steps: PlanStep[],
  ): void {
    if (!varName) return;
    const predicates = perVar.get(varName);
    if (!predicates || predicates.length === 0) return;
    steps.push(...this._perVarToFilterSteps(varName, predicates));
  }

  /**
   * Convert per-variable {@link PropertyFilter}s into {@link FilterStep}s
   * by rebuilding the corresponding {@link Expression} AST.
   */
  private _perVarToFilterSteps(
    varName: string,
    filters: PropertyFilter[],
  ): FilterStep[] {
    return filters.map((f) => ({
      kind: 'FilterStep' as const,
      predicate: this._propertyFilterToExpr(varName, f),
    }));
  }

  /**
   * Convert a single {@link PropertyFilter} into an {@link Expression}.
   * Supports binary comparisons, IS NULL, IN, and nested AND/OR.
   */
  private _propertyFilterToExpr(
    varName: string,
    f: PropertyFilter,
  ): Expression {
    // ── Nested AND ────────────────────────────────────────────────
    if (f.AND) {
      if (f.AND.length === 0) {
        return { kind: 'Literal', value: true };
      }
      let left = this._propertyFilterToExpr(varName, f.AND[0]);
      for (let i = 1; i < f.AND.length; i++) {
        left = {
          kind: 'Binary',
          op: 'AND',
          left,
          right: this._propertyFilterToExpr(varName, f.AND[i]),
        };
      }
      return left;
    }

    // ── Nested OR ─────────────────────────────────────────────────
    if (f.OR) {
      if (f.OR.length === 0) {
        return { kind: 'Literal', value: false };
      }
      let left = this._propertyFilterToExpr(varName, f.OR[0]);
      for (let i = 1; i < f.OR.length; i++) {
        left = {
          kind: 'Binary',
          op: 'OR',
          left,
          right: this._propertyFilterToExpr(varName, f.OR[i]),
        };
      }
      return left;
    }

    // ── IS NULL / IS NOT NULL ─────────────────────────────────────
    if (f.op === 'IS_NULL' || f.op === 'IS_NOT_NULL') {
      return {
        kind: 'IsNull',
        expression: {
          kind: 'PropertyAccess',
          object: { kind: 'Identifier', name: varName },
          property: f.key!,
        },
        not: f.op === 'IS_NOT_NULL',
      };
    }

    // ── IN / NOT IN ───────────────────────────────────────────────
    if (f.op === 'IN' || f.op === 'NOT_IN') {
      const elements: Expression[] = Array.isArray(f.value)
        ? f.value.map((v) =>
            typeof v === 'object' && v !== null && 'kind' in v
              ? (v as Expression)
              : { kind: 'Literal' as const, value: v as string | number | boolean | null },
          )
        : [];
      return {
        kind: 'In',
        expression: {
          kind: 'PropertyAccess',
          object: { kind: 'Identifier', name: varName },
          property: f.key!,
        },
        list: { kind: 'List', elements },
        not: f.op === 'NOT_IN',
      };
    }

    // ── Binary comparison (=, <>, >, <, >=, <=, CONTAINS, …) ─────
    const rhs: Expression =
      typeof f.value === 'object' && f.value !== null && 'kind' in f.value
        ? (f.value as Expression)
        : { kind: 'Literal' as const, value: f.value as string | number | boolean | null };

    return {
      kind: 'Binary',
      op: f.op as import('../ast/AstNode').BinaryOp,
      left: {
        kind: 'PropertyAccess',
        object: { kind: 'Identifier', name: varName },
        property: f.key!,
      },
      right: rhs,
    };
  }

  /** Find the variable of the most recently scanned, sought, or expanded-to node. */
  private _findLastNodeVar(steps: PlanStep[]): string {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.kind === 'NodeScanStep') {
        return step.variable;
      }
      if (step.kind === 'NodeSeekStep') {
        return step.variable;
      }
      if (step.kind === 'EdgeExpandStep') {
        return step.target;
      }
    }
    return '__root__';
  }

  /** Generate a synthetic variable name for anonymous pattern elements. */
  _syntheticVar(prefix: string, index: number): string {
    return `__${prefix}_${index}`;
  }
}
