/**
 * Semantic analyser for the Cypher AST.
 *
 * Validates the raw AST produced by the {@link Parser} against semantic rules
 * and annotates variable scopes. Uses a **chain of pass functions** design:
 * each pass is a standalone function that receives the AST and either returns
 * it (possibly annotated) or throws {@link CypherSemanticError}.
 *
 * ### Current passes (in order)
 * | # | Pass                     | Responsibility                                    |
 * |---|--------------------------|---------------------------------------------------|
 * | 1 | `resolveScopes`          | Collect variable bindings from MATCH              |
 * | 2 | `checkUnresolvedVars`    | Detect references to undefined variables           |
 * | 3 | `checkDuplicateBindings` | Detect variables bound more than once              |
 * | 4 | `checkCreateUniqueness`  | Ensure CREATE vars don't shadow MATCH vars         |
 * | 5 | `checkWriteScope`        | Verify SET/DELETE/REMOVE vars are in scope         |
 * | 6 | `checkDeleteSafety`      | Detect deleted vars used in RETURN/SET             |
 * | 7 | `checkSetTypes`          | Validate SET values are primitives                 |
 * | 8 | `checkAggregateGrouping` | Validate aggregate + grouping key rules            |
 * | 9 | `checkHavingClause`      | Validate HAVING clause                             |
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
  CreateClause,
  SetClause,
  DeleteClause,
  RemoveClause,
  ReturnClause,
  ReturnItem,
  OrderByClause,
  OrderByItem,
  SkipClause,
  LimitClause,
  MatchPattern,
  PatternPath,
  NamedPath,
  PatternSegment,
  getPatternSegments,
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
  bindingKind: 'node' | 'edge' | 'path';
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
    this._checkCreateUniqueness.bind(this),
    this._checkWriteScope.bind(this),
    this._checkDeleteSafety.bind(this),
    this._checkSetTypes.bind(this),
    this._checkAggregateGrouping.bind(this),
    this._checkHavingClause.bind(this),
    this._checkIndexDdlValidity.bind(this),
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
      const pattern = ast.match.patterns[i];
      this._collectPatternScope(pattern, i);
    }

    return ast;
  }

  /**
   * Extract variable bindings from a single pattern path (or named path).
   */
  private _collectPatternScope(pattern: MatchPattern, patternIndex: number): void {
    // If this is a named path, also bind the path variable itself
    if (pattern.kind === 'NamedPath') {
      this._addBinding(pattern.name, patternIndex, 'path');
    }
    const segments = getPatternSegments(pattern);
    for (const segment of segments) {
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
    bindingKind: 'node' | 'edge' | 'path',
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
    // Skip unresolved-var check for DDL statements — the RETURN clause
    // items for SHOW INDEXES are projection aliases, not variable references.
    if (ast.createIndex || ast.dropIndex || ast.showIndexes) return ast;

    // Build the extra scope from CREATE patterns so variables introduced
    // by CREATE can be referenced in RETURN, WHERE, ORDER BY, etc.
    const extraScope = this._collectCreateScope(ast);

    // Check WHERE clause.
    if (ast.where) {
      this._checkExpressionVars(ast.where.expression, 'WHERE', extraScope);
    }

    // Check RETURN items.
    for (const item of ast.return.items) {
      this._checkExpressionVars(item.expression, 'RETURN', extraScope);
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
            extraScope,
          );
        } else {
          this._checkExpressionVars(item.expression, 'ORDER BY', extraScope);
        }
      }
    }

    // Check SKIP expression.
    if (ast.skip) {
      this._checkExpressionVars(ast.skip.expression, 'SKIP', extraScope);
    }

    // Check LIMIT expression.
    if (ast.limit) {
      this._checkExpressionVars(ast.limit.expression, 'LIMIT', extraScope);
    }

    return ast;
  }

  /**
   * Recursively walk an expression tree and verify that every
   * {@link IdentifierExpr} refers to a defined variable.
   *
   * @param extraScope - Additional variable bindings from CREATE that
   *   are not tracked in the main MATCH scope table.
   * @throws {CypherSemanticError} on the first unresolved reference.
   */
  private _checkExpressionVars(
    expr: Expression,
    clause: string,
    extraScope?: ReadonlySet<string>,
  ): void {
    switch (expr.kind) {
      case 'Identifier': {
        if (!this._scope.has(expr.name) && !extraScope?.has(expr.name)) {
          throw new CypherSemanticError(
            `Variable '${expr.name}' is not defined in ${clause} clause. ` +
            `Defined variables: ${[...this._scope.keys()].join(', ') || '(none)'}`,
          );
        }
        return;
      }

      case 'PropertyAccess':
        this._checkExpressionVars(expr.object, clause, extraScope);
        return;

      case 'Binary':
        this._checkExpressionVars(expr.left, clause, extraScope);
        this._checkExpressionVars(expr.right, clause, extraScope);
        return;

      case 'Unary':
        this._checkExpressionVars(expr.operand, clause, extraScope);
        return;

      case 'In':
        this._checkExpressionVars(expr.expression, clause, extraScope);
        this._checkExpressionVars(expr.list, clause, extraScope);
        return;

      case 'IsNull':
        this._checkExpressionVars(expr.expression, clause, extraScope);
        return;

      case 'List':
        for (const elem of expr.elements) {
          this._checkExpressionVars(elem, clause, extraScope);
        }
        return;

      case 'FunctionCall':
        for (const arg of expr.args) {
          this._checkExpressionVars(arg, clause, extraScope);
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
   * @param extraScope - Additional variable bindings from CREATE that
   *   are not tracked in the main MATCH scope table.
   * @throws {CypherSemanticError} on the first unresolved reference that
   *         is not in the allowed set.
   */
  private _checkExpressionVarsWithAllowed(
    expr: Expression,
    clause: string,
    allowed: ReadonlySet<string>,
    extraScope?: ReadonlySet<string>,
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
        } else if (!this._scope.has(expr.name) && !extraScope?.has(expr.name)) {
          // Pre-aggregation context: check the MATCH scope + CREATE extras.
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
        this._checkExpressionVarsWithAllowed(expr.object, clause, allowed, extraScope);
        return;

      case 'Binary':
        this._checkExpressionVarsWithAllowed(expr.left, clause, allowed, extraScope);
        this._checkExpressionVarsWithAllowed(expr.right, clause, allowed, extraScope);
        return;

      case 'Unary':
        this._checkExpressionVarsWithAllowed(expr.operand, clause, allowed, extraScope);
        return;

      case 'In':
        this._checkExpressionVarsWithAllowed(expr.expression, clause, allowed, extraScope);
        this._checkExpressionVarsWithAllowed(expr.list, clause, allowed, extraScope);
        return;

      case 'IsNull':
        this._checkExpressionVarsWithAllowed(expr.expression, clause, allowed, extraScope);
        return;

      case 'List':
        for (const elem of expr.elements) {
          this._checkExpressionVarsWithAllowed(elem, clause, allowed, extraScope);
        }
        return;

      case 'FunctionCall':
        for (const arg of expr.args) {
          this._checkExpressionVarsWithAllowed(arg, clause, allowed, extraScope);
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
      const pattern = ast.match.patterns[i];
      const segments = getPatternSegments(pattern);

      for (const segment of segments) {
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
        // The function itself may be an aggregate (COUNT), or it may be
        // a non-aggregate wrapper (COALESCE) whose arguments contain
        // aggregate calls.  Both cases make this an aggregate expression.
        return (
          Semantic.AGGREGATE_FUNCTIONS.has(expr.name) ||
          expr.args.some((arg) => this._containsAggregate(arg))
        );

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
      // No aggregates in RETURN, but HAVING may still contain aggregate
      // functions (e.g. MATCH ... RETURN p.name HAVING COUNT(*) > 5).
      // Aggregates are only executable with an AggregateStep in the plan;
      // without aggregates in RETURN, the Planner takes the non-aggregate
      // path and the Executor will fail on raw FunctionCall nodes.
      if (this._containsAggregate(ast.having.expression)) {
        throw new CypherSemanticError(
          'HAVING contains aggregate functions but RETURN has no ' +
          'aggregates. Add an aggregate (e.g. COUNT(*)) to RETURN, ' +
          'or remove the aggregate from HAVING.',
        );
      }

      // HAVING without aggregates is essentially an additional WHERE filter.
      this._checkExpressionVars(ast.having.expression, 'HAVING');
    }

    return ast;
  }

  // ── Pass 6: CREATE uniqueness ───────────────────────────────────

  /**
   * Ensure variables introduced in CREATE patterns do not shadow existing
   * MATCH variables within the same query.
   *
   * openCypher rule: a variable that is already bound cannot be re-bound.
   *
   * Already-bound MATCH variables that appear in CREATE path patterns
   * (e.g. {@code MATCH (a) CREATE (a)-[:R]->(b)}) are treated as
   * *references* — they serve as endpoints for new relationships and are
   * not re-bindings.  Only a standalone CREATE node whose variable is
   * already bound in MATCH is flagged as a true re-binding error.
   *
   * @throws {CypherSemanticError} if a CREATE node variable is already
   *         in MATCH scope and the pattern contains no edge segments.
   */
  private _checkCreateUniqueness(ast: QueryAst): QueryAst {
    if (!ast.create) return ast;

    for (const pattern of ast.create.patterns) {
      const segments = getPatternSegments(pattern);
      const hasEdges = segments.some(s => s.kind === 'EdgePattern');

      // Path patterns with edges use node variables as endpoints
      // (references), never as re-bindings.
      if (hasEdges) continue;

      // Standalone node pattern(s): any node variable already bound
      // in MATCH is a true re-binding.
      for (const seg of segments) {
        if (
          seg.kind === 'NodePattern' &&
          seg.variable &&
          this._scope.has(seg.variable)
        ) {
          throw new CypherSemanticError(
            `Variable '${seg.variable}' already bound in MATCH. ` +
            `Cannot re-bind variables across MATCH and CREATE.`,
          );
        }
      }
    }

    return ast;
  }

  // ── Pass 7: Write-scope validation ──────────────────────────────

  /**
   * Verify that all variables referenced in SET, DELETE, and REMOVE clauses
   * are bound in either the MATCH scope or the CREATE scope.
   *
   * CREATE introduces new variable bindings into scope that downstream
   * clauses (SET, RETURN, REMOVE) can reference.
   *
   * @throws {CypherSemanticError} if a variable used in a write clause is undefined.
   */
  private _checkWriteScope(ast: QueryAst): QueryAst {
    if (!ast.set && !ast.delete && !ast.remove) return ast;

    // Build the full set of known variables: MATCH scope ∪ CREATE scope.
    const knownVars = new Set(this._scope.keys());
    const createScope = this._collectCreateScope(ast);
    for (const v of createScope) knownVars.add(v);

    // SET clause: the variable property-access target must be in scope.
    if (ast.set) {
      for (const item of ast.set.items) {
        this._checkExpressionVarsBound(item.variable, 'SET', knownVars);
      }
    }

    // DELETE clause: each variable must be in scope.
    if (ast.delete) {
      for (const varName of ast.delete.variables) {
        if (!knownVars.has(varName)) {
          throw new CypherSemanticError(
            `Variable '${varName}' not defined in DELETE clause. ` +
            `Defined variables: ${[...knownVars].join(', ') || '(none)'}`,
          );
        }
      }
    }

    // REMOVE clause: each target variable must be in scope.
    if (ast.remove) {
      for (const item of ast.remove.items) {
        if (!knownVars.has(item.variable.name)) {
          throw new CypherSemanticError(
            `Variable '${item.variable.name}' not defined in REMOVE clause. ` +
            `Defined variables: ${[...knownVars].join(', ') || '(none)'}`,
          );
        }
      }
    }

    return ast;
  }

  // ── Pass 8: Delete safety ───────────────────────────────────────

  /**
   * Check that variables deleted in the DELETE clause are not subsequently
   * referenced in SET within the same query.
   *
   * openCypher semantics: RETURN after DELETE is valid — the row is emitted
   * before the variable binding is removed from the row buffer.
   * SET after DELETE is rejected because writing to a deleted variable
   * makes no sense.
   *
   * @throws {CypherSemanticError} if a deleted variable appears in SET.
   */
  private _checkDeleteSafety(ast: QueryAst): QueryAst {
    if (!ast.delete) return ast;

    const deletedVars = new Set(ast.delete.variables);

    // Check SET clause — writing to a deleted variable makes no sense.
    if (ast.set) {
      for (const item of ast.set.items) {
        if (this._expressionReferencesAny(item.variable, deletedVars)) {
          throw new CypherSemanticError(
            `Cannot SET property on deleted variable. ` +
            `Variables deleted: ${[...deletedVars].join(', ')}`,
          );
        }
      }
    }

    return ast;
  }

  // ── Pass 9: SET type checking ───────────────────────────────────

  /**
   * Ensure that property values assigned in SET are flat primitives
   * (string, number, boolean, null), matching the Graph layer's
   * `isPrimitive` constraint.
   *
   * Array literals (ListExpr) are rejected; all other expression types
   * are allowed since they may resolve to primitives at runtime.
   *
   * @throws {CypherSemanticError} if a SET value is a non-primitive literal.
   */
  private _checkSetTypes(ast: QueryAst): QueryAst {
    if (!ast.set) return ast;

    for (const item of ast.set.items) {
      if (!this._isPrimitiveExpression(item.value)) {
        throw new CypherSemanticError(
          'Property value must be a primitive type (string, number, boolean, or null)',
        );
      }
    }

    return ast;
  }

  // ── Write-pass helpers ──────────────────────────────────────────

  /**
   * Collect all variable names introduced by CREATE patterns into a Set.
   *
   * Walks the pattern paths in the CREATE clause the same way
   * {@link _resolveScopes} walks MATCH patterns.
   */
  private _collectCreateScope(ast: QueryAst): Set<string> {
    const vars = new Set<string>();
    if (!ast.create) return vars;

    for (const pattern of ast.create.patterns) {
      // Handle NamedPath binding.
      if (pattern.kind === 'NamedPath' && pattern.name) {
        vars.add(pattern.name);
      }
      const segments = getPatternSegments(pattern);
      for (const segment of segments) {
        if (segment.kind === 'NodePattern' && segment.variable) {
          vars.add(segment.variable);
        } else if (segment.kind === 'EdgePattern' && segment.variable) {
          vars.add(segment.variable);
        }
      }
    }

    return vars;
  }

  /**
   * Verify that an expression (used as a SET target) only references
   * variables present in the given set of known variable names.
   *
   * @throws {CypherSemanticError} on the first unresolved reference.
   */
  private _checkExpressionVarsBound(
    expr: Expression,
    clause: string,
    knownVars: ReadonlySet<string>,
  ): void {
    switch (expr.kind) {
      case 'Identifier': {
        if (!knownVars.has(expr.name)) {
          throw new CypherSemanticError(
            `Variable '${expr.name}' not defined in ${clause} clause. ` +
            `Defined variables: ${[...knownVars].join(', ') || '(none)'}`,
          );
        }
        return;
      }

      case 'PropertyAccess':
        this._checkExpressionVarsBound(expr.object, clause, knownVars);
        return;

      case 'Literal':
      case 'Parameter':
        return;

      default:
        // Binary, Unary, In, IsNull, FunctionCall, List — complex
        // expressions; allow them (runtime will catch type issues).
        return;
    }
  }

  /**
   * Recursively check whether an expression tree references any variable
   * name in the given set.
   *
   * @returns `true` if any Identifier leaf in the tree matches a name in `varNames`.
   */
  private _expressionReferencesAny(
    expr: Expression,
    varNames: ReadonlySet<string>,
  ): boolean {
    switch (expr.kind) {
      case 'Identifier':
        return varNames.has(expr.name);

      case 'PropertyAccess':
        return this._expressionReferencesAny(expr.object, varNames);

      case 'Binary':
        return (
          this._expressionReferencesAny(expr.left, varNames) ||
          this._expressionReferencesAny(expr.right, varNames)
        );

      case 'Unary':
        return this._expressionReferencesAny(expr.operand, varNames);

      case 'In':
        return (
          this._expressionReferencesAny(expr.expression, varNames) ||
          this._expressionReferencesAny(expr.list, varNames)
        );

      case 'IsNull':
        return this._expressionReferencesAny(expr.expression, varNames);

      case 'List':
        return expr.elements.some(e =>
          this._expressionReferencesAny(e, varNames),
        );

      case 'FunctionCall':
        return expr.args.some(a =>
          this._expressionReferencesAny(a, varNames),
        );

      case 'Literal':
      case 'Parameter':
        return false;
    }
  }

  /**
   * Determine whether an expression is guaranteed to evaluate to a
   * primitive value (string, number, boolean, or null).
   *
   * Array literals ({@link ListExpr}) are rejected; all other expression
   * types are allowed since they may resolve to primitives at runtime.
   */
  private _isPrimitiveExpression(expr: Expression): boolean {
    if (expr.kind === 'List') return false;
    // Literals are primitive by construction (string | number | boolean | null).
    // Parameters, identifiers, property accesses, function calls, and binary
    // expressions may resolve to primitives at runtime — be lenient.
    return true;
  }

  // ── Pass 10: Index DDL validity ──────────────────────────────────

  /**
   * Validate index DDL statements.
   *
   * Rules enforced:
   * 1. CREATE INDEX must have a non-empty name.
   * 2. CREATE INDEX must have at least one property key.
   * 3. DROP INDEX must have a non-empty name.
   * 4. DDL and DML cannot be combined in the same query.
   *
   * @throws {CypherSemanticError} if any rule is violated.
   */
  private _checkIndexDdlValidity(ast: QueryAst): QueryAst {
    const hasDdl = !!(ast.createIndex || ast.dropIndex || ast.showIndexes);
    if (!hasDdl) return ast;

    // ── Rule 1: CREATE INDEX name required ─────────────────────────
    if (ast.createIndex && !ast.createIndex.name) {
      throw new CypherSemanticError(
        'Index name is required for CREATE INDEX',
      );
    }

    // ── Rule 2: CREATE INDEX property keys non-empty ──────────────
    if (ast.createIndex && ast.createIndex.propertyKeys.length === 0) {
      throw new CypherSemanticError(
        'At least one property key is required for CREATE INDEX',
      );
    }

    // ── Rule 3: DROP INDEX name required ─────────────────────────
    if (ast.dropIndex && !ast.dropIndex.name) {
      throw new CypherSemanticError(
        'Index name is required for DROP INDEX',
      );
    }

    // ── Rule 4: DDL + DML mutual exclusion ─────────────────────────
    const hasDml =
      ast.match.patterns.length > 0 ||
      !!ast.create ||
      !!ast.set ||
      !!ast.delete ||
      !!ast.remove;

    if (hasDml) {
      throw new CypherSemanticError(
        'DDL statements (CREATE INDEX, DROP INDEX, SHOW INDEXES) cannot be combined with MATCH/RETURN',
      );
    }

    return ast;
  }
}
