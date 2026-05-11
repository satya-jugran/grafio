/**
 * Semantic analyser for the Cypher AST.
 *
 * Validates the raw AST produced by the {@link Parser} against semantic rules
 * and annotates variable scopes. Uses a **chain of pass functions** design:
 * each pass is a standalone function that receives the AST and either returns
 * it (possibly annotated) or throws {@link CypherSemanticError}.
 *
 * ### Current passes (in order)
 * | # | Pass                     | Responsibility                           |
 * |---|--------------------------|------------------------------------------|
 * | 1 | `resolveScopes`          | Collect variable bindings from MATCH     |
 * | 2 | `checkUnresolvedVars`    | Detect references to undefined variables |
 * | 3 | `checkDuplicateBindings` | Detect variables bound more than once    |
 *
 * ### Extensibility
 * New semantic rules are added by appending a pass function to the `_passes`
 * array — no existing pass code needs to change.
 *
 * @module cypher/Semantic
 */

import { CypherSemanticError } from './errors';
import {
  QueryAst,
  MatchClause,
  WhereClause,
  ReturnClause,
  ReturnItem,
  OrderByClause,
  OrderByItem,
  SkipClause,
  LimitClause,
  PatternPath,
  PatternSegment,
  NodePattern,
  EdgePattern,
  Expression,
  IdentifierExpr,
  PropertyAccessExpr,
  BinaryExpr,
  UnaryExpr,
  InExpr,
  IsNullExpr,
  ListExpr,
  FunctionCallExpr,
} from './ast/AstNode';

// ── Scope types ───────────────────────────────────────────────────

/**
 * Describes where a variable was bound.
 */
export interface ScopeEntry {
  /** The variable name. */
  name: string;
  /** Which pattern path (0-based index in the MATCH clause). */
  patternIndex: number;
  /** The kind of pattern element that introduced this binding. */
  bindingKind: 'node' | 'edge';
}

/**
 * Map of variable name → {@link ScopeEntry}.
 */
export type VariableScope = Map<string, ScopeEntry>;

// ── Pass function signature ───────────────────────────────────────

/**
 * A single semantic check or transformation pass.
 *
 * Receives the (possibly annotated) AST and either returns it or throws
 * {@link CypherSemanticError}.
 */
type SemanticPass = (ast: QueryAst) => QueryAst | never;

// ── Semantic analyser ─────────────────────────────────────────────

/**
 * Validates and annotates a raw Cypher AST.
 *
 * Usage:
 * ```typescript
 * const typedAst = new Semantic().analyse(rawAst);
 * ```
 */
export class Semantic {
  /**
   * Ordered list of pass functions.
   *
   * `resolveScopes` always runs first because all downstream passes depend
   * on a populated scope table.
   */
  private readonly _passes: SemanticPass[] = [
    this._resolveScopes.bind(this),
    this._checkUnresolvedVars.bind(this),
    this._checkDuplicateBindings.bind(this),
  ];

  /** Cached scope table populated by `_resolveScopes` and consumed by later passes. */
  private _scope: VariableScope = new Map();

  /**
   * Run all semantic passes over the AST.
   *
   * @param ast - The raw AST from the parser.
   * @returns The validated AST (currently identical in shape; annotations
   *          are stored internally on the analyser instance).
   * @throws {CypherSemanticError} if any pass detects a violation.
   */
  public analyse(ast: QueryAst): QueryAst {
    // Scope resolution always runs first — it populates the scope table.
    let result = this._resolveScopes(ast);

    // Run remaining passes in order.
    for (const pass of this._passes.slice(1)) {
      result = pass(result);
    }

    return result;
  }

  /**
   * Return the scope table populated by the most recent call to {@link analyse}.
   */
  public get scope(): Readonly<VariableScope> {
    return this._scope;
  }

  // ── Pass 1: Scope resolution ───────────────────────────────────

  /**
   * Walk all MATCH patterns and collect every variable binding into
   * the {@link VariableScope} table.
   *
   * @throws {CypherSemanticError} if a variable name is not a valid identifier.
   */
  private _resolveScopes(ast: QueryAst): QueryAst {
    this._scope = new Map();

    for (let i = 0; i < ast.match.patterns.length; i++) {
      const path = ast.match.patterns[i];
      this._collectPatternScope(path, i);
    }

    return ast;
  }

  /**
   * Extract variable bindings from a single pattern path.
   */
  private _collectPatternScope(path: PatternPath, patternIndex: number): void {
    for (const segment of path.segments) {
      if (segment.kind === 'NodePattern') {
        if (segment.variable) {
          this._addBinding(segment.variable, patternIndex, 'node');
        }
      } else if (segment.kind === 'EdgePattern') {
        if (segment.variable) {
          this._addBinding(segment.variable, patternIndex, 'edge');
        }
      }
    }
  }

