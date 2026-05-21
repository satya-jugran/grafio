/**
 * Delete step executor for the Cypher execution layer.
 *
 * Executes {@link DeleteEntityStep} and {@link RemovePropertyStep}
 * against a {@link Graph} instance.
 *
 * @module cypher/executor/steps/DeleteStepExecutors
 */

import { Graph } from '../../../Graph';
import { Node } from '../../../Node';
import { Edge } from '../../../Edge';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import {
  DeleteEntityStep,
  RemovePropertyStep,
} from '../../plan/QueryPlan';
import { NodeHasEdgesError } from '../../../errors';
import { CypherRuntimeError } from '../../errors';
import { Row, StepResult } from '../ExpressionEvaluator';

/**
 * Executes delete/mutation plan steps (DELETE, REMOVE) against a {@link Graph}.
 */
export class DeleteStepExecutor {
  private readonly _graph: Graph;

  constructor(graph: Graph) {
    this._graph = graph;
  }

  // ── DeleteEntityStep ───────────────────────────────────────────

  async executeDeleteEntity(
    step: DeleteEntityStep,
    rows: Row[],
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    let nodesDeleted = 0;
    let edgesDeleted = 0;

    for (const row of rows) {
      const entity = row.get(step.variable);
      if (!entity) continue;
      if (step.entityKind === 'node') {
        try {
          const { result, cascadeDeletedEdgesCount } = await this._graph.removeNode(
            (entity as Node).id, step.detach, transaction,
          );
          if (result) {
            nodesDeleted++;
            if (cascadeDeletedEdgesCount) {
              edgesDeleted += cascadeDeletedEdgesCount;
            }
          }
        } catch (err) {
          if (err instanceof NodeHasEdgesError && !step.detach) {
            throw new CypherRuntimeError(
              `Cannot delete node '${(entity as Node).id}': it still has incident edges. Use DETACH DELETE to also remove edges.`,
            );
          }
          throw err;
        }
      } else {
        try {
          const result = await this._graph.removeEdge((entity as Edge).id, transaction);
          if (result) {
            edgesDeleted++;
          }
        } catch (err) {
          throw err;
        }
      }
    }
    return { rows, nodesDeleted, edgesDeleted };
  }

  // ── RemovePropertyStep ─────────────────────────────────────────

  async executeRemoveProperty(
    step: RemovePropertyStep,
    rows: Row[],
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    let propertiesSet = 0;

    for (const row of rows) {
      const entity = row.get(step.variable);
      if (!entity) continue;
      if (step.entityKind === 'node') {
        await this._graph.deleteNodeProperty(
          (entity as Node).id, step.property, transaction,
        );
      } else {
        await this._graph.deleteEdgeProperty(
          (entity as Edge).id, step.property, transaction,
        );
      }
      propertiesSet++;
    }
    return { rows, propertiesSet };
  }
}