/**
 * Query plan executor for the Cypher execution layer.
 *
 * Walks a {@link QueryPlan} step by step, delegating each step to
 * dedicated sub-executor instances. Each step receives the current
 * row buffer and returns a new row buffer (pure function semantics).
 *
 * ### Execution model
 * - Rows are modelled as `Map<string, unknown>` (variable name → value).
 * - Parameter placeholders (`$name`) are resolved from the `params` map.
 * - No traversal logic decisions are made here; the Executor reads the
 *   strategy set by the {@link Planner}.
 *
 * ### Sub-executors
 * - {@link ExpressionEvaluator} — expression evaluation & parameter resolution
 * - {@link ReadStepExecutor} — NodeScan, NodeSeek, EdgeExpand
 * - {@link PipelineStepExecutor} — Filter, Project, Sort, Limit
 * - {@link AggregateStepExecutor} — storage-level + in-process aggregation
 * - {@link WriteStepExecutor} — CreateNode, CreateEdge, SetProperty
 * - {@link DeleteStepExecutor} — DeleteEntity, RemoveProperty
 * - {@link IndexStepExecutor} — CreateIndex, DropIndex, ShowIndexes
 *
 * @module cypher/executor/Executor
 */

import { Graph } from '../../Graph';
import { GraphTransaction } from '../../Graph/GraphTransaction';
import {
  QueryPlan,
  PlanStep,
  ProjectStep,
  PlanStepExecutionStats,
  PlanExecutionStats,
} from '../plan/QueryPlan';
import { CypherResult, CypherRow, CypherSummary } from '../Result';
import { CypherRuntimeError } from '../errors';
import { Row, ExpressionEvaluator } from './ExpressionEvaluator';

import { ReadStepExecutor } from './steps/ReadStepExecutors';
import { PipelineStepExecutor } from './steps/PipelineStepExecutors';
import { AggregateStepExecutor } from './steps/AggregateStepExecutor';
import { WriteStepExecutor } from './steps/WriteStepExecutors';
import { DeleteStepExecutor } from './steps/DeleteStepExecutors';
import { IndexStepExecutor } from './steps/IndexStepExecutors';

/**
 * Executes a {@link QueryPlan} against a {@link Graph} instance.
 *
 * Holds sub-executor instances for each step category, created
 * in the constructor and reused across all query executions.
 */
export class Executor {
  private readonly _graph: Graph;

  // ── Sub-executors ──────────────────────────────────────────────

  private readonly _evaluator: ExpressionEvaluator;
  private readonly _readExecutor: ReadStepExecutor;
  private readonly _pipelineExecutor: PipelineStepExecutor;
  private readonly _aggregateExecutor: AggregateStepExecutor;
  private readonly _writeExecutor: WriteStepExecutor;
  private readonly _deleteExecutor: DeleteStepExecutor;
  private readonly _indexExecutor: IndexStepExecutor;

  // ── Write counters ─────────────────────────────────────────────

  private _nodesCreated = 0;
  private _nodesDeleted = 0;
  private _edgesCreated = 0;
  private _edgesDeleted = 0;
  private _propertiesSet = 0;
  private _indexesCreated = 0;
  private _indexesDeleted = 0;

  constructor(graph: Graph) {
    this._graph = graph;
    this._evaluator = new ExpressionEvaluator();
    this._readExecutor = new ReadStepExecutor(graph, this._evaluator);
    this._pipelineExecutor = new PipelineStepExecutor(this._evaluator);
    this._aggregateExecutor = new AggregateStepExecutor(graph, this._evaluator);
    this._writeExecutor = new WriteStepExecutor(graph, this._evaluator);
    this._deleteExecutor = new DeleteStepExecutor(graph);
    this._indexExecutor = new IndexStepExecutor(graph);
  }

