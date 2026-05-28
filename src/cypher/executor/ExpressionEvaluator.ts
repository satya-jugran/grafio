/**
 * Expression evaluator for the Cypher execution layer.
 *
 * Evaluates AST {@link Expression} nodes against a row (variable bindings)
 * and a parameter map.  Also provides shared parameter-resolution helpers
 * used by step executors before calling the storage layer.
 *
 * This class is stateless — it only holds evaluation logic and can be
 * shared freely across sub-executor instances.
 *
 * @module cypher/executor/ExpressionEvaluator
 */

import { Expression } from '../ast/AstNode';
import { Node } from '../../Node';
import { Edge } from '../../Edge';
import { CypherRuntimeError, UnboundParameterError, TypeMismatchError } from '../errors';

/**
 * Internal row representation: variable name → bound value.
 * Shared across all executor modules.
 */
export type Row = Map<string, unknown>;

/** Result returned by write step executors including mutation counts. */
export interface StepResult {
  rows: Row[];
  nodesCreated?: number;
  nodesDeleted?: number;
  edgesCreated?: number;
  edgesDeleted?: number;
  propertiesSet?: number;
  indexesCreated?: number;
  indexesDeleted?: number;
}

/**
 * Stateless expression evaluator and parameter resolver.
 */
export class ExpressionEvaluator {
  // ── Parameter resolution ────────────────────────────────────────

