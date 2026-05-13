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
    this._checkAggregateGrouping.bind(this),
    this._checkHavingClause.bind(this),
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
      // When aggregates are present, ORDER BY can reference aggregate
      // aliases and group-by key aliases that aren't in the MATCH scope.
      const hasAggregate = ast.return.items.some(
        item => this._containsAggregate(item.expression),
      );

      const allowedAliases = hasAggregate
        ? this._collectReturnAliases(ast)
        : undefined;

      for (const item of ast.orderBy.items) {
        if (allowedAliases) {
          this._checkExpressionVarsWithAllowed(
            item.expression,
            'ORDER BY',
            allowedAliases,
          );
        } else {
          this._checkExpressionVars(item.expression, 'ORDER BY');
        }
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

  /**
   * Like {@link _checkExpressionVars} but also accepts identifiers whose
   * name appears in the `allowed` set.  Used for ORDER BY when aggregates
   * are present so that aggregate aliases and group-by key aliases
   * (which are not in the MATCH scope) pass validation.
   *
   * @throws {CypherSemanticError} on the first unresolved reference that
   *         is not in the allowed set.
   */
  private _checkExpressionVarsWithAllowed(
    expr: Expression,
    clause: string,
    allowed: ReadonlySet<string>,
  ): void {
    switch (expr.kind) {
      case 'Identifier': {
        if (allowed.size > 0) {
          // Post-aggregation context (ORDER BY / HAVING with aggregates):
          // only RETURN aliases are available — MATCH-scope variables like
          // 'p' from MATCH (p:Person) no longer exist in the row buffer
          // after AggregateStep.
          if (!allowed.has(expr.name)) {
            throw new CypherSemanticError(
              `Variable '${expr.name}' is not available after aggregation in ${clause} clause. ` +
              `Post-aggregation aliases: ${[...allowed].join(', ') || '(none)'}. ` +
              `Use an aggregate alias or a group-by key alias.`,
            );
          }
        } else if (!this._scope.has(expr.name)) {
          // Pre-aggregation context: check the MATCH scope.
          throw new CypherSemanticError(
            `Variable '${expr.name}' is not defined in ${clause} clause. ` +
            `Defined variables: ${[...this._scope.keys()].join(', ') || '(none)'}` +
            (allowed.size > 0
              ? `. Post-aggregation aliases: ${[...allowed].join(', ')}`
              : ''),
          );
        }
        return;
      }

      case 'PropertyAccess':
        this._checkExpressionVarsWithAllowed(expr.object, clause, allowed);
        return;

      case 'Binary':
        this._checkExpressionVarsWithAllowed(expr.left, clause, allowed);
        this._checkExpressionVarsWithAllowed(expr.right, clause, allowed);
        return;

      case 'Unary':
        this._checkExpressionVarsWithAllowed(expr.operand, clause, allowed);
        return;

      case 'In':
        this._checkExpressionVarsWithAllowed(expr.expression, clause, allowed);
        this._checkExpressionVarsWithAllowed(expr.list, clause, allowed);
        return;

      case 'IsNull':
        this._checkExpressionVarsWithAllowed(expr.expression, clause, allowed);
        return;

      case 'List':
        for (const elem of expr.elements) {
          this._checkExpressionVarsWithAllowed(elem, clause, allowed);
        }
        return;

      case 'FunctionCall':
        for (const arg of expr.args) {
          this._checkExpressionVarsWithAllowed(arg, clause, allowed);
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

  // ── ORDER BY helpers ────────────────────────────────────────────

  /**
   * Derive the effective alias for a RETURN item, matching the logic in
   * {@link Planner._deriveAlias} so that the semantic checker knows which
   * identifiers are valid post-aggregation.
   */
  private _deriveReturnAlias(expr: Expression): string {
    switch (expr.kind) {
      case 'Identifier':
        return expr.name;
      case 'PropertyAccess':
        return `${this._deriveReturnAlias(expr.object)}_${expr.property}`;
      case 'Literal':
        return String(expr.value);
      case 'Parameter':
        return expr.name;
      case 'FunctionCall':
        return expr.name.toLowerCase();
      default:
        return 'expr';
    }
  }

  /**
   * Collect all aliases from the RETURN clause — both explicit (`AS alias`)
   * and auto-derived — into a set.  Used to allow ORDER BY to reference
   * aggregate aliases and group-by key aliases when aggregates are present.
   */
  private _collectReturnAliases(ast: QueryAst): Set<string> {
    const aliases = new Set<string>();
    for (const item of ast.return.items) {
      const alias = item.alias ?? this._deriveReturnAlias(item.expression);
      aliases.add(alias);
    }
    return aliases;
  }

  // ── Pass 4: Aggregate grouping validation ──────────────────────

  /** Set of aggregate function names recognised by the semantic analyser. */
  private static readonly AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set([
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COLLECT',
  ]);

  /**
   * Validate aggregate function usage in RETURN and WHERE clauses.
   *
   * Rules enforced:
   * 1. Aggregate functions MUST NOT appear in WHERE clauses.
   * 2. When aggregates are present in RETURN, non-aggregate RETURN items
   *    must be simple identifiers or property accesses (valid grouping keys).
   *
   * @throws {CypherSemanticError} if any rule is violated.
   */
  private _checkAggregateGrouping(ast: QueryAst): QueryAst {
    // Rule 1: No aggregate functions in WHERE.
    if (ast.where && this._containsAggregate(ast.where.expression)) {
      throw new CypherSemanticError(
        'Aggregate functions cannot be used in WHERE clauses',
      );
    }

    // Determine whether any RETURN item contains an aggregate function.
    const hasAggregate = ast.return.items.some(
      item => this._containsAggregate(item.expression),
    );

    if (!hasAggregate) {
      return ast;
    }

    // Rule 2: Non-aggregate RETURN items must be valid grouping keys.
    for (const item of ast.return.items) {
      if (this._containsAggregate(item.expression)) {
        continue; // aggregate expression — allowed
      }

      if (!this._isGroupingKey(item.expression)) {
        throw new CypherSemanticError(
          `Non-aggregate RETURN item must be a simple identifier or ` +
          `property access to serve as a grouping key, but found ` +
          `'${this._describeExpr(item.expression)}'`,
        );
      }
    }

    // Rule 3: ORDER BY with aggregates — validate that ORDER BY items
    // reference valid post-aggregation identifiers (aggregate aliases
    // or group-by key aliases).  Since the Planner now places SortStep
    // after AggregateStep for aggregate queries, ORDER BY expressions
    // must only reference identifiers available in the post-aggregation
    // row.  Raw MATCH variables (like `p.name`) that are not group-by
    // keys are not available at sort time.
    if (ast.orderBy) {
      const allowedAliases = this._collectReturnAliases(ast);

      for (const item of ast.orderBy.items) {
        const unresolved = this._collectUnresolvedPostAggIdentifiers(
          item.expression,
          allowedAliases,
        );

        if (unresolved.length > 0) {
          throw new CypherSemanticError(
            `ORDER BY references '${unresolved.join("', '")}' which ` +
            `are not available after aggregation. ` +
            `Post-aggregation aliases: ${[...allowedAliases].join(', ') || '(none)'}. ` +
            `Use an aggregate alias or a group-by key alias in ORDER BY.`,
          );
        }
      }
    }

    return ast;
  }

  /**
   * Walk an expression tree and collect identifiers that are NOT in
   * the MATCH scope AND NOT in the allowed post-aggregation alias set.
   *
   * @returns Array of unresolved identifier names (empty = all valid).
   */
  private _collectUnresolvedPostAggIdentifiers(
    expr: Expression,
    allowed: ReadonlySet<string>,
  ): string[] {
    switch (expr.kind) {
      case 'Identifier': {
        // Post-aggregation context: only allowed aliases are available.
        // MATCH-scope variables do not exist after AggregateStep.
        if (!allowed.has(expr.name)) {
          return [expr.name];
        }
        return [];
      }

      case 'PropertyAccess':
        return this._collectUnresolvedPostAggIdentifiers(expr.object, allowed);

      case 'Binary':
        return [
          ...this._collectUnresolvedPostAggIdentifiers(expr.left, allowed),
          ...this._collectUnresolvedPostAggIdentifiers(expr.right, allowed),
        ];

      case 'Unary':
        return this._collectUnresolvedPostAggIdentifiers(expr.operand, allowed);

      case 'In':
        return [
          ...this._collectUnresolvedPostAggIdentifiers(expr.expression, allowed),
          ...this._collectUnresolvedPostAggIdentifiers(expr.list, allowed),
        ];

      case 'IsNull':
        return this._collectUnresolvedPostAggIdentifiers(expr.expression, allowed);

      case 'List':
        return expr.elements.flatMap((elem) =>
          this._collectUnresolvedPostAggIdentifiers(elem, allowed),
        );

      case 'FunctionCall':
        return expr.args.flatMap((arg) =>
          this._collectUnresolvedPostAggIdentifiers(arg, allowed),
        );

      case 'Literal':
      case 'Parameter':
        return [];
    }
  }

  /**
   * Recursively check whether an expression tree contains any aggregate
   * function call ({@link FunctionCallExpr}).
   */
  private _containsAggregate(expr: Expression): boolean {
    switch (expr.kind) {
      case 'FunctionCall':
        return Semantic.AGGREGATE_FUNCTIONS.has(expr.name);

      case 'Binary':
        return this._containsAggregate(expr.left) || this._containsAggregate(expr.right);

      case 'Unary':
        return this._containsAggregate(expr.operand);

      case 'PropertyAccess':
        return this._containsAggregate(expr.object);

      case 'In':
        return this._containsAggregate(expr.expression) || this._containsAggregate(expr.list);

      case 'IsNull':
        return this._containsAggregate(expr.expression);

      case 'List':
        return expr.elements.some(e => this._containsAggregate(e));

      case 'Identifier':
      case 'Literal':
      case 'Parameter':
        return false;
    }
  }

  /**
   * Determine whether an expression is a valid grouping key — a simple
   * identifier or a property access on a bound variable.
   */
  private _isGroupingKey(expr: Expression): boolean {
    switch (expr.kind) {
      case 'Identifier':
      case 'PropertyAccess':
        return true;

      default:
        return false;
    }
  }

  /**
   * Produce a short human-readable description of an expression for
   * error messages.
   */
  private _describeExpr(expr: Expression): string {
    switch (expr.kind) {
      case 'Identifier':
        return expr.name;
      case 'PropertyAccess':
        return `${this._describeExpr(expr.object)}.${expr.property}`;
      case 'Literal':
        return String(expr.value);
      case 'Parameter':
        return `$${expr.name}`;
      case 'FunctionCall':
        return `${expr.name}(...)`;
      default:
        return 'expression';
    }
  }

  // ── Pass 5: HAVING clause validation ────────────────────────────

  /**
   * Validate the HAVING clause when present.
   *
   * Rules enforced:
   * 1. HAVING without aggregates is unusual but not invalid per openCypher
   *    — it behaves like an additional WHERE filter.
   * 2. Variables referenced in HAVING must be defined in the scope or
   *    be aggregate aliases. Aggregate functions ARE allowed in HAVING
   *    (e.g., `HAVING COUNT(*) > 5`).
   *
   * @throws {CypherSemanticError} if HAVING references undefined variables
   *         or contains aggregates but no aggregates are present in RETURN.
   */
  private _checkHavingClause(ast: QueryAst): QueryAst {
    if (!ast.having) return ast;

    // When aggregates are present, HAVING can reference aggregate
    // aliases and group-by key aliases that aren't in the MATCH scope.
    // Aggregate functions ARE allowed in HAVING (e.g., HAVING COUNT(*) > 5).
    const hasAggregate = ast.return.items.some(
      item => this._containsAggregate(item.expression),
    );

    const allowedAliases = hasAggregate
      ? this._collectReturnAliases(ast)
      : undefined;

    if (allowedAliases) {
      this._checkExpressionVarsWithAllowed(
        ast.having.expression,
        'HAVING',
        allowedAliases,
      );
    } else {
      // No aggregates → HAVING is essentially an additional WHERE filter.
      // Validate against MATCH-scope variables only.
      this._checkExpressionVars(ast.having.expression, 'HAVING');
    }

    return ast;
  }
}
