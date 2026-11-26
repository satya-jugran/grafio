/**
 * Write step executor for the Cypher execution layer.
 *
 * Executes {@link CreateNodeStep}, {@link CreateEdgeStep}, and
 * {@link SetPropertyStep} against a {@link Graph} or {@link ISyncGraphKernel}.
 *
 * @module cypher/executor/steps/WriteStepExecutors
 */

import { Graph } from '../../../Graph';
import { Node } from '../../../Node';
import { Edge } from '../../../Edge';
import { GraphTransaction } from '../../../Graph/GraphTransaction';
import type { ISyncGraphKernel } from '../../../storage/IStorageProvider';
import {
  CreateNodeStep,
  CreateEdgeStep,
  SetPropertyStep,
  SetLabelStep,
} from '../../plan/QueryPlan';
import { Expression } from '../../ast/AstNode';
import {
  UNBOUND,
  type CompiledPlanMeta,
  type VarSlotTable,
} from '../../plan/CompiledPlanMeta';
import { CypherRuntimeError } from '../../errors';
import { compileExpression, type CompiledExprFn } from '../ClosureCompiler';
import { Row, ExpressionEvaluator, StepResult } from '../ExpressionEvaluator';

/**
 * Return a shallow copy of `row` with every slot (and array/path element)
 * referencing the mutated entity replaced by `refreshed`.
 */
