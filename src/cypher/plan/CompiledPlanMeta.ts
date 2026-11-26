/**
 * Non-enumerable WeakMap metadata attached to compiled {@link QueryPlan}s:
 * dense variable-slot tables (`VarSlotTable`), write detection (`hasWrites`),
 * and pre-compiled expression closures (keeping `PlanFormatter.toJson()` spotless).
 *
 * @module cypher/plan/CompiledPlanMeta
 */

import type { Expression } from '../ast/AstNode';
import type {
  AggregateStep,
  FilterStep,
  LimitStep,
  MergeStep,
  OptionalMatchStep,
  PatternComprehensionStep,
  PlanStep,
  ProjectStep,
  QueryPlan,
  SetPropertyStep,
  ShowIndexesStep,
  SortStep,
  UnwindStep,
} from './QueryPlan';
import { compileExpression, type CompiledExprFn } from '../executor/ClosureCompiler';

export const UNBOUND = Symbol('UNBOUND');
export type SlotRow = unknown[];

export class VarSlotTable {
  private readonly _varToSlot = new Map<string, number>();
  private readonly _slotToVar: string[] = [];

  get size(): number {
    return this._slotToVar.length;
  }

  get slotToVar(): readonly string[] {
    return this._slotToVar;
  }

  getOrAdd(name: string): number {
    const existing = this._varToSlot.get(name);
    if (existing !== undefined) return existing;
    const slot = this._slotToVar.length;
    this._varToSlot.set(name, slot);
    this._slotToVar.push(name);
    return slot;
  }

  lookup(name: string): number {
    const slot = this._varToSlot.get(name);
    return slot !== undefined ? slot : -1;
  }

  createEmptyRow(): SlotRow {
    return new Array<unknown>(this._slotToVar.length).fill(UNBOUND);
  }
}

export interface CompiledPlanMeta {
  readonly slotTable: VarSlotTable;
  readonly hasWrites: boolean;
  readonly compiledExprs: WeakMap<Expression, CompiledExprFn>;
  readonly subPlanMetas: WeakMap<QueryPlan, CompiledPlanMeta>;
}

const PLAN_META_CACHE = new WeakMap<QueryPlan, CompiledPlanMeta>();

export function getOrBuildCompiledPlanMeta(plan: QueryPlan): CompiledPlanMeta {
  let meta = PLAN_META_CACHE.get(plan);
  if (meta) return meta;
  meta = buildCompiledPlanMeta(plan);
  PLAN_META_CACHE.set(plan, meta);
  return meta;
}

