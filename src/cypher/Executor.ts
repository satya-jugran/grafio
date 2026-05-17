/**
 * Query plan executor for the Cypher execution layer.
 *
 * Walks a {@link QueryPlan} step by step, calling {@link Graph} API methods
 * and accumulating rows into an output table. Each step receives the current
 * row buffer and returns a new row buffer (pure function semantics).
 *
 * ### Execution model
 * - Rows are modelled as `Map<string, unknown>` (variable name → value).
 * - Parameter placeholders (`$name`) are resolved from the `params` map.
 * - A {@link NodeScanStep} calls `graph.getNodes({ filter: { types: [label] } })` or `graph.getNodes()`.
 * - An {@link EdgeExpandStep} dispatches on its `strategy` field:
 *   - `'single-hop'` → `getEdgesFrom` / `getEdgesTo`
 *   - `'multi-hop-bfs'` → BFS traversal
 *   - `'multi-hop-dfs'` → DFS traversal
 * - No traversal logic decisions are made here; the Executor reads the
 *   strategy set by the {@link Planner}.
 *
 * @module cypher/Executor
 */

import { Graph } from '../Graph';
import { Node } from '../Node';
import { Edge } from '../Edge';
import { GraphTransaction } from '../Graph/GraphTransaction';
import {
  QueryPlan,
  PlanStep,
  NodeScanStep,
  NodeSeekStep,
  EdgeExpandStep,
  FilterStep,
  ProjectStep,
  SortStep,
  LimitStep,
  AggregateStep,
  AggregateSpec,
  PlanStepExecutionStats,
  PlanExecutionStats,
} from './plan/QueryPlan';
import { CypherResult, CypherRow, CypherSummary } from './Result';
import { Expression } from './ast/AstNode';
import { CypherRuntimeError, UnboundParameterError, TypeMismatchError } from './errors';

// ── Row type ──────────────────────────────────────────────────────

/** Internal row representation: variable name → bound value. */
type Row = Map<string, unknown>;

// ── Executor ──────────────────────────────────────────────────────

/**
 * Executes a {@link QueryPlan} against a {@link Graph} instance.
 */
export class Executor {
  private readonly _graph: Graph;

  constructor(graph: Graph) {
    this._graph = graph;
  }

  /**
   * Execute a query plan and return the result set.
   *
   * @param plan   - The physical execution plan from the {@link Planner}.
   * @param params - Named parameter map (`$key` → value).
   * @param transaction - Optional transaction for consistent reads within a transaction context.
   * @returns A {@link CypherResult} containing rows and execution summary.
   */
  public async execute(
    plan: QueryPlan,
    params: Record<string, unknown> = {},
    transaction?: GraphTransaction,
  ): Promise<CypherResult> {
    const startTime = Date.now();
    const stepStats: PlanStepExecutionStats[] = [];

    // Initial row buffer: a single empty row as the starting point.
    let rows: Row[] = [new Map()];

    // Walk each plan step, transforming the row buffer.
    for (const step of plan.steps) {
      const stepStart = Date.now();
      rows = await this._executeStep(step, rows, params, transaction);
      const stepTime = Date.now() - stepStart;
      stepStats.push({
        stepKind: step.kind,
        timeMs: stepTime,
        percentageOfTotal: 0, // calculated after all steps
        rowsOut: rows.length,
      });
    }

    // Use sum of step times as total for percentage calculation
    // This ensures percentages always sum to 100% regardless of overhead
    const stepTotalTime = stepStats.reduce((sum, s) => sum + s.timeMs, 0);
    const totalTime = stepTotalTime > 0 ? stepTotalTime : (Date.now() - startTime);

    // Calculate percentages
    const stats: PlanExecutionStats = {
      totalTimeMs: totalTime,
      steps: stepStats.map((s) => ({
        ...s,
        percentageOfTotal: totalTime > 0 ? (s.timeMs / totalTime) * 100 : 0,
      })),
    };

    return this._buildResult(plan, rows, stats);
  }

  // ── Step dispatch ───────────────────────────────────────────────

  private async _executeStep(
    step: PlanStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    switch (step.kind) {
      case 'NodeScanStep':
        return this._executeNodeScan(step, rows, params, transaction);
      case 'NodeSeekStep':
        return this._executeNodeSeek(step, rows, params, transaction);
      case 'EdgeExpandStep':
        return this._executeEdgeExpand(step, rows, params, transaction);
      case 'FilterStep':
        return this._executeFilter(step, rows, params);
      case 'ProjectStep':
        return this._executeProject(step, rows, params);
      case 'SortStep':
        return this._executeSort(step, rows, params);
      case 'LimitStep':
        return this._executeLimit(step, rows, params);
      case 'AggregateStep':
        return this._executeAggregate(step, rows, params, transaction);
      default:
        throw new CypherRuntimeError(
          `Unknown plan step kind: ${(step as PlanStep).kind}`,
        );
    }
  }

