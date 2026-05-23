/**
 * Write step executor for the Cypher execution layer.
 *
 * Executes {@link CreateNodeStep}, {@link CreateEdgeStep}, and
 * {@link SetPropertyStep} against a {@link Graph} instance.
 *
 * @module cypher/executor/steps/WriteStepExecutors
 */

import { Graph } from '../../../Graph';
import { Node } from '../../../Node';
import { Edge } from '../../../Edge';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import {
  CreateNodeStep,
  CreateEdgeStep,
  SetPropertyStep,
} from '../../plan/QueryPlan';
import { Expression } from '../../ast/AstNode';
import { PropertyNotFoundError } from '../../../errors';
import { CypherRuntimeError } from '../../errors';
import { Row, ExpressionEvaluator, StepResult } from '../ExpressionEvaluator';

/**
 * Executes write plan steps (CREATE, SET) against a {@link Graph} instance.
 */
export class WriteStepExecutor {
  private readonly _graph: Graph;
  private readonly _evaluator: ExpressionEvaluator;

  constructor(graph: Graph, evaluator: ExpressionEvaluator) {
    this._graph = graph;
    this._evaluator = evaluator;
  }

  // ── CreateNodeStep ─────────────────────────────────────────────

  async executeCreateNode(
    step: CreateNodeStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    const result: Row[] = [];
    const resolvedProps = this._evaluator.resolvePropertyMap(step.properties, params);
    const propCount = Object.keys(resolvedProps).length;

    for (const row of rows) {
      const node = await this._graph.addNode(
        step.labels[0] ?? 'Node',
        resolvedProps,
        transaction,
      );
      const newRow = new Map(row);
      newRow.set(step.variable, node);
      result.push(newRow);
    }

    return {
      rows: result,
      nodesCreated: result.length,
      propertiesSet: result.length * propCount,
    };
  }

  // ── CreateEdgeStep ─────────────────────────────────────────────

  async executeCreateEdge(
    step: CreateEdgeStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    const result: Row[] = [];
    const resolvedProps = this._evaluator.resolvePropertyMap(step.properties, params);
    const propCount = Object.keys(resolvedProps).length;

    for (const row of rows) {
      const srcNode = row.get(step.source) as Node | undefined;
      const tgtNode = row.get(step.target) as Node | undefined;
      if (!srcNode || !tgtNode) {
        throw new CypherRuntimeError(
          `Cannot create edge: source or target node not bound`,
        );
      }
      const edge = await this._graph.addEdge(
        srcNode.id,
        tgtNode.id,
        step.types[0] ?? 'RELATIONSHIP',
        resolvedProps,
        transaction,
      );
      const newRow = new Map(row);
      newRow.set(step.variable, edge);
      result.push(newRow);
    }

    return {
      rows: result,
      edgesCreated: result.length,
      propertiesSet: result.length * propCount,
    };
  }

  // ── SetPropertyStep ────────────────────────────────────────────

  async executeSetProperty(
    step: SetPropertyStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    const result: Row[] = [];
    let propertiesSet = 0;

    for (const row of rows) {
      const entity = row.get(step.variable);
      if (!entity) {
        result.push(row);
        continue;
      }

      let updatedProperties = { ...(entity as Node | Edge).properties };

      for (const { key, value } of step.assignments) {
        const evaluatedValue = this._evaluator.evaluate(value as Expression, row, params);
        try {
          if (step.entityKind === 'node') {
            await this._graph.updateNodeProperty(
              (entity as Node).id, key, evaluatedValue, transaction,
            );
          } else {
            await this._graph.updateEdgeProperty(
              (entity as Edge).id, key, evaluatedValue, transaction,
            );
          }
        } catch (e: unknown) {
          if (e instanceof PropertyNotFoundError) {
            if (step.entityKind === 'node') {
              await this._graph.addNodeProperty(
                (entity as Node).id, key, evaluatedValue, transaction,
              );
            } else {
              await this._graph.addEdgeProperty(
                (entity as Edge).id, key, evaluatedValue, transaction,
              );
            }
          } else {
            throw e;
          }
        }
        updatedProperties = { ...updatedProperties, [key]: evaluatedValue };
        propertiesSet++;
      }

      const updatedOn = Date.now();
      let updatedEntity: Node | Edge;
      if (step.entityKind === 'node') {
        const n = entity as Node;
        updatedEntity = new Node(
          n.labels, updatedProperties, n.id, n.createdOn, updatedOn,
        );
      } else {
        const e = entity as Edge;
        updatedEntity = new Edge(
          e.sourceId, e.targetId, e.type, updatedProperties,
          e.id, e.createdOn, updatedOn,
        );
      }

      const newRow = new Map(row);
      newRow.set(step.variable, updatedEntity);
      result.push(newRow);
    }

    return { rows: result, propertiesSet };
  }
}