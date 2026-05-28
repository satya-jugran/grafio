/**
 * WHERE clause decomposition for the Cypher query planner.
 *
 * Splits a WHERE expression into per-variable {@link PropertyFilter}s
 * (pushable into {@link NodeScanStep}s) and cross-variable expressions
 * (retained as {@link FilterStep}s).
 *
 * @module cypher/plan/WhereDecomposer
 */

import {
  Expression,
  PatternPath,
  NamedPath,
  getPatternSegments,
  NodePattern,
} from '../ast/AstNode';
import { PropertyFilter } from './QueryPlan';

// ── Types ──────────────────────────────────────────────────────────

/** Information about a variable collected from MATCH patterns. */
export interface VarInfo {
  name: string;
  labels: string[];
  /** True if this variable is the first node in a pattern path (gets
   *  its own NodeScanStep and can have predicates pushed in). */
  isRoot: boolean;
}

/** Result of decomposing a WHERE expression. */
export interface DecomposedWhere {
  /** Per-variable predicates pushable into NodeScanStep. */
  perVar: Map<string, PropertyFilter[]>;
  /** Cross-variable expressions retained as FilterStep. */
  crossVar: Expression[];
}

// ── WhereDecomposer ────────────────────────────────────────────────

export class WhereDecomposer {
  // ── Variable collection ──────────────────────────────────────────

  /**
   * Collect all named variables from MATCH patterns and record their
   * labels and whether they are root nodes (first in a pattern path).
   */
  collectVariables(patterns: (PatternPath | NamedPath)[]): Map<string, VarInfo> {
    const vars = new Map<string, VarInfo>();

    for (const pattern of patterns) {
      if (pattern.kind === 'NamedPath' && pattern.name && !vars.has(pattern.name)) {
        vars.set(pattern.name, {
          name: pattern.name,
          labels: [],
          isRoot: false,
        });
      }

      const segments = getPatternSegments(pattern);
      if (segments.length === 0) continue;

      // First segment is always a NodePattern — this is a root variable.
      const firstNode = segments[0] as NodePattern;
      const firstVar = firstNode.variable;
      if (firstVar) {
        vars.set(firstVar, {
          name: firstVar,
          labels: firstNode.labels,
          isRoot: true,
        });
      }

      // Walk alternating edge → node pairs for dependent variables.
      for (let i = 1; i < segments.length; i += 2) {
        // Collect edge variable (if named).
        const edge = segments[i] as { variable?: string };
        if (edge.variable && !vars.has(edge.variable)) {
          vars.set(edge.variable, {
            name: edge.variable,
            labels: [],
            isRoot: false,
          });
        }

        const targetNode = segments[i + 1] as NodePattern;
        if (targetNode.variable && !vars.has(targetNode.variable)) {
          vars.set(targetNode.variable, {
            name: targetNode.variable,
            labels: targetNode.labels,
            isRoot: false,
          });
        }
      }
    }

    return vars;
  }

  // ── WHERE decomposition ──────────────────────────────────────────

  /**
   * Decompose a WHERE expression into per-variable ({@link PropertyFilter}s
   * that can be pushed into {@link NodeScanStep}s) and cross-variable
   * expressions (that remain as {@link FilterStep}s).
   */
  decompose(
    expr: Expression,
    vars: Map<string, VarInfo>,
  ): DecomposedWhere {
    const perVar = new Map<string, PropertyFilter[]>();
    const crossVar: Expression[] = [];

    this._classify(expr, vars, perVar, crossVar);

    return { perVar, crossVar };
  }

  /**
   * Recursively classify a WHERE sub-expression into per-variable or
   * cross-variable groups.
   */
  private _classify(
    expr: Expression,
    vars: Map<string, VarInfo>,
    perVar: Map<string, PropertyFilter[]>,
    crossVar: Expression[],
  ): void {
    // ── AND: always split — each operand is classified independently.
    //     This must come first so that id(a)=42 AND a.name='Alice'
    //     (single variable, but mixed translatable/non-translatable
    //     operands) is decomposed correctly.
    if (expr.kind === 'Binary' && expr.op === 'AND') {
      this._classify(expr.left, vars, perVar, crossVar);
      this._classify(expr.right, vars, perVar, crossVar);
      return;
    }

    const refs = this._collectVars(expr);

    // ── No variable reference → keep as crossVar filter ───────────
    if (refs.size === 0) {
      crossVar.push(expr);
      return;
    }

    // ── Single variable → try to translate to PropertyFilter ──────
    if (refs.size === 1) {
      const varName = [...refs][0];
      const varInfo = vars.get(varName);
      const filter = this._toPropertyFilter(expr);

      // Only push predicates for root variables that have their own
      // NodeScanStep.  Dependent variables (edge expansion targets)
      // have no scan to push into, so their predicates stay as
      // crossVar / FilterStep.
      if (filter && varInfo?.isRoot) {
        this._add(perVar, varName, filter);
      } else {
        crossVar.push(expr);
      }
      return;
    }

    // ── Multiple variables, OR, cross-variable comparisons ────────
    crossVar.push(expr);
  }

