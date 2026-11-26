/**
 * CSP-safe expression closure compiler (zero `eval` / `new Function`).
 *
 * Compiles AST {@link Expression} trees into monomorphic closures operating
 * directly on array-backed {@link SlotRow}s and reading properties straight
 * from {@link ISyncGraphKernel}'s {@link ColumnStore} whenever possible.
 *
 * @module cypher/executor/ClosureCompiler
 */

import type { Expression } from '../ast/AstNode';
import { Node } from '../../Node';
import { Edge } from '../../Edge';
import type { ISyncGraphKernel } from '../../storage/IStorageProvider';
import { TAG_ABSENT } from '../../storage/engine/ColumnStore';
import { CypherRuntimeError, TypeMismatchError, UnboundParameterError } from '../errors';
import { UNBOUND, type SlotRow, type VarSlotTable } from '../plan/CompiledPlanMeta';
import { compileScalarFunction } from './ScalarFunctions';

export type CompiledExprFn = (
  row: SlotRow,
  params: Record<string, unknown>,
  kernel?: ISyncGraphKernel,
) => unknown;

export function compileExpression(
  expr: Expression,
  slotTable: VarSlotTable,
): CompiledExprFn {
  switch (expr.kind) {
    case 'Literal': {
      const val = expr.value;
      return () => val;
    }

    case 'Parameter': {
      const name = expr.name;
      return (_row, params) => {
        if (!(name in params)) {
          throw new UnboundParameterError(name);
        }
        return params[name];
      };
    }

    case 'Identifier': {
      const name = expr.name;
      const slot = slotTable.getOrAdd(name);
      return (row) => {
        const val = row[slot];
        if (val === UNBOUND) {
          throw new CypherRuntimeError(
            `Variable '${name}' is not bound in the current row`,
          );
        }
        return val;
      };
    }

    case 'PropertyAccess': {
      const propKey = expr.property;
      // Fast specialization when accessing a direct variable (`n.score`)
      if (expr.object.kind === 'Identifier') {
        const varName = expr.object.name;
        const slot = slotTable.getOrAdd(varName);
        return (row, _params, kernel) => {
          const obj = row[slot];
          if (obj === UNBOUND) {
            throw new CypherRuntimeError(
              `Variable '${varName}' is not bound in the current row`,
            );
          }
          if (obj === null || obj === undefined) return null;
          return readEntityProperty(obj, propKey, kernel);
        };
      }

      const objFn = compileExpression(expr.object, slotTable);
      return (row, params, kernel) => {
        const obj = objFn(row, params, kernel);
        if (obj === null || obj === undefined) return null;
        return readEntityProperty(obj, propKey, kernel);
      };
    }

    case 'Binary': {
      const leftFn = compileExpression(expr.left, slotTable);
      const rightFn = compileExpression(expr.right, slotTable);
      switch (expr.op) {
        case 'AND':
          return (r, p, k) => Boolean(leftFn(r, p, k)) && Boolean(rightFn(r, p, k));
        case 'OR':
          return (r, p, k) => Boolean(leftFn(r, p, k)) || Boolean(rightFn(r, p, k));
        case 'XOR':
          return (r, p, k) => Boolean(leftFn(r, p, k)) !== Boolean(rightFn(r, p, k));
        case '=':
          return (r, p, k) => cypherEq(leftFn(r, p, k), rightFn(r, p, k));
        case '<>':
          return (r, p, k) => !cypherEq(leftFn(r, p, k), rightFn(r, p, k));
        case '<':
          return (r, p, k) => compareCompiled(leftFn(r, p, k), rightFn(r, p, k), '<');
        case '<=':
          return (r, p, k) => compareCompiled(leftFn(r, p, k), rightFn(r, p, k), '<=');
        case '>':
          return (r, p, k) => compareCompiled(leftFn(r, p, k), rightFn(r, p, k), '>');
        case '>=':
          return (r, p, k) => compareCompiled(leftFn(r, p, k), rightFn(r, p, k), '>=');
        case '+':
          return (r, p, k) => addCompiled(leftFn(r, p, k), rightFn(r, p, k));
        case '-':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l === null || l === undefined || rv === null || rv === undefined) return null;
            if (typeof l !== 'number' || typeof rv !== 'number') {
              throw new TypeMismatchError(`Cannot subtract ${typeof rv} from ${typeof l}`);
            }
            return l - rv;
          };
        case '*':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l === null || l === undefined || rv === null || rv === undefined) return null;
            if (typeof l !== 'number' || typeof rv !== 'number') {
              throw new TypeMismatchError(`Cannot multiply ${typeof l} and ${typeof rv}`);
            }
            return l * rv;
          };
        case '/':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l === null || l === undefined || rv === null || rv === undefined) return null;
            if (typeof l !== 'number' || typeof rv !== 'number') {
              throw new TypeMismatchError(`Cannot divide ${typeof l} by ${typeof rv}`);
            }
            if (rv === 0) throw new CypherRuntimeError('Division by zero');
            return l / rv;
          };
        case '%':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l === null || l === undefined || rv === null || rv === undefined) return null;
            if (typeof l !== 'number' || typeof rv !== 'number') {
              throw new TypeMismatchError(`Cannot apply modulo to ${typeof l} and ${typeof rv}`);
            }
            if (rv === 0) throw new CypherRuntimeError('Modulo by zero');
            return l % rv;
          };
        case '^':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l === null || l === undefined || rv === null || rv === undefined) return null;
            if (typeof l !== 'number' || typeof rv !== 'number') {
              throw new TypeMismatchError(`Cannot exponentiate ${typeof l} by ${typeof rv}`);
            }
            return Math.pow(l, rv);
          };
        case 'STARTS WITH':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l == null || rv == null) return null;
            return typeof l === 'string' && typeof rv === 'string' && l.startsWith(rv);
          };
        case 'ENDS WITH':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l == null || rv == null) return null;
            return typeof l === 'string' && typeof rv === 'string' && l.endsWith(rv);
          };
        case 'CONTAINS':
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l == null || rv == null) return null;
            return typeof l === 'string' && typeof rv === 'string' && l.includes(rv);
          };
        case '=~': {
          if (expr.right.kind === 'Literal' && typeof expr.right.value === 'string') {
            try {
              const compiled = compileCypherRegex(expr.right.value);
              return (r, p, k) => {
                const l = leftFn(r, p, k);
                if (l == null) return null;
                return typeof l === 'string' && compiled.test(l);
              };
            } catch (compileErr) {
              return (r, p, k) => {
                const l = leftFn(r, p, k);
                if (l == null) return null;
                if (typeof l !== 'string') return false;
                throw compileErr;
              };
            }
          }
          let cachedRaw: string | undefined;
          let cachedRe: RegExp | undefined;
          return (r, p, k) => {
            const l = leftFn(r, p, k);
            const rv = rightFn(r, p, k);
            if (l == null || rv == null) return null;
            if (typeof l !== 'string' || typeof rv !== 'string') return false;
            let re = cachedRaw === rv ? cachedRe : undefined;
            if (!re) {
              re = compileCypherRegex(rv);
              cachedRaw = rv;
              cachedRe = re;
            }
            return re.test(l);
          };
        }
        default:
          throw new CypherRuntimeError(`Unknown operator: ${(expr as { op: string }).op}`);
      }
    }

    case 'Unary': {
      const opFn = compileExpression(expr.operand, slotTable);
      if (expr.op === 'NOT') return (r, p, k) => !Boolean(opFn(r, p, k));
      if (expr.op === '-') {
        return (r, p, k) => {
          const v = opFn(r, p, k);
          if (v === null || v === undefined) return null;
          if (typeof v !== 'number') {
            throw new TypeMismatchError(`Unary '-' requires a number, got ${typeof v}`);
          }
          return v === 0 ? 0 : -v;
        };
      }
      throw new CypherRuntimeError(`Unknown unary operator: ${expr.op}`);
    }

    case 'In': {
      const valFn = compileExpression(expr.expression, slotTable);
      const listFn = compileExpression(expr.list, slotTable);
      const isNot = expr.not;
      return (r, p, k) => {
        const val = valFn(r, p, k);
        const list = listFn(r, p, k);
        if (!Array.isArray(list)) {
          throw new TypeMismatchError(`Right-hand side of IN must be a list, got ${typeof list}`);
        }
        let matched = false;
        for (let i = 0; i < list.length; i++) {
          if (cypherEq(val, list[i])) {
            matched = true;
            break;
          }
        }
        return isNot ? !matched : matched;
      };
    }

    case 'IsNull': {
      const valFn = compileExpression(expr.expression, slotTable);
      const isNot = expr.not;
      return (r, p, k) => {
        const v = valFn(r, p, k);
        const isNull = v === null || v === undefined;
        return isNot ? !isNull : isNull;
      };
    }

    case 'LabelPredicate': {
      const matcher = compileLabelMatcher(expr.labels);
      if (expr.expression.kind === 'Identifier') {
        const varName = expr.expression.name;
        const slot = slotTable.getOrAdd(varName);
        return (row) => {
          const val = row[slot];
          if (val === UNBOUND) {
            throw new CypherRuntimeError(
              `Variable '${varName}' is not bound in the current row`,
            );
          }
          return matcher(val);
        };
      }
      const targetFn = compileExpression(expr.expression, slotTable);
      return (r, p, k) => matcher(targetFn(r, p, k));
    }

    case 'List': {
      const elemFns = expr.elements.map((e) => compileExpression(e, slotTable));
      return (r, p, k) => {
        const out = new Array<unknown>(elemFns.length);
        for (let i = 0; i < elemFns.length; i++) {
          out[i] = elemFns[i](r, p, k);
        }
        return out;
      };
    }

    case 'Case': {
      const baseFn = expr.expression ? compileExpression(expr.expression, slotTable) : null;
      const branches = expr.branches.map((b) => ({
        whenFn: compileExpression(b.when, slotTable),
        thenFn: compileExpression(b.then, slotTable),
      }));
      const elseFn = expr.else ? compileExpression(expr.else, slotTable) : null;
      return (r, p, k) => {
        const baseVal = baseFn ? baseFn(r, p, k) : undefined;
        for (let i = 0; i < branches.length; i++) {
          const whenVal = branches[i].whenFn(r, p, k);
          if (baseFn ? cypherEq(baseVal, whenVal) : Boolean(whenVal)) {
            return branches[i].thenFn(r, p, k);
          }
        }
        return elseFn ? elseFn(r, p, k) : null;
      };
    }

    case 'ListPredicate': {
      const listFn = compileExpression(expr.list, slotTable);
      const loopSlot = slotTable.getOrAdd(expr.variable);
      const whereFn = compileExpression(expr.where, slotTable);
      const predKind = expr.predicate;
      return (r, p, k) => {
        const listVal = listFn(r, p, k);
        if (listVal === null || listVal === undefined) return null;
        if (!Array.isArray(listVal)) {
          throw new TypeMismatchError(`List predicate requires a list, got ${typeof listVal}`);
        }
        let matchCount = 0;
        const prev = r[loopSlot];
        try {
          for (let i = 0; i < listVal.length; i++) {
            r[loopSlot] = listVal[i];
            if (whereFn(r, p, k)) matchCount++;
          }
        } finally {
          r[loopSlot] = prev;
        }
        switch (predKind) {
          case 'ALL': return matchCount === listVal.length;
          case 'ANY': return matchCount > 0;
          case 'NONE': return matchCount === 0;
          case 'SINGLE': return matchCount === 1;
        }
      };
    }

    case 'ListComprehension': {
      const listFn = compileExpression(expr.list, slotTable);
      const loopSlot = slotTable.getOrAdd(expr.variable);
      const whereFn = expr.where ? compileExpression(expr.where, slotTable) : null;
      const projFn = expr.projection ? compileExpression(expr.projection, slotTable) : null;
      return (r, p, k) => {
        const listVal = listFn(r, p, k);
        if (listVal === null || listVal === undefined) return null;
        if (!Array.isArray(listVal)) {
          throw new TypeMismatchError(`List comprehension requires a list, got ${typeof listVal}`);
        }
        const out: unknown[] = [];
        const prev = r[loopSlot];
        try {
          for (let i = 0; i < listVal.length; i++) {
            const item = listVal[i];
            r[loopSlot] = item;
            if (whereFn && !whereFn(r, p, k)) continue;
            out.push(projFn ? projFn(r, p, k) : item);
          }
        } finally {
          r[loopSlot] = prev;
        }
        return out;
      };
    }

    case 'Map': {
      const entries = Object.entries(expr.props).map(([k, v]) => [
        k,
        compileExpression(v, slotTable),
      ] as const);
      return (r, p, k) => {
        const out: Record<string, unknown> = {};
        for (let i = 0; i < entries.length; i++) {
          out[entries[i][0]] = entries[i][1](r, p, k);
        }
        return out;
      };
    }

    case 'FunctionCall': {
      const fnName = expr.name.toUpperCase();
      const argFns = expr.args.map((a) => compileExpression(a, slotTable));
      return compileScalarFunction(fnName, expr.name, argFns, expr.distinct);
    }

    case 'ExistsSubquery':
      return () => {
        throw new CypherRuntimeError(
          'ExistsSubquery must be extracted by Planner into ExistsSubqueryStep before evaluation',
        );
      };
    case 'PatternComprehension':
      return () => {
        throw new CypherRuntimeError(
          'PatternComprehension must be extracted by Planner into PatternComprehensionStep before evaluation',
        );
      };
    case 'PatternExpr':
      return () => {
        throw new CypherRuntimeError(
          'PatternExpr must be extracted by Planner into PatternExprStep before evaluation',
        );
      };
    default:
      return () => {
        throw new CypherRuntimeError(`Unsupported expression kind: '${(expr as Expression).kind}'`);
      };
  }
}

