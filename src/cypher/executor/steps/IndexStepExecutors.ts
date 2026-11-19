/**
 * Index step executor for the Cypher execution layer.
 *
 * Executes {@link CreateIndexStep}, {@link DropIndexStep}, and
 * {@link ShowIndexesStep} against a {@link Graph} instance.
 *
 * @module cypher/executor/steps/IndexStepExecutors
 */

import { Graph } from '../../../Graph';
import type { ISyncGraphKernel } from '../../../storage/IStorageProvider';
import {
  CreateIndexStep,
  DropIndexStep,
  ShowIndexesStep,
} from '../../plan/QueryPlan';
import type { VarSlotTable } from '../../plan/CompiledPlanMeta';
import { Row, StepResult } from '../ExpressionEvaluator';

/**
 * Executes index DDL plan steps against a {@link Graph}.
 */
export class IndexStepExecutor {
  private readonly _graph: Graph;

  constructor(graph: Graph) {
    this._graph = graph;
  }

  // ── CreateIndexStep ────────────────────────────────────────────

  async executeCreateIndex(
    step: CreateIndexStep,
    rows: Row[],
  ): Promise<StepResult> {
    const opts = step.labelOrType ? { labelOrType: step.labelOrType } : undefined;
    await this._graph.createIndex(step.name, step.target, step.propertyKeys, opts);
    return { rows, indexesCreated: 1 };
  }

  executeCreateIndexSync(
    kernel: ISyncGraphKernel,
    step: CreateIndexStep,
    rows: Row[],
  ): StepResult {
    const opts = step.labelOrType ? { labelOrType: step.labelOrType } : undefined;
    kernel.createIndexSync(step.name, step.target, step.propertyKeys, opts);
    return { rows, indexesCreated: 1 };
  }

  // ── DropIndexStep ──────────────────────────────────────────────

  async executeDropIndex(
    step: DropIndexStep,
    rows: Row[],
  ): Promise<StepResult> {
    await this._graph.deleteIndex(step.name);
    return { rows, indexesDeleted: 1 };
  }

  executeDropIndexSync(
    kernel: ISyncGraphKernel,
    step: DropIndexStep,
    rows: Row[],
  ): StepResult {
    kernel.deleteIndexSync(step.name);
    return { rows, indexesDeleted: 1 };
  }

  // ── ShowIndexesStep ────────────────────────────────────────────

  async executeShowIndexes(
    step: ShowIndexesStep,
    _rows: Row[],
    slotTable: VarSlotTable,
  ): Promise<Row[]> {
    const indexes = await this._graph.getIndexes();
    return this._indexesToRows(step, indexes, slotTable);
  }

  executeShowIndexesSync(
    kernel: ISyncGraphKernel,
    step: ShowIndexesStep,
    _rows: Row[],
    slotTable: VarSlotTable,
  ): Row[] {
    const indexes = kernel.getIndexesSync();
    return this._indexesToRows(step, indexes, slotTable);
  }

  private _indexesToRows(
    step: ShowIndexesStep,
    indexes: ReadonlyArray<unknown>,
    slotTable: VarSlotTable,
  ): Row[] {
    return indexes.map((idx) => {
      const row = slotTable.createEmptyRow();
      for (const col of step.columns) {
        const slot = slotTable.getOrAdd(col.alias);
        row[slot] = (idx as Record<string, unknown>)[col.source];
      }
      return row;
    });
  }
}
