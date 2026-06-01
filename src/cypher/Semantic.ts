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
  WithClause,
  QuerySegment,
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
    this._checkIndexDdlValidity.bind(this),
  ];

  /** Cached scope table populated by `_resolveScopes` and consumed by later passes. */
  private _scope: VariableScope = new Map();

  public analyse(ast: QueryAst): QueryAst {
    if (ast.segments && ast.segments.length > 0) {
      return this._analyseMultiSegment(ast);
    }

    // Scope resolution always runs first — it populates the scope table.
    let result = this._resolveScopes(ast);

    // Run remaining passes in order.
    for (const pass of this._passes.slice(1)) {
      result = pass(result);
    }

    return result;
  }

  /**
   * Analyse a top-level statement (which may be a UnionAst).
   */
  public analyseStatement(stmt: import('./ast/AstNode').Statement): import('./ast/AstNode').Statement {
    if (stmt.kind === 'Union') {
      let firstColCount = -1;
      let firstAliases: string[] = [];

      for (let i = 0; i < stmt.queries.length; i++) {
        const query = stmt.queries[i];
        this.analyse(query);
        
        const aliases = query.return.items.map(item => item.alias ?? this._deriveReturnAlias(item.expression));
        if (i === 0) {
          firstColCount = aliases.length;
          firstAliases = aliases;
        } else {
          if (aliases.length !== firstColCount) {
            throw new CypherSemanticError(`All queries in a UNION must return the same number of columns. Query 1 returns ${firstColCount}, but Query ${i + 1} returns ${aliases.length}.`);
          }
          for (let j = 0; j < firstColCount; j++) {
            if (aliases[j] !== firstAliases[j]) {
              throw new CypherSemanticError(`All queries in a UNION must return the same column names. Column ${j + 1} in Query 1 is '${firstAliases[j]}', but in Query ${i + 1} is '${aliases[j]}'.`);
            }
          }
        }
      }

      this._scope = new Map();
      const allowedAliases = new Set(firstAliases);
      if (stmt.orderBy) {
        for (const item of stmt.orderBy.items) {
          this._checkExpressionVarsWithAllowed(item.expression, 'UNION ORDER BY', allowedAliases);
        }
      }
      if (stmt.skip) {
        this._checkExpressionVarsWithAllowed(stmt.skip.expression, 'UNION SKIP', allowedAliases);
      }
      if (stmt.limit) {
        this._checkExpressionVarsWithAllowed(stmt.limit.expression, 'UNION LIMIT', allowedAliases);
      }

      return stmt;
    } else {
      return this.analyse(stmt);
    }
  }

  private _analyseMultiSegment(ast: QueryAst): QueryAst {
    this._scope = new Map();

    for (const segment of ast.segments) {
      // 1. Resolve MATCH scopes (adds to this._scope)
      for (const matchClause of segment.matches) {
        for (let i = 0; i < matchClause.patterns.length; i++) {
          this._collectPatternScope(matchClause.patterns[i], i);
        }
      }

      // Check WITH alias rule before anything else
      for (const item of segment.with.items) {
        if (!item.alias && !this._isSimpleAliasable(item.expression)) {
          throw new CypherSemanticError(`Expression in WITH must be aliased (use AS)`);
        }
      }

      // Construct a temporary QueryAst for this segment to reuse existing passes
      const fakeAst: QueryAst = {
        kind: 'Query',
        matches: segment.matches,
        create: segment.create,
        merge: segment.merge,
        set: segment.set,
        delete: segment.delete,
        remove: segment.remove,
        return: { kind: 'Return', distinct: segment.with.distinct, items: segment.with.items },
        orderBy: segment.with.orderBy,
        skip: segment.with.skip,
        limit: segment.with.limit,
        segments: [],
      };

      // Run passes 2 through 9 on the fake AST
      // (Skips 1=_resolveScopes, 10=_checkIndexDdlValidity)
      for (const pass of this._passes.slice(1, -1)) {
        pass.call(this, fakeAst);
      }

      const extraScope = this._collectWriteScope(fakeAst);

      // Compute output scope for next segment
      const nextScope = new Map<string, ScopeEntry>();
      
      if (segment.with.star) {
        // Carry forward all variables from current scope and extra scope
        for (const [name, entry] of this._scope.entries()) {
          nextScope.set(name, entry);
        }
        for (const [name, kind] of extraScope) {
          nextScope.set(name, { name, patternIndex: -1, bindingKind: kind });
        }
      }

      // Add explicit items
      for (let i = 0; i < segment.with.items.length; i++) {
        const item = segment.with.items[i];
        const alias = item.alias ?? this._deriveReturnAlias(item.expression);
        nextScope.set(alias, { name: alias, patternIndex: i, bindingKind: 'node' }); 
      }

      // Check WITH WHERE against post-projection scope
      if (segment.with.where) {
        const tempScope = this._scope;
        this._scope = nextScope;
        this._checkExpressionVars(segment.with.where.expression, 'WITH WHERE');
        this._scope = tempScope;
      }

      this._scope = nextScope;
    }

    // Now process the final segment (the remaining fields in QueryAst)
    for (const matchClause of ast.matches) {
      for (let i = 0; i < matchClause.patterns.length; i++) {
        this._collectPatternScope(matchClause.patterns[i], i);
      }
    }

    // Run passes on the final segment (skipping _resolveScopes)
    let result = ast;
    for (const pass of this._passes.slice(1)) {
      result = pass.call(this, result);
    }

    return result;
  }

  private _isSimpleAliasable(expr: Expression): boolean {
    return expr.kind === 'Identifier' || expr.kind === 'PropertyAccess';
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

    for (const matchClause of ast.matches) {
      for (let i = 0; i < matchClause.patterns.length; i++) {
        this._collectPatternScope(matchClause.patterns[i], i);
      }
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

    // Build the extra scope from CREATE/MERGE patterns so variables introduced
    // by them can be referenced in RETURN, WHERE, ORDER BY, etc.
    const extraScope = this._collectWriteScope(ast);

    // Check WHERE clauses (embedded in each MatchClause).
    // We build an incremental scope because a WHERE clause attached to an earlier MATCH
    // cannot reference variables introduced by a later MATCH/OPTIONAL MATCH.
    const incrementalScope = new Set<string>();

    for (const matchClause of ast.matches) {
      for (const pattern of matchClause.patterns) {
        const segments = getPatternSegments(pattern);
        if (pattern.kind === 'NamedPath' && pattern.name) incrementalScope.add(pattern.name);
        for (const seg of segments) {
          if (seg.variable) incrementalScope.add(seg.variable);
        }
      }

      if (matchClause.where) {
        this._checkExpressionVars(matchClause.where.expression, 'WHERE', extraScope, incrementalScope);
      }
    }

    // Check MERGE clause SET items.
    if (ast.merge) {
      for (const merge of ast.merge) {
        for (const action of merge.actions) {
          for (const item of action.items) {
            this._checkExpressionVars(item.value, 'MERGE SET', extraScope);
          }
        }
      }
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
    extraScope?: ReadonlySet<string> | ReadonlyMap<string, unknown>,
    restrictScope?: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  ): void {
    switch (expr.kind) {
      case 'Identifier': {
        const isBoundInMain = restrictScope ? restrictScope.has(expr.name) : this._scope.has(expr.name);
        if (!isBoundInMain && !extraScope?.has(expr.name)) {
          const definedVars = restrictScope ? [...restrictScope.keys()] : [...this._scope.keys()];
          throw new CypherSemanticError(
            `Variable '${expr.name}' is not defined in ${clause} clause. ` +
            `Defined variables: ${definedVars.join(', ') || '(none)'}`,
          );
        }
        return;
      }

      case 'PropertyAccess':
        this._checkExpressionVars(expr.object, clause, extraScope, restrictScope);
        return;

      case 'Binary':
        this._checkExpressionVars(expr.left, clause, extraScope, restrictScope);
        this._checkExpressionVars(expr.right, clause, extraScope, restrictScope);
        return;

      case 'Unary':
        this._checkExpressionVars(expr.operand, clause, extraScope, restrictScope);
        return;

      case 'In':
        this._checkExpressionVars(expr.expression, clause, extraScope, restrictScope);
        this._checkExpressionVars(expr.list, clause, extraScope, restrictScope);
        return;

      case 'IsNull':
        this._checkExpressionVars(expr.expression, clause, extraScope, restrictScope);
        return;

      case 'List':
        for (const elem of expr.elements) {
          this._checkExpressionVars(elem, clause, extraScope, restrictScope);
        }
        return;

      case 'ListComprehension': {
        this._checkExpressionVars(expr.list, clause, extraScope, restrictScope);
        if ((expr.where && this._containsAggregate(expr.where)) || (expr.projection && this._containsAggregate(expr.projection))) {
          throw new CypherSemanticError(`Aggregate functions cannot be used inside ListComprehension`);
        }
        const localScope = new Set(restrictScope ? restrictScope.keys() : this._scope.keys());
        if (extraScope) {
          for (const v of extraScope.keys()) localScope.add(v);
        }
        localScope.add(expr.variable);
        if (expr.where) this._checkExpressionVars(expr.where, 'list comprehension WHERE', undefined, localScope);
        if (expr.projection) this._checkExpressionVars(expr.projection, 'list comprehension projection', undefined, localScope);
        return;
      }

      case 'FunctionCall':
        for (const arg of expr.args) {
          this._checkExpressionVars(arg, clause, extraScope, restrictScope);
        }
        return;

      case 'ExistsSubquery': {
        const localScope = new Set(restrictScope ? restrictScope.keys() : this._scope.keys());
        if (extraScope) {
          for (const v of extraScope.keys()) localScope.add(v);
        }
        for (const pattern of expr.match.patterns) {
          const segments = getPatternSegments(pattern);
          if (pattern.kind === 'NamedPath' && pattern.name) localScope.add(pattern.name);
          for (const seg of segments) {
            if (seg.variable) localScope.add(seg.variable);
          }
        }
        if (expr.match.where) {
          this._checkExpressionVars(expr.match.where.expression, 'EXISTS subquery WHERE', undefined, localScope);
        }
        return;
      }

      case 'PatternComprehension': {
        if ((expr.where && this._containsAggregate(expr.where)) || this._containsAggregate(expr.projection)) {
          throw new CypherSemanticError(`Aggregate functions cannot be used inside PatternComprehension`);
        }
        const localScope = new Set(restrictScope ? restrictScope.keys() : this._scope.keys());
        if (extraScope) {
          for (const v of extraScope.keys()) localScope.add(v);
        }
        const segments = getPatternSegments(expr.pattern);
        if (expr.pattern.kind === 'NamedPath' && expr.pattern.name) localScope.add(expr.pattern.name);
        for (const seg of segments) {
          if (seg.variable) localScope.add(seg.variable);
        }
        if (expr.where) this._checkExpressionVars(expr.where, 'pattern comprehension WHERE', undefined, localScope);
        this._checkExpressionVars(expr.projection, 'pattern comprehension projection', undefined, localScope);
        return;
      }

      case 'PatternExpr': {
        const localScope = new Set(restrictScope ? restrictScope.keys() : this._scope.keys());
        if (extraScope) {
          for (const v of extraScope.keys()) localScope.add(v);
        }
        const segments = getPatternSegments(expr.pattern);
        if (expr.pattern.kind === 'NamedPath' && expr.pattern.name) localScope.add(expr.pattern.name);
        for (const seg of segments) {
          if (seg.variable) localScope.add(seg.variable);
        }
        return;
      }

      case 'Case':
        if (expr.expression) this._checkExpressionVars(expr.expression, clause, extraScope, restrictScope);
        for (const branch of expr.branches) {
          this._checkExpressionVars(branch.when, clause, extraScope, restrictScope);
          this._checkExpressionVars(branch.then, clause, extraScope, restrictScope);
        }
        if (expr.else) this._checkExpressionVars(expr.else, clause, extraScope, restrictScope);
        return;

      case 'ListPredicate': {
        this._checkExpressionVars(expr.list, clause, extraScope, restrictScope);
        const localScope = new Set(restrictScope ? restrictScope.keys() : this._scope.keys());
        if (extraScope) {
          for (const v of extraScope.keys()) localScope.add(v);
        }
        localScope.add(expr.variable);
        this._checkExpressionVars(expr.where, 'list predicate WHERE', undefined, localScope);
        return;
      }

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
    extraScope?: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  ): void {
    switch (expr.kind) {
      case 'Identifier': {
        if (allowed.size > 0) {
          // Post-aggregation context (ORDER BY with aggregates):
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

      case 'ListComprehension': {
        this._checkExpressionVarsWithAllowed(expr.list, clause, allowed, extraScope);
        if ((expr.where && this._containsAggregate(expr.where)) || (expr.projection && this._containsAggregate(expr.projection))) {
          throw new CypherSemanticError(`Aggregate functions cannot be used inside ListComprehension`);
        }
        const localAllowed = new Set(allowed);
        if (extraScope) {
          for (const v of extraScope.keys()) localAllowed.add(v);
        }
        for (const v of this._scope.keys()) localAllowed.add(v);
        localAllowed.add(expr.variable);
        if (expr.where) this._checkExpressionVarsWithAllowed(expr.where, 'list comprehension WHERE', localAllowed, undefined);
        if (expr.projection) this._checkExpressionVarsWithAllowed(expr.projection, 'list comprehension projection', localAllowed, undefined);
        return;
      }

      case 'FunctionCall':
        for (const arg of expr.args) {
          this._checkExpressionVarsWithAllowed(arg, clause, allowed, extraScope);
        }
        return;

      case 'ExistsSubquery': {
        const localAllowed = new Set(allowed);
        if (extraScope) {
          for (const v of extraScope.keys()) localAllowed.add(v);
        }
        for (const v of this._scope.keys()) localAllowed.add(v);
        for (const pattern of expr.match.patterns) {
          const segments = getPatternSegments(pattern);
          if (pattern.kind === 'NamedPath' && pattern.name) localAllowed.add(pattern.name);
          for (const seg of segments) {
            if (seg.variable) localAllowed.add(seg.variable);
          }
        }
        if (expr.match.where) {
          this._checkExpressionVarsWithAllowed(expr.match.where.expression, 'EXISTS subquery WHERE', localAllowed, undefined);
        }
        return;
      }

      case 'PatternComprehension': {
        if ((expr.where && this._containsAggregate(expr.where)) || this._containsAggregate(expr.projection)) {
          throw new CypherSemanticError(`Aggregate functions cannot be used inside PatternComprehension`);
        }
        const localAllowed = new Set(allowed);
        if (extraScope) {
          for (const v of extraScope.keys()) localAllowed.add(v);
        }
        for (const v of this._scope.keys()) localAllowed.add(v);
        const segments = getPatternSegments(expr.pattern);
        if (expr.pattern.kind === 'NamedPath' && expr.pattern.name) localAllowed.add(expr.pattern.name);
        for (const seg of segments) {
          if (seg.variable) localAllowed.add(seg.variable);
        }
        if (expr.where) this._checkExpressionVarsWithAllowed(expr.where, 'pattern comprehension WHERE', localAllowed, undefined);
        this._checkExpressionVarsWithAllowed(expr.projection, 'pattern comprehension projection', localAllowed, undefined);
        return;
      }

      case 'PatternExpr': {
        const localAllowed = new Set(allowed);
        if (extraScope) {
          for (const v of extraScope.keys()) localAllowed.add(v);
        }
        for (const v of this._scope.keys()) localAllowed.add(v);
        const segments = getPatternSegments(expr.pattern);
        if (expr.pattern.kind === 'NamedPath' && expr.pattern.name) localAllowed.add(expr.pattern.name);
        for (const seg of segments) {
          if (seg.variable) localAllowed.add(seg.variable);
        }
        return;
      }

      case 'Case':
        if (expr.expression) this._checkExpressionVarsWithAllowed(expr.expression, clause, allowed, extraScope);
        for (const branch of expr.branches) {
          this._checkExpressionVarsWithAllowed(branch.when, clause, allowed, extraScope);
          this._checkExpressionVarsWithAllowed(branch.then, clause, allowed, extraScope);
        }
        if (expr.else) this._checkExpressionVarsWithAllowed(expr.else, clause, allowed, extraScope);
        return;

      case 'ListPredicate': {
        this._checkExpressionVarsWithAllowed(expr.list, clause, allowed, extraScope);
        const localAllowed = new Set(allowed);
        if (extraScope) {
          for (const v of extraScope.keys()) localAllowed.add(v);
        }
        for (const v of this._scope.keys()) localAllowed.add(v);
        localAllowed.add(expr.variable);
        this._checkExpressionVarsWithAllowed(expr.where, 'list predicate WHERE', localAllowed, undefined);
        return;
      }

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
    for (const matchClause of ast.matches) {
      this._checkDuplicateBindingsForPatterns(matchClause.patterns);
    }
    return ast;
  }

  private _checkDuplicateBindingsForPatterns(patterns: MatchPattern[]): void {
    const seen = new Map<string, { patternIndex: number; bindingKind: string }>();

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
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
    for (const matchClause of ast.matches) {
      if (matchClause.where && this._containsAggregate(matchClause.where.expression)) {
        throw new CypherSemanticError(
          'Aggregate functions cannot be used in WHERE clauses',
        );
      }
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

      case 'ListComprehension': {
        const unresolved = [...this._collectUnresolvedPostAggIdentifiers(expr.list, allowed)];
        const localAllowed = new Set(allowed);
        localAllowed.add(expr.variable);
        if (expr.where) unresolved.push(...this._collectUnresolvedPostAggIdentifiers(expr.where, localAllowed));
        if (expr.projection) unresolved.push(...this._collectUnresolvedPostAggIdentifiers(expr.projection, localAllowed));
        return unresolved;
      }

      case 'Map':
        return Object.values(expr.props).flatMap((elem) =>
          this._collectUnresolvedPostAggIdentifiers(elem, allowed),
        );

      case 'FunctionCall':
        return expr.args.flatMap((arg) =>
          this._collectUnresolvedPostAggIdentifiers(arg, allowed),
        );

      case 'ExistsSubquery': {
        const localAllowed = new Set(allowed);
        for (const pattern of expr.match.patterns) {
          const segments = getPatternSegments(pattern);
          if (pattern.kind === 'NamedPath' && pattern.name) localAllowed.add(pattern.name);
          for (const seg of segments) {
            if (seg.variable) localAllowed.add(seg.variable);
          }
        }
        if (expr.match.where) {
          return this._collectUnresolvedPostAggIdentifiers(expr.match.where.expression, localAllowed);
        }
        return [];
      }

      case 'PatternComprehension': {
        const localAllowed = new Set(allowed);
        const segments = getPatternSegments(expr.pattern);
        if (expr.pattern.kind === 'NamedPath' && expr.pattern.name) localAllowed.add(expr.pattern.name);
        for (const seg of segments) {
          if (seg.variable) localAllowed.add(seg.variable);
        }
        const unresolved = [];
        if (expr.where) unresolved.push(...this._collectUnresolvedPostAggIdentifiers(expr.where, localAllowed));
        unresolved.push(...this._collectUnresolvedPostAggIdentifiers(expr.projection, localAllowed));
        return unresolved;
      }

      case 'PatternExpr': {
        return [];
      }

      case 'Case': {
        const unresolved = [];
        if (expr.expression) unresolved.push(...this._collectUnresolvedPostAggIdentifiers(expr.expression, allowed));
        for (const branch of expr.branches) {
          unresolved.push(...this._collectUnresolvedPostAggIdentifiers(branch.when, allowed));
          unresolved.push(...this._collectUnresolvedPostAggIdentifiers(branch.then, allowed));
        }
        if (expr.else) unresolved.push(...this._collectUnresolvedPostAggIdentifiers(expr.else, allowed));
        return unresolved;
      }

      case 'ListPredicate': {
        const unresolved = [...this._collectUnresolvedPostAggIdentifiers(expr.list, allowed)];
        const localAllowed = new Set(allowed);
        localAllowed.add(expr.variable);
        unresolved.push(...this._collectUnresolvedPostAggIdentifiers(expr.where, localAllowed));
        return unresolved;
      }

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

      case 'ListComprehension':
        if (this._containsAggregate(expr.list)) return true;
        if (expr.where && this._containsAggregate(expr.where)) return true;
        if (expr.projection && this._containsAggregate(expr.projection)) return true;
        return false;

      case 'Map':
        return Object.values(expr.props).some(e => this._containsAggregate(e));

      case 'ExistsSubquery':
        return expr.match.where ? this._containsAggregate(expr.match.where.expression) : false;

      case 'PatternComprehension':
        if (expr.where && this._containsAggregate(expr.where)) return true;
        if (expr.projection && this._containsAggregate(expr.projection)) return true;
        return false;

      case 'PatternExpr':
        return false;

      case 'Case':
        if (expr.expression && this._containsAggregate(expr.expression)) return true;
        if (expr.else && this._containsAggregate(expr.else)) return true;
        return expr.branches.some(b => this._containsAggregate(b.when) || this._containsAggregate(b.then));

      case 'ListPredicate':
        return this._containsAggregate(expr.list) || this._containsAggregate(expr.where);

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
      case 'Map':
        return '{...}';
      default:
        return 'expression';
    }
  }


  // ── Pass 6: CREATE uniqueness ───────────────────────────────────

  /**
   * Ensure variables introduced in CREATE patterns do not shadow existing
   * MATCH variables or re-bind the same variable across standalone CREATE
   * patterns.
   *
   * openCypher rule: a variable that is already bound cannot be re-bound.
   *
   * Already-bound MATCH variables that appear in CREATE path patterns
   * (e.g. {@code MATCH (a) CREATE (a)-[:R]->(b)}) are treated as
   * *references* — they serve as endpoints for new relationships and are
   * not re-bindings.
   *
   * For standalone CREATE node patterns (no edges), the same variable name
   * must not appear in more than one pattern — e.g.,
   * {@code CREATE (n:Person), (n:Student)} is rejected because `n` is
   * re-bound.
   *
   * @throws {CypherSemanticError} if a CREATE node variable is already
   *         in MATCH scope or was introduced by an earlier standalone
   *         CREATE pattern.
   */
  private _checkCreateUniqueness(ast: QueryAst): QueryAst {
    if (!ast.create) return ast;

    // Track variables introduced by standalone CREATE node patterns
    // so that re-binding the same variable name across multiple
    // standalone patterns (e.g., CREATE (n:X), (n:Y)) is detected.
    const createScope = new Set<string>();

    for (const pattern of ast.create.patterns) {
      const segments = getPatternSegments(pattern);
      const hasEdges = segments.some(s => s.kind === 'EdgePattern');

      // Path patterns with edges use node variables as endpoints
      // (references), never as re-bindings.
      if (hasEdges) continue;

      // Standalone node pattern(s): any node variable already bound
      // in MATCH or in a previous CREATE standalone pattern is a
      // true re-binding.
      for (const seg of segments) {
        if (seg.kind === 'NodePattern' && seg.variable) {
          if (this._scope.has(seg.variable)) {
            throw new CypherSemanticError(
              `Variable '${seg.variable}' already bound in MATCH. ` +
              `Cannot re-bind variables across MATCH and CREATE.`,
            );
          }
          if (createScope.has(seg.variable)) {
            throw new CypherSemanticError(
              `Variable '${seg.variable}' is bound multiple times in CREATE. ` +
              `Each standalone node pattern must introduce a unique variable.`,
            );
          }
          createScope.add(seg.variable);
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
    if (!ast.set && !ast.delete && !ast.remove && !ast.merge) return ast;

    // Build the full set of known variables: MATCH scope ∪ CREATE/MERGE scope.
    const knownVars = new Set(this._scope.keys());
    const knownBindings = new Map<string, 'node' | 'edge' | 'path' | 'unknown'>();
    
    for (const [v, binding] of this._scope) {
      knownBindings.set(v, binding.bindingKind);
    }
    
    const writeScope = this._collectWriteScope(ast);
    for (const [v, kind] of writeScope) {
      knownVars.add(v);
      knownBindings.set(v, kind);
    }

    // MERGE clause: SET variable must be in scope.
    if (ast.merge) {
      for (const merge of ast.merge) {
        for (const action of merge.actions) {
          for (const item of action.items) {
            this._checkExpressionVarsBound(item.variable, 'MERGE SET', knownVars);
          }
        }
      }
    }

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
    // Also, labels cannot be removed from edges.
    if (ast.remove) {
      for (const item of ast.remove.items) {
        if (!knownVars.has(item.variable.name)) {
          throw new CypherSemanticError(
            `Variable '${item.variable.name}' not defined in REMOVE clause. ` +
            `Defined variables: ${[...knownVars].join(', ') || '(none)'}`,
          );
        }
        if (item.labels && item.labels.length > 0) {
          const binding = knownBindings.get(item.variable.name);
          if (binding === 'edge') {
            throw new CypherSemanticError(
              `Cannot remove labels from edge '${item.variable.name}'. Labels can only be removed from nodes.`
            );
          }
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

    // Check SET clause — writing to a deleted variable, or using a deleted
    // variable in the value expression of a SET, makes no sense.
    if (ast.set) {
      for (const item of ast.set.items) {
        if (this._expressionReferencesAny(item.variable, deletedVars) || this._expressionReferencesAny(item.value, deletedVars)
        ) {
          throw new CypherSemanticError(
            `Cannot SET property on deleted variable. ` +
            `Variables deleted: ${[...deletedVars].join(', ')}`,
          );
        }
      }
    }

    // Check MERGE SET clauses.
    if (ast.merge) {
      for (const merge of ast.merge) {
        for (const action of merge.actions) {
          for (const item of action.items) {
            if ( this._expressionReferencesAny(item.variable, deletedVars) || this._expressionReferencesAny(item.value, deletedVars)
            ) {
              throw new CypherSemanticError(
                `Cannot SET property on deleted variable. ` +
                `Variables deleted: ${[...deletedVars].join(', ')}`,
              );
            }
          }
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
    const checkItem = (item: import('./ast/AstNode').SetItem) => {
      if (item.property !== undefined) {
        if (!this._isPrimitiveExpression(item.value)) {
          throw new CypherSemanticError(
            'Property value must be a primitive type (string, number, boolean, or null)',
          );
        }
      } else {
        if (item.value.kind !== 'Map' && item.value.kind !== 'Parameter') {
          throw new CypherSemanticError(
            'SET map replacement or mutation requires a map expression or parameter',
          );
        }
        if (item.value.kind === 'Map') {
          for (const val of Object.values((item.value as import('./ast/AstNode').MapExpr).props)) {
            if (!this._isPrimitiveExpression(val)) {
              throw new CypherSemanticError(
                'Map property values must be a primitive type (string, number, boolean, or null)',
              );
            }
          }
        }
      }
    };

    if (ast.set) {
      for (const item of ast.set.items) {
        checkItem(item);
      }
    }

    if (ast.merge) {
      for (const merge of ast.merge) {
        for (const action of merge.actions) {
          for (const item of action.items) {
            checkItem(item);
          }
        }
      }
    }

    return ast;
  }

  // ── Write-pass helpers ──────────────────────────────────────────

  /**
   * Collect all variable names introduced by CREATE and MERGE patterns into a Set.
   *
   * Walks the pattern paths in the CREATE and MERGE clauses the same way
   * {@link _resolveScopes} walks MATCH patterns.
   */
  private _collectWriteScope(ast: QueryAst): Map<string, 'node' | 'edge' | 'path'> {
    const vars = new Map<string, 'node' | 'edge' | 'path'>();

    if (ast.create) {
      for (const pattern of ast.create.patterns) {
        // Handle NamedPath binding.
        if (pattern.kind === 'NamedPath' && pattern.name) {
          vars.set(pattern.name, 'path');
        }
        const segments = getPatternSegments(pattern);
        for (const segment of segments) {
          if (segment.kind === 'NodePattern' && segment.variable) {
            vars.set(segment.variable, 'node');
          } else if (segment.kind === 'EdgePattern' && segment.variable) {
            vars.set(segment.variable, 'edge');
          }
        }
      }
    }

    if (ast.merge) {
      for (const merge of ast.merge) {
        if (merge.pattern.kind === 'NamedPath' && merge.pattern.name) {
          vars.set(merge.pattern.name, 'path');
        }
        const segments = getPatternSegments(merge.pattern);
        for (const segment of segments) {
          if (segment.kind === 'NodePattern' && segment.variable) {
            vars.set(segment.variable, 'node');
          } else if (segment.kind === 'EdgePattern' && segment.variable) {
            vars.set(segment.variable, 'edge');
          }
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

      case 'Map':
        for (const v of Object.values(expr.props)) {
          this._checkExpressionVarsBound(v, clause, knownVars);
        }
        return;

      default:
        // Binary, Unary, In, IsNull, FunctionCall, List, ListComprehension — complex
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
        return expr.elements.some((e) =>
          this._expressionReferencesAny(e, varNames),
        );

      case 'ListComprehension':
        if (this._expressionReferencesAny(expr.list, varNames)) return true;
        if (expr.where && this._expressionReferencesAny(expr.where, varNames)) return true;
        if (expr.projection && this._expressionReferencesAny(expr.projection, varNames)) return true;
        return false;

      case 'Map':
        return Object.values(expr.props).some(e =>
          this._expressionReferencesAny(e, varNames),
        );

      case 'FunctionCall':
        return expr.args.some(a =>
          this._expressionReferencesAny(a, varNames),
        );

      case 'ExistsSubquery':
        return expr.match.where
          ? this._expressionReferencesAny(expr.match.where.expression, varNames)
          : false;

      case 'PatternComprehension': {
        const segments = getPatternSegments(expr.pattern);
        for (const seg of segments) {
          if (seg.variable && varNames.has(seg.variable)) return true;
        }
        if (expr.where && this._expressionReferencesAny(expr.where, varNames)) return true;
        return this._expressionReferencesAny(expr.projection, varNames);
      }

      case 'PatternExpr':
        // PatternExpr contains a pattern path only — no sub-expressions to walk.
        return false;

      case 'Case':
        if (expr.expression && this._expressionReferencesAny(expr.expression, varNames)) return true;
        if (expr.else && this._expressionReferencesAny(expr.else, varNames)) return true;
        return expr.branches.some(b => this._expressionReferencesAny(b.when, varNames) || this._expressionReferencesAny(b.then, varNames));

      case 'ListPredicate':
        if (this._expressionReferencesAny(expr.list, varNames)) return true;
        return this._expressionReferencesAny(expr.where, varNames);

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
    if (expr.kind === 'List' || expr.kind === 'Map') return false;
    // Literals are primitive by construction (string | number | boolean | null).
    // Parameters, identifiers, property accesses, function calls, and binary
    // expressions may resolve to primitives at runtime — be lenient.
    return true;
  }

  // ── Pass 10: Index DDL validity ──────────────────────────────────

  /**
   * No-op pass for index DDL statements.
   *
   * All structural invariants (non-empty name, at least one property key,
   * no DDL+DML mixing) are already enforced by the parser via _consume /
   * _ensureAtEnd, so there is nothing left for the semantic layer to check.
   * This method exists only to satisfy the _passes pipeline interface.
   */
  private _checkIndexDdlValidity(ast: QueryAst): QueryAst {
    return ast;
  }
}
