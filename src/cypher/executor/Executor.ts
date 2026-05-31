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
  MergeStep,
  OptionalMatchStep,
  SetPropertyStep,
  CreateNodeStep,
  CreateEdgeStep,
  RemoveLabelStep,
} from '../plan/QueryPlan';
import { CypherResult, CypherRow, CypherSummary } from '../Result';
import { CypherRuntimeError } from '../errors';
import { Row, ExpressionEvaluator } from './ExpressionEvaluator';
import {
  ExistsSubqueryStep,
  PatternComprehensionStep,
  PatternExprStep,
} from '../plan/QueryPlan';

import { ReadStepExecutor } from './steps/ReadStepExecutors';
import { PipelineStepExecutor, getDistinctKey } from './steps/PipelineStepExecutors';
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
  private readonly _maxDegreeOfParallelism: number;

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

  constructor(graph: Graph, maxDegreeOfParallelism: number = 1) {
    this._graph = graph;
    this._maxDegreeOfParallelism = Math.max(1, maxDegreeOfParallelism);
    this._evaluator = new ExpressionEvaluator();
    this._readExecutor = new ReadStepExecutor(graph, this._evaluator, this._maxDegreeOfParallelism);
    this._pipelineExecutor = new PipelineStepExecutor(this._evaluator, this._maxDegreeOfParallelism);
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
      case 'VerifyNodeStep':
        return this._readExecutor.executeVerifyNode(step, rows, params, transaction);
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
      case 'MergeStep': {
        const stepMerge = step as MergeStep;
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows = [row];
          for (const rStep of stepMerge.readSteps) {
             matchRows = await this._executeStep(rStep, matchRows, params, transaction);
             if (matchRows.length === 0) break;
          }

          if (matchRows.length > 0) {
            let currentRows = matchRows;
            for (const item of stepMerge.onMatchItems) {
               const setStep: SetPropertyStep = {
                 kind: 'SetPropertyStep',
                 variable: item.variable,
                 entityKind: item.entityKind,
                 assignments: [{ key: item.property, operator: item.operator, value: item.value }]
               };
               const res = await this._writeExecutor.executeSetProperty(setStep, currentRows, params, transaction);
               currentRows = res.rows;
               this._propertiesSet += res.propertiesSet ?? 0;
            }
            resultRows.push(...currentRows);
          } else {
            let currentRows = [row];
            for (const cStep of stepMerge.createSteps) {
               if (cStep.kind === 'CreateNodeStep') {
                 const res = await this._writeExecutor.executeCreateNode(cStep as CreateNodeStep, currentRows, params, transaction);
                 currentRows = res.rows;
                 this._nodesCreated += res.nodesCreated ?? 0;
                 this._propertiesSet += res.propertiesSet ?? 0;
               } else if (cStep.kind === 'CreateEdgeStep') {
                 const res = await this._writeExecutor.executeCreateEdge(cStep as CreateEdgeStep, currentRows, params, transaction);
                 currentRows = res.rows;
                 this._edgesCreated += res.edgesCreated ?? 0;
                 this._propertiesSet += res.propertiesSet ?? 0;
               } else {
                 currentRows = await this._executeStep(cStep, currentRows, params, transaction);
               }
            }
            for (const item of stepMerge.onCreateItems) {
               const setStep: SetPropertyStep = {
                 kind: 'SetPropertyStep',
                 variable: item.variable,
                 entityKind: item.entityKind,
                 assignments: [{ key: item.property, operator: item.operator, value: item.value }]
               };
               const res = await this._writeExecutor.executeSetProperty(setStep, currentRows, params, transaction);
               currentRows = res.rows;
               this._propertiesSet += res.propertiesSet ?? 0;
            }
            resultRows.push(...currentRows);
          }
        }
        return resultRows;
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
      case 'RemoveLabelStep': {
        const result = await this._deleteExecutor.executeRemoveLabel(step as RemoveLabelStep, rows, transaction);
        // We do not have a specific counter for labels removed in the summary yet,
        // but we could track it if added to CypherSummary.
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

      case 'OptionalMatchStep': {
        const optStep = step as OptionalMatchStep;
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const rStep of optStep.readSteps) {
            matchRows = await this._executeStep(rStep, matchRows, params, transaction);
            if (matchRows.length === 0) break;
          }
          if (matchRows.length > 0) {
            resultRows.push(...matchRows);
          } else {
            // No matches — preserve the incoming row with new vars set to null
            const nullRow = new Map(row);
            for (const v of optStep.newVars) {
              nullRow.set(v, null);
            }
            resultRows.push(nullRow);
          }
        }
        return resultRows;
      }

      case 'ExistsSubqueryStep': {
        const existsStep = step as ExistsSubqueryStep;
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const subStep of existsStep.subPlan) {
            matchRows = await this._executeStep(subStep, matchRows, params, transaction);
            if (matchRows.length === 0) break;
          }
          const hasMatch = matchRows.length > 0;
          const outRow = new Map(row);
          outRow.set(existsStep.resultVariable, hasMatch);
          resultRows.push(outRow);
        }
        return resultRows;
      }

      case 'PatternComprehensionStep': {
        const compStep = step as PatternComprehensionStep;
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const subStep of compStep.subPlan) {
            matchRows = await this._executeStep(subStep, matchRows, params, transaction);
            if (matchRows.length === 0) break;
          }
          
          const results: unknown[] = [];
          for (const matchRow of matchRows) {
            const val = this._evaluator.evaluate(compStep.projection, matchRow, params);
            results.push(val);
          }
          
          const outRow = new Map(row);
          outRow.set(compStep.resultVariable, results);
          resultRows.push(outRow);
        }
        return resultRows;
      }

      case 'PatternExprStep': {
        const exprStep = step as PatternExprStep;
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const subStep of exprStep.subPlan) {
            matchRows = await this._executeStep(subStep, matchRows, params, transaction);
            if (matchRows.length === 0) break;
          }
          
          const paths: unknown[][] = [];
          for (const matchRow of matchRows) {
            const path: unknown[] = [];
            for (const v of exprStep.pathVariables) {
              path.push(matchRow.get(v) ?? null);
            }
            paths.push(path);
          }
          
          const outRow = new Map(row);
          outRow.set(exprStep.resultVariable, paths);
          resultRows.push(outRow);
        }
        return resultRows;
      }

      case 'UnionStep': {
        const unionStep = step as import('../plan/QueryPlan').UnionStep;
        let resultRows: Row[] = [];

        for (let i = 0; i < unionStep.plans.length; i++) {
          let subRows: Row[] = [new Map()];
          for (const subStep of unionStep.plans[i].steps) {
            subRows = await this._executeStep(
              subStep,
              subRows,
              params,
              transaction,
            );
          }

          if (i === 0) {
            resultRows = subRows;
          } else {
            const isAll = unionStep.all[i - 1];
            resultRows = resultRows.concat(subRows);

            if (!isAll) {
              const seen = new Set<string>();
              resultRows = resultRows.filter((row) => {
                const keys = Array.from(row.keys()).sort();
                const keyParts: string[] = [];
                for (const k of keys) {
                  keyParts.push(getDistinctKey(row.get(k)));
                }
                const hash = keyParts.join('\x00');
                if (seen.has(hash)) return false;
                seen.add(hash);
                return true;
              });
            }
          }
        }
        return resultRows;
      }

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
    let projectStep = plan.steps.find(
      (s): s is ProjectStep => s.kind === 'ProjectStep',
    );

    if (!projectStep) {
      const unionStep = plan.steps.find(
        (s): s is import('../plan/QueryPlan').UnionStep => s.kind === 'UnionStep',
      );
      if (unionStep && unionStep.plans.length > 0) {
        projectStep = unionStep.plans[0].steps.find(
          (s): s is ProjectStep => s.kind === 'ProjectStep',
        );
      }
    }

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