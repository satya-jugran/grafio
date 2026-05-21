/**
 * Index step executor for the Cypher execution layer.
 *
 * Executes {@link CreateIndexStep}, {@link DropIndexStep}, and
 * {@link ShowIndexesStep} against a {@link Graph} instance.
 *
 * @module cypher/executor/steps/IndexStepExecutors
 */

import { Graph } from '../../../Graph';
import {
  CreateIndexStep,
  DropIndexStep,
  ShowIndexesStep,
} from '../../plan/QueryPlan';
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
    await this._graph.createIndex(step.name, step.target, step.propertyKeys);
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

  // ── ShowIndexesStep ────────────────────────────────────────────

  async executeShowIndexes(
    step: ShowIndexesStep,
    rows: Row[],
  ): Promise<Row[]> {
    const indexes = await this._graph.getIndexes();
    return indexes.map((idx) => {
      const row = new Map<string, unknown>();
      for (const col of step.columns) {
        row.set(col.alias, (idx as Record<string, unknown>)[col.source]);
      }
      return row;
    });
  }
}