/**
 * CSP-safe scalar function closure compiler for openCypher expressions.
 *
 * Compiles `FunctionCall` AST nodes into specialized monomorphic closures
 * operating on {@link SlotRow}s with compile-time arity validation and
 * openCypher null/type semantics.
 *
 * @module cypher/executor/ScalarFunctions
 */

import { Node } from '../../Node';
import { Edge } from '../../Edge';
import { CypherRuntimeError } from '../errors';
import type { CompiledExprFn } from './ClosureCompiler';

const INT_STRING_RE = /^[+-]?\d+(?:\.\d+)?$/;
const FLOAT_STRING_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const KNOWN_SCALAR_FUNCTIONS = new Set([
  'ID',
  'NODES',
  'RELATIONSHIPS',
  'LENGTH',
  'LABELS',
  'TYPE',
  'SIZE',
  'COALESCE',
  'TOLOWER',
  'LOWER',
  'TOUPPER',
  'UPPER',
  'TRIM',
  'LTRIM',
  'RTRIM',
  'SUBSTRING',
  'REPLACE',
  'SPLIT',
  'TOSTRING',
  'TOINTEGER',
  'TOINT',
  'TOFLOAT',
  'TOBOOLEAN',
  'KEYS',
  'PROPERTIES',
  'HEAD',
  'LAST',
  'TAIL',
  'RANGE',
  'ABS',
  'CEIL',
  'FLOOR',
  'ROUND',
  'SQRT',
  'TIMESTAMP',
]);

function normalizeZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

function arityError(fnDisplay: string, expected: string, got: number): CompiledExprFn {
  return () => {
    throw new CypherRuntimeError(`${fnDisplay}() expects ${expected}, got ${got}`);
  };
}

function compileUnaryString(
  fnDisplay: string,
  argFns: CompiledExprFn[],
  op: (s: string) => string,
): CompiledExprFn {
  if (argFns.length !== 1) {
    return arityError(fnDisplay, 'exactly 1 argument', argFns.length);
  }
  const a0 = argFns[0];
  return (r, p, k) => {
    const arg = a0(r, p, k);
    if (arg === null || arg === undefined) return null;
    if (typeof arg !== 'string') {
      throw new CypherRuntimeError(
        `${fnDisplay}() requires a string argument, got ${typeof arg}`,
      );
    }
    return op(arg);
  };
}

function compileUnaryMath(
  fnDisplay: string,
  argFns: CompiledExprFn[],
  op: (n: number) => number | null,
): CompiledExprFn {
  if (argFns.length !== 1) {
    return arityError(fnDisplay, 'exactly 1 argument', argFns.length);
  }
  const a0 = argFns[0];
  return (r, p, k) => {
    const arg = a0(r, p, k);
    if (arg === null || arg === undefined) return null;
    if (typeof arg !== 'number') {
      throw new CypherRuntimeError(
        `${fnDisplay}() requires a numeric argument, got ${typeof arg}`,
      );
    }
    return op(arg);
  };
}

/**
 * Compile a Cypher `FunctionCall` expression into a monomorphic {@link CompiledExprFn}.
 */