const LEADING_REGEX_FLAGS_RE = /^\(\?([ims]+)\)/;

/**
 * Compile an openCypher regex pattern string into a stateless JS {@link RegExp}.
 * Extracts leading inline flags (`(?i)`, `(?m)`, `(?s)`) and anchors the full
 * pattern as `^(?:...)$` so top-level alternations match the entire string.
 */
function compileCypherRegex(raw: string): RegExp {
  let body = raw;
  let flagSet: Set<string> | undefined;
  let match = LEADING_REGEX_FLAGS_RE.exec(body);
  while (match) {
    if (!flagSet) flagSet = new Set<string>();
    const grp = match[1];
    for (let i = 0; i < grp.length; i++) flagSet.add(grp[i]);
    body = body.slice(match[0].length);
    match = LEADING_REGEX_FLAGS_RE.exec(body);
  }
  const flags = flagSet ? Array.from(flagSet).join('') : '';
  try {
    return new RegExp(`^(?:${body})$`, flags);
  } catch {
    throw new CypherRuntimeError(`Invalid regular expression: ${raw}`);
  }
}

export function readEntityProperty(
  obj: unknown,
  propKey: string,
  kernel?: ISyncGraphKernel,
): unknown {
  if (kernel && !kernel.hasActiveTransactions) {
    if (
      obj instanceof Node &&
      obj._slot !== undefined &&
      kernel.arena.nodeAlive[obj._slot] === 1 &&
      kernel.arena.nodeIds[obj._slot] === obj.id
    ) {
      const keyId = kernel.arena.nodePropDict.lookup(propKey);
      if (keyId >= 0) {
        const col = kernel.arena.nodeColumns.getColumnByKeyId(keyId);
        if (col && col.tags[obj._slot] !== TAG_ABSENT) {
          return col.get(obj._slot);
        }
      }
      if (
        propKey === 'id' ||
        propKey === 'labels' ||
        propKey === 'createdOn' ||
        propKey === 'updatedOn'
      ) {
        return (obj as unknown as Record<string, unknown>)[propKey];
      }
      return undefined;
    }
    if (
      obj instanceof Edge &&
      obj._slot !== undefined &&
      kernel.arena.edgeAlive[obj._slot] === 1 &&
      kernel.arena.edgeIds[obj._slot] === obj.id
    ) {
      const keyId = kernel.arena.edgePropDict.lookup(propKey);
      if (keyId >= 0) {
        const col = kernel.arena.edgeColumns.getColumnByKeyId(keyId);
        if (col && col.tags[obj._slot] !== TAG_ABSENT) {
          return col.get(obj._slot);
        }
      }
      if (
        propKey === 'id' ||
        propKey === 'sourceId' ||
        propKey === 'targetId' ||
        propKey === 'type' ||
        propKey === 'createdOn' ||
        propKey === 'updatedOn'
      ) {
        return (obj as unknown as Record<string, unknown>)[propKey];
      }
      return undefined;
    }
  }
  return readObjectProperty(obj, propKey);
}

