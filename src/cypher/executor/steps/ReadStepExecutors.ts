/**
 * Read step executor for the Cypher execution layer.
 *
 * Executes {@link NodeScanStep}, {@link NodeSeekStep}, and
 * {@link EdgeExpandStep} against a {@link Graph} instance.
 *
 * @module cypher/executor/steps/ReadStepExecutors
 */

import { Graph } from '../../../Graph';
import { Node } from '../../../Node';
import { Edge } from '../../../Edge';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import {
  NodeScanStep,
  NodeSeekStep,
  EdgeExpandStep,
} from '../../plan/QueryPlan';
import { UnboundParameterError } from '../../errors';
import { Row, ExpressionEvaluator } from '../ExpressionEvaluator';
import { parallelMap } from '../parallelMap';

/**
 * Executes read-only plan steps (NodeScan, NodeSeek, EdgeExpand)
 * against a {@link Graph} instance.
 */
export class ReadStepExecutor {
  private readonly _graph: Graph;
  private readonly _evaluator: ExpressionEvaluator;
  private readonly _maxDegreeOfParallelism: number;

  constructor(
    graph: Graph,
    evaluator: ExpressionEvaluator,
    maxDegreeOfParallelism: number = 1,
  ) {
    this._graph = graph;
    this._evaluator = evaluator;
    this._maxDegreeOfParallelism = Math.max(1, maxDegreeOfParallelism);
  }

  // ── NodeScanStep ───────────────────────────────────────────────

  /**
   * Execute a {@link NodeScanStep}: fetch nodes from storage, optionally
   * filtered by type labels and property filters, then cross-join with
   * the current row buffer.
   */
  async executeNodeScan(
    step: NodeScanStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    const filter: Record<string, unknown> = {};

    if (step.types?.length) {
      filter.types = step.types;
    } else if (step.label) {
      filter.types = [step.label];
    }

    if (step.propertyFilters?.length) {
      filter.properties = this._resolvePropertyFilterParams(
        step.propertyFilters as Array<Record<string, unknown>>,
        params,
      );
    }

    const nodes = Object.keys(filter).length > 0
      ? await this._graph.getNodes({ filter: filter as any, transaction } as any) as unknown as Node[]
      : await this._graph.getNodes({ transaction } as any);

    return parallelMap(rows, (rowChunk) => {
      const chunkResult: Row[] = [];
      for (const row of rowChunk) {
        for (const node of nodes) {
          const newRow = new Map(row);
          newRow.set(step.variable, node);
          chunkResult.push(newRow);
        }
      }
      return Promise.resolve(chunkResult);
    }, this._maxDegreeOfParallelism);
  }

  /**
   * Recursively resolve `$param` references in a property filter tree
   * against the runtime parameter map.
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

  // ── NodeSeekStep ───────────────────────────────────────────────

  /**
   * Direct node lookup — O(1) via `graph.getNode(id)` for id-indexed
   * seeks or `graph.getNodes({filter})` for property-indexed seeks.
   */
  async executeNodeSeek(
    step: NodeSeekStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    let nodes: Node[];

    switch (step.index) {
      case 'id': {
        const id = this._evaluator.resolveParam(step.value, params);
        const node = await this._graph.getNode(String(id ?? ''), transaction);
        nodes = node ? [node] : [];
        break;
      }
      case 'property': {
        const resolvedValue = this._evaluator.resolveParam(step.value, params);
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

    return parallelMap(rows, async (rowChunk) => {
      const chunkResult: Row[] = [];
      for (const row of rowChunk) {
        for (const node of nodes) {
          const newRow = new Map(row);
          newRow.set(step.variable, node);
          chunkResult.push(newRow);
        }
      }
      return chunkResult;
    }, this._maxDegreeOfParallelism);
  }

  // ── EdgeExpandStep ─────────────────────────────────────────────

  /**
   * Execute an {@link EdgeExpandStep}: for each row, expand from the
   * bound source node and cross-join with the matched target nodes.
   */
  async executeEdgeExpand(
    step: EdgeExpandStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    return parallelMap(rows, async (rowChunk) => {
      const chunkResult: Row[] = [];
      for (const row of rowChunk) {
        const sourceNode = row.get(step.source) as Node | undefined;
        if (!sourceNode) continue;
        const expanded = await this._expandFromNode(step, row, sourceNode, transaction);
        chunkResult.push(...expanded);
      }
      return chunkResult;
    }, this._maxDegreeOfParallelism);
  }

  private async _expandFromNode(
    step: EdgeExpandStep,
    row: Row,
    sourceNode: Node,
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

    const targetIds = edges.map(e => step.direction === 'out' ? e.targetId : e.sourceId);
    const uniqueIds = [...new Set(targetIds)];
    const nodeMap = await this._graph.getNodesByIds(uniqueIds, transaction);

    const result: Row[] = [];
    for (const edge of edges) {
      const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
      const targetNode = nodeMap.get(targetId);
      if (!targetNode) continue;

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
    const visited = new Map<string, number>([[sourceNode.id, 0]]);

    const frontier: Array<{
      node: Node;
      row: Row;
      hops: number;
      pathNodes?: Node[];
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
        ? frontier.shift()!
        : frontier.pop()!;

      if (hops >= step.maxHops) continue;

      const filterArg = step.types.length > 0
        ? { filter: { types: step.types } }
        : undefined;

      const edges =
        step.direction === 'out'
          ? await this._graph.getEdgesFrom(node.id, { ...filterArg, transaction } as any)
          : await this._graph.getEdgesTo(node.id, { ...filterArg, transaction } as any);

      const edgeIds = edges.map(e => step.direction === 'out' ? e.targetId : e.sourceId);
      const uniqueIds = [...new Set(edgeIds)];
      const nodeMap = await this._graph.getNodesByIds(uniqueIds, transaction);

      for (const edge of edges) {
        const targetId = step.direction === 'out' ? edge.targetId : edge.sourceId;
        const targetNode = nodeMap.get(targetId);
        if (!targetNode) continue;

        if (
          step.targetTypes &&
          step.targetTypes.length > 0 &&
          !step.targetTypes.includes(targetNode.type)
        ) {
          continue;
        }

        const newHops = hops + 1;
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

          if (step.pathVar && newPathNodes && newPathEdges) {
            const pathValue: (Node | Edge)[] = [newPathNodes[0]];
            for (let i = 0; i < newPathEdges.length; i++) {
              pathValue.push(newPathEdges[i], newPathNodes[i + 1]);
            }
            newRow.set(step.pathVar, pathValue);
          }

          result.push(newRow);
        }

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
}