  // ── NodeScanStep ────────────────────────────────────────────────

  private async _executeNodeScan(
    step: NodeScanStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    // Build the storage-level filter from step.types and step.propertyFilters.
    const filter: Record<string, unknown> = {};

    if (step.types?.length) {
      filter.types = step.types;
    } else if (step.label) {
      filter.types = [step.label];
    }

    if (step.propertyFilters?.length) {
      // Resolve $param references in property values before passing to
      // the storage layer.
      filter.properties = this._resolvePropertyFilterParams(
        step.propertyFilters as Array<Record<string, unknown>>,
        params,
      );
    }

    const nodes = Object.keys(filter).length > 0
      ? await this._graph.getNodes({ filter: filter as any, transaction } as any) as unknown as Node[]
      : await this._graph.getNodes({ transaction } as any);

    const result: Row[] = [];
    for (const row of rows) {
      for (const node of nodes) {
        const newRow = new Map(row);
        newRow.set(step.variable, node);
        result.push(newRow);
      }
    }
    return result;
  }

  /**
   * Recursively resolve {@code $param} references in a
   * {@link PropertyFilter} tree against the runtime parameter map.
   *
   * Parameter references are stored as {@code { kind: 'Parameter', name: 'x' }}
   * objects by the Planner; this helper replaces them with the actual
   * value from {@code params} before the storage layer sees them.
   */
  private _resolvePropertyFilterParams(
    filters: Array<Record<string, unknown>>,
    params: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    return filters.map((f) => this._resolveOneFilter(f, params));
  }

  private _resolveOneFilter(
    f: Record<string, unknown>,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(f)) {
      if (k === 'AND' && Array.isArray(v)) {
        resolved[k] = v.map((child: Record<string, unknown>) =>
          this._resolveOneFilter(child, params),
        );
      } else if (k === 'OR' && Array.isArray(v)) {
        resolved[k] = v.map((child: Record<string, unknown>) =>
          this._resolveOneFilter(child, params),
        );
      } else if (
        typeof v === 'object' &&
        v !== null &&
        (v as Record<string, unknown>).kind === 'Parameter'
      ) {
        const paramName = (v as Record<string, unknown>).name as string;
        if (!(paramName in params)) {
          throw new UnboundParameterError(paramName);
        }
        resolved[k] = params[paramName];
      } else {
        resolved[k] = v;
      }
    }