export function readObjectProperty(obj: unknown, propKey: string): unknown {
  if (typeof obj === 'object' && obj !== null) {
    if ('properties' in (obj as Record<string, unknown>)) {
      const props = (obj as { properties: Record<string, unknown> }).properties;
      if (propKey in props) return props[propKey];
    }
    return (obj as Record<string, unknown>)[propKey];
  }
  throw new TypeMismatchError(`Cannot access property '${propKey}' on ${typeof obj}`);
}

function compareCompiled(
  l: unknown,
  rv: unknown,
  op: '<' | '<=' | '>' | '>=',
): boolean | null {
  if (l === null || l === undefined || rv === null || rv === undefined) return null;
  if (typeof l === 'number' && typeof rv === 'number') {
    if (Number.isNaN(l) || Number.isNaN(rv)) return null;
    switch (op) {
      case '<': return l < rv;
      case '<=': return l <= rv;
      case '>': return l > rv;
      case '>=': return l >= rv;
    }
  }
  if (typeof l === 'string' && typeof rv === 'string') {
    switch (op) {
      case '<': return l < rv;
      case '<=': return l <= rv;
      case '>': return l > rv;
      case '>=': return l >= rv;
    }
  }
  return null;
}

function addCompiled(l: unknown, rv: unknown): unknown {
  if (l === null || l === undefined || rv === null || rv === undefined) return null;
  if (typeof l === 'number' && typeof rv === 'number') return l + rv;
  if (typeof l === 'string' && (typeof rv === 'string' || typeof rv === 'number' || typeof rv === 'boolean')) {
    return l + String(rv);
  }
  if (typeof rv === 'string' && (typeof l === 'number' || typeof l === 'boolean')) {
    return String(l) + rv;
  }
  if (Array.isArray(l) && Array.isArray(rv)) return [...l, ...rv];
  if (Array.isArray(l)) return [...l, rv];
  if (Array.isArray(rv)) return [l, ...rv];
  throw new TypeMismatchError(`Cannot apply '+' to ${typeof l} and ${typeof rv}`);
}

