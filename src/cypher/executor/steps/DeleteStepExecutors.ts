/**
 * Delete step executor for the Cypher execution layer.
 *
 * Executes {@link DeleteEntityStep}, {@link RemovePropertyStep}, and
 * {@link RemoveLabelStep} against a {@link Graph} or {@link ISyncGraphKernel}.
 *
 * @module cypher/executor/steps/DeleteStepExecutors
 */

import { Graph } from '../../../Graph';
import { Node } from '../../../Node';
import { Edge } from '../../../Edge';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import type { ISyncGraphKernel } from '../../../storage/IStorageProvider';
import {
  DeleteEntityStep,
  RemovePropertyStep,
  RemoveLabelStep,
} from '../../plan/QueryPlan';
import { UNBOUND, type VarSlotTable } from '../../plan/CompiledPlanMeta';
import { NodeHasEdgesError } from '../../../errors';
import { CypherRuntimeError } from '../../errors';
import { Row, StepResult } from '../ExpressionEvaluator';
import { refreshEntityInRow } from './WriteStepExecutors';

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
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    let nodesDeleted = 0;
    let edgesDeleted = 0;
    const varSlot = slotTable.getOrAdd(step.variable);

    for (const row of rows) {
      const entity = row[varSlot];
      if (entity === UNBOUND || !entity) continue;

      if (step.entityKind === 'node') {
        const nodeId = (entity as Node).id;
        try {
          const { result, cascadeDeletedEdgesCount } = await this._graph.removeNode(
            nodeId,
            step.detach,
            transaction,
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
              `Cannot delete node '${nodeId}': it still has incident edges. Use DETACH DELETE to also remove edges.`,
            );
          }
          throw err;
        }
      } else {
        const result = await this._graph.removeEdge((entity as Edge).id, transaction);
        if (result) edgesDeleted++;
      }
    }
    return { rows, nodesDeleted, edgesDeleted };
  }

  executeDeleteEntitySync(
    kernel: ISyncGraphKernel,
    step: DeleteEntityStep,
    rows: Row[],
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): StepResult {
    let nodesDeleted = 0;
    let edgesDeleted = 0;
    const varSlot = slotTable.getOrAdd(step.variable);
    const txHandle = transaction?._getHandle();

    for (let i = 0; i < rows.length; i++) {
      const entity = rows[i][varSlot];
      if (entity === UNBOUND || !entity) continue;

      if (step.entityKind === 'node') {
        const nodeId = (entity as Node).id;
        try {
          const { result, cascadeDeletedEdgesCount } = kernel.deleteNodeByIdSync(
            nodeId,
            step.detach,
            txHandle,
          );
          if (result) {
            nodesDeleted++;
            if (cascadeDeletedEdgesCount) {
              edgesDeleted += cascadeDeletedEdgesCount;
            }
          }
        } catch (err) {
          transaction?.markFailed();
          if (err instanceof NodeHasEdgesError && !step.detach) {
            throw new CypherRuntimeError(
              `Cannot delete node '${nodeId}': it still has incident edges. Use DETACH DELETE to also remove edges.`,
            );
          }
          throw err;
        }
      } else {
        try {
          const result = kernel.deleteEdgeByIdSync((entity as Edge).id, txHandle);
          if (result) edgesDeleted++;
        } catch (err) {
          transaction?.markFailed();
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
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    let propertiesSet = 0;
    const varSlot = slotTable.getOrAdd(step.variable);
    const outRows: Row[] = new Array(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const entity = row[varSlot];
      if (entity === UNBOUND || !entity) {
        outRows[i] = row;
        continue;
      }
      const entityId = (entity as Node | Edge).id;
      if (step.entityKind === 'node') {
        await this._graph.unsetNodeProperties(entityId, [step.property], transaction);
        const refreshed = await this._graph.getNode(entityId, transaction);
        outRows[i] = refreshed
          ? refreshEntityInRow(row, 'node', entityId, refreshed)
          : row.slice();
      } else {
        await this._graph.unsetEdgeProperties(entityId, [step.property], transaction);
        const refreshed = await this._graph.getEdge(entityId, transaction);
        outRows[i] = refreshed
          ? refreshEntityInRow(row, 'edge', entityId, refreshed)
          : row.slice();
      }
      propertiesSet++;
    }
    return { rows: outRows, propertiesSet };
  }

  executeRemovePropertySync(
    kernel: ISyncGraphKernel,
    step: RemovePropertyStep,
    rows: Row[],
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): StepResult {
    let propertiesSet = 0;
    const varSlot = slotTable.getOrAdd(step.variable);
    const txHandle = transaction?._getHandle();
    const outRows: Row[] = new Array(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const entity = row[varSlot];
      if (entity === UNBOUND || !entity) {
        outRows[i] = row;
        continue;
      }
      const entityId = (entity as Node | Edge).id;
      try {
        kernel.patchPropertiesSync(
          step.entityKind,
          entityId,
          { unset: [step.property] },
          txHandle,
        );
      } catch (err) {
        transaction?.markFailed();
        throw err;
      }
      const refreshed =
        step.entityKind === 'node'
          ? kernel.getNodeSync(entityId, txHandle)
          : kernel.getEdgeSync(entityId, txHandle);
      outRows[i] = refreshed
        ? refreshEntityInRow(row, step.entityKind, entityId, refreshed)
        : row.slice();
      propertiesSet++;
    }
    return { rows: outRows, propertiesSet };
  }

  // ── RemoveLabelStep ────────────────────────────────────────────

  async executeRemoveLabel(
    step: RemoveLabelStep,
    rows: Row[],
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    let labelsRemoved = 0;
    const varSlot = slotTable.getOrAdd(step.variable);
    const labelSet = new Set(step.labels);
    const outRows: Row[] = new Array(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const entity = row[varSlot];
      if (entity === UNBOUND || !entity) {
        outRows[i] = row;
        continue;
      }
      const nodeId = (entity as Node).id;
      const before = await this._graph.getNode(nodeId, transaction);
      await this._graph.removeNodeLabels(nodeId, step.labels, transaction);
      const refreshed = await this._graph.getNode(nodeId, transaction);
      outRows[i] = refreshed
        ? refreshEntityInRow(row, 'node', nodeId, refreshed)
        : row.slice();
      if (before) {
        for (let k = 0; k < before.labels.length; k++) {
          if (labelSet.has(before.labels[k])) labelsRemoved++;
        }
      }
    }
    return { rows: outRows, labelsRemoved };
  }

  executeRemoveLabelSync(
    kernel: ISyncGraphKernel,
    step: RemoveLabelStep,
    rows: Row[],
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): StepResult {
    let labelsRemoved = 0;
    const varSlot = slotTable.getOrAdd(step.variable);
    const txHandle = transaction?._getHandle();
    const outRows: Row[] = new Array(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const entity = row[varSlot];
      if (entity === UNBOUND || !entity) {
        outRows[i] = row;
        continue;
      }
      const nodeId = (entity as Node).id;
      let removedCount: number;
      try {
        removedCount = kernel.removeNodeLabelsSync(nodeId, step.labels, txHandle);
      } catch (err) {
        transaction?.markFailed();
        throw err;
      }
      const refreshed = kernel.getNodeSync(nodeId, txHandle);
      outRows[i] = refreshed
        ? refreshEntityInRow(row, 'node', nodeId, refreshed)
        : row.slice();
      labelsRemoved += removedCount;
    }
    return { rows: outRows, labelsRemoved };
  }
}