  /**
   * Add a binding to the scope table.
   * Does NOT check for duplicates here — that is handled by Pass 3.
   */
  private _addBinding(
    name: string,
    patternIndex: number,
    bindingKind: 'node' | 'edge',
  ): void {
    if (!this._scope.has(name)) {
      this._scope.set(name, { name, patternIndex, bindingKind });
    }
    // Duplicate bindings are silently allowed here; Pass 3 will flag them.
  }

  // ── Pass 2: Unresolved variable detection ──────────────────────

  /**
   * Verify that every variable referenced in `RETURN`, `WHERE`, `ORDER BY`,
   * `SKIP`, and `LIMIT` clauses exists in the scope table.
   *
   * @throws {CypherSemanticError} if an undefined variable is referenced.
   */
  private _checkUnresolvedVars(ast: QueryAst): QueryAst {
    // Check WHERE clause.
    if (ast.where) {
      this._checkExpressionVars(ast.where.expression, 'WHERE');
    }

    // Check RETURN items.
    for (const item of ast.return.items) {
      this._checkExpressionVars(item.expression, 'RETURN');
    }

    // Check ORDER BY items.
    if (ast.orderBy) {
      for (const item of ast.orderBy.items) {
        this._checkExpressionVars(item.expression, 'ORDER BY');
      }
    }

    // Check SKIP expression.
    if (ast.skip) {
      this._checkExpressionVars(ast.skip.expression, 'SKIP');
    }

    // Check LIMIT expression.
    if (ast.limit) {
      this._checkExpressionVars(ast.limit.expression, 'LIMIT');
    }

    return ast;
  }

  /**
   * Recursively walk an expression tree and verify that every
   * {@link IdentifierExpr} refers to a defined variable.
   *
   * @throws {CypherSemanticError} on the first unresolved reference.
   */
  private _checkExpressionVars(expr: Expression, clause: string): void {
    switch (expr.kind) {
      case 'Identifier': {
        if (!this._scope.has(expr.name)) {
          throw new CypherSemanticError(
            `Variable '${expr.name}' is not defined in ${clause} clause. ` +
            `Defined variables: ${[...this._scope.keys()].join(', ') || '(none)'}`,
          );
        }
        return;
      }

      case 'PropertyAccess':
        this._checkExpressionVars(expr.object, clause);
        return;

      case 'Binary':
        this._checkExpressionVars(expr.left, clause);
        this._checkExpressionVars(expr.right, clause);
        return;

      case 'Unary':
        this._checkExpressionVars(expr.operand, clause);
        return;

      case 'In':
        this._checkExpressionVars(expr.expression, clause);
        this._checkExpressionVars(expr.list, clause);
        return;

      case 'IsNull':
        this._checkExpressionVars(expr.expression, clause);
        return;

      case 'List':
        for (const elem of expr.elements) {
          this._checkExpressionVars(elem, clause);
        }
        return;

      case 'FunctionCall':
        for (const arg of expr.args) {
          this._checkExpressionVars(arg, clause);
        }
        return;

      case 'Literal':
      case 'Parameter':
        // No variable references — safe.
        return;
    }
  }

  // ── Pass 3: Duplicate binding detection ────────────────────────

  /**
   * Detect when the same variable name is bound more than once within
   * a single MATCH clause.
   *
   * @throws {CypherSemanticError} on the first duplicate.
   */
  private _checkDuplicateBindings(ast: QueryAst): QueryAst {
    const seen = new Map<string, { patternIndex: number; bindingKind: string }>();

    for (let i = 0; i < ast.match.patterns.length; i++) {
      const path = ast.match.patterns[i];

      for (const segment of path.segments) {
        let varName: string | undefined;
        let bindingKind: string = 'pattern element';

        if (segment.kind === 'NodePattern') {
          varName = segment.variable;
          bindingKind = 'node';
        } else if (segment.kind === 'EdgePattern') {
          varName = segment.variable;
          bindingKind = 'edge';
        }

        if (!varName) continue;

        const existing = seen.get(varName);
        if (existing) {
          throw new CypherSemanticError(
            `Variable '${varName}' is bound multiple times in MATCH. ` +
            `First bound as ${existing.bindingKind} in pattern ${existing.patternIndex + 1}, ` +
            `then re-bound as ${bindingKind} in pattern ${i + 1}.`,
          );
        }

        seen.set(varName, { patternIndex: i, bindingKind });
      }
    }

    return ast;
  }
}