export function cypherEq(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    'id' in (a as object) &&
    'id' in (b as object)
  ) {
    return (a as { id: string }).id === (b as { id: string }).id;
  }
  return a === b;
}

/**
 * Compile a CNF label/type predicate (`string[][]`) into a zero-allocation
 * matcher supporting both {@link Node} (`labels`) and {@link Edge} (`type`).
 */
function compileLabelMatcher(groups: string[][]): (val: unknown) => boolean {
  if (groups.length === 1 && groups[0].length === 1) {
    const req = groups[0][0];
    return (val) => {
      if (val instanceof Node) return val.labels.includes(req);
      if (val instanceof Edge) return val.type === req;
      return false;
    };
  }

  if (groups.length === 1) {
    const orGroup = groups[0];
    const len = orGroup.length;
    return (val) => {
      if (val instanceof Node) {
        const labels = val.labels;
        for (let i = 0; i < len; i++) {
          if (labels.includes(orGroup[i])) return true;
        }
        return false;
      }
      if (val instanceof Edge) {
        const t = val.type;
        for (let i = 0; i < len; i++) {
          if (t === orGroup[i]) return true;
        }
        return false;
      }
      return false;
    };
  }

  if (groups.every((g) => g.length === 1)) {
    const andLabels = groups.map((g) => g[0]);
    const len = andLabels.length;
    return (val) => {
      if (val instanceof Node) {
        const labels = val.labels;
        for (let i = 0; i < len; i++) {
          if (!labels.includes(andLabels[i])) return false;
        }
        return true;
      }
      if (val instanceof Edge) {
        const t = val.type;
        for (let i = 0; i < len; i++) {
          if (t !== andLabels[i]) return false;
        }
        return true;
      }
      return false;
    };
  }

  const groupCount = groups.length;
  return (val) => {
    if (val instanceof Node) {
      const labels = val.labels;
      for (let g = 0; g < groupCount; g++) {
        const orGroup = groups[g];
        let matched = false;
        for (let i = 0; i < orGroup.length; i++) {
          if (labels.includes(orGroup[i])) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    }
    if (val instanceof Edge) {
      const t = val.type;
      for (let g = 0; g < groupCount; g++) {
        if (!groups[g].includes(t)) return false;
      }
      return true;
    }
    return false;
  };
}
