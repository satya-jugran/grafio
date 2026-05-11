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
 * - A {@link NodeScanStep} calls `graph.getNodesByType(label)` or `graph.getNodes()`.
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
import {
  QueryPlan,
  PlanStep,
  NodeScanStep,
  EdgeExpandStep,
  FilterStep,
  ProjectStep,
  SortStep,
  LimitStep,
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
   * @returns A {@link CypherResult} containing rows and execution summary.
   */
  public async execute(
    plan: QueryPlan,
    params: Record<string, unknown> = {},
  ): Promise<CypherResult> {
    const startTime = Date.now();

    // Initial row buffer: a single empty row as the starting point.
    let rows: Row[] = [new Map()];

    // Walk each plan step, transforming the row buffer.
    for (const step of plan.steps) {
      rows = await this._executeStep(step, rows, params);
    }

    const queryTimeMs = Date.now() - startTime;
    return this._buildResult(plan, rows, queryTimeMs);
  }

  // ── Step dispatch ───────────────────────────────────────────────

  private async _executeStep(
    step: PlanStep,
    rows: Row[],
    params: Record<string, unknown>,
  ): Promise<Row[]> {
    switch (step.kind) {
      case 'NodeScanStep':
        return this._executeNodeScan(step, rows);
      case 'EdgeExpandStep':
        return this._executeEdgeExpand(step, rows, params);
      case 'FilterStep':
        return this._executeFilter(step, rows, params);
      case 'ProjectStep':
        return this._executeProject(step, rows, params);
      case 'SortStep':
        return this._executeSort(step, rows, params);
      case 'LimitStep':
        return this._executeLimit(step, rows);
      case 'AggregateStep':
        throw new CypherRuntimeError('Aggregation is not yet supported');
    }
  }

  // ── NodeScanStep ────────────────────────────────────────────────

  private async _executeNodeScan(step: NodeScanStep, rows: Row[]): Promise<Row[]> {
    const nodes = step.label
      ? await this._graph.getNodesByType(step.label)
      : await this._graph.getNodes();

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
  ): Promise<Row[]> {
    const result: Row[] = [];
    for (const row of rows) {
      const sourceNode = row.get(step.source) as Node | undefined;
      if (!sourceNode) continue;
      const expanded = await this._expandFromNode(step, row, sourceNode, params);
      result.push(...expanded);
    }
    return result;
  }

  private async _expandFromNode(
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
    params: Record<string, unknown>,
  ): Promise<Row[]> {
    if (step.strategy === 'single-hop') {
      return this._expandSingleHop(step, row, sourceNode);
    }
    return this._expandMultiHop(step, row, sourceNode);
  }

  private async _expandSingleHop(
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
  ): Promise<Row[]> {
    const filterArg = step.types.length > 0
      ? { filter: { edgeType: step.types[0] } }
      : undefined;

    const edges =
      step.direction === 'out'
        ? await this._graph.getEdgesFrom(sourceNode.id, filterArg)
        : await this._graph.getEdgesTo(sourceNode.id, filterArg);

    const result: Row[] = [];
    for (const edge of edges) {
      const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
      const targetNode = await this._graph.getNode(targetId);
      if (!targetNode) continue;

      const newRow = new Map(row);
      if (step.edgeVar) newRow.set(step.edgeVar, edge);
      newRow.set(step.target, targetNode);
      result.push(newRow);
    }
    return result;
  }

  private async _expandMultiHop(
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
  ): Promise<Row[]> {
    const result: Row[] = [];
    const visited = new Set<string>([sourceNode.id]);
    const queue: Array<{ node: Node; row: Row; hops: number }> = [
      { node: sourceNode, row, hops: 0 },
    ];

    while (queue.length > 0) {
      const { node, row: curRow, hops } = queue.shift()!;

      if (hops >= step.maxHops) continue;

      const filterArg = step.types.length > 0
        ? { filter: { edgeType: step.types[0] } }
        : undefined;

      const edges =
        step.direction === 'out'
          ? await this._graph.getEdgesFrom(node.id, filterArg)
          : await this._graph.getEdgesTo(node.id, filterArg);

      for (const edge of edges) {
        const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
        const targetNode = await this._graph.getNode(targetId);
        if (!targetNode) continue;

        const newHops = hops + 1;

        if (newHops >= step.minHops && newHops <= step.maxHops) {
          const newRow = new Map(curRow);
          if (step.edgeVar) newRow.set(step.edgeVar, edge);
          newRow.set(step.target, targetNode);
          result.push(newRow);
        }

        if (newHops < step.maxHops && !visited.has(targetId)) {
          visited.add(targetId);
          const nextRow = new Map(curRow);
          queue.push({ node: targetNode, row: nextRow, hops: newHops });
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
    return rows.map((row) => {
      const newRow = new Map<string, unknown>();
      for (const col of step.columns) {
        newRow.set(col.alias, this._evaluate(col.expression, row, params));
      }
      return newRow;
    });
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

  private _executeLimit(step: LimitStep, rows: Row[]): Row[] {
    const start = Math.max(0, step.skip);
    const end = step.limit === Infinity ? undefined : start + step.limit;
    return rows.slice(start, end);
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
          return (obj as { properties: Record<string, unknown> }).properties[
            expr.property
          ];
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

      case 'FunctionCall':
        throw new CypherRuntimeError(
          `Function '${expr.name}' is not yet supported`,
        );
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
    queryTimeMs: number,
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
      queryTimeMs,
      nodesCreated: 0,
      nodesDeleted: 0,
      edgesCreated: 0,
      edgesDeleted: 0,
      propertiesSet: 0,
    };

    return { columns, rows: resultRows, summary };
  }
}
