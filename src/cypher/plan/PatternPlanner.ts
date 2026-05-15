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
    idLookups?: Map<string, unknown>,
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
      this._planTrailingSegments(segments, steps, ast, pattern);
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

        // Expand in the reversed direction
        const revDirection: 'out' | 'in' =
          firstEdge.direction === 'out' ? 'in' : 'out';
        const reversedEdge: EdgePattern = {
          ...firstEdge,
          direction: revDirection,
        };

        this.planEdgeExpand(reversedEdge, firstNode, steps, ast, pathVar);

        // Handle any remaining segments after the first edge→node pair
        for (let i = 3; i < segments.length; i += 2) {
          const edge = segments[i] as EdgePattern;
          const nextNode = segments[i + 1] as NodePattern;
          this.planEdgeExpand(edge, nextNode, steps, ast, pathVar);
        }
        return;
      }
    }

    const extraFilters = perVar.get(firstVar) ?? [];
    this.planNodeScan(firstNode, steps, extraFilters);

    // Walk alternating edge → node pairs.
    for (let i = 1; i < segments.length; i += 2) {
      const edge = segments[i] as EdgePattern;
      const targetNode = segments[i + 1] as NodePattern;
      this.planEdgeExpand(edge, targetNode, steps, ast, pathVar);
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
  ): void {
    const pathVar = pattern.kind === 'NamedPath' ? pattern.name : undefined;
    for (let i = 1; i < segments.length; i += 2) {
      const edge = segments[i] as EdgePattern;
      const targetNode = segments[i + 1] as NodePattern;
      this.planEdgeExpand(edge, targetNode, steps, ast, pathVar);
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
