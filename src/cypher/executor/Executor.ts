/**
 * Query plan executor for the Cypher execution layer.
 *
 * Walks a {@link QueryPlan} step by step over slot-indexed {@link SlotRow}
 * buffers using pre-compiled closures from {@link CompiledPlanMeta}, supporting
 * both a zero-microtask synchronous execution path (`executeSync`) and an async
 * fallback path (`execute`) for remote/custom storage providers.
 *
 * @module cypher/executor/Executor
 */

import { Graph } from '../../Graph';
import { GraphTransaction } from '../../Graph/GraphTransaction';
import type { ISyncGraphKernel } from '../../storage/IStorageProvider';
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
  ExistsSubqueryStep,
  PatternComprehensionStep,
  PatternExprStep,
  UnionStep,
  NodeScanStep,
  FilterStep,
  AggregateStep,
} from '../plan/QueryPlan';
import {
  UNBOUND,
  getOrBuildCompiledPlanMeta,
  type CompiledPlanMeta,
} from '../plan/CompiledPlanMeta';
import { CypherResult, CypherRow, CypherSummary } from '../Result';
import { CypherRuntimeError } from '../errors';
import { compileExpression } from './ClosureCompiler';
import { Row, ExpressionEvaluator, serializeSlotRowKey } from './ExpressionEvaluator';

import { ReadStepExecutor } from './steps/ReadStepExecutors';
import { PipelineStepExecutor } from './steps/PipelineStepExecutors';
import { AggregateStepExecutor } from './steps/AggregateStepExecutor';
import { WriteStepExecutor } from './steps/WriteStepExecutors';
import { DeleteStepExecutor } from './steps/DeleteStepExecutors';
import { IndexStepExecutor } from './steps/IndexStepExecutors';

interface ExecCounters {
  nodesCreated: number;
  nodesDeleted: number;
  edgesCreated: number;
  edgesDeleted: number;
  propertiesSet: number;
  labelsRemoved: number;
  indexesCreated: number;
  indexesDeleted: number;
}

function createCounters(): ExecCounters {
  return {
    nodesCreated: 0,
    nodesDeleted: 0,
    edgesCreated: 0,
    edgesDeleted: 0,
    propertiesSet: 0,
    labelsRemoved: 0,
    indexesCreated: 0,
    indexesDeleted: 0,
  };
}