export function compileScalarFunction(
  fnName: string,
  origName: string,
  argFns: CompiledExprFn[],
  distinct?: boolean,
): CompiledExprFn {
  if (distinct === true && KNOWN_SCALAR_FUNCTIONS.has(fnName)) {
    return () => {
      throw new CypherRuntimeError(
        `DISTINCT is only supported on aggregate functions, not '${origName}()'`,
      );
    };
  }

  switch (fnName) {
    // ── Graph & Path Functions ─────────────────────────────────────
    case 'ID': {
      if (argFns.length !== 1) {
        return arityError('id', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg && typeof arg === 'object' && 'id' in (arg as object)) {
          return (arg as { id: string }).id;
        }
        if (arg === null || arg === undefined) return null;
        throw new CypherRuntimeError(
          `id() requires a node or relationship argument, got ${typeof arg}`,
        );
      };
    }

    case 'NODES': {
      if (argFns.length !== 1) {
        return arityError('nodes', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (!Array.isArray(arg)) {
          throw new CypherRuntimeError(`nodes() requires a path argument, got ${typeof arg}`);
        }
        return arg.filter((_, idx) => idx % 2 === 0);
      };
    }

    case 'RELATIONSHIPS': {
      if (argFns.length !== 1) {
        return arityError('relationships', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (!Array.isArray(arg)) {
          throw new CypherRuntimeError(
            `relationships() requires a path argument, got ${typeof arg}`,
          );
        }
        return arg.filter((_, idx) => idx % 2 === 1);
      };
    }

    case 'LENGTH': {
      if (argFns.length !== 1) {
        return arityError('length', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (
          Array.isArray(arg) &&
          arg.length >= 1 &&
          arg.length % 2 === 1 &&
          arg[0] instanceof Node
        ) {
          return (arg.length - 1) >> 1;
        }
        throw new CypherRuntimeError(`length() requires a path argument, got ${typeof arg}`);
      };
    }

    case 'LABELS': {
      if (argFns.length !== 1) {
        return arityError('labels', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (arg instanceof Node) return arg.labels;
        throw new CypherRuntimeError(`labels() requires a node argument, got ${typeof arg}`);
      };
    }

    case 'TYPE': {
      if (argFns.length !== 1) {
        return arityError('type', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (arg instanceof Edge) return arg.type;
        throw new CypherRuntimeError(
          `type() requires a relationship argument, got ${typeof arg}`,
        );
      };
    }

    case 'SIZE': {
      if (argFns.length !== 1) {
        return arityError('size', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (Array.isArray(arg) || typeof arg === 'string') return arg.length;
        throw new CypherRuntimeError(
          `size() requires a list or string argument, got ${typeof arg}`,
        );
      };
    }

    // ── Null Handling ──────────────────────────────────────────────
    case 'COALESCE': {
      if (argFns.length === 0) {
        return arityError('coalesce', 'at least 1 argument', 0);
      }
      if (argFns.length === 1) {
        const a0 = argFns[0];
        return (r, p, k) => a0(r, p, k) ?? null;
      }
      if (argFns.length === 2) {
        const a0 = argFns[0];
        const a1 = argFns[1];
        return (r, p, k) => {
          const v0 = a0(r, p, k);
          return v0 !== null && v0 !== undefined ? v0 : (a1(r, p, k) ?? null);
        };
      }
      const len = argFns.length;
      return (r, p, k) => {
        for (let i = 0; i < len; i++) {
          const v = argFns[i](r, p, k);
          if (v !== null && v !== undefined) return v;
        }
        return null;
      };
    }

    // ── String Functions ───────────────────────────────────────────
    case 'TOLOWER':
    case 'LOWER':
      return compileUnaryString(origName.toLowerCase(), argFns, (s) => s.toLowerCase());

    case 'TOUPPER':
    case 'UPPER':
      return compileUnaryString(origName.toLowerCase(), argFns, (s) => s.toUpperCase());

    case 'TRIM':
      return compileUnaryString('trim', argFns, (s) => s.trim());

    case 'LTRIM':
      return compileUnaryString('lTrim', argFns, (s) => s.trimStart());

    case 'RTRIM':
      return compileUnaryString('rTrim', argFns, (s) => s.trimEnd());

    case 'SUBSTRING': {
      if (argFns.length !== 2 && argFns.length !== 3) {
        return arityError('substring', '2 or 3 arguments', argFns.length);
      }
      const a0 = argFns[0];
      const a1 = argFns[1];
      const a2 = argFns.length === 3 ? argFns[2] : null;
      return (r, p, k) => {
        const str = a0(r, p, k);
        const start = a1(r, p, k);
        const len = a2 ? a2(r, p, k) : undefined;
        if (str === null || str === undefined || start === null || start === undefined) {
          return null;
        }
        if (a2 && (len === null || len === undefined)) {
          return null;
        }
        if (typeof str !== 'string') {
          throw new CypherRuntimeError(
            `substring() requires a string first argument, got ${typeof str}`,
          );
        }
        if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) {
          throw new CypherRuntimeError(
            `substring() start index must be a non-negative integer, got ${String(start)}`,
          );
        }
        if (len === undefined) {
          return str.slice(start);
        }
        if (typeof len !== 'number' || !Number.isSafeInteger(len) || len < 0) {
          throw new CypherRuntimeError(
            `substring() length must be a non-negative integer, got ${String(len)}`,
          );
        }
        return str.slice(start, start + len);
      };
    }

    case 'REPLACE': {
      if (argFns.length !== 3) {
        return arityError('replace', 'exactly 3 arguments', argFns.length);
      }
      const a0 = argFns[0];
      const a1 = argFns[1];
      const a2 = argFns[2];
      return (r, p, k) => {
        const orig = a0(r, p, k);
        const search = a1(r, p, k);
        const rep = a2(r, p, k);
        if (orig == null || search == null || rep == null) return null;
        if (typeof orig !== 'string' || typeof search !== 'string' || typeof rep !== 'string') {
          throw new CypherRuntimeError('replace() requires string arguments');
        }
        return orig.replaceAll(search, rep);
      };
    }

    case 'SPLIT': {
      if (argFns.length !== 2) {
        return arityError('split', 'exactly 2 arguments', argFns.length);
      }
      const a0 = argFns[0];
      const a1 = argFns[1];
      return (r, p, k) => {
        const orig = a0(r, p, k);
        const delim = a1(r, p, k);
        if (orig == null || delim == null) return null;
        if (typeof orig !== 'string' || typeof delim !== 'string') {
          throw new CypherRuntimeError('split() requires string arguments');
        }
        return orig.split(delim);
      };
    }

    // ── Type Cast Functions ────────────────────────────────────────
    case 'TOSTRING': {
      if (argFns.length !== 1) {
        return arityError('toString', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const v = a0(r, p, k);
        if (v === null || v === undefined) return null;
        const t = typeof v;
        if (t === 'string' || t === 'number' || t === 'boolean') {
          return String(v);
        }
        throw new CypherRuntimeError(`toString() cannot convert ${t}`);
      };
    }

    case 'TOINTEGER':
    case 'TOINT': {
      if (argFns.length !== 1) {
        return arityError(origName, 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const v = a0(r, p, k);
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) {
            throw new CypherRuntimeError(`toInteger() cannot convert non-finite number`);
          }
          return normalizeZero(Math.trunc(v));
        }
        if (typeof v === 'boolean') {
          return v ? 1 : 0;
        }
        if (typeof v === 'string') {
          const s = v.trim();
          if (!INT_STRING_RE.test(s)) return null;
          const t = Math.trunc(Number(s));
          return Number.isSafeInteger(t) ? normalizeZero(t) : null;
        }
        throw new CypherRuntimeError(`toInteger() cannot convert ${typeof v}`);
      };
    }

    case 'TOFLOAT': {
      if (argFns.length !== 1) {
        return arityError('toFloat', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const v = a0(r, p, k);
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') {
          return normalizeZero(v);
        }
        if (typeof v === 'string') {
          const s = v.trim();
          if (!FLOAT_STRING_RE.test(s)) return null;
          const n = Number(s);
          return Number.isFinite(n) ? normalizeZero(n) : null;
        }
        throw new CypherRuntimeError(`toFloat() cannot convert ${typeof v}`);
      };
    }

    case 'TOBOOLEAN': {
      if (argFns.length !== 1) {
        return arityError('toBoolean', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const v = a0(r, p, k);
        if (v === null || v === undefined) return null;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') {
          const s = v.trim().toLowerCase();
          if (s === 'true') return true;
          if (s === 'false') return false;
          return null;
        }
        if (typeof v === 'number') {
          if (!Number.isSafeInteger(v)) {
            throw new CypherRuntimeError(`toBoolean() requires an integer when given a number`);
          }
          return v !== 0;
        }
        throw new CypherRuntimeError(`toBoolean() cannot convert ${typeof v}`);
      };
    }

    // ── Collection & Map Functions ─────────────────────────────────
    case 'KEYS': {
      if (argFns.length !== 1) {
        return arityError('keys', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (arg instanceof Node || arg instanceof Edge) {
          return Object.keys(arg.properties);
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
          const rec = arg as Record<string, unknown>;
          return Object.keys(rec).filter((key) => rec[key] !== undefined);
        }
        throw new CypherRuntimeError(
          `keys() requires a node, relationship, or map argument, got ${typeof arg}`,
        );
      };
    }

    case 'PROPERTIES': {
      if (argFns.length !== 1) {
        return arityError('properties', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (arg instanceof Node || arg instanceof Edge) {
          return { ...arg.properties };
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
          const rec = arg as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(rec)) {
            if (rec[key] !== undefined) out[key] = rec[key];
          }
          return out;
        }
        throw new CypherRuntimeError(
          `properties() requires a node, relationship, or map argument, got ${typeof arg}`,
        );
      };
    }

    case 'HEAD': {
      if (argFns.length !== 1) {
        return arityError('head', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (!Array.isArray(arg)) {
          throw new CypherRuntimeError(`head() requires a list argument, got ${typeof arg}`);
        }
        return arg.length === 0 ? null : (arg[0] ?? null);
      };
    }

    case 'LAST': {
      if (argFns.length !== 1) {
        return arityError('last', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (!Array.isArray(arg)) {
          throw new CypherRuntimeError(`last() requires a list argument, got ${typeof arg}`);
        }
        return arg.length === 0 ? null : (arg[arg.length - 1] ?? null);
      };
    }

    case 'TAIL': {
      if (argFns.length !== 1) {
        return arityError('tail', 'exactly 1 argument', argFns.length);
      }
      const a0 = argFns[0];
      return (r, p, k) => {
        const arg = a0(r, p, k);
        if (arg === null || arg === undefined) return null;
        if (!Array.isArray(arg)) {
          throw new CypherRuntimeError(`tail() requires a list argument, got ${typeof arg}`);
        }
        return arg.slice(1);
      };
    }

    case 'RANGE': {
      if (argFns.length !== 2 && argFns.length !== 3) {
        return arityError('range', '2 or 3 arguments', argFns.length);
      }
      const a0 = argFns[0];
      const a1 = argFns[1];
      const a2 = argFns.length === 3 ? argFns[2] : null;
      return (r, p, k) => {
        const start = a0(r, p, k);
        const end = a1(r, p, k);
        const step = a2 ? a2(r, p, k) : 1;
        if (typeof start !== 'number' || !Number.isSafeInteger(start)) {
          throw new CypherRuntimeError(
            `range() start must be an integer, got ${start === null ? 'null' : typeof start}`,
          );
        }
        if (typeof end !== 'number' || !Number.isSafeInteger(end)) {
          throw new CypherRuntimeError(
            `range() end must be an integer, got ${end === null ? 'null' : typeof end}`,
          );
        }
        if (typeof step !== 'number' || !Number.isSafeInteger(step)) {
          throw new CypherRuntimeError(
            `range() step must be an integer, got ${step === null ? 'null' : typeof step}`,
          );
        }
        if (step === 0) {
          throw new CypherRuntimeError('range() step cannot be 0');
        }
        if ((step > 0 && start > end) || (step < 0 && start < end)) {
          return [];
        }
        const out: number[] = [];
        if (step > 0) {
          for (let i = start; i <= end; i += step) out.push(i);
        } else {
          for (let i = start; i >= end; i += step) out.push(i);
        }
        return out;
      };
    }

    // ── Math & Temporal Functions ──────────────────────────────────
    case 'ABS':
      return compileUnaryMath('abs', argFns, (n) => Math.abs(n));

    case 'CEIL':
      return compileUnaryMath('ceil', argFns, (n) => normalizeZero(Math.ceil(n)));

    case 'FLOOR':
      return compileUnaryMath('floor', argFns, (n) => normalizeZero(Math.floor(n)));

    case 'ROUND': {
      if (argFns.length !== 1 && argFns.length !== 2) {
        return arityError('round', '1 or 2 arguments', argFns.length);
      }
      const a0 = argFns[0];
      const a1 = argFns.length === 2 ? argFns[1] : null;
      return (r, p, k) => {
        const x = a0(r, p, k);
        if (x === null || x === undefined) return null;
        if (typeof x !== 'number') {
          throw new CypherRuntimeError(`round() requires a numeric argument, got ${typeof x}`);
        }
        if (!a1) {
          return normalizeZero(Math.round(x));
        }
        const prec = a1(r, p, k);
        if (prec === null || prec === undefined) return null;
        if (typeof prec !== 'number' || !Number.isSafeInteger(prec) || prec < 0) {
          throw new CypherRuntimeError(
            `round() precision must be a non-negative integer, got ${String(prec)}`,
          );
        }
        const factor = 10 ** prec;
        return normalizeZero(Math.round(x * factor) / factor);
      };
    }

    case 'SQRT':
      return compileUnaryMath('sqrt', argFns, (n) => (n < 0 ? null : Math.sqrt(n)));

    case 'TIMESTAMP': {
      if (argFns.length !== 0) {
        return arityError('timestamp', '0 arguments', argFns.length);
      }
      return () => Date.now();
    }

    default:
      return () => {
        throw new CypherRuntimeError(`Function '${origName}' is not yet supported`);
      };
  }
}
