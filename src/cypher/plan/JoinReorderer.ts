/**
 * Join reordering and seek detection for the Cypher query planner.
 *
 * Requires a {@link Graph} instance for index-aware selectivity;
 * falls back to non-indexed estimates when no Graph is provided.
 *
 * Orders root patterns by estimated selectivity and detects id-lookup
 * predicates that qualify for {@link NodeSeekStep} emission.
 *
 * @module cypher/plan/JoinReorderer
 */

import {
  Expression,
  MatchPattern,
  PatternPath,
  NamedPath,
  getPatternSegments,
  NodePattern,
} from '../ast/AstNode';
import { PropertyFilter, NodeSeekStep, PlanStep } from './QueryPlan';
import { VarInfo } from './WhereDecomposer';
import type { Graph } from '../../Graph';

// ── JoinReorderer ──────────────────────────────────────────────────

export class JoinReorderer {
  private readonly _graph?: Graph;

  constructor(graph?: Graph) {
    this._graph = graph;
  }

  /**
   * Order root patterns by estimated selectivity.
   * When a {@link Graph} is available, uses {@code graph.hasIndex} to
   * score indexed property equalities as 5 instead of 10.
   */
  async reorder(
    patterns: MatchPattern[],
    varRegistry: Map<string, VarInfo>,
    perVar: Map<string, PropertyFilter[]>,
    idLookups: Map<string, unknown>,
  ): Promise<MatchPattern[]> {
    const ordered = [...patterns];

    // Compute selectivities in parallel for all root variables
    const selectivity = new Map<string, number>();
    for (const [name, info] of varRegistry) {
      if (info.isRoot) {
        selectivity.set(
          name,
          await this._estimateSelectivity(info, perVar.get(name) ?? [], idLookups),
        );
      }
    }

    ordered.sort((a, b) => {
      const rootA = this._getRootVar(a, varRegistry);
      const rootB = this._getRootVar(b, varRegistry);
      const selA = rootA ? (selectivity.get(rootA.name) ?? 10000) : 10000;
      const selB = rootB ? (selectivity.get(rootB.name) ?? 10000) : 10000;
      return selA - selB;
    });

    return ordered;
  }

  /**
   * Detect {@code id(n) = value} predicates in the cross-variable
   * expression list and return a map of variable → id value.
   */
  detectIdLookups(
    crossVar: Expression[],
    varRegistry: Map<string, VarInfo>,
  ): Map<string, unknown> {
    const idLookups = new Map<string, unknown>();

    for (const expr of crossVar) {
      if (
        expr.kind === 'Binary' &&
        expr.op === '=' &&
        expr.left.kind === 'FunctionCall' &&
        expr.left.name.toUpperCase() === 'ID' &&
        expr.left.args.length === 1 &&
        expr.left.args[0].kind === 'Identifier'
      ) {
        const varName = expr.left.args[0].name;
        // Record ALL id-lookups — root variables get NodeSeekStep
        // replacing NodeScanStep; dependent variables trigger pattern
        // reversal (seek target → expand in reverse).
        const varInfo = varRegistry.get(varName);
        if (varInfo) {
          const rhs = expr.right;
          if (rhs.kind === 'Literal') {
            idLookups.set(varName, rhs.value);
          } else if (rhs.kind === 'Parameter') {
            idLookups.set(varName, rhs);
          }
        }
      }
    }

    return idLookups;
  }

  /**
   * Collect id-lookup expressions from crossVar for removal.
   *
   * When {@code onlyVars} is provided, only expressions whose variable
   * name is in the set are collected.  This prevents silently dropping
   * id-lookups for variables that the pattern planner cannot consume
   * (e.g. deeper nodes in a multi-hop path).
   */
  collectIdLookupExprs(
    crossVar: Expression[],
    out: Set<Expression>,
    onlyVars?: Set<string>,
  ): void {
    for (const expr of crossVar) {
      if (
        expr.kind === 'Binary' &&
        expr.op === '=' &&
        expr.left.kind === 'FunctionCall' &&
        expr.left.name.toUpperCase() === 'ID' &&
        expr.left.args.length >= 1 &&
        expr.left.args[0].kind === 'Identifier'
      ) {
        if (onlyVars && !onlyVars.has(expr.left.args[0].name)) continue;
        out.add(expr);
      }
    }
  }

  /**
   * Remove id-lookup expressions from the crossVar list.
   */
  removeIdLookups(crossVar: Expression[], lookupExprs: Set<Expression>): void {
    for (let i = crossVar.length - 1; i >= 0; i--) {
      if (lookupExprs.has(crossVar[i])) {
        crossVar.splice(i, 1);
      }
    }
  }

  // ── Selectivity estimation ──────────────────────────────────────

  /**
   * Estimate the selectivity (row count) for a root variable.
   *
   * Lower = more selective = fewer result rows = preferred first.
   *
   * | Predicate type        | Score |
   * |-----------------------|-------|
   * | id(n) = val           |     1 |
   * | indexed property =    |     5 |
   * | non-indexed property =|    10 |
   * | type scan only        |   100 |
   * | full scan             | 10000 |
   */
  private async _estimateSelectivity(
    v: VarInfo,
    predicates: PropertyFilter[],
    idLookups: Map<string, unknown>,
  ): Promise<number> {
    if (idLookups.has(v.name)) return 1;

    // Collect all equality predicate property keys
    const predicateKeys = predicates
      .filter(p => this._isEquality(p) && p.key)
      .map(p => p.key!);

    // Check if ALL predicate properties are covered by the same index (compound index)
    // This handles both single-property and multi-property predicates using compound indexes
    if (predicateKeys.length > 0 && this._graph) {
      const indexed = await this._graph.hasIndex('node', predicateKeys);
      if (indexed) return 5;
    }

    // Non-indexed equality — score 10
    if (predicateKeys.length > 0) return 10;

    if (v.labels.length > 0) return 100;
    return 10000;
  }

  private _isEquality(f: PropertyFilter): boolean {
    return f.op === '=' && f.value !== undefined && f.value !== null;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private _getRootVar(
    pattern: MatchPattern,
    varRegistry: Map<string, VarInfo>,
  ): VarInfo | undefined {
    const segments = getPatternSegments(pattern);
    if (segments.length === 0) return undefined;
    const firstNode = segments[0] as NodePattern;
    if (!firstNode.variable) return undefined;
    return varRegistry.get(firstNode.variable);
  }
}