  /**
   * Execute a query plan and return the result set.
   *
   * @param plan   - The physical execution plan from the {@link Planner}.
   * @param params - Named parameter map (`$key` → value).
   * @param transaction - Optional transaction for consistent reads.
   * @returns A {@link CypherResult} containing rows and execution summary.
   */
  public async execute(
    plan: QueryPlan,
    params: Record<string, unknown> = {},
    transaction?: GraphTransaction,
  ): Promise<CypherResult> {
    this._nodesCreated = 0;
    this._nodesDeleted = 0;
    this._edgesCreated = 0;
    this._edgesDeleted = 0;
    this._propertiesSet = 0;
    this._indexesCreated = 0;
    this._indexesDeleted = 0;

    const startTime = Date.now();
    const stepStats: PlanStepExecutionStats[] = [];

    let rows: Row[] = [new Map()];

    for (const step of plan.steps) {
      const stepStart = Date.now();
      rows = await this._executeStep(step, rows, params, transaction);
      const stepTime = Date.now() - stepStart;
      stepStats.push({
        stepKind: step.kind,
        timeMs: stepTime,
        percentageOfTotal: 0,
        rowsOut: rows.length,
      });
    }

    const stepTotalTime = stepStats.reduce((sum, s) => sum + s.timeMs, 0);
    const totalTime = stepTotalTime > 0 ? stepTotalTime : (Date.now() - startTime);

    const stats: PlanExecutionStats = {
      totalTimeMs: totalTime,
      steps: stepStats.map((s) => ({
        ...s,
        percentageOfTotal: totalTime > 0 ? (s.timeMs / totalTime) * 100 : 0,
      })),
    };

    return this._buildResult(plan, rows, stats);
  }

  // ── Step dispatch ──────────────────────────────────────────────

  private async _executeStep(
    step: PlanStep,
    rows: Row[],
    params: Record<string, unknown>,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    switch (step.kind) {
      case 'NodeScanStep':
        return this._readExecutor.executeNodeScan(step, rows, params, transaction);
      case 'NodeSeekStep':
        return this._readExecutor.executeNodeSeek(step, rows, params, transaction);
      case 'EdgeExpandStep':
        return this._readExecutor.executeEdgeExpand(step, rows, params, transaction);

      case 'FilterStep':
        return this._pipelineExecutor.executeFilter(step, rows, params);
      case 'ProjectStep':
        return this._pipelineExecutor.executeProject(step, rows, params);
      case 'SortStep':
        return this._pipelineExecutor.executeSort(step, rows, params);
      case 'LimitStep':
        return this._pipelineExecutor.executeLimit(step, rows, params);

      case 'AggregateStep':
        return this._aggregateExecutor.executeAggregate(step, rows, params, transaction);

      case 'CreateNodeStep': {
        const result = await this._writeExecutor.executeCreateNode(step, rows, params, transaction);
        this._nodesCreated += result.nodesCreated ?? 0;
        this._propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'CreateEdgeStep': {
        const result = await this._writeExecutor.executeCreateEdge(step, rows, params, transaction);
        this._edgesCreated += result.edgesCreated ?? 0;
        this._propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'SetPropertyStep': {
        const result = await this._writeExecutor.executeSetProperty(step, rows, params, transaction);
        this._propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }

      case 'DeleteEntityStep': {
        const result = await this._deleteExecutor.executeDeleteEntity(step, rows, transaction);
        this._nodesDeleted += result.nodesDeleted ?? 0;
        this._edgesDeleted += result.edgesDeleted ?? 0;
        return result.rows;
      }
      case 'RemovePropertyStep': {
        const result = await this._deleteExecutor.executeRemoveProperty(step, rows, transaction);
        this._propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }

      case 'CreateIndexStep': {
        const result = await this._indexExecutor.executeCreateIndex(step, rows);
        this._indexesCreated += result.indexesCreated ?? 0;
        return result.rows;
      }
      case 'DropIndexStep': {
        const result = await this._indexExecutor.executeDropIndex(step, rows);
        this._indexesDeleted += result.indexesDeleted ?? 0;
        return result.rows;
      }
      case 'ShowIndexesStep':
        return this._indexExecutor.executeShowIndexes(step, rows);

      default:
        throw new CypherRuntimeError(
          `Unknown plan step kind: ${(step as PlanStep).kind}`,
        );
    }
  }

  // ── Result builder ─────────────────────────────────────────────

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
      nodesCreated: this._nodesCreated,
      nodesDeleted: this._nodesDeleted,
      edgesCreated: this._edgesCreated,
      edgesDeleted: this._edgesDeleted,
      propertiesSet: this._propertiesSet,
      indexesCreated: this._indexesCreated,
      indexesDeleted: this._indexesDeleted,
      planExecutionStats: stats,
    };

    return { columns, rows: resultRows, summary };
  }
}