export function buildCompiledPlanMeta(plan: QueryPlan): CompiledPlanMeta {
  const slotTable = new VarSlotTable();
  const compiledExprs = new WeakMap<Expression, CompiledExprFn>();
  const subPlanMetas = new WeakMap<QueryPlan, CompiledPlanMeta>();
  let hasWrites = false;

  const registerExpr = (expr: Expression | undefined): void => {
    if (!expr) return;
    collectExprVars(expr, slotTable);
    if (!compiledExprs.has(expr)) {
      compiledExprs.set(expr, compileExpression(expr, slotTable));
    }
  };

  const walkSteps = (steps: readonly PlanStep[]): void => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      switch (step.kind) {
        case 'NodeScanStep':
        case 'NodeSeekStep':
        case 'VerifyNodeStep':
          slotTable.getOrAdd(step.variable);
          break;
        case 'EdgeExpandStep':
          slotTable.getOrAdd(step.source);
          slotTable.getOrAdd(step.target);
          if (step.edgeVar) slotTable.getOrAdd(step.edgeVar);
          if (step.pathVar) slotTable.getOrAdd(step.pathVar);
          break;
        case 'FilterStep':
          registerExpr((step as FilterStep).predicate);
          break;
        case 'ProjectStep': {
          const ps = step as ProjectStep;
          for (const col of ps.columns) {
            registerExpr(col.expression);
            slotTable.getOrAdd(col.alias);
          }
          break;
        }
        case 'SortStep': {
          const ss = step as SortStep;
          for (const item of ss.items) {
            registerExpr(item.expression);
          }
          break;
        }
        case 'LimitStep': {
          const ls = step as LimitStep;
          registerExpr(ls.skipExpr);
          registerExpr(ls.limitExpr);
          break;
        }
        case 'UnwindStep': {
          const us = step as UnwindStep;
          registerExpr(us.expression);
          slotTable.getOrAdd(us.variable);
          break;
        }
        case 'AggregateStep': {
          const ag = step as AggregateStep;
          for (let g = 0; g < ag.groupBy.length; g++) {
            registerExpr(ag.groupBy[g]);
            slotTable.getOrAdd(ag.groupByAliases[g]);
          }
          for (const spec of ag.aggregates) {
            registerExpr(spec.expression);
            slotTable.getOrAdd(spec.alias);
          }
          break;
        }
        case 'CreateNodeStep':
          hasWrites = true;
          slotTable.getOrAdd(step.variable);
          break;
        case 'CreateEdgeStep':
          hasWrites = true;
          slotTable.getOrAdd(step.source);
          slotTable.getOrAdd(step.target);
          slotTable.getOrAdd(step.variable);
          break;
        case 'SetPropertyStep': {
          hasWrites = true;
          const sp = step as SetPropertyStep;
          slotTable.getOrAdd(sp.variable);
          for (const a of sp.assignments) registerExpr(a.value);
          break;
        }
        case 'DeleteEntityStep':
        case 'RemovePropertyStep':
        case 'RemoveLabelStep':
        case 'SetLabelStep':
          hasWrites = true;
          slotTable.getOrAdd(step.variable);
          break;
        case 'ShowIndexesStep': {
          const si = step as ShowIndexesStep;
          for (const col of si.columns) slotTable.getOrAdd(col.alias);
          break;
        }
        case 'MergeStep': {
          hasWrites = true;
          const ms = step as MergeStep;
          walkSteps(ms.readSteps);
          walkSteps(ms.createSteps);
          for (const item of ms.onCreateItems) {
            slotTable.getOrAdd(item.variable);
            registerExpr(item.value);
          }
          for (const item of ms.onMatchItems) {
            slotTable.getOrAdd(item.variable);
            registerExpr(item.value);
          }
          break;
        }
        case 'OptionalMatchStep': {
          const om = step as OptionalMatchStep;
          walkSteps(om.readSteps);
          for (const v of om.newVars) slotTable.getOrAdd(v);
          break;
        }
        case 'ExistsSubqueryStep':
          walkSteps(step.subPlan);
          slotTable.getOrAdd(step.resultVariable);
          break;
        case 'PatternComprehensionStep': {
          const pc = step as PatternComprehensionStep;
          walkSteps(pc.subPlan);
          registerExpr(pc.projection);
          slotTable.getOrAdd(pc.resultVariable);
          break;
        }
        case 'PatternExprStep':
          walkSteps(step.subPlan);
          for (const pv of step.pathVariables) slotTable.getOrAdd(pv);
          slotTable.getOrAdd(step.resultVariable);
          break;
        case 'UnionStep':
          for (const subPlan of step.plans) {
            const subMeta = buildCompiledPlanMeta(subPlan);
            subPlanMetas.set(subPlan, subMeta);
            if (subMeta.hasWrites) hasWrites = true;
            for (const name of subMeta.slotTable.slotToVar) {
              slotTable.getOrAdd(name);
            }
          }
          break;
      }
    }
  };

  walkSteps(plan.steps);
  const meta: CompiledPlanMeta = {
    slotTable,
    hasWrites,
    compiledExprs,
    subPlanMetas,
  };
  PLAN_META_CACHE.set(plan, meta);
  return meta;
}

function collectExprVars(expr: Expression, slotTable: VarSlotTable): void {
  switch (expr.kind) {
    case 'Identifier':
      slotTable.getOrAdd(expr.name);
      return;
    case 'PropertyAccess':
      collectExprVars(expr.object, slotTable);
      return;
    case 'Binary':
      collectExprVars(expr.left, slotTable);
      collectExprVars(expr.right, slotTable);
      return;
    case 'Unary':
      collectExprVars(expr.operand, slotTable);
      return;
    case 'In':
      collectExprVars(expr.expression, slotTable);
      collectExprVars(expr.list, slotTable);
      return;
    case 'IsNull':
      collectExprVars(expr.expression, slotTable);
      return;
    case 'LabelPredicate':
      collectExprVars(expr.expression, slotTable);
      return;
    case 'List':
      for (const el of expr.elements) collectExprVars(el, slotTable);
      return;
    case 'Case':
      if (expr.expression) collectExprVars(expr.expression, slotTable);
      for (const b of expr.branches) {
        collectExprVars(b.when, slotTable);
        collectExprVars(b.then, slotTable);
      }
      if (expr.else) collectExprVars(expr.else, slotTable);
      return;
    case 'ListPredicate':
      slotTable.getOrAdd(expr.variable);
      collectExprVars(expr.list, slotTable);
      collectExprVars(expr.where, slotTable);
      return;
    case 'ListComprehension':
      slotTable.getOrAdd(expr.variable);
      collectExprVars(expr.list, slotTable);
      if (expr.where) collectExprVars(expr.where, slotTable);
      if (expr.projection) collectExprVars(expr.projection, slotTable);
      return;
    case 'Map':
      for (const val of Object.values(expr.props)) collectExprVars(val, slotTable);
      return;
    case 'FunctionCall':
      for (const arg of expr.args) collectExprVars(arg, slotTable);
      return;
  }
}
