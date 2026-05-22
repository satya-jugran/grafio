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
  EdgePattern,
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
  /** Whether this variable refers to a node or an edge. */
  entityKind: 'node' | 'edge';
}

/** Result of decomposing a WHERE expression. */
export interface DecomposedWhere {
  /** Per-variable predicates pushable into NodeScanStep. */
  perVar: Map<string, PropertyFilter[]>;
  /** Per-edge-variable predicates pushable into EdgeExpandStep. */
  perEdgeVar: Map<string, PropertyFilter[]>;
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
          entityKind: 'node',
        });
      }

      // Walk alternating edge → node pairs for dependent variables.
      for (let i = 1; i < segments.length; i += 2) {
        const edge = segments[i] as EdgePattern;
        const targetNode = segments[i + 1] as NodePattern;

        // Register edge variables so that single-variable WHERE
        // predicates on edges (e.g. WHERE r1.weight > 5) can be
        // pushed down into EdgeExpandStep.edgePropertyFilters.
        if (edge.variable && !vars.has(edge.variable)) {
          vars.set(edge.variable, {
            name: edge.variable,
            labels: edge.types,
            isRoot: false,
            entityKind: 'edge',
          });
        }

        if (targetNode.variable && !vars.has(targetNode.variable)) {
          vars.set(targetNode.variable, {
            name: targetNode.variable,
            labels: targetNode.labels,
            isRoot: false,
            entityKind: 'node',
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
    const perEdgeVar = new Map<string, PropertyFilter[]>();
    const crossVar: Expression[] = [];

    this._classify(expr, vars, perVar, perEdgeVar, crossVar);

    return { perVar, perEdgeVar, crossVar };
  }

  /**
   * Recursively classify a WHERE sub-expression into per-variable or
   * cross-variable groups.
   */
  private _classify(
    expr: Expression,
    vars: Map<string, VarInfo>,
    perVar: Map<string, PropertyFilter[]>,
    perEdgeVar: Map<string, PropertyFilter[]>,
    crossVar: Expression[],
  ): void {
    // ── AND: always split — each operand is classified independently.
    //     This must come first so that id(a)=42 AND a.name='Alice'
    //     (single variable, but mixed translatable/non-translatable
    //     operands) is decomposed correctly.
    if (expr.kind === 'Binary' && expr.op === 'AND') {
      this._classify(expr.left, vars, perVar, perEdgeVar, crossVar);
      this._classify(expr.right, vars, perVar, perEdgeVar, crossVar);
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

      // Push predicates for root node variables into NodeScanStep.
      if (filter && varInfo?.isRoot && varInfo?.entityKind === 'node') {
        this._add(perVar, varName, filter);
      } else if (filter && varInfo?.entityKind === 'edge') {
        // Push edge-variable predicates (e.g. r1.weight > 5) into
        // EdgeExpandStep.edgePropertyFilters so they can be applied
        // at the storage layer during _expandSingleHop / _expandMultiHop.
        this._add(perEdgeVar, varName, filter);
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