  /**
   * Collect all variable names referenced in an expression tree.
   */
  private _collectVars(expr: Expression): Set<string> {
    const vars = new Set<string>();

    const walk = (e: Expression): void => {
      switch (e.kind) {
        case 'Identifier':
          vars.add(e.name);
          return;
        case 'PropertyAccess':
          walk(e.object);
          return;
        case 'Binary':
          walk(e.left);
          walk(e.right);
          return;
        case 'Unary':
          walk(e.operand);
          return;
        case 'In':
          walk(e.expression);
          walk(e.list);
          return;
        case 'IsNull':
          walk(e.expression);
          return;
        case 'List':
          for (const el of e.elements) walk(el);
          return;
        case 'FunctionCall':
          for (const arg of e.args) walk(arg);
          return;
        case 'ExistsSubquery':
          if (e.match.where) walk(e.match.where.expression);
          // Variables used in subquery patterns are usually new bindings or outer bindings.
          // To be safe and ensure the EXISTS goes to crossVar, we can just let it have no explicit variables 
          // or all variables in the expression. Since it never becomes a PropertyFilter, it will go to crossVar
          // as long as it has multiple vars or 0 vars.
          return;
        default:
          // Literal, Parameter — no variables.
          return;
      }
    };

    walk(expr);
    return vars;
  }

  /**
   * Translate a single-variable expression into a {@link PropertyFilter}.
   * Returns `null` if the expression cannot be pushed into the storage
   * layer (e.g. complex arithmetic, function calls).
   */
  private _toPropertyFilter(expr: Expression): PropertyFilter | null {
    // ── Binary comparison: n.key OP literal/param ─────────────────
    if (expr.kind === 'Binary') {
      if (
        ['=', '<>', '>', '<', '>=', '<='].includes(expr.op) &&
        expr.left.kind === 'PropertyAccess' &&
        expr.left.object.kind === 'Identifier'
      ) {
        const key = expr.left.property;
        const rhs = expr.right;
        if (rhs.kind === 'Literal' || rhs.kind === 'Parameter') {
          return {
            key,
            value: rhs.kind === 'Literal' ? rhs.value : rhs,
            op: expr.op as PropertyFilter['op'],
          };
        }
        return null;
      }

      // ── AND: both sides are translatable → nested AND ───────────
      if (expr.op === 'AND') {
        const left = this._toPropertyFilter(expr.left);
        const right = this._toPropertyFilter(expr.right);
        if (left && right) {
          return { AND: [left, right] };
        }
        if (left) return left;
        if (right) return right;
        return null;
      }

      // ── OR: both sides are translatable → nested OR ─────────────
      if (expr.op === 'OR') {
        const left = this._toPropertyFilter(expr.left);
        const right = this._toPropertyFilter(expr.right);
        if (left && right) {
          return { OR: [left, right] };
        }
        return null;
      }

      return null;
    }

    // ── IS NULL / IS NOT NULL ─────────────────────────────────────
    if (expr.kind === 'IsNull') {
      if (
        expr.expression.kind === 'PropertyAccess' &&
        expr.expression.object.kind === 'Identifier'
      ) {
        return {
          key: expr.expression.property,
          op: expr.not ? 'IS_NOT_NULL' : 'IS_NULL',
        };
      }
      return null;
    }

    // ── IN / NOT IN ───────────────────────────────────────────────
    if (expr.kind === 'In') {
      if (
        expr.expression.kind === 'PropertyAccess' &&
        expr.expression.object.kind === 'Identifier'
      ) {
        const key = expr.expression.property;
        if (expr.list.kind === 'List') {
          const value = expr.list.elements
            .filter((e) => e.kind === 'Literal')
            .map((e) => (e as { kind: 'Literal'; value: unknown }).value);
          return { key, value, op: expr.not ? 'NOT_IN' : 'IN' };
        }
        if (expr.list.kind === 'Parameter') {
          return {
            key,
            value: expr.list,
            op: expr.not ? 'NOT_IN' : 'IN',
          };
        }
        return null;
      }
      return null;
    }

    // ── NOT (simple comparison) → rewrite operator ────────────────
    if (expr.kind === 'Unary' && expr.op === 'NOT') {
      const inner = this._toPropertyFilter(expr.operand);
      if (inner) {
        if (inner.op === '=') return { ...inner, op: '<>' };
        if (inner.op === '<>') return { ...inner, op: '=' };
        if (inner.op === 'IS_NULL') return { ...inner, op: 'IS_NOT_NULL' };
        if (inner.op === 'IS_NOT_NULL') return { ...inner, op: 'IS_NULL' };
        if (inner.op === 'IN') return { ...inner, op: 'NOT_IN' };
        if (inner.op === 'NOT_IN') return { ...inner, op: 'IN' };
      }
      return null;
    }

    return null;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private _add(
    perVar: Map<string, PropertyFilter[]>,
    varName: string,
    filter: PropertyFilter,
  ): void {
    if (!perVar.has(varName)) {
      perVar.set(varName, []);
    }
    perVar.get(varName)!.push(filter);
  }

  /**
   * Combine an array of expressions with AND, returning the single
   * combined expression (or the sole element if only one).
   */
  andAll(exprs: Expression[]): Expression {
    if (exprs.length === 0) {
      return { kind: 'Literal', value: true };
    }
    if (exprs.length === 1) {
      return exprs[0];
    }
    return exprs.reduce((left, right) => ({
      kind: 'Binary' as const,
      op: 'AND' as const,
      left,
      right,
    }));
  }
}