export function refreshEntityInRow(
  row: Row,
  entityKind: 'node' | 'edge',
  entityId: string,
  refreshed: Node | Edge,
): Row {
  const isMatch = (val: unknown): boolean =>
    entityKind === 'node'
      ? val instanceof Node && val.id === entityId
      : val instanceof Edge && val.id === entityId;

  const newRow = row.slice();
  for (let s = 0; s < newRow.length; s++) {
    const val = newRow[s];
    if (val === UNBOUND || val === null || val === undefined) continue;
    if (isMatch(val)) {
      newRow[s] = refreshed;
    } else if (Array.isArray(val)) {
      let changed = false;
      for (let j = 0; j < val.length; j++) {
        if (isMatch(val[j])) {
          changed = true;
          break;
        }
      }
      if (changed) {
        newRow[s] = val.map((el) => (isMatch(el) ? refreshed : el));
      }
    }
  }
  return newRow;
}

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

  private _getCompiled(expr: Expression, meta: CompiledPlanMeta): CompiledExprFn {
    let fn = meta.compiledExprs.get(expr);
    if (!fn) {
      fn = compileExpression(expr, meta.slotTable);
      meta.compiledExprs.set(expr, fn);
    }
    return fn;
  }

  // ── CreateNodeStep ─────────────────────────────────────────────

  async executeCreateNode(
    step: CreateNodeStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    const result: Row[] = new Array(rows.length);
    const resolvedProps = this._evaluator.resolvePropertyMap(step.properties, params);
    const propCount = Object.keys(resolvedProps).length;
    const varSlot = meta.slotTable.getOrAdd(step.variable);

    for (let i = 0; i < rows.length; i++) {
      const node = await this._graph.addNode(step.labels, resolvedProps, transaction);
      const newRow = rows[i].slice();
      newRow[varSlot] = node;
      result[i] = newRow;
    }

    return {
      rows: result,
      nodesCreated: result.length,
      propertiesSet: result.length * propCount,
    };
  }

  executeCreateNodeSync(
    kernel: ISyncGraphKernel,
    step: CreateNodeStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): StepResult {
    const result: Row[] = new Array(rows.length);
    const resolvedProps = this._evaluator.resolvePropertyMap(step.properties, params);
    const propCount = Object.keys(resolvedProps).length;
    const varSlot = meta.slotTable.getOrAdd(step.variable);
    const txHandle = transaction?._getHandle();

    for (let i = 0; i < rows.length; i++) {
      let node: Node;
      try {
        node = kernel.insertNodeSync(step.labels, resolvedProps, undefined, txHandle);
      } catch (err) {
        transaction?.markFailed();
        throw err;
      }
      const newRow = rows[i].slice();
      newRow[varSlot] = node;
      result[i] = newRow;
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
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    const result: Row[] = new Array(rows.length);
    const resolvedProps = this._evaluator.resolvePropertyMap(step.properties, params);
    const propCount = Object.keys(resolvedProps).length;
    const srcSlot = meta.slotTable.getOrAdd(step.source);
    const tgtSlot = meta.slotTable.getOrAdd(step.target);
    const edgeSlot = meta.slotTable.getOrAdd(step.variable);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawSrc = row[srcSlot];
      const rawTgt = row[tgtSlot];
      if (rawSrc === UNBOUND || rawTgt === UNBOUND || !rawSrc || !rawTgt) {
        throw new CypherRuntimeError('Cannot create edge: source or target node not bound');
      }
      if (step.types.length === 0) {
        throw new CypherRuntimeError('Cannot create edge: relationship type is required');
      }
      const edge = await this._graph.addEdge(
        (rawSrc as Node).id,
        (rawTgt as Node).id,
        step.types[0],
        resolvedProps,
        transaction,
      );
      const newRow = row.slice();
      newRow[edgeSlot] = edge;
      result[i] = newRow;
    }

    return {
      rows: result,
      edgesCreated: result.length,
      propertiesSet: result.length * propCount,
    };
  }

  executeCreateEdgeSync(
    kernel: ISyncGraphKernel,
    step: CreateEdgeStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): StepResult {
    const result: Row[] = new Array(rows.length);
    const resolvedProps = this._evaluator.resolvePropertyMap(step.properties, params);
    const propCount = Object.keys(resolvedProps).length;
    const srcSlot = meta.slotTable.getOrAdd(step.source);
    const tgtSlot = meta.slotTable.getOrAdd(step.target);
    const edgeSlot = meta.slotTable.getOrAdd(step.variable);
    const txHandle = transaction?._getHandle();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawSrc = row[srcSlot];
      const rawTgt = row[tgtSlot];
      if (rawSrc === UNBOUND || rawTgt === UNBOUND || !rawSrc || !rawTgt) {
        throw new CypherRuntimeError('Cannot create edge: source or target node not bound');
      }
      if (step.types.length === 0) {
        throw new CypherRuntimeError('Cannot create edge: relationship type is required');
      }
      let edge: Edge;
      try {
        edge = kernel.insertEdgeSync(
          (rawSrc as Node).id,
          (rawTgt as Node).id,
          step.types[0],
          resolvedProps,
          undefined,
          txHandle,
        );
      } catch (err) {
        transaction?.markFailed();
        throw err;
      }
      const newRow = row.slice();
      newRow[edgeSlot] = edge;
      result[i] = newRow;
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
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    const result: Row[] = new Array(rows.length);
    let propertiesSet = 0;
    const varSlot = meta.slotTable.getOrAdd(step.variable);
    const assignmentFns = step.assignments.map((a) =>
      this._getCompiled(a.value as Expression, meta),
    );

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const entity = row[varSlot];
      if (entity === UNBOUND || !entity) {
        result[r] = row;
        continue;
      }
      const entityId = (entity as Node | Edge).id;

      for (let a = 0; a < step.assignments.length; a++) {
        const { key, operator } = step.assignments[a];
        const evaluatedValue = assignmentFns[a](row, params);

        if (key === undefined) {
          const mapVal = this._validateMapAssignment(evaluatedValue);
          const merge = operator !== '=';
          if (step.entityKind === 'node') {
            await this._graph.setNodeProperties(entityId, mapVal, { merge, transaction });
          } else {
            await this._graph.setEdgeProperties(entityId, mapVal, { merge, transaction });
          }
          propertiesSet += Object.keys(mapVal).length;
        } else {
          if (step.entityKind === 'node') {
            await this._graph.setNodeProperties(
              entityId,
              { [key]: evaluatedValue },
              { merge: true, transaction },
            );
          } else {
            await this._graph.setEdgeProperties(
              entityId,
              { [key]: evaluatedValue },
              { merge: true, transaction },
            );
          }
          propertiesSet++;
        }
      }

      const refreshed =
        step.entityKind === 'node'
          ? await this._graph.getNode(entityId, transaction)
          : await this._graph.getEdge(entityId, transaction);

      result[r] = refreshed
        ? refreshEntityInRow(row, step.entityKind, entityId, refreshed)
        : row.slice();
    }

    return { rows: result, propertiesSet };
  }

  executeSetPropertySync(
    kernel: ISyncGraphKernel,
    step: SetPropertyStep,
    rows: Row[],
    params: Record<string, unknown>,
    meta: CompiledPlanMeta,
    transaction?: GraphTransaction,
  ): StepResult {
    const result: Row[] = new Array(rows.length);
    let propertiesSet = 0;
    const varSlot = meta.slotTable.getOrAdd(step.variable);
    const txHandle = transaction?._getHandle();
    const assignmentFns = step.assignments.map((a) =>
      this._getCompiled(a.value as Expression, meta),
    );

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const entity = row[varSlot];
      if (entity === UNBOUND || !entity) {
        result[r] = row;
        continue;
      }
      const entityId = (entity as Node | Edge).id;

      for (let a = 0; a < step.assignments.length; a++) {
        const { key, operator } = step.assignments[a];
        const evaluatedValue = assignmentFns[a](row, params, kernel);

        if (key === undefined) {
          const mapVal = this._validateMapAssignment(evaluatedValue);
          try {
            kernel.patchPropertiesSync(
              step.entityKind,
              entityId,
              { set: mapVal, replace: operator === '=' },
              txHandle,
            );
          } catch (err) {
            transaction?.markFailed();
            throw err;
          }
          propertiesSet += Object.keys(mapVal).length;
        } else {
          try {
            kernel.patchPropertiesSync(
              step.entityKind,
              entityId,
              { set: { [key]: evaluatedValue } },
              txHandle,
            );
          } catch (err) {
            transaction?.markFailed();
            throw err;
          }
          propertiesSet++;
        }
      }

      const refreshed =
        step.entityKind === 'node'
          ? kernel.getNodeSync(entityId, txHandle)
          : kernel.getEdgeSync(entityId, txHandle);

      result[r] = refreshed
        ? refreshEntityInRow(row, step.entityKind, entityId, refreshed)
        : row.slice();
    }

    return { rows: result, propertiesSet };
  }

  // ── SetLabelStep ───────────────────────────────────────────────

  async executeSetLabel(
    step: SetLabelStep,
    rows: Row[],
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): Promise<StepResult> {
    let labelsAdded = 0;
    const varSlot = slotTable.getOrAdd(step.variable);
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
      await this._graph.addNodeLabels(nodeId, step.labels, transaction);
      const refreshed = await this._graph.getNode(nodeId, transaction);
      outRows[i] = refreshed
        ? refreshEntityInRow(row, 'node', nodeId, refreshed)
        : row.slice();
      if (before) {
        const beforeSet = new Set(before.labels);
        const seenNew = new Set<string>();
        for (let k = 0; k < step.labels.length; k++) {
          const lbl = step.labels[k];
          if (!beforeSet.has(lbl) && !seenNew.has(lbl)) {
            seenNew.add(lbl);
            labelsAdded++;
          }
        }
      }
    }
    return { rows: outRows, labelsAdded };
  }

  executeSetLabelSync(
    kernel: ISyncGraphKernel,
    step: SetLabelStep,
    rows: Row[],
    slotTable: VarSlotTable,
    transaction?: GraphTransaction,
  ): StepResult {
    let labelsAdded = 0;
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
      let addedCount: number;
      try {
        addedCount = kernel.addNodeLabelsSync(nodeId, step.labels, txHandle);
      } catch (err) {
        transaction?.markFailed();
        throw err;
      }
      const refreshed = kernel.getNodeSync(nodeId, txHandle);
      outRows[i] = refreshed
        ? refreshEntityInRow(row, 'node', nodeId, refreshed)
        : row.slice();
      labelsAdded += addedCount;
    }
    return { rows: outRows, labelsAdded };
  }

  private _validateMapAssignment(evaluatedValue: unknown): Record<string, unknown> {
    if (
      typeof evaluatedValue !== 'object' ||
      evaluatedValue === null ||
      Array.isArray(evaluatedValue) ||
      Object.getPrototypeOf(evaluatedValue) !== Object.prototype
    ) {
      throw new CypherRuntimeError('SET map assignment requires a plain object map value');
    }
    const mapVal = evaluatedValue as Record<string, unknown>;
    for (const v of Object.values(mapVal)) {
      if (
        v !== null &&
        typeof v !== 'string' &&
        typeof v !== 'number' &&
        typeof v !== 'boolean'
      ) {
        throw new CypherRuntimeError(
          'Map property values must be a primitive type (string, number, boolean, or null)',
        );
      }
    }
    return mapVal;
  }
}