    return resolved;
  }

  // ── NodeSeekStep ────────────────────────────────────────────────

  /**
   * Resolve a value that may be a {@code { kind: 'Parameter', name: 'x' }}
   * AST node stored by the Planner.  If the value is a Parameter object,
   * look it up in {@code params} (throwing {@link UnboundParameterError}
   * if missing).  Otherwise return the value as-is.
   */
  private _resolveParam(
    value: unknown,
    params: Record<string, unknown>,
  ): unknown {
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<string, unknown>).kind === 'Parameter'
    ) {
      const name = (value as Record<string, unknown>).name as string;
      if (!(name in params)) {
        throw new UnboundParameterError(name);
      }
      return params[name];
    }
    return value;
  }

  /**
   * Direct node lookup — O(1) via {@code graph.getNode(id)} for id-indexed
   * seeks or {@code graph.getNodes({filter})} for property-indexed seeks.
   * Delegates entirely to the Graph API; no Executor-level indexes needed.
   */
  private async _executeNodeSeek(
    step: NodeSeekStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    let nodes: Node[];

    switch (step.index) {
      case 'id': {
        const id = this._resolveParam(step.value, params);
        const node = await this._graph.getNode(String(id ?? ''), transaction);
        nodes = node ? [node] : [];
        break;
      }
      case 'property': {
        const resolvedValue = this._resolveParam(step.value, params);
        const filter: {
          types?: string[];
          properties: Array<{ key: string; value: unknown; op?: '=' }>;
        } = {
          properties: [{ key: step.key!, value: resolvedValue, op: '=' }],
        };
        if (step.types?.length) filter.types = step.types;
        nodes = await this._graph.getNodes({ filter, transaction } as any) as unknown as Node[];
        break;
      }
      default:
        nodes = [];
    }

    const result: Row[] = [];
    for (const row of rows) {
      for (const node of nodes) {
        const newRow = new Map(row);
        newRow.set(step.variable, node);
        result.push(newRow);
      }
    }
    return result;
  }

  // ── EdgeExpandStep ──────────────────────────────────────────────

  private async _executeEdgeExpand(
    step: EdgeExpandStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    const result: Row[] = [];
    for (const row of rows) {
      const sourceNode = row.get(step.source) as Node | undefined;
      if (!sourceNode) continue;
      const expanded = await this._expandFromNode(step, row, sourceNode, params, transaction);
      result.push(...expanded);
    }
    return result;
  }

  private async _expandFromNode(
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.strategy === 'single-hop') {
      return this._expandSingleHop(step, row, sourceNode, transaction);
    }
    return this._expandMultiHop(step, row, sourceNode, transaction);
  }

  private async _expandSingleHop(
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    const filterArg = step.types.length > 0
      ? { filter: { types: step.types } }
      : undefined;

    const edges =
      step.direction === 'out'
        ? await this._graph.getEdgesFrom(sourceNode.id, { ...filterArg, transaction } as any)
        : await this._graph.getEdgesTo(sourceNode.id, { ...filterArg, transaction } as any);

    // Collect all target IDs
    const targetIds = edges.map(e => step.direction === 'out' ? e.targetId : e.sourceId);
    const uniqueIds = [...new Set(targetIds)];
    // Batch fetch all target nodes in ONE call
    const nodeMap = await this._graph.getNodesByIds(uniqueIds, transaction);

    const result: Row[] = [];
    for (const edge of edges) {
      const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
      const targetNode = nodeMap.get(targetId);
      if (!targetNode) continue;

      // Filter by target node type if labels were specified in the pattern
      // (e.g. (c:Course)-[:CONTAINS]->(ch:Chapter)).
      if (
        step.targetTypes &&
        step.targetTypes.length > 0 &&
        !step.targetTypes.includes(targetNode.type)
      ) {
        continue;
      }

      const newRow = new Map(row);
      if (step.edgeVar) newRow.set(step.edgeVar, edge);
      newRow.set(step.target, targetNode);

      // Bind named path variable.
      // For the first EdgeExpandStep in a named path this creates
      // [sourceNode, edge, targetNode].  For subsequent steps on the
      // same named path (e.g. MATCH p = (a)-[:R]->(b)-[:S]->(c)) the
      // row already carries a prefix from the prior step; we append
      // [edge, targetNode] to extend it rather than overwriting.
      if (step.pathVar) {
        const existingPath = newRow.get(step.pathVar) as
          | (Node | Edge)[]
          | undefined;
        if (existingPath && existingPath.length > 0) {
          newRow.set(step.pathVar, [...existingPath, edge, targetNode]);
        } else {
          newRow.set(step.pathVar, [sourceNode, edge, targetNode]);
        }
      }

      result.push(newRow);
    }
    return result;
  }

  private async _expandMultiHop(
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    const result: Row[] = [];
    // Track minimum hops at which each node was visited.
    // Using a map prevents over-pruning: a node reached via a shorter
    // path should still be explored downstream.
    const visited = new Map<string, number>([[sourceNode.id, 0]]);

    const frontier: Array<{
      node: Node;
      row: Row;
      hops: number;
      /** Node objects in traversal order (for pathVar). */
      pathNodes?: Node[];
      /** Edge objects in traversal order (for pathVar). */
      pathEdges?: Edge[];
    }> = [
        {
          node: sourceNode,
          row,
          hops: 0,
          pathNodes: step.pathVar ? [sourceNode] : undefined,
          pathEdges: step.pathVar ? [] : undefined,
        },
      ];

    const isBFS = step.strategy !== 'multi-hop-dfs';

    while (frontier.length > 0) {
      const { node, row: curRow, hops, pathNodes, pathEdges } = isBFS
        ? frontier.shift()!   // BFS: dequeue from front (FIFO)
        : frontier.pop()!;    // DFS: pop from back (LIFO)

      if (hops >= step.maxHops) continue;

      const filterArg = step.types.length > 0
        ? { filter: { types: step.types } }
        : undefined;

      const edges =
        step.direction === 'out'
          ? await this._graph.getEdgesFrom(node.id, { ...filterArg, transaction } as any)
          : await this._graph.getEdgesTo(node.id, { ...filterArg, transaction } as any);

      // For each node in frontier:
      const edgeIds = edges.map(e => step.direction === 'out' ? e.targetId : e.sourceId);
      const uniqueIds = [...new Set(edgeIds)];
      const nodeMap = await this._graph.getNodesByIds(uniqueIds, transaction);

      for (const edge of edges) {
        const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
        const targetNode = nodeMap.get(targetId);
        if (!targetNode) continue;

        // Filter by target node type if labels were specified in the pattern.
        if (
          step.targetTypes &&
          step.targetTypes.length > 0 &&
          !step.targetTypes.includes(targetNode.type)
        ) {
          continue;
        }

        const newHops = hops + 1;
        // Only track path state when a named path variable is requested
        // (step.pathVar).  Otherwise the spreads and frontier storage are
        // pure overhead.
        const newPathNodes = step.pathVar
          ? [...(pathNodes ?? []), targetNode]
          : undefined;
        const newPathEdges = step.pathVar
          ? [...(pathEdges ?? []), edge]
          : undefined;

        if (newHops >= step.minHops && newHops <= step.maxHops) {
          const newRow = new Map(curRow);
          if (step.edgeVar) newRow.set(step.edgeVar, edge);
          newRow.set(step.target, targetNode);

          // Bind named path variable: interleave nodes and edges
          // [node0, edge0, node1, edge1, ..., nodeN]
          if (step.pathVar && newPathNodes && newPathEdges) {
            const pathValue: (Node | Edge)[] = [newPathNodes[0]];
            for (let i = 0; i < newPathEdges.length; i++) {
              pathValue.push(newPathEdges[i], newPathNodes[i + 1]);
            }
            newRow.set(step.pathVar, pathValue);
          }

          result.push(newRow);
        }

        // Only skip if we've reached this node at ≤ the current hop count
        // (nothing new to explore downstream).
        const prevHops = visited.get(targetId);
        if (newHops < step.maxHops && (prevHops === undefined || newHops <= prevHops)) {
          visited.set(targetId, newHops);
          const nextRow = new Map(curRow);
          frontier.push({
            node: targetNode,
            row: nextRow,
            hops: newHops,
            pathNodes: newPathNodes,
            pathEdges: newPathEdges,
          });
        }
      }
    }
    return result;
  }

  // ── FilterStep ──────────────────────────────────────────────────

  private _executeFilter(
    step: FilterStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    return rows.filter((row) => {
      const result = this._evaluate(step.predicate, row, params);
      return Boolean(result);
    });
  }

  // ── ProjectStep ─────────────────────────────────────────────────

  private _executeProject(
    step: ProjectStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    const projected = rows.map((row) => {
      const newRow = new Map<string, unknown>();
      for (const col of step.columns) {
        newRow.set(col.alias, this._evaluate(col.expression, row, params));
      }
      return newRow;
    });

    if (!step.distinct) return projected;

    // Deduplicate: use a Set of composite keys built from column values.
    // For Node/Edge objects we use the .id field; for primitives, String().
    const seen = new Set<string>();
    const deduped: Row[] = [];

    for (const row of projected) {
      const keyParts: string[] = [];
      for (const col of step.columns) {
        const value = row.get(col.alias);
        if (value === null) {
          keyParts.push('\x00null');
        } else if (value === undefined) {
          keyParts.push('\x00undef');
        } else if (typeof value === 'object' && value !== null && 'id' in (value as object)) {
          // Node or Edge — compare by id.
          keyParts.push((value as { id: string }).id);
        } else {
          keyParts.push(String(value));
        }
      }
      const key = keyParts.join('\x00');

      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(row);
      }
    }

    return deduped;
  }

  // ── SortStep ────────────────────────────────────────────────────

  private _executeSort(
    step: SortStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    return [...rows].sort((a, b) => {
      for (const spec of step.items) {
        const va = this._evaluate(spec.expression, a, params);
        const vb = this._evaluate(spec.expression, b, params);
        const cmp = this._compare(va, vb);
        if (cmp !== 0) return spec.direction === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });
  }

  // ── LimitStep ───────────────────────────────────────────────────

  private _executeLimit(
    step: LimitStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    // Evaluate expressions at runtime so $param placeholders work.
    const start = step.skipExpr
      ? Math.max(0, Number(this._evaluate(step.skipExpr, rows[0], params)))
      : 0;
    const limitVal = step.limitExpr
      ? Number(this._evaluate(step.limitExpr, rows[0], params))
      : Infinity;
    const end = limitVal === Infinity ? undefined : start + limitVal;
    return rows.slice(start, end);
  }

  // ── AggregateStep ───────────────────────────────────────────────

  /**
   * Execute an {@link AggregateStep}, dispatching to storage-level
   * aggregation (Path A) for simple plans or in-process aggregation
   * (Path B) for complex plans with preceding pipeline steps.
   */
  private async _executeAggregate(
    step: AggregateStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    // Path A: Storage-level optimisation — only attempted when the
    // Planner cleared prior steps and set useStorageLevel.
    if (step.useStorageLevel && this._canUseStorageLevel(step)) {
      return this._executeAggregateStorageLevel(step, transaction);
    }

    // Path B: In-process aggregation over materialised rows.
    return this._executeAggregateInProcess(step, rows, params);
  }

  /**
   * Determine whether the {@link AggregateStep} qualifies for the
   * storage-level fast path (Path A).
   *
   * Conditions (all must be true):
   * 1. `sourceVariable` is set.
   * 2. `sourceEntity` is set.
   * 3. Every aggregate expression is "simple" — a variable reference,
   *    a property access on `sourceVariable`, or the COUNT(*) literal.
   */
  private _canUseStorageLevel(step: AggregateStep): boolean {
    // sourceEntity must be set by the Planner for either node or edge
    if (!step.sourceVariable || !step.sourceEntity) return false;
    if (step.groupBy.length > 0) return false;

    if (step.sourceEntity === 'edge') {
      // For edge-only aggregates: no type restriction needed
      // (edge types come from step.edgeTypes, not sourceTypes)
      for (const spec of step.aggregates) {
        if (!this._isSimpleAggregateExpr(spec.expression, step.sourceVariable!)) {
          return false;
        }
      }
      return true;
    }

    // Node aggregates: sourceType is optional (undefined = all types).
    // The storage-layer APIs accept undefined type filter internally.
    for (const spec of step.aggregates) {
      if (!this._isSimpleAggregateExpr(spec.expression, step.sourceVariable!)) {
        return false;
      }
    }

    return true;
  }


  /**
   * Check whether an aggregate expression is "simple" — i.e. it only
   * references `sourceVar` (either directly or via a property access)
   * or is the `COUNT(*)` sentinel literal.
   */
  private _isSimpleAggregateExpr(
    expr: Expression,
    sourceVar: string,
  ): boolean {
    // COUNT(*)
    if (expr.kind === 'Literal' && expr.value === '*') return true;

    // COUNT(p)
    if (expr.kind === 'Identifier' && expr.name === sourceVar) return true;

    // SUM(p.age), AVG(p.age), MIN(p.age), MAX(p.age), COLLECT(p.name)
    if (
      expr.kind === 'PropertyAccess' &&
      expr.object.kind === 'Identifier' &&
      expr.object.name === sourceVar
    ) {
      return true;
    }

    return false;
  }

  /**
   * Extract the property key from a simple aggregate expression.
   *
   * @returns The property name for a {@code PropertyAccess} on
   *          {@code sourceVar}, or {@code null} for variable/literal
   *          references (COUNT variants).
   */
  private _extractPropertyKey(
    expr: Expression,
    sourceVar: string,
  ): string | null {
    if (
      expr.kind === 'PropertyAccess' &&
      expr.object.kind === 'Identifier' &&
      expr.object.name === sourceVar
    ) {
      return expr.property;
    }
    return null;
  }

  // ── Path A: Storage-level aggregation ───────────────────────────

  /**
   * Execute aggregates by calling storage-layer methods directly,
   * avoiding full row materialisation.
   *
   * Coalesces multiple aggregates on the same property (with the same
   * `distinct` flag) into a single {@code aggregateNodeProperty} call.
   */
  private async _executeAggregateStorageLevel(
    step: AggregateStep,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    if (step.sourceEntity === 'edge') {
      return this._executeEdgeAggregateStorageLevel(step, transaction);
    }

    const sourceTypes = step.sourceTypes;
    // When sourceTypes is undefined (unlabeled MATCH) the storage APIs
    // accept undefined / empty filter to mean "all types".
    const typeFilter = sourceTypes ? { types: sourceTypes } : undefined;
    const resultRow = new Map<string, unknown>();

    // Partition aggregates by their storage call.
    // - `countAggs`: COUNT(p) / COUNT(*) → entity count
    // - `propertyAggs`: keyed by `propKey|distinct` → aggregateNodeProperty
    // - `collectAggs`: COLLECT(p.name) → getNodes + extract
    const countAggs: AggregateSpec[] = [];
    const propertyAggs = new Map<string, AggregateSpec[]>();
    const collectAggs: AggregateSpec[] = [];

    for (const spec of step.aggregates) {
      if (spec.function === 'COLLECT') {
        collectAggs.push(spec);
        continue;
      }

      const propKey = this._extractPropertyKey(
        spec.expression,
        step.sourceVariable!,
      );

      if (propKey === null) {
        // COUNT(p) or COUNT(*) — entity-level count
        countAggs.push(spec);
      } else {
        const coalesceKey = `${propKey}|${spec.distinct}`;
        if (!propertyAggs.has(coalesceKey)) {
          propertyAggs.set(coalesceKey, []);
        }
        propertyAggs.get(coalesceKey)!.push(spec);
      }
    }

    // ── Entity-level COUNT ─────────────────────────────────────────
    if (countAggs.length > 0) {
      const nodeCount = await this._graph.getNodeCount(
        typeFilter ? { filter: typeFilter, transaction } : { transaction },
      );
      for (const spec of countAggs) {
        resultRow.set(spec.alias, nodeCount);
      }
    }

    // ── Property aggregates (coalesced) ────────────────────────────
    for (const [coalesceKey, specs] of propertyAggs) {
      const [propKey, distinctStr] = coalesceKey.split('|');
      const distinct = distinctStr === 'true';

      const aggResult = await this._graph.aggregateNodeProperty(propKey, {
        filter: typeFilter as { types: string[] },
        distinct,
        transaction,
      });

      for (const spec of specs) {
        resultRow.set(spec.alias, this._extractAggField(aggResult, spec.function));
      }
    }

    // ── COLLECT aggregates ─────────────────────────────────────────
    if (collectAggs.length > 0) {
      const nodes = await this._graph.getNodes(
        typeFilter ? { filter: typeFilter, transaction } : { transaction },
      );

      for (const spec of collectAggs) {
        const propKey = this._extractPropertyKey(
          spec.expression,
          step.sourceVariable!,
        );
        const values = nodes
          .map((n) => (propKey ? n.properties[propKey] : n))
          .filter((v) => v !== undefined);

        resultRow.set(
          spec.alias,
          spec.distinct ? [...new Set(values)] : values,
        );
      }
    }

    return [resultRow];
  }

  /**
 * Execute edge-only aggregates via storage-layer calls,
 * avoiding full row materialisation.  Uses the existing
 * {@code getEdgeCount} and {@code aggregateEdgeProperty} APIs.
 *
 * Edge type filtering comes from {@link AggregateStep.edgeTypes},
 * which the Planner extracts from the EdgeExpandStep.
 */
  private async _executeEdgeAggregateStorageLevel(
    step: AggregateStep,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    // Build type filter from the Planner-supplied edgeTypes.
    const typeFilter = step.edgeTypes?.length
      ? { types: step.edgeTypes }
      : undefined;
    const resultRow = new Map<string, unknown>();

    const countAggs: AggregateSpec[] = [];
    const propertyAggs = new Map<string, AggregateSpec[]>();
    const collectAggs: AggregateSpec[] = [];

    for (const spec of step.aggregates) {
      if (spec.function === 'COLLECT') {
        collectAggs.push(spec);
        continue;
      }

      const propKey = this._extractPropertyKey(
        spec.expression,
        step.sourceVariable!,
      );

      if (propKey === null) {
        countAggs.push(spec);
      } else {
        const coalesceKey = `${propKey}|${spec.distinct}`;
        if (!propertyAggs.has(coalesceKey)) {
          propertyAggs.set(coalesceKey, []);
        }
        propertyAggs.get(coalesceKey)!.push(spec);
      }
    }

    // ── Edge-level COUNT ─────────────────────────────────────────
    if (countAggs.length > 0) {
      const edgeCount = await this._graph.getEdgeCount(
        typeFilter
          ? { filter: typeFilter, transaction }
          : (transaction ? { transaction } : undefined),
      );
      for (const spec of countAggs) {
        resultRow.set(spec.alias, edgeCount);
      }
    }

    // ── Edge property aggregates (coalesced) ──────────────────────
    for (const [coalesceKey, specs] of propertyAggs) {
      const [propKey, distinctStr] = coalesceKey.split('|');
      const distinct = distinctStr === 'true';

      const aggResult = await this._graph.aggregateEdgeProperty(propKey, {
        filter: typeFilter,
        distinct,
        transaction,
      } as any);

      for (const spec of specs) {
        resultRow.set(spec.alias, this._extractAggField(aggResult, spec.function));
      }
    }

    // ── COLLECT for edges (rare, but handle consistently) ────────
    if (collectAggs.length > 0) {
      const edges = await this._graph.getEdges(
        typeFilter
          ? { filter: typeFilter, transaction }
          : (transaction ? { transaction } : undefined),
      );

      for (const spec of collectAggs) {
        const propKey = this._extractPropertyKey(
          spec.expression,
          step.sourceVariable!,
        );
        const values = edges
          .map((e) => (propKey ? e.properties[propKey] : e))
          .filter((v) => v !== undefined);

        resultRow.set(
          spec.alias,
          spec.distinct ? [...new Set(values)] : values,
        );
      }
    }

    return [resultRow];
  }


  /**
   * Extract the relevant field from an {@link AggregateResult} based
   * on the aggregate function name.
   */
  private _extractAggField(
    result: { count: number; sum?: number; avg?: number; min?: number; max?: number },
    fn: string,
  ): unknown {
    switch (fn) {
      case 'COUNT':
        return result.count;
      case 'SUM':
        return result.sum ?? 0;
      case 'AVG':
        return result.avg ?? 0;
      case 'MIN':
        return result.min ?? null;
      case 'MAX':
        return result.max ?? null;
      default:
        return null;
    }
  }

  // ── Path B: In-process aggregation ──────────────────────────────

  /**
   * Compute aggregates in-process over the materialised row buffer.
   *
   * Supports both ungrouped (scalar) aggregation and grouped
   * aggregation via {@code step.groupBy}.
   */
  private _executeAggregateInProcess(
    step: AggregateStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Row[] {
    if (step.groupBy.length === 0) {
      // Scalar aggregation — collapse all rows into one.
      const resultRow = new Map<string, unknown>();
      for (const spec of step.aggregates) {
        resultRow.set(
          spec.alias,
          this._computeAggregate(spec, rows, params),
        );
      }
      return [resultRow];
    }

    // Grouped aggregation.
    const groups = new Map<string, { keyValues: unknown[]; rows: Row[] }>();

    for (const row of rows) {
      // Compute the group key by evaluating groupBy expressions.
      const keyValues: unknown[] = step.groupBy.map((expr) =>
        this._evaluate(expr, row, params),
      );
      const keyStr = this._serializeGroupKey(keyValues);

      if (!groups.has(keyStr)) {
        groups.set(keyStr, { keyValues, rows: [] });
      }
      groups.get(keyStr)!.rows.push(row);
    }

    // Emit one row per group.
    const result: Row[] = [];
    for (const [, group] of groups) {
      const resultRow = new Map<string, unknown>();

      // Include group-by values in the output.
      for (let i = 0; i < step.groupBy.length; i++) {
        // Use the planner-provided alias that matches the RETURN item alias,
        // so ProjectStep can later resolve it via Identifier lookup.
        const alias = step.groupByAliases[i];
        resultRow.set(alias, group.keyValues[i]);
      }

      // Compute aggregates over the group's rows.
      for (const spec of step.aggregates) {
        resultRow.set(
          spec.alias,
          this._computeAggregate(spec, group.rows, params),
        );
      }

      result.push(resultRow);
    }

    return result;
  }

  /**
   * Compute a single aggregate function over a set of rows.
   */
  private _computeAggregate(
    spec: AggregateSpec,
    rows: Row[],
    params: Record<string, unknown>,
  ): unknown {
    const { expression, distinct } = spec;

    // Evaluate expression for each row, filtering out null/undefined.
    let values: unknown[] = rows
      .map((row) => this._evaluateExpressionForAggregate(expression, row, params))
      .filter((v) => v !== null && v !== undefined);

    // Apply DISTINCT deduplication.
    if (distinct) {
      values = [...new Set(values)];
    }

    switch (spec.function) {
      case 'COUNT':
        return values.length;

      case 'SUM': {
        const nums = values.map(Number).filter((n) => !isNaN(n));
        return nums.reduce((a, b) => a + b, 0);
      }

      case 'AVG': {
        const nums = values.map(Number).filter((n) => !isNaN(n));
        if (nums.length === 0) return 0;
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }

      case 'MIN': {
        if (values.length === 0) return null;
        return values.reduce((a, b) =>
          this._compare(a, b) <= 0 ? a : b,
        );
      }

      case 'MAX': {
        if (values.length === 0) return null;
        return values.reduce((a, b) =>
          this._compare(a, b) >= 0 ? a : b,
        );
      }

      case 'COLLECT':
        return values;

      default:
        throw new CypherRuntimeError(
          `Unknown aggregate function: ${spec.function}`,
        );
    }
  }

  /**
   * Evaluate an aggregate expression against a row.
   *
   * For {@code COUNT(*)}, the expression is a literal {@code '*'} —
   * treat that as a non-null sentinel so every row is counted.
   * All other expressions are delegated to {@link _evaluate}.
   */
  private _evaluateExpressionForAggregate(
    expr: Expression,
    row: Row,
    params: Record<string, unknown>,
  ): unknown {
    // COUNT(*) — every row contributes.
    if (expr.kind === 'Literal' && expr.value === '*') {
      return 1; // non-null sentinel
    }

    return this._evaluate(expr, row, params);
  }

  /**
   * Build a stable string key from an array of group-by values,
   * used to partition rows into groups.
   */
  private _serializeGroupKey(keyValues: unknown[]): string {
    return keyValues
      .map((v) => {
        if (v === null) return '\x00null';
        if (v === undefined) return '\x00undef';
        if (typeof v === 'object' && v !== null && 'id' in (v as object)) {
          return (v as { id: string }).id;
        }
        return String(v);
      })
      .join('\x00');
  }

  // ── Expression evaluator ────────────────────────────────────────

  /**
   * Evaluate an AST {@link Expression} against a row and parameter map.
   */
  private _evaluate(
    expr: Expression,
    row: Row,
    params: Record<string, unknown>,
  ): unknown {
    switch (expr.kind) {
      case 'Literal':
        return expr.value;

      case 'Parameter': {
        if (!(expr.name in params)) {
          throw new UnboundParameterError(expr.name);
        }
        return params[expr.name];
      }

      case 'Identifier': {
        if (!row.has(expr.name)) {
          throw new CypherRuntimeError(
            `Variable '${expr.name}' is not bound in the current row`,
          );
        }
        return row.get(expr.name);
      }

      case 'PropertyAccess': {
        const obj = this._evaluate(expr.object, row, params);
        if (obj === null || obj === undefined) return null;
        if (
          typeof obj === 'object' &&
          'properties' in (obj as Record<string, unknown>)
        ) {
          const props = (obj as { properties: Record<string, unknown> })
            .properties;
          if (expr.property in props) {
            return props[expr.property];
          }
          // Property not in user-defined properties — fall through to
          // top-level access for built-in fields like `type` and `id`.
        }
        if (typeof obj === 'object' && obj !== null) {
          return (obj as Record<string, unknown>)[expr.property];
        }
        throw new TypeMismatchError(
          `Cannot access property '${expr.property}' on ${typeof obj}`,
        );
      }

      case 'Binary': {
        const left = this._evaluate(expr.left, row, params);
        const right = this._evaluate(expr.right, row, params);
        return this._applyBinaryOp(expr.op, left, right);
      }

      case 'Unary': {
        const operand = this._evaluate(expr.operand, row, params);
        return this._applyUnaryOp(expr.op, operand);
      }

      case 'In': {
        const value = this._evaluate(expr.expression, row, params);
        const list = this._evaluate(expr.list, row, params);
        const inResult = this._checkIn(value, list);
        return expr.not ? !inResult : inResult;
      }

      case 'IsNull': {
        const value = this._evaluate(expr.expression, row, params);
        const isNull = value === null || value === undefined;
        return expr.not ? !isNull : isNull;
      }

      case 'List': {
        return expr.elements.map((e) => this._evaluate(e, row, params));
      }

      case 'FunctionCall': {
        switch (expr.name.toUpperCase()) {
          // ── id(node|relationship) → internal UUID ─────────────
          case 'ID': {
            if (expr.args.length !== 1) {
              throw new CypherRuntimeError(
                `id() expects exactly 1 argument, got ${expr.args.length}`,
              );
            }
            const arg = this._evaluate(expr.args[0], row, params);
            if (arg && typeof arg === 'object' && 'id' in (arg as object)) {
              return (arg as { id: string }).id;
            }
            // null argument → null per openCypher semantics
            if (arg === null || arg === undefined) return null;
            throw new CypherRuntimeError(
              `id() requires a node or relationship argument, got ${typeof arg}`,
            );
          }
          default:
            throw new CypherRuntimeError(
              `Function '${expr.name}' is not yet supported`,
            );
        }
      }
    }
  }

  // ── Operator helpers ────────────────────────────────────────────

  private _applyBinaryOp(op: string, left: unknown, right: unknown): unknown {
    switch (op) {
      case 'AND':
        return Boolean(left) && Boolean(right);
      case 'OR':
        return Boolean(left) || Boolean(right);
      case '=':
        return this._eq(left, right);
      case '<>':
        return !this._eq(left, right);
      case '<':
        return (left as number) < (right as number);
      case '<=':
        return (left as number) <= (right as number);
      case '>':
        return (left as number) > (right as number);
      case '>=':
        return (left as number) >= (right as number);
      case '+':
        return (left as number) + (right as number);
      case '-':
        return (left as number) - (right as number);
      case '*':
        return (left as number) * (right as number);
      case '/':
        if ((right as number) === 0)
          throw new CypherRuntimeError('Division by zero');
        return (left as number) / (right as number);
      default:
        throw new CypherRuntimeError(`Unknown operator: ${op}`);
    }
  }

  private _applyUnaryOp(op: string, operand: unknown): unknown {
    switch (op) {
      case 'NOT':
        return !Boolean(operand);
      case '-':
        return -(operand as number);
      default:
        throw new CypherRuntimeError(`Unknown unary operator: ${op}`);
    }
  }

  private _eq(a: unknown, b: unknown): boolean {
    if (a === null && b === null) return true;
    if (a === undefined && b === undefined) return true;
    if (a === null || b === null) return false;
    if (a === undefined || b === undefined) return false;
    if (
      typeof a === 'object' &&
      typeof b === 'object' &&
      'id' in (a as object) &&
      'id' in (b as object)
    ) {
      return (a as { id: string }).id === (b as { id: string }).id;
    }
    return a === b;
  }

  private _checkIn(value: unknown, list: unknown): boolean {
    if (!Array.isArray(list)) {
      throw new TypeMismatchError(
        `Right-hand side of IN must be a list, got ${typeof list}`,
      );
    }
    return list.some((item) => this._eq(value, item));
  }

  private _compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean')
      return a === b ? 0 : a ? 1 : -1;
    return String(a).localeCompare(String(b));
  }

  // ── Result builder ──────────────────────────────────────────────

  private _buildResult(
    plan: QueryPlan,
    rows: Row[],
    stats: PlanExecutionStats,
  ): CypherResult {
    const projectStep = plan.steps.find(
      (s): s is ProjectStep => s.kind === 'ProjectStep',
    );

    const columns = projectStep
      ? projectStep.columns.map((c) => c.alias)
      : [];

    const resultRows: CypherRow[] = rows.map((row) => {
      const obj: CypherRow = {};
      for (const [key, value] of row) {
        obj[key] = value;
      }
      return obj;
    });

    const summary: CypherSummary = {
      queryTimeMs: stats.totalTimeMs,
      nodesCreated: 0,
      nodesDeleted: 0,
      edgesCreated: 0,
      edgesDeleted: 0,
      propertiesSet: 0,
      planExecutionStats: stats,
    };

    return { columns, rows: resultRows, summary };
  }
}