  /**
   * Resolve a value that may be a `{ kind: 'Parameter', name: 'x' }`
   * AST node stored by the Planner.  If the value is a Parameter object,
   * look it up in `params` (throwing {@link UnboundParameterError}
   * if missing).  Otherwise return the value as-is.
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
   * runtime parameter map, returning a plain record of primitive values
   * suitable for the storage layer.
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

  // ── Expression evaluator ─────────────────────────────────────────

  /**
   * Evaluate an AST {@link Expression} against a row and parameter map.
   */
  evaluate(
    expr: Expression,
    row: Row,
    params: Record<string, unknown>,
  ): unknown {
    switch (expr.kind) {
      case 'Literal':
        return expr.value;

      case 'Parameter': {
        if (!(expr.name in params)) {
          throw new UnboundParameterError(expr.name);
        }
        return params[expr.name];
      }

      case 'Identifier': {
        if (!row.has(expr.name)) {
          throw new CypherRuntimeError(
            `Variable '${expr.name}' is not bound in the current row`,
          );
        }
        return row.get(expr.name);
      }

      case 'PropertyAccess': {
        const obj = this.evaluate(expr.object, row, params);
        if (obj === null || obj === undefined) return null;
        if (
          typeof obj === 'object' &&
          'properties' in (obj as Record<string, unknown>)
        ) {
          const props = (obj as { properties: Record<string, unknown> })
            .properties;
          if (expr.property in props) {
            return props[expr.property];
          }
          // Property not in user-defined properties — fall through to
          // top-level access for built-in fields like `labels` and `id`.
        }
        if (typeof obj === 'object' && obj !== null) {
          return (obj as Record<string, unknown>)[expr.property];
        }
        throw new TypeMismatchError(
          `Cannot access property '${expr.property}' on ${typeof obj}`,
        );
      }

      case 'Binary': {
        const left = this.evaluate(expr.left, row, params);
        const right = this.evaluate(expr.right, row, params);
        return this.applyBinaryOp(expr.op, left, right);
      }

      case 'Unary': {
        const operand = this.evaluate(expr.operand, row, params);
        return this.applyUnaryOp(expr.op, operand);
      }

      case 'In': {
        const value = this.evaluate(expr.expression, row, params);
        const list = this.evaluate(expr.list, row, params);
        const inResult = this.checkIn(value, list);
        return expr.not ? !inResult : inResult;
      }

      case 'IsNull': {
        const value = this.evaluate(expr.expression, row, params);
        const isNull = value === null || value === undefined;
        return expr.not ? !isNull : isNull;
      }

      case 'List': {
        return expr.elements.map((e) => this.evaluate(e, row, params));
      }

      case 'Map': {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(expr.props)) {
          result[k] = this.evaluate(v, row, params);
        }
        return result;
      }

      case 'FunctionCall': {
        switch (expr.name.toUpperCase()) {
          // ── id(node|relationship) → internal UUID ─────────────
          case 'ID': {
            if (expr.args.length !== 1) {
              throw new CypherRuntimeError(
                `id() expects exactly 1 argument, got ${expr.args.length}`,
              );
            }
            const arg = this.evaluate(expr.args[0], row, params);
            if (arg && typeof arg === 'object' && 'id' in (arg as object)) {
              return (arg as { id: string }).id;
            }
            // null argument → null per openCypher semantics
            if (arg === null || arg === undefined) return null;
            throw new CypherRuntimeError(
              `id() requires a node or relationship argument, got ${typeof arg}`,
            );
          }

          // ── nodes(path) → list of nodes ──────────────────────
          case 'NODES': {
            if (expr.args.length !== 1) {
              throw new CypherRuntimeError(
                `nodes() expects exactly 1 argument, got ${expr.args.length}`,
              );
            }
            const arg = this.evaluate(expr.args[0], row, params);
            if (arg === null || arg === undefined) return null;
            if (!Array.isArray(arg)) {
              throw new CypherRuntimeError(
                `nodes() requires a path argument, got ${typeof arg}`,
              );
            }
            // Path is [node₀, edge₀, node₁, edge₁, ..., nodeₙ].
            // Return elements at even indices (the nodes).
            return (arg as unknown[]).filter((_, i) => i % 2 === 0);
          }

          // ── relationships(path) → list of edges ──────────────
          case 'RELATIONSHIPS': {
            if (expr.args.length !== 1) {
              throw new CypherRuntimeError(
                `relationships() expects exactly 1 argument, got ${expr.args.length}`,
              );
            }
            const arg = this.evaluate(expr.args[0], row, params);
            if (arg === null || arg === undefined) return null;
            if (!Array.isArray(arg)) {
              throw new CypherRuntimeError(
                `relationships() requires a path argument, got ${typeof arg}`,
              );
            }
            // Path is [node₀, edge₀, node₁, edge₁, ..., nodeₙ].
            // Return elements at odd indices (the edges).
            return (arg as unknown[]).filter((_, i) => i % 2 === 1);
          }

          // ── labels(node) → list of node labels ─────────────
          case 'LABELS': {
            if (expr.args.length !== 1) {
              throw new CypherRuntimeError(
                `labels() expects exactly 1 argument, got ${expr.args.length}`,
              );
            }
            const arg = this.evaluate(expr.args[0], row, params);
            if (arg === null || arg === undefined) return null;
            if (arg instanceof Node) {
              return arg.labels;
            }
            throw new CypherRuntimeError(
              `labels() requires a node argument, got ${typeof arg}`,
            );
          }

          // ── type(relationship) → relationship type string ──
          case 'TYPE': {
            if (expr.args.length !== 1) {
              throw new CypherRuntimeError(
                `type() expects exactly 1 argument, got ${expr.args.length}`,
              );
            }
            const arg = this.evaluate(expr.args[0], row, params);
            if (arg === null || arg === undefined) return null;
            if (arg instanceof Edge) {
              return arg.type;
            }
            throw new CypherRuntimeError(
              `type() requires a relationship argument, got ${typeof arg}`,
            );
          }

          default:
            throw new CypherRuntimeError(
              `Function '${expr.name}' is not yet supported`,
            );
        }
      }

      case 'ExistsSubquery': {
        throw new CypherRuntimeError(
          `ExistsSubquery must be extracted by Planner into ExistsSubqueryStep before evaluation`,
        );
      }

      default:
        throw new CypherRuntimeError(
          `Unsupported expression kind: '${(expr as Expression).kind}'`,
        );
    }
  }

  // ── Operator helpers ─────────────────────────────────────────────

  applyBinaryOp(op: string, left: unknown, right: unknown): unknown {
    switch (op) {
      case 'AND':
        return Boolean(left) && Boolean(right);
      case 'OR':
        return Boolean(left) || Boolean(right);
      case '=':
        return this.eq(left, right);
      case '<>':
        return !this.eq(left, right);
      case '<':
        return (left as number) < (right as number);
      case '<=':
        return (left as number) <= (right as number);
      case '>':
        return (left as number) > (right as number);
      case '>=':
        return (left as number) >= (right as number);
      case '+':
        return (left as number) + (right as number);
      case '-':
        return (left as number) - (right as number);
      case '*':
        return (left as number) * (right as number);
      case '/':
        if ((right as number) === 0)
          throw new CypherRuntimeError('Division by zero');
        return (left as number) / (right as number);
      default:
        throw new CypherRuntimeError(`Unknown operator: ${op}`);
    }
  }

  applyUnaryOp(op: string, operand: unknown): unknown {
    switch (op) {
      case 'NOT':
        return !Boolean(operand);
      case '-':
        return -(operand as number);
      default:
        throw new CypherRuntimeError(`Unknown unary operator: ${op}`);
    }
  }

  eq(a: unknown, b: unknown): boolean {
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

  checkIn(value: unknown, list: unknown): boolean {
    if (!Array.isArray(list)) {
      throw new TypeMismatchError(
        `Right-hand side of IN must be a list, got ${typeof list}`,
      );
    }
    return list.some((item) => this.eq(value, item));
  }

  compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean')
      return a === b ? 0 : a ? 1 : -1;
    return String(a).localeCompare(String(b));
  }
}