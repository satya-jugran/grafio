/**
 * Shared parameter-resolution, comparison, and evaluation helpers for
 * the Cypher execution layer.
 *
 * Delegates AST expression evaluation to {@link compileExpression} in
 * {@link ClosureCompiler} while preserving Map-row compatibility for tests.
 *
 * @module cypher/executor/ExpressionEvaluator
 */

import { Expression } from '../ast/AstNode';
import { Node } from '../../Node';
import { Edge } from '../../Edge';
import { UnboundParameterError } from '../errors';
import { UNBOUND, VarSlotTable, type SlotRow } from '../plan/CompiledPlanMeta';
import type { ISyncGraphKernel } from '../../storage/IStorageProvider';
import { compileExpression, cypherEq } from './ClosureCompiler';

/**
 * Internal row representation: slot-indexed tuple (`unknown[]`).
 * Shared across all executor modules.
 */
export type Row = SlotRow;
export type EvalRow = SlotRow | Map<string, unknown>;

/**
 * Prefix-free, type-tagged key serialization for Cypher values.
 * Distinguishes `1` vs `'1'`, `true` vs `'true'`, `Node('a')` vs `'a'`,
 * arrays, plain map objects, `null`, `undefined`, and `UNBOUND`.
 */
export function serializeCypherKey(value: unknown): string {
  if (value === UNBOUND) return 'u:';
  if (value === null) return '0:null';
  if (value === undefined) return '0:undef';
  const t = typeof value;
  if (t === 'number') {
    const n = value as number;
    if (Number.isNaN(n)) return 'n:NaN';
    return `n:${Object.is(n, -0) ? 0 : n}`;
  }
  if (t === 'string') {
    const s = value as string;
    return `s:${s.length}:${s}`;
  }
  if (t === 'boolean') return (value as boolean) ? 'b:1' : 'b:0';
  if (value instanceof Node) return `node:${value.id.length}:${value.id}`;
  if (value instanceof Edge) return `edge:${value.id.length}:${value.id}`;
  if (Array.isArray(value)) {
    const parts = new Array<string>(value.length);
    for (let i = 0; i < value.length; i++) {
      parts[i] = serializeCypherKey(value[i]);
    }
    return `a:${value.length}:[${parts.join(',')}]`;
  }
  if (t === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = new Array<string>(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      entries[i] = `${k.length}:${k}=${serializeCypherKey(rec[k])}`;
    }
    return `m:${keys.length}:{${entries.join(',')}}`;
  }
  const str = String(value);
  return `${t}:${str.length}:${str}`;
}

/**
 * Serialize all bound slots of a {@link Row} into a collision-free key string
 * preserving slot indices so `{ a: 1, b: UNBOUND }` never collides with `{ a: UNBOUND, b: 1 }`.
 */
export function serializeSlotRowKey(row: Row, orderedSlots?: readonly number[]): string {
  const parts: string[] = [];
  if (orderedSlots) {
    for (let i = 0; i < orderedSlots.length; i++) {
      const s = orderedSlots[i];
      const v = row[s];
      if (v !== UNBOUND) {
        const sk = serializeCypherKey(v);
        parts.push(`${s}:${sk.length}:${sk}`);
      }
    }
  } else {
    for (let s = 0; s < row.length; s++) {
      const v = row[s];
      if (v !== UNBOUND) {
        const sk = serializeCypherKey(v);
        parts.push(`${s}:${sk.length}:${sk}`);
      }
    }
  }
  return parts.join('\x00');
}

function typeRank(v: unknown): number {
  switch (typeof v) {
    case 'boolean': return 1;
    case 'number': return 2;
    case 'string': return 3;
    case 'object': return Array.isArray(v) ? 4 : 5;
    default: return 6;
  }
}

/** Result returned by write step executors including mutation counts. */
export interface StepResult {
  rows: Row[];
  nodesCreated?: number;
  nodesDeleted?: number;
  edgesCreated?: number;
  edgesDeleted?: number;
  propertiesSet?: number;
  labelsAdded?: number;
  labelsRemoved?: number;
  indexesCreated?: number;
  indexesDeleted?: number;
}

const EMPTY_SLOT_TABLE = new VarSlotTable();
const EMPTY_SLOT_ROW: SlotRow = [];

/**
 * Stateless expression evaluator and parameter resolver.
 */
export class ExpressionEvaluator {
  /**
   * Resolve a value that may be a `{ kind: 'Parameter', name: 'x' }` AST node.
   */
  resolveParam(value: unknown, params: Record<string, unknown>): unknown {
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<string, unknown>).kind === 'Parameter'
    ) {
      const name = (value as Record<string, unknown>).name as string;
      if (!(name in params)) {
        throw new UnboundParameterError(name);
      }
      return params[name];
    }
    return value;
  }

  /**
   * Resolve any `ParameterRef` values in a property map against the
   * runtime parameter map, returning a plain record of primitive values.
   */
  resolvePropertyMap(
    properties: Record<string, unknown>,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      resolved[key] = this.resolveParam(value, params);
    }
    return resolved;
  }

  /**
   * Evaluate an AST {@link Expression} against a row (`SlotRow` or `Map`) and params.
   */
  evaluate(
    expr: Expression,
    row: EvalRow,
    params: Record<string, unknown>,
    slotTable?: VarSlotTable,
    kernel?: ISyncGraphKernel,
  ): unknown {
    if (row instanceof Map) {
      const tempTable = new VarSlotTable();
      for (const k of row.keys()) {
        tempTable.getOrAdd(k);
      }
      const fn = compileExpression(expr, tempTable);
      const tempRow = tempTable.createEmptyRow();
      for (const [k, v] of row) {
        tempRow[tempTable.lookup(k)] = v;
      }
      return fn(tempRow, params, kernel);
    }
    return compileExpression(expr, slotTable ?? EMPTY_SLOT_TABLE)(row, params, kernel);
  }

  /**
   * Evaluate a single binary operator via the compiled expression path.
   */
  applyBinaryOp(op: string, left: unknown, right: unknown): unknown {
    const expr = {
      kind: 'Binary',
      op,
      left: { kind: 'Literal', value: left },
      right: { kind: 'Literal', value: right },
    } as unknown as Expression;
    return compileExpression(expr, EMPTY_SLOT_TABLE)(EMPTY_SLOT_ROW, {});
  }

  /**
   * openCypher equality semantics (delegates to {@link cypherEq}).
   */
  eq(a: unknown, b: unknown): boolean {
    return cypherEq(a, b);
  }

  /**
   * Deterministic UTF-16 total ordering comparator for ORDER BY / MIN / MAX.
   */
  compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') {
      const aNaN = Number.isNaN(a);
      const bNaN = Number.isNaN(b);
      if (aNaN && bNaN) return 0;
      if (aNaN) return 1;
      if (bNaN) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return a ? 1 : -1;
    }
    const rankA = typeRank(a);
    const rankB = typeRank(b);
    if (rankA !== rankB) return rankA - rankB;
    const ka = serializeCypherKey(a);
    const kb = serializeCypherKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }
}