/**
 * Executes a {@link QueryPlan} against a {@link Graph} instance.
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
   * Synchronously execute a compiled query plan against an in-memory kernel.
   */
  public executeSync(
    plan: QueryPlan,
    params: Record<string, unknown> = {},
    transaction?: GraphTransaction,
    precomputedMeta?: CompiledPlanMeta,
  ): CypherResult {
    const kernel = this._graph._getSyncKernel();
    if (!kernel) {
      throw new CypherRuntimeError(
        'Synchronous execution requires an in-memory kernel storage provider',
      );
    }

    const meta = precomputedMeta ?? getOrBuildCompiledPlanMeta(plan);
    const counters = createCounters();
    const startTime = Date.now();
    const stepStats: PlanStepExecutionStats[] = [];

    const useAutoCheckpoint = meta.hasWrites && !transaction;
    if (useAutoCheckpoint) {
      kernel.beginUndoCheckpoint();
    }

    let rows: Row[] = [meta.slotTable.createEmptyRow()];

    try {
      const steps = plan.steps;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        // Fused columnar NodeScan -> Filter? -> Aggregate fast path
        if (
          !transaction &&
          !kernel.hasActiveTransactions &&
          rows.length === 1 &&
          step.kind === 'NodeScanStep'
        ) {
          const nextStep = steps[i + 1];
          const thirdStep = steps[i + 2];

          if (
            nextStep?.kind === 'FilterStep' &&
            thirdStep?.kind === 'AggregateStep' &&
            this._canFuseScanAggregate(step as NodeScanStep, thirdStep as AggregateStep)
          ) {
            const fusedStart = Date.now();
            rows = this._aggregateExecutor.executeFusedNodeAggregateSync(
              kernel,
              step as NodeScanStep,
              nextStep as FilterStep,
              thirdStep as AggregateStep,
              rows[0],
              params,
              meta,
            );
            const fusedTime = Date.now() - fusedStart;
            stepStats.push(
              { stepKind: step.kind, timeMs: 0, percentageOfTotal: 0, rowsOut: rows.length },
              { stepKind: nextStep.kind, timeMs: 0, percentageOfTotal: 0, rowsOut: rows.length },
              {
                stepKind: thirdStep.kind,
                timeMs: fusedTime,
                percentageOfTotal: 0,
                rowsOut: rows.length,
              },
            );
            i += 2;
            continue;
          }

          if (
            nextStep?.kind === 'AggregateStep' &&
            this._canFuseScanAggregate(step as NodeScanStep, nextStep as AggregateStep)
          ) {
            const fusedStart = Date.now();
            rows = this._aggregateExecutor.executeFusedNodeAggregateSync(
              kernel,
              step as NodeScanStep,
              undefined,
              nextStep as AggregateStep,
              rows[0],
              params,
              meta,
            );
            const fusedTime = Date.now() - fusedStart;
            stepStats.push(
              { stepKind: step.kind, timeMs: 0, percentageOfTotal: 0, rowsOut: rows.length },
              {
                stepKind: nextStep.kind,
                timeMs: fusedTime,
                percentageOfTotal: 0,
                rowsOut: rows.length,
              },
            );
            i += 1;
            continue;
          }
        }

        const stepStart = Date.now();
        rows = this._executeStepSync(kernel, step, rows, params, meta, counters, transaction);
        const stepTime = Date.now() - stepStart;
        stepStats.push({
          stepKind: step.kind,
          timeMs: stepTime,
          percentageOfTotal: 0,
          rowsOut: rows.length,
        });
      }

      if (useAutoCheckpoint) {
        kernel.commitUndoCheckpoint();
      }
    } catch (err) {
      if (useAutoCheckpoint) {
        kernel.rollbackUndoCheckpoint();
      }
      throw err;
    }

    return this._finalizeResult(plan, meta, rows, stepStats, startTime, counters);
  }

  private _canFuseScanAggregate(
    scan: NodeScanStep,
    agg: AggregateStep,
  ): boolean {
    if (agg.useStorageLevel) return false;
    return agg.sourceEntity !== 'edge' && (!agg.sourceVariable || agg.sourceVariable === scan.variable);
  }

  /**
   * Execute a query plan and return the result set.
   * Dispatches immediately to {@link executeSync} when backed by `InMemoryStorageProvider`.
   */
  public async execute(
    plan: QueryPlan,
    params: Record<string, unknown> = {},
    transaction?: GraphTransaction,
    precomputedMeta?: CompiledPlanMeta,
  ): Promise<CypherResult> {
    if (this._graph._getSyncKernel()) {
      return this.executeSync(plan, params, transaction, precomputedMeta);
    }

    const meta = precomputedMeta ?? getOrBuildCompiledPlanMeta(plan);
    const counters = createCounters();
    const startTime = Date.now();
    const stepStats: PlanStepExecutionStats[] = [];

    let autoTx: GraphTransaction | undefined;
    let effectiveTx = transaction;
    if (meta.hasWrites && !transaction && this._graph.supportsTransactions()) {
      autoTx = this._graph.createTransaction();
      await autoTx.begin();
      effectiveTx = autoTx;
    }

    let rows: Row[] = [meta.slotTable.createEmptyRow()];

    try {
      for (const step of plan.steps) {
        const stepStart = Date.now();
        rows = await this._executeStepAsync(step, rows, params, meta, counters, effectiveTx);
        const stepTime = Date.now() - stepStart;
        stepStats.push({
          stepKind: step.kind,
          timeMs: stepTime,
          percentageOfTotal: 0,
          rowsOut: rows.length,
        });
      }

      if (autoTx) {
        await autoTx.commit();
      }
    } catch (err) {
      if (autoTx && (autoTx.isActive() || autoTx.isFailed())) {
        try {
          await autoTx.rollback();
        } catch {
          // Preserve original error
        }
      }
      throw err;
    }

    return this._finalizeResult(plan, meta, rows, stepStats, startTime, counters);
  }

  // ── Synchronous Step Dispatch ────────────────────────────────────

  private _executeStepSync(
    kernel: ISyncGraphKernel,
    step: PlanStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    counters: ExecCounters,
    transaction?: GraphTransaction,
  ): Row[] {
    switch (step.kind) {
      case 'NodeScanStep':
        return this._readExecutor.executeNodeScanSync(
          kernel,
          step,
          rows,
          params,
          meta.slotTable,
          transaction,
        );
      case 'NodeSeekStep':
        return this._readExecutor.executeNodeSeekSync(
          kernel,
          step,
          rows,
          params,
          meta.slotTable,
          transaction,
        );
      case 'VerifyNodeStep':
        return this._readExecutor.executeVerifyNodeSync(
          kernel,
          step,
          rows,
          params,
          meta.slotTable,
          transaction,
        );
      case 'EdgeExpandStep':
        return this._readExecutor.executeEdgeExpandSync(
          kernel,
          step,
          rows,
          params,
          meta.slotTable,
          transaction,
        );

      case 'FilterStep':
        return this._pipelineExecutor.executeFilterSync(step, rows, params, meta, kernel);
      case 'ProjectStep':
        return this._pipelineExecutor.executeProjectSync(step, rows, params, meta, kernel);
      case 'SortStep':
        return this._pipelineExecutor.executeSortSync(step, rows, params, meta, kernel);
      case 'LimitStep':
        return this._pipelineExecutor.executeLimitSync(step, rows, params, meta, kernel);
      case 'UnwindStep':
        return this._pipelineExecutor.executeUnwindSync(step, rows, params, meta, kernel);

      case 'AggregateStep':
        return this._aggregateExecutor.executeAggregateSync(
          kernel,
          step,
          rows,
          params,
          meta,
          transaction,
        );

      case 'CreateNodeStep': {
        const result = this._writeExecutor.executeCreateNodeSync(
          kernel,
          step,
          rows,
          params,
          meta,
          transaction,
        );
        counters.nodesCreated += result.nodesCreated ?? 0;
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'CreateEdgeStep': {
        const result = this._writeExecutor.executeCreateEdgeSync(
          kernel,
          step,
          rows,
          params,
          meta,
          transaction,
        );
        counters.edgesCreated += result.edgesCreated ?? 0;
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'SetPropertyStep': {
        const result = this._writeExecutor.executeSetPropertySync(
          kernel,
          step,
          rows,
          params,
          meta,
          transaction,
        );
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'DeleteEntityStep': {
        const result = this._deleteExecutor.executeDeleteEntitySync(
          kernel,
          step,
          rows,
          meta.slotTable,
          transaction,
        );
        counters.nodesDeleted += result.nodesDeleted ?? 0;
        counters.edgesDeleted += result.edgesDeleted ?? 0;
        return result.rows;
      }
      case 'RemovePropertyStep': {
        const result = this._deleteExecutor.executeRemovePropertySync(
          kernel,
          step,
          rows,
          meta.slotTable,
          transaction,
        );
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'RemoveLabelStep': {
        const result = this._deleteExecutor.executeRemoveLabelSync(
          kernel,
          step as RemoveLabelStep,
          rows,
          meta.slotTable,
          transaction,
        );
        counters.labelsRemoved += result.labelsRemoved ?? 0;
        return result.rows;
      }

      case 'CreateIndexStep': {
        const result = this._indexExecutor.executeCreateIndexSync(kernel, step, rows);
        counters.indexesCreated += result.indexesCreated ?? 0;
        return result.rows;
      }
      case 'DropIndexStep': {
        const result = this._indexExecutor.executeDropIndexSync(kernel, step, rows);
        counters.indexesDeleted += result.indexesDeleted ?? 0;
        return result.rows;
      }
      case 'ShowIndexesStep':
        return this._indexExecutor.executeShowIndexesSync(kernel, step, rows, meta.slotTable);

      case 'MergeStep': {
        const stepMerge = step as MergeStep;
        const resultRows: Row[] = [];
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          let matchRows: Row[] = [row];
          for (const rStep of stepMerge.readSteps) {
            matchRows = this._executeStepSync(
              kernel,
              rStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }

          if (matchRows.length > 0) {
            let currentRows = matchRows;
            for (const item of stepMerge.onMatchItems) {
              const setStep: SetPropertyStep = {
                kind: 'SetPropertyStep',
                variable: item.variable,
                entityKind: item.entityKind,
                assignments: [{ key: item.property, operator: item.operator, value: item.value }],
              };
              const res = this._writeExecutor.executeSetPropertySync(
                kernel,
                setStep,
                currentRows,
                params,
                meta,
                transaction,
              );
              currentRows = res.rows;
              counters.propertiesSet += res.propertiesSet ?? 0;
            }
            for (let m = 0; m < currentRows.length; m++) resultRows.push(currentRows[m]);
          } else {
            let currentRows: Row[] = [row];
            for (const cStep of stepMerge.createSteps) {
              if (cStep.kind === 'CreateNodeStep') {
                const res = this._writeExecutor.executeCreateNodeSync(
                  kernel,
                  cStep as CreateNodeStep,
                  currentRows,
                  params,
                  meta,
                  transaction,
                );
                currentRows = res.rows;
                counters.nodesCreated += res.nodesCreated ?? 0;
                counters.propertiesSet += res.propertiesSet ?? 0;
              } else if (cStep.kind === 'CreateEdgeStep') {
                const res = this._writeExecutor.executeCreateEdgeSync(
                  kernel,
                  cStep as CreateEdgeStep,
                  currentRows,
                  params,
                  meta,
                  transaction,
                );
                currentRows = res.rows;
                counters.edgesCreated += res.edgesCreated ?? 0;
                counters.propertiesSet += res.propertiesSet ?? 0;
              } else {
                currentRows = this._executeStepSync(
                  kernel,
                  cStep,
                  currentRows,
                  params,
                  meta,
                  counters,
                  transaction,
                );
              }
            }
            for (const item of stepMerge.onCreateItems) {
              const setStep: SetPropertyStep = {
                kind: 'SetPropertyStep',
                variable: item.variable,
                entityKind: item.entityKind,
                assignments: [{ key: item.property, operator: item.operator, value: item.value }],
              };
              const res = this._writeExecutor.executeSetPropertySync(
                kernel,
                setStep,
                currentRows,
                params,
                meta,
                transaction,
              );
              currentRows = res.rows;
              counters.propertiesSet += res.propertiesSet ?? 0;
            }
            for (let c = 0; c < currentRows.length; c++) resultRows.push(currentRows[c]);
          }
        }
        return resultRows;
      }

      case 'OptionalMatchStep': {
        const optStep = step as OptionalMatchStep;
        const resultRows: Row[] = [];
        const nullSlots = optStep.newVars.map((v) => meta.slotTable.getOrAdd(v));
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          let matchRows: Row[] = [row];
          for (const rStep of optStep.readSteps) {
            matchRows = this._executeStepSync(
              kernel,
              rStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          if (matchRows.length > 0) {
            for (let m = 0; m < matchRows.length; m++) resultRows.push(matchRows[m]);
          } else {
            const nullRow = row.slice();
            for (let s = 0; s < nullSlots.length; s++) {
              nullRow[nullSlots[s]] = null;
            }
            resultRows.push(nullRow);
          }
        }
        return resultRows;
      }

      case 'ExistsSubqueryStep': {
        const existsStep = step as ExistsSubqueryStep;
        const resultSlot = meta.slotTable.getOrAdd(existsStep.resultVariable);
        const resultRows: Row[] = new Array(rows.length);
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          let matchRows: Row[] = [row];
          for (const subStep of existsStep.subPlan) {
            matchRows = this._executeStepSync(
              kernel,
              subStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          const outRow = row.slice();
          outRow[resultSlot] = matchRows.length > 0;
          resultRows[r] = outRow;
        }
        return resultRows;
      }

      case 'PatternComprehensionStep': {
        const compStep = step as PatternComprehensionStep;
        const resultSlot = meta.slotTable.getOrAdd(compStep.resultVariable);
        let projFn = meta.compiledExprs.get(compStep.projection);
        if (!projFn) {
          projFn = compileExpression(compStep.projection, meta.slotTable);
          meta.compiledExprs.set(compStep.projection, projFn);
        }
        const resultRows: Row[] = new Array(rows.length);
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          let matchRows: Row[] = [row];
          for (const subStep of compStep.subPlan) {
            matchRows = this._executeStepSync(
              kernel,
              subStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          const results = new Array<unknown>(matchRows.length);
          for (let m = 0; m < matchRows.length; m++) {
            results[m] = projFn(matchRows[m], params, kernel);
          }
          const outRow = row.slice();
          outRow[resultSlot] = results;
          resultRows[r] = outRow;
        }
        return resultRows;
      }

      case 'PatternExprStep': {
        const exprStep = step as PatternExprStep;
        const resultSlot = meta.slotTable.getOrAdd(exprStep.resultVariable);
        const pathVarSlots = exprStep.pathVariables.map((v) => meta.slotTable.getOrAdd(v));
        const resultRows: Row[] = new Array(rows.length);
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          let matchRows: Row[] = [row];
          for (const subStep of exprStep.subPlan) {
            matchRows = this._executeStepSync(
              kernel,
              subStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          const paths: unknown[][] = new Array(matchRows.length);
          for (let m = 0; m < matchRows.length; m++) {
            const matchRow = matchRows[m];
            const path = new Array<unknown>(pathVarSlots.length);
            for (let p = 0; p < pathVarSlots.length; p++) {
              const val = matchRow[pathVarSlots[p]];
              path[p] = val === UNBOUND || val === undefined ? null : val;
            }
            paths[m] = path;
          }
          const outRow = row.slice();
          outRow[resultSlot] = paths;
          resultRows[r] = outRow;
        }
        return resultRows;
      }

      case 'UnionStep': {
        const unionStep = step as UnionStep;
        let resultRows: Row[] = [];
        for (let i = 0; i < unionStep.plans.length; i++) {
          const subPlan = unionStep.plans[i];
          const subMeta = meta.subPlanMetas.get(subPlan) ?? getOrBuildCompiledPlanMeta(subPlan);
          let subRows: Row[] = [subMeta.slotTable.createEmptyRow()];
          for (const subStep of subPlan.steps) {
            subRows = this._executeStepSync(
              kernel,
              subStep,
              subRows,
              params,
              subMeta,
              counters,
              transaction,
            );
          }
          const remapped = this._remapUnionRows(subRows, subMeta, meta);
          if (i === 0) {
            resultRows = remapped;
          } else {
            const isAll = unionStep.all[i - 1];
            resultRows = resultRows.concat(remapped);
            if (!isAll) {
              resultRows = this._dedupeUnionRows(resultRows, meta);
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

  // ── Async Step Dispatch (Remote / Custom Providers) ──────────────

  private async _executeStepAsync(
    step: PlanStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    counters: ExecCounters,
    transaction?: GraphTransaction,
  ): Promise<Row[]> {
    switch (step.kind) {
      case 'NodeScanStep':
        return this._readExecutor.executeNodeScan(step, rows, params, meta.slotTable, transaction);
      case 'NodeSeekStep':
        return this._readExecutor.executeNodeSeek(step, rows, params, meta.slotTable, transaction);
      case 'VerifyNodeStep':
        return this._readExecutor.executeVerifyNode(step, rows, params, meta.slotTable, transaction);
      case 'EdgeExpandStep':
        return this._readExecutor.executeEdgeExpand(step, rows, params, meta.slotTable, transaction);

      case 'FilterStep':
        return this._pipelineExecutor.executeFilter(step, rows, params, meta);
      case 'ProjectStep':
        return this._pipelineExecutor.executeProject(step, rows, params, meta);
      case 'SortStep':
        return this._pipelineExecutor.executeSort(step, rows, params, meta);
      case 'LimitStep':
        return this._pipelineExecutor.executeLimit(step, rows, params, meta);
      case 'UnwindStep':
        return this._pipelineExecutor.executeUnwind(step, rows, params, meta);

      case 'AggregateStep':
        return this._aggregateExecutor.executeAggregate(step, rows, params, meta, transaction);

      case 'CreateNodeStep': {
        const result = await this._writeExecutor.executeCreateNode(
          step,
          rows,
          params,
          meta,
          transaction,
        );
        counters.nodesCreated += result.nodesCreated ?? 0;
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'CreateEdgeStep': {
        const result = await this._writeExecutor.executeCreateEdge(
          step,
          rows,
          params,
          meta,
          transaction,
        );
        counters.edgesCreated += result.edgesCreated ?? 0;
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'SetPropertyStep': {
        const result = await this._writeExecutor.executeSetProperty(
          step,
          rows,
          params,
          meta,
          transaction,
        );
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'DeleteEntityStep': {
        const result = await this._deleteExecutor.executeDeleteEntity(
          step,
          rows,
          meta.slotTable,
          transaction,
        );
        counters.nodesDeleted += result.nodesDeleted ?? 0;
        counters.edgesDeleted += result.edgesDeleted ?? 0;
        return result.rows;
      }
      case 'RemovePropertyStep': {
        const result = await this._deleteExecutor.executeRemoveProperty(
          step,
          rows,
          meta.slotTable,
          transaction,
        );
        counters.propertiesSet += result.propertiesSet ?? 0;
        return result.rows;
      }
      case 'RemoveLabelStep': {
        const result = await this._deleteExecutor.executeRemoveLabel(
          step as RemoveLabelStep,
          rows,
          meta.slotTable,
          transaction,
        );
        counters.labelsRemoved += result.labelsRemoved ?? 0;
        return result.rows;
      }

      case 'CreateIndexStep': {
        const result = await this._indexExecutor.executeCreateIndex(step, rows);
        counters.indexesCreated += result.indexesCreated ?? 0;
        return result.rows;
      }
      case 'DropIndexStep': {
        const result = await this._indexExecutor.executeDropIndex(step, rows);
        counters.indexesDeleted += result.indexesDeleted ?? 0;
        return result.rows;
      }
      case 'ShowIndexesStep':
        return this._indexExecutor.executeShowIndexes(step, rows, meta.slotTable);

      case 'MergeStep': {
        const stepMerge = step as MergeStep;
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const rStep of stepMerge.readSteps) {
            matchRows = await this._executeStepAsync(
              rStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }

          if (matchRows.length > 0) {
            let currentRows = matchRows;
            for (const item of stepMerge.onMatchItems) {
              const setStep: SetPropertyStep = {
                kind: 'SetPropertyStep',
                variable: item.variable,
                entityKind: item.entityKind,
                assignments: [{ key: item.property, operator: item.operator, value: item.value }],
              };
              const res = await this._writeExecutor.executeSetProperty(
                setStep,
                currentRows,
                params,
                meta,
                transaction,
              );
              currentRows = res.rows;
              counters.propertiesSet += res.propertiesSet ?? 0;
            }
            resultRows.push(...currentRows);
          } else {
            let currentRows: Row[] = [row];
            for (const cStep of stepMerge.createSteps) {
              if (cStep.kind === 'CreateNodeStep') {
                const res = await this._writeExecutor.executeCreateNode(
                  cStep as CreateNodeStep,
                  currentRows,
                  params,
                  meta,
                  transaction,
                );
                currentRows = res.rows;
                counters.nodesCreated += res.nodesCreated ?? 0;
                counters.propertiesSet += res.propertiesSet ?? 0;
              } else if (cStep.kind === 'CreateEdgeStep') {
                const res = await this._writeExecutor.executeCreateEdge(
                  cStep as CreateEdgeStep,
                  currentRows,
                  params,
                  meta,
                  transaction,
                );
                currentRows = res.rows;
                counters.edgesCreated += res.edgesCreated ?? 0;
                counters.propertiesSet += res.propertiesSet ?? 0;
              } else {
                currentRows = await this._executeStepAsync(
                  cStep,
                  currentRows,
                  params,
                  meta,
                  counters,
                  transaction,
                );
              }
            }
            for (const item of stepMerge.onCreateItems) {
              const setStep: SetPropertyStep = {
                kind: 'SetPropertyStep',
                variable: item.variable,
                entityKind: item.entityKind,
                assignments: [{ key: item.property, operator: item.operator, value: item.value }],
              };
              const res = await this._writeExecutor.executeSetProperty(
                setStep,
                currentRows,
                params,
                meta,
                transaction,
              );
              currentRows = res.rows;
              counters.propertiesSet += res.propertiesSet ?? 0;
            }
            resultRows.push(...currentRows);
          }
        }
        return resultRows;
      }

      case 'OptionalMatchStep': {
        const optStep = step as OptionalMatchStep;
        const resultRows: Row[] = [];
        const nullSlots = optStep.newVars.map((v) => meta.slotTable.getOrAdd(v));
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const rStep of optStep.readSteps) {
            matchRows = await this._executeStepAsync(
              rStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          if (matchRows.length > 0) {
            resultRows.push(...matchRows);
          } else {
            const nullRow = row.slice();
            for (const s of nullSlots) {
              nullRow[s] = null;
            }
            resultRows.push(nullRow);
          }
        }
        return resultRows;
      }

      case 'ExistsSubqueryStep': {
        const existsStep = step as ExistsSubqueryStep;
        const resultSlot = meta.slotTable.getOrAdd(existsStep.resultVariable);
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const subStep of existsStep.subPlan) {
            matchRows = await this._executeStepAsync(
              subStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          const outRow = row.slice();
          outRow[resultSlot] = matchRows.length > 0;
          resultRows.push(outRow);
        }
        return resultRows;
      }

      case 'PatternComprehensionStep': {
        const compStep = step as PatternComprehensionStep;
        const resultSlot = meta.slotTable.getOrAdd(compStep.resultVariable);
        let projFn = meta.compiledExprs.get(compStep.projection);
        if (!projFn) {
          projFn = compileExpression(compStep.projection, meta.slotTable);
          meta.compiledExprs.set(compStep.projection, projFn);
        }
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const subStep of compStep.subPlan) {
            matchRows = await this._executeStepAsync(
              subStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          const results = matchRows.map((matchRow) => projFn(matchRow, params));
          const outRow = row.slice();
          outRow[resultSlot] = results;
          resultRows.push(outRow);
        }
        return resultRows;
      }

      case 'PatternExprStep': {
        const exprStep = step as PatternExprStep;
        const resultSlot = meta.slotTable.getOrAdd(exprStep.resultVariable);
        const pathVarSlots = exprStep.pathVariables.map((v) => meta.slotTable.getOrAdd(v));
        const resultRows: Row[] = [];
        for (const row of rows) {
          let matchRows: Row[] = [row];
          for (const subStep of exprStep.subPlan) {
            matchRows = await this._executeStepAsync(
              subStep,
              matchRows,
              params,
              meta,
              counters,
              transaction,
            );
            if (matchRows.length === 0) break;
          }
          const paths = matchRows.map((matchRow) =>
            pathVarSlots.map((slot) => {
              const v = matchRow[slot];
              return v === UNBOUND || v === undefined ? null : v;
            }),
          );
          const outRow = row.slice();
          outRow[resultSlot] = paths;
          resultRows.push(outRow);
        }
        return resultRows;
      }

      case 'UnionStep': {
        const unionStep = step as UnionStep;
        let resultRows: Row[] = [];
        for (let i = 0; i < unionStep.plans.length; i++) {
          const subPlan = unionStep.plans[i];
          const subMeta = meta.subPlanMetas.get(subPlan) ?? getOrBuildCompiledPlanMeta(subPlan);
          let subRows: Row[] = [subMeta.slotTable.createEmptyRow()];
          for (const subStep of subPlan.steps) {
            subRows = await this._executeStepAsync(
              subStep,
              subRows,
              params,
              subMeta,
              counters,
              transaction,
            );
          }
          const remapped = this._remapUnionRows(subRows, subMeta, meta);
          if (i === 0) {
            resultRows = remapped;
          } else {
            const isAll = unionStep.all[i - 1];
            resultRows = resultRows.concat(remapped);
            if (!isAll) {
              resultRows = this._dedupeUnionRows(resultRows, meta);
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

  // ── Union Helpers ──────────────────────────────────────────────

  private _remapUnionRows(
    subRows: Row[],
    subMeta: CompiledPlanMeta,
    parentMeta: CompiledPlanMeta,
  ): Row[] {
    const subVars = subMeta.slotTable.slotToVar;
    const slotMap = new Array<number>(subVars.length);
    for (let s = 0; s < subVars.length; s++) {
      slotMap[s] = parentMeta.slotTable.getOrAdd(subVars[s]);
    }

    const out = new Array<Row>(subRows.length);
    for (let r = 0; r < subRows.length; r++) {
      const subRow = subRows[r];
      const parentRow = parentMeta.slotTable.createEmptyRow();
      for (let s = 0; s < slotMap.length; s++) {
        if (subRow[s] !== UNBOUND) {
          parentRow[slotMap[s]] = subRow[s];
        }
      }
      out[r] = parentRow;
    }
    return out;
  }

  private _dedupeUnionRows(rows: Row[], meta: CompiledPlanMeta): Row[] {
    const slotToVar = meta.slotTable.slotToVar;
    const sortedSlots = slotToVar
      .map((name, slot) => ({ name, slot }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((x) => x.slot);

    const seen = new Set<string>();
    const out: Row[] = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const hash = serializeSlotRowKey(row, sortedSlots);
      if (!seen.has(hash)) {
        seen.add(hash);
        out.push(row);
      }
    }
    return out;
  }

  // ── Result builder ─────────────────────────────────────────────

  private _finalizeResult(
    plan: QueryPlan,
    meta: CompiledPlanMeta,
    rows: Row[],
    stepStats: PlanStepExecutionStats[],
    startTime: number,
    counters: ExecCounters,
  ): CypherResult {
    const stepTotalTime = stepStats.reduce((sum, s) => sum + s.timeMs, 0);
    const totalTime = stepTotalTime > 0 ? stepTotalTime : Date.now() - startTime;

    const stats: PlanExecutionStats = {
      totalTimeMs: totalTime,
      steps: stepStats.map((s) => ({
        ...s,
        percentageOfTotal: totalTime > 0 ? (s.timeMs / totalTime) * 100 : 0,
      })),
    };

    return this._buildResult(plan, meta, rows, stats, counters);
  }

  private _findLastProjectStep(steps: readonly PlanStep[]): ProjectStep | undefined {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].kind === 'ProjectStep') {
        return steps[i] as ProjectStep;
      }
    }
    return undefined;
  }

  private _buildResult(
    plan: QueryPlan,
    meta: CompiledPlanMeta,
    rows: Row[],
    stats: PlanExecutionStats,
    counters: ExecCounters,
  ): CypherResult {
    let projectStep = this._findLastProjectStep(plan.steps);

    if (!projectStep) {
      const unionStep = plan.steps.find((s): s is UnionStep => s.kind === 'UnionStep');
      if (unionStep && unionStep.plans.length > 0) {
        projectStep = this._findLastProjectStep(unionStep.plans[0].steps);
      }
    }

    const columns = projectStep ? projectStep.columns.map((c) => c.alias) : [];
    const slotToVar = meta.slotTable.slotToVar;
    const slotCount = slotToVar.length;

    const resultRows: CypherRow[] = new Array(rows.length);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const obj: CypherRow = {};
      for (let s = 0; s < slotCount; s++) {
        const val = row[s];
        if (val !== UNBOUND) {
          obj[slotToVar[s]] = val;
        }
      }
      resultRows[r] = obj;
    }

    const summary: CypherSummary = {
      queryTimeMs: stats.totalTimeMs,
      nodesCreated: counters.nodesCreated,
      nodesDeleted: counters.nodesDeleted,
      edgesCreated: counters.edgesCreated,
      edgesDeleted: counters.edgesDeleted,
      propertiesSet: counters.propertiesSet,
      labelsRemoved: counters.labelsRemoved,
      indexesCreated: counters.indexesCreated,
      indexesDeleted: counters.indexesDeleted,
      planExecutionStats: stats,
    };

    return { columns, rows: resultRows, summary };
  }
}
