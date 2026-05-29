/**
 * Hand-written recursive-descent parser for the openCypher subset.
 *
 * Consumes a flat token array from the {@link Lexer} and produces a raw
 * (semantically unchecked) AST defined in {@link AstNode}.
 *
 * ### Grammar (simplified)
 * ```
 * query          → matchClause? [whereClause] [createClause] [setClause] [deleteClause]
 *                  [removeClause] returnClause [orderByClause] [skipClause] [limitClause]
 * matchClause    → MATCH patternPath (',' patternPath)*
 * createClause   → CREATE patternPath (',' patternPath)*
 * setClause      → SET setItem (',' setItem)*
 * setItem        → IDENT '.' IDENT '=' expression
 * deleteClause   → [DETACH] DELETE IDENT (',' IDENT)*
 * removeClause   → REMOVE removeItem (',' removeItem)*
 * removeItem     → IDENT '.' IDENT
 * whereClause    → WHERE expression
 * returnClause   → RETURN [DISTINCT] returnItem (',' returnItem)*
 * returnItem     → expression [AS IDENT]
 * orderByClause  → ORDER BY orderByItem (',' orderByItem)*
 * orderByItem    → expression [ASC | DESC]
 * skipClause     → SKIP expression
 * limitClause    → LIMIT expression
 * ```
 *
 * ### Operator precedence (lowest → highest)
 * | Level | Operator(s)            | Associativity |
 * |------:|------------------------|---------------|
 * |     1 | OR                     | left          |
 * |     2 | AND                    | left          |
 * |     3 | NOT                    | prefix        |
 * |     4 | =, <>, <, <=, >, >=    | left          |
 * |     5 | IN, IS NULL, IS NOT NULL | postfix     |
 * |     6 | +, -                   | left          |
 * |     7 | *, /                   | left          |
 * |     8 | unary -                | prefix        |
 * |     9 | . (property access), function call | left |
 * ```
 *
 * ### Error handling
 * The parser does **not** attempt error recovery. The first syntax error
 * throws {@link CypherSyntaxError} immediately.
 *
 * @module cypher/Parser
 */

import { Token, TokenKind } from './Token';
import { CypherSyntaxError } from './errors';
import {
  QueryAst,
  MatchClause,
  CreateClause,
  SetClause,
  SetItem,
  DeleteClause,
  RemoveClause,
  RemoveItem,
  MergeClause,
  MergeAction,
  CreateIndexClause,
  DropIndexClause,
  ShowIndexesClause,
  WhereClause,
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
  NodePattern,
  EdgePattern,
  Expression,
  BinaryExpr,
  UnaryExpr,
  PropertyMap,
  PropertyValue,
  LiteralExpr,
  ParameterRef,
  IdentifierExpr,
  PropertyAccessExpr,
  InExpr,
  IsNullExpr,
  ListExpr,
  FunctionCallExpr,
} from './ast/AstNode';

// ── Precedence table for Pratt expression parsing ─────────────────

/**
 * Precedence levels for binary/ternary operators, used by the Pratt parser.
 * Higher number = tighter binding.
 */
const enum Prec {
  OR = 1,
  AND = 2,
  COMPARISON = 4,
  ADD = 6,
  MUL = 7,
}

/**
 * Mapping from token kind to binary operator precedence level.
 * Only tokens that can appear as binary operators are listed.
 */
const BINARY_PREC: Partial<Record<TokenKind, Prec>> = {
  [TokenKind.OR]: Prec.OR,
  [TokenKind.AND]: Prec.AND,
  [TokenKind.EQ]: Prec.COMPARISON,
  [TokenKind.NEQ]: Prec.COMPARISON,
  [TokenKind.REGEX_MATCH]: Prec.COMPARISON,
  [TokenKind.LT]: Prec.COMPARISON,
  [TokenKind.LTE]: Prec.COMPARISON,
  [TokenKind.GT]: Prec.COMPARISON,
  [TokenKind.GTE]: Prec.COMPARISON,
  [TokenKind.PLUS]: Prec.ADD,
  [TokenKind.MINUS]: Prec.ADD,
  [TokenKind.STAR]: Prec.MUL,
  [TokenKind.SLASH]: Prec.MUL,
};

// ── Parser ────────────────────────────────────────────────────────

/**
 * Recursive-descent parser for Cypher queries.
 *
 * Usage:
 * ```typescript
 * const tokens = new Lexer("MATCH (n) RETURN n").tokenise();
 * const ast = new Parser(tokens).parse();
 * ```
 */
export class Parser {
  private readonly _tokens: Token[];
  private _pos: number = 0;

  constructor(tokens: Token[]) {
    this._tokens = tokens;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Parse the full token stream into a {@link QueryAst}.
   *
   * @returns The root AST node.
   * @throws {CypherSyntaxError} on any syntax violation.
   */
  public parse(): import('./ast/AstNode').Statement {
    const firstQuery = this._parseSingleQuery();

    if (this._check(TokenKind.UNION)) {
      const queries = [firstQuery];
      const all: boolean[] = [];

      while (this._check(TokenKind.UNION)) {
        this._advance();
        if (this._check(TokenKind.ALL)) {
          this._advance();
          all.push(true);
        } else {
          all.push(false);
        }
        queries.push(this._parseSingleQuery());
      }

      const unionAst: import('./ast/AstNode').UnionAst = {
        kind: 'Union',
        queries,
        all,
      };

      // Ensure no intermediate query has ORDER BY, SKIP, or LIMIT
      for (let i = 0; i < queries.length - 1; i++) {
        if (queries[i].orderBy || queries[i].skip || queries[i].limit) {
          throw new CypherSyntaxError(
            `ORDER BY, SKIP and LIMIT are only allowed at the end of a UNION query`,
            1,
            1
          );
        }
      }

      // Extract trailing clauses from the final query to apply to the union as a whole
      const finalQuery = queries[queries.length - 1];
      if (finalQuery.orderBy) {
        unionAst.orderBy = finalQuery.orderBy;
        finalQuery.orderBy = undefined;
      }
      if (finalQuery.skip) {
        unionAst.skip = finalQuery.skip;
        finalQuery.skip = undefined;
      }
      if (finalQuery.limit) {
        unionAst.limit = finalQuery.limit;
        finalQuery.limit = undefined;
      }

      if (!this._isAtEnd()) {
        const token = this._peek();
        throw new CypherSyntaxError(
          `Unexpected token '${token.value}' after query clauses`,
          token.line,
          token.col,
        );
      }
      return unionAst;
    }

    if (!this._isAtEnd()) {
      const token = this._peek();
      throw new CypherSyntaxError(
        `Unexpected token '${token.value}' after query clauses`,
        token.line,
        token.col,
      );
    }
    return firstQuery;
  }

  private _parseSingleQuery(): QueryAst {
    // ── DDL: CREATE INDEX … ──────────────────────────────────────
    if (this._check(TokenKind.CREATE) && this._peek(1)?.kind === TokenKind.INDEX) {
      return this._parseCreateIndex();
    }
    // ── DDL: DROP INDEX … ────────────────────────────────────────
    if (this._check(TokenKind.DROP) && this._peek(1)?.kind === TokenKind.INDEX) {
      return this._parseDropIndex();
    }
    // ── DDL: SHOW INDEXES ────────────────────────────────────────
    if (this._check(TokenKind.SHOW) && (this._peek(1)?.kind === TokenKind.INDEX || (this._peek(1)?.kind === TokenKind.IDENT && this._peek(1)?.value.toLowerCase() === 'indexes'))) {
      return this._parseShowIndexes();
    }
    const segments: import('./ast/AstNode').QuerySegment[] = [];

    while (!this._isAtEnd() && !this._check(TokenKind.UNION)) {
      // Parse a sequence of MATCH / OPTIONAL MATCH clauses (each with embedded WHERE).
      const matches = this._parseMatchClauses();

      // Write clauses (each optional, in positional order).
      // If CREATE is followed by INDEX, this is DDL — skip and let _ensureAtEnd reject the hybrid query.
      const create = this._check(TokenKind.CREATE) && this._peek(1)?.kind !== TokenKind.INDEX
        ? this._parseCreateClause()
        : undefined;

      const merge: MergeClause[] = [];
      while (this._check(TokenKind.MERGE)) {
        merge.push(this._parseMergeClause());
      }

      const set = this._check(TokenKind.SET) ? this._parseSetClause() : undefined;
      const del = this._check(TokenKind.DELETE) || this._check(TokenKind.DETACH)
        ? this._parseDeleteClause()
        : undefined;
      const remove = this._check(TokenKind.REMOVE) ? this._parseRemoveClause() : undefined;

      if (this._check(TokenKind.WITH)) {
        segments.push({
          kind: 'QuerySegment',
          matches,
          create,
          merge: merge.length > 0 ? merge : undefined,
          set,
          delete: del,
          remove,
          with: this._parseWithClause(),
        });
      } else {
        const ret: ReturnClause = this._check(TokenKind.RETURN)
          ? this._parseReturnClause()
          : { kind: 'Return', distinct: false, items: [] };
        
        const orderBy = this._check(TokenKind.ORDER) ? this._parseOrderByClause() : undefined;
        const skip = this._check(TokenKind.SKIP) ? this._parseSkipClause() : undefined;
        const limit = this._check(TokenKind.LIMIT) ? this._parseLimitClause() : undefined;

        // Ensure no trailing tokens beyond the supported clauses unless we are inside a UNION statement
        if (!this._check(TokenKind.UNION) && !this._isAtEnd()) {
          const token = this._peek();
          throw new CypherSyntaxError(
            `Unexpected token '${token.value}' after query clauses`,
            token.line,
            token.col,
          );
        }

        const isEmpty =
          segments.length === 0 &&
          matches.length === 0 &&
          create === undefined &&
          merge.length === 0 &&
          set === undefined &&
          del === undefined &&
          remove === undefined &&
          ret.items.length === 0;

        if (isEmpty) {
          throw new CypherSyntaxError(
            "Query must contain at least one clause (MATCH, CREATE, RETURN, WITH, etc.)",
            1,
            1,
          );
        }

        return {
          kind: 'Query',
          segments,
          matches,
          create,
          merge: merge.length > 0 ? merge : undefined,
          set,
          delete: del,
          remove,
          return: ret,
          orderBy,
          skip,
          limit,
        };
      }
    }
    
    throw new CypherSyntaxError("Unexpected end of query", 1, 1);
  }

  // ── Clause parsers ──────────────────────────────────────────────

  /**
   * Parse a sequence of MATCH / OPTIONAL MATCH clauses.
   * Each MATCH clause consumes a trailing WHERE if present.
   */
  private _parseMatchClauses(): MatchClause[] {
    const matches: MatchClause[] = [];
    while (this._check(TokenKind.MATCH) || this._check(TokenKind.OPTIONAL)) {
      if (this._check(TokenKind.OPTIONAL)) {
        this._advance(); // consume OPTIONAL
        matches.push(this._parseMatchClause(true));
      } else {
        matches.push(this._parseMatchClause(false));
      }
    }
    return matches;
  }

  /** [OPTIONAL] MATCH patternPath (',' patternPath)* [WHERE expression] */
  private _parseMatchClause(optional: boolean): MatchClause {
    this._consume(TokenKind.MATCH, "Expected 'MATCH'");
    const patterns: MatchPattern[] = [this._parsePatternPath()];

    while (this._check(TokenKind.COMMA)) {
      this._advance();
      patterns.push(this._parsePatternPath());
    }

    // WHERE is a sub-clause of MATCH per OpenCypher spec.
    const where = this._check(TokenKind.WHERE) ? this._parseWhereClause() : undefined;

    return { kind: 'Match', optional, patterns, where };
  }

  /** WHERE expression */
  private _parseWhereClause(): WhereClause {
    this._consume(TokenKind.WHERE, "Expected 'WHERE'");
    const expression = this._parseExpression();
    return { kind: 'Where', expression };
  }



  /** WITH [DISTINCT] ('*' | returnItem) (',' returnItem)* [ORDER BY ...] [SKIP ...] [LIMIT ...] [WHERE ...] */
  private _parseWithClause(): import('./ast/AstNode').WithClause {
    this._consume(TokenKind.WITH, "Expected 'WITH'");
    let star = false;
    let distinct = false;
    const items: ReturnItem[] = [];

    if (this._check(TokenKind.STAR)) {
      star = true;
      this._advance();
      while (this._check(TokenKind.COMMA)) {
        this._advance();
        items.push(this._parseReturnItem());
      }
    } else {
      distinct = this._check(TokenKind.DISTINCT);
      if (distinct) this._advance();
      items.push(this._parseReturnItem());
      while (this._check(TokenKind.COMMA)) {
        this._advance();
        items.push(this._parseReturnItem());
      }
    }

    const where = this._check(TokenKind.WHERE) ? this._parseWhereClause() : undefined;
    const orderBy = this._check(TokenKind.ORDER) ? this._parseOrderByClause() : undefined;
    const skip = this._check(TokenKind.SKIP) ? this._parseSkipClause() : undefined;
    const limit = this._check(TokenKind.LIMIT) ? this._parseLimitClause() : undefined;

    return {
      kind: 'With',
      star,
      distinct,
      items,
      where,
      orderBy,
      skip,
      limit,
    };
  }

  private _parseReturnClause(): ReturnClause {
    this._consume(TokenKind.RETURN, "Expected 'RETURN'");

    const distinct = this._check(TokenKind.DISTINCT);
    if (distinct) this._advance();

    const items: ReturnItem[] = [this._parseReturnItem()];

    while (this._check(TokenKind.COMMA)) {
      this._advance();
      items.push(this._parseReturnItem());
    }

    return { kind: 'Return', distinct, items };
  }

  /** expression [AS IDENT] */
  private _parseReturnItem(): ReturnItem {
    const expression = this._parseExpression();
    let alias: string | undefined;

    if (this._check(TokenKind.AS)) {
      this._advance();
      alias = this._consume(TokenKind.IDENT, "Expected alias name after 'AS'").value;
    }

    return { kind: 'ReturnItem', expression, alias };
  }

  /** ORDER BY orderByItem (',' orderByItem)* */
  private _parseOrderByClause(): OrderByClause {
    this._consume(TokenKind.ORDER, "Expected 'ORDER'");
    this._consume(TokenKind.BY, "Expected 'BY' after 'ORDER'");

    const items: OrderByItem[] = [this._parseOrderByItem()];

    while (this._check(TokenKind.COMMA)) {
      this._advance();
      items.push(this._parseOrderByItem());
    }

    return { kind: 'OrderBy', items };
  }

  /** expression [ASC | DESC] */
  private _parseOrderByItem(): OrderByItem {
    const expression = this._parseExpression();
    let direction: 'ASC' | 'DESC' = 'ASC';

    if (this._check(TokenKind.ASC)) {
      this._advance();
      direction = 'ASC';
    } else if (this._check(TokenKind.DESC)) {
      this._advance();
      direction = 'DESC';
    }

    return { kind: 'OrderByItem', expression, direction };
  }

  /** SKIP expression */
  private _parseSkipClause(): SkipClause {
    this._consume(TokenKind.SKIP, "Expected 'SKIP'");
    const expression = this._parseExpression();
    return { kind: 'Skip', expression };
  }

  /** LIMIT expression */
  private _parseLimitClause(): LimitClause {
    this._consume(TokenKind.LIMIT, "Expected 'LIMIT'");
    const expression = this._parseExpression();
    return { kind: 'Limit', expression };
  }

  /** CREATE patternPath (',' patternPath)* */
  private _parseCreateClause(): CreateClause {
    this._consume(TokenKind.CREATE, "Expected 'CREATE'");
    const patterns: MatchPattern[] = [this._parsePatternPath()];
    while (this._check(TokenKind.COMMA)) {
      this._advance();
      patterns.push(this._parsePatternPath());
    }
    return { kind: 'Create', patterns };
  }

  /** MERGE patternPath (ON CREATE SET ...)* (ON MATCH SET ...)* */
  private _parseMergeClause(): MergeClause {
    this._consume(TokenKind.MERGE, "Expected 'MERGE'");
    const pattern = this._parsePatternPath();
    const actions: MergeAction[] = [];

    while (this._check(TokenKind.ON)) {
      this._advance(); // consume ON
      let onMatch = false;
      if (this._check(TokenKind.MATCH)) {
        onMatch = true;
        this._advance(); // consume MATCH
      } else if (this._check(TokenKind.CREATE)) {
        onMatch = false;
        this._advance(); // consume CREATE
      } else {
        throw new CypherSyntaxError(
          "Expected 'MATCH' or 'CREATE' after 'ON'",
          this._peek().line,
          this._peek().col
        );
      }

      this._consume(TokenKind.SET, "Expected 'SET' after 'ON " + (onMatch ? "MATCH" : "CREATE") + "'");

      const items: SetItem[] = [this._parseSetItem()];
      while (this._check(TokenKind.COMMA)) {
        this._advance();
        items.push(this._parseSetItem());
      }
      actions.push({ kind: 'MergeAction', onMatch, items });
    }

    return { kind: 'Merge', pattern, actions };
  }

  /** DETACH? DELETE IDENT (',' IDENT)* */
  private _parseDeleteClause(): DeleteClause {
    let detach = false;
    if (this._check(TokenKind.DETACH)) {
      detach = true;
      this._advance();
    }
    this._consume(TokenKind.DELETE, "Expected 'DELETE'");
    const variables: string[] = [this._consume(TokenKind.IDENT, 'Expected variable name').value];
    while (this._check(TokenKind.COMMA)) {
      this._advance();
      variables.push(this._consume(TokenKind.IDENT, 'Expected variable name').value);
    }
    return { kind: 'Delete', detach, variables };
  }

  /** SET setItem (',' setItem)* */
  private _parseSetClause(): SetClause {
    this._consume(TokenKind.SET, "Expected 'SET'");
    const items: SetItem[] = [this._parseSetItem()];
    while (this._check(TokenKind.COMMA)) {
      this._advance();
      items.push(this._parseSetItem());
    }
    return { kind: 'Set', items };
  }

  /** SET item: IDENT '.' IDENT '=' expression | IDENT '=' expression | IDENT '+=' expression */
  private _parseSetItem(): SetItem {
    const varToken = this._consume(TokenKind.IDENT, 'Expected variable name in SET');
    const variable: IdentifierExpr = { kind: 'Identifier', name: varToken.value };

    if (this._check(TokenKind.DOT)) {
      // IDENT '.' IDENT '=' expr
      this._advance();
      const propToken = this._consume(TokenKind.IDENT, 'Expected property name');
      this._consume(TokenKind.EQ, "Expected '=' in SET assignment");
      const value = this._parseExpression();
      return { kind: 'SetItem', variable, property: propToken.value, operator: '=', value };
    } else if (this._check(TokenKind.EQ)) {
      // IDENT '=' expr (replace all properties)
      this._advance();
      const value = this._parseExpression();
      return { kind: 'SetItem', variable, operator: '=', value };
    } else if (this._check(TokenKind.PLUS_EQ)) {
      // IDENT '+=' expr (mutate properties)
      this._advance();
      const value = this._parseExpression();
      return { kind: 'SetItem', variable, operator: '+=', value };
    } else {
      const token = this._peek();
      throw new CypherSyntaxError(
        `Expected '.', '=', or '+=' after variable name in SET, found '${token.value}'`,
        token.line,
        token.col
      );
    }
  }

  /** REMOVE removeItem (',' removeItem)* */
  private _parseRemoveClause(): RemoveClause {
    this._consume(TokenKind.REMOVE, "Expected 'REMOVE'");
    const items: RemoveItem[] = [this._parseRemoveItem()];
    while (this._check(TokenKind.COMMA)) {
      this._advance();
      items.push(this._parseRemoveItem());
    }
    return { kind: 'Remove', items };
  }

  /** REMOVE item: IDENT '.' IDENT */
  private _parseRemoveItem(): RemoveItem {
    const varToken = this._consume(TokenKind.IDENT, 'Expected variable name in REMOVE');
    const variable: IdentifierExpr = { kind: 'Identifier', name: varToken.value };
    this._consume(TokenKind.DOT, "Expected '.' in REMOVE property reference");
    const propToken = this._consume(TokenKind.IDENT, 'Expected property name');
    return { kind: 'RemoveItem', variable, property: propToken.value };
  }

  /** CREATE INDEX index_name FOR pattern ON (var.prop [, var.prop]*) */
  private _parseCreateIndex(): QueryAst {
    this._consume(TokenKind.CREATE, "Expected 'CREATE'");
    this._consume(TokenKind.INDEX, "Expected 'INDEX' after 'CREATE'");
    let name: string = '';
    if (this._check(TokenKind.STRING)) {
      name = this._consume(TokenKind.STRING, "Expected index name after 'INDEX'").value;
    } else {
      const nameToken = this._consume(TokenKind.IDENT, "Expected index name after 'INDEX'");
      name = nameToken.value;
    }

    if (name === '') {
      const token = this._peek();
      throw new CypherSyntaxError(
        "Expected index name after 'INDEX'",
        token.line,
        token.col,
      );
    }

    // FOR
    this._consume(TokenKind.FOR, "Expected 'FOR' after index name");

    let variable: string;
    let target: 'node' | 'edge';
    let labelOrType: string;

    // Determine target from pattern shape:
    if (this._check(TokenKind.LPAREN) && this._peek(1)?.kind === TokenKind.RPAREN) {
      // edge pattern: ()-[r:TYPE]-()
      this._consume(TokenKind.LPAREN, "Expected '('"); // '('
      this._consume(TokenKind.RPAREN, "Expected ')'"); // ')'
      // optional dash
      if (this._check(TokenKind.MINUS)) this._advance();
      this._consume(TokenKind.LBRACKET, "Expected '[' for edge pattern");
      variable = this._consume(TokenKind.IDENT, "Expected variable name in edge pattern").value;
      this._consume(TokenKind.COLON, "Expected ':' after edge variable");
      labelOrType = this._consume(TokenKind.IDENT, "Expected edge type name").value;
      this._consume(TokenKind.RBRACKET, "Expected ']'");
      // optional dash
      if (this._check(TokenKind.MINUS)) this._advance();
      this._consume(TokenKind.LPAREN, "Expected '('"); // '('
      this._consume(TokenKind.RPAREN, "Expected ')'"); // ')'
      target = 'edge';
    } else {
      // node pattern: (var:Label)
      this._consume(TokenKind.LPAREN, "Expected '(' for node pattern");
      variable = this._consume(TokenKind.IDENT, "Expected variable name in FOR pattern").value;
      this._consume(TokenKind.COLON, "Expected ':' after variable");
      labelOrType = this._consume(TokenKind.IDENT, "Expected label name").value;
      this._consume(TokenKind.RPAREN, "Expected ')'");
      target = 'node';
    }

    // ON (var.prop1, var.prop2, …)
    this._consume(TokenKind.ON, "Expected 'ON' after FOR pattern");
    this._consume(TokenKind.LPAREN, "Expected '(' after 'ON'");

    const propertyKeys: string[] = [];
    do {
      const v = this._consume(TokenKind.IDENT, "Expected variable in ON property list").value;
      if (v !== variable) {
        const tok = this._peek(-1);
        throw new CypherSyntaxError(
          `ON property variable '${v}' must match FOR variable '${variable}'`,
          tok.line,
          tok.col,
        );
      }
      this._consume(TokenKind.DOT, "Expected '.' after variable in ON property list");
      const prop = this._consume(TokenKind.IDENT, "Expected property name").value;
      propertyKeys.push(prop);
    } while (this._check(TokenKind.COMMA) && this._advance());
    this._consume(TokenKind.RPAREN, "Expected ')' after ON property list");

    this._ensureAtEnd('CREATE INDEX');

    return {
      kind: 'Query',
      segments: [],
      matches: [],
      createIndex: {
        kind: 'CreateIndex',
        name,
        variable,
        target,
        labelOrType,
        propertyKeys,
      },
      return: { kind: 'Return', distinct: false, items: [] },
    };
  }

  /** DROP INDEX index_name */
  private _parseDropIndex(): QueryAst {
    this._consume(TokenKind.DROP, "Expected 'DROP'");
    this._consume(TokenKind.INDEX, "Expected 'INDEX' after 'DROP'");
    let name: string = '';
    if (this._check(TokenKind.STRING)) {
      name = this._consume(TokenKind.STRING, "Expected index name after 'INDEX'").value;
    } else {
      name = this._consume(TokenKind.IDENT, "Expected index name after 'INDEX'").value;
    }

    if (name === '') {
      throw new CypherSyntaxError(
        "Expected index name after 'INDEX'",
        this._peek().line,
        this._peek().col,
      );
    }

    this._ensureAtEnd('DROP INDEX');

    return {
      kind: 'Query',
      segments: [],
      matches: [],
      dropIndex: {
        kind: 'DropIndex',
        name: name,
      },
      return: { kind: 'Return', distinct: false, items: [] },
    };
  }

  /** SHOW INDEXES */
  private _parseShowIndexes(): QueryAst {
    this._consume(TokenKind.SHOW, "Expected 'SHOW'");
    // 'INDEXES' tokenizes as IDENT if not a keyword; consume it regardless
    if (this._check(TokenKind.INDEX)) {
      this._advance();
    } else {
      const idxToken = this._consume(TokenKind.IDENT, "Expected 'INDEXES' after 'SHOW'");
      if (idxToken.value.toLowerCase() !== 'indexes') {
        throw new CypherSyntaxError(
          `Expected 'INDEXES' after 'SHOW', but found '${idxToken.value}'`,
          idxToken.line,
          idxToken.col,
        );
      }
    }
    this._ensureAtEnd('SHOW INDEXES');

    return {
      kind: 'Query',
      segments: [],
      matches: [],
      showIndexes: { kind: 'ShowIndexes' },
      return: {
        kind: 'Return',
        distinct: false,
        items: [
          { kind: 'ReturnItem', expression: { kind: 'Identifier', name: 'name' }, alias: 'name' },
          { kind: 'ReturnItem', expression: { kind: 'Identifier', name: 'target' }, alias: 'target' },
          { kind: 'ReturnItem', expression: { kind: 'Identifier', name: 'propertyKeys' }, alias: 'propertyKeys' },
        ],
      },
    };
  }

  // ── Pattern parsers ─────────────────────────────────────────────

  /**
   * Parses either a named path (`path = (pattern)`) or a plain pattern path.
   *
   * namedPath → IDENT EQ patternPath
   * patternPath → nodePattern (edgePattern nodePattern)*
   *
   * A path always starts and ends with a node. Edges alternate between nodes.
   */
  private _parsePatternPath(): PatternPath | NamedPath {
    // Check for named path: IDENT = (pattern)
    if (this._check(TokenKind.IDENT) && this._peek(1).kind === TokenKind.EQ && this._peek(2).kind === TokenKind.LPAREN) {
      const name = this._advance().value; // consume IDENT
      this._advance(); // consume EQ
      const pattern = this._parsePlainPatternPath();
      return { kind: 'NamedPath', name, pattern };
    }

    // Otherwise, parse a plain pattern path
    return this._parsePlainPatternPath();
  }

  /**
   * Parse a plain pattern path (without named path syntax).
   * Internal helper for use within named paths.
   */
  private _parsePlainPatternPath(): PatternPath {
    const segments: PatternSegment[] = [this._parseNodePattern()];

    // Keep consuming edge+node pairs while the next token starts an edge.
    while (this._isEdgeStart()) {
      segments.push(this._parseEdgePattern());
      segments.push(this._parseNodePattern());
    }

    return { kind: 'PatternPath', segments };
  }

  /** '(' [IDENT] [COLON IDENT ('|' IDENT)*] [propertyMap] ')' */
  private _parseNodePattern(): NodePattern {
    this._consume(TokenKind.LPAREN, "Expected '(' to start node pattern");

    // Optional variable.
    let variable: string | undefined;
    if (this._check(TokenKind.IDENT)) {
      variable = this._advance().value;
    }

    // Optional label(s): :Label1|Label2
    const labels: string[] = [];
    if (this._check(TokenKind.COLON)) {
      this._advance();
      labels.push(this._consume(TokenKind.IDENT, 'Expected label name after :').value);

      while (this._check(TokenKind.PIPE)) {
        this._advance();
        labels.push(this._consume(TokenKind.IDENT, 'Expected label name after |').value);
      }
    }

    // Optional inline properties.
    const properties = this._check(TokenKind.LBRACE)
      ? this._parsePropertyMap()
      : {};

    this._consume(TokenKind.RPAREN, "Expected ')' to close node pattern");

    return { kind: 'NodePattern', variable, labels, properties };
  }

  /**
   * Check if the current token starts an edge pattern.
   *
   * Edge patterns begin with: `<--`, `<-`, `-`, `-->`, `->`
   * (The dash or arrow is the indicator.)
   */
  private _isEdgeStart(): boolean {
    return (
      this._check(TokenKind.MINUS) ||
      this._check(TokenKind.ARROW_LEFT) ||
      this._check(TokenKind.ARROW_RIGHT)
    );
  }

  /**
   * edgePattern → ('<-' | '-')? '[' [IDENT] [COLON IDENT ('|' IDENT)*] [propertyMap] [STAR [INTEGER] ['..' [INTEGER]]] ']' ('->' | '-')?
   *
   * Direction is determined by the surrounding arrows/dashes.
   * - `-[r:KNOWS]->`  → direction 'out'
   * - `<-[r:KNOWS]-`  → direction 'in'
   * - `-[r:KNOWS]-`   → direction 'out' (default when no arrows)
   */
  private _parseEdgePattern(): EdgePattern {
    let direction: 'out' | 'in' = 'out';

    // Leading direction indicator.
    if (this._check(TokenKind.ARROW_LEFT)) {
      direction = 'in';
      this._advance();
    } else if (this._check(TokenKind.MINUS)) {
      this._advance();
    }

    // The bracket-enclosed body.
    this._consume(TokenKind.LBRACKET, "Expected '[' to start edge pattern");

    // Optional variable.
    let variable: string | undefined;
    if (this._check(TokenKind.IDENT)) {
      variable = this._advance().value;
    }

    // Optional type(s): :TYPE1|TYPE2
    const types: string[] = [];
    if (this._check(TokenKind.COLON)) {
      this._advance();
      types.push(this._consume(TokenKind.IDENT, 'Expected edge type after :').value);

      while (this._check(TokenKind.PIPE)) {
        this._advance();
        types.push(this._consume(TokenKind.IDENT, 'Expected edge type after |').value);
      }
    }

    // Optional inline properties.
    const properties = this._check(TokenKind.LBRACE)
      ? this._parsePropertyMap()
      : {};

    // Optional variable-length quantifier: [*min..max]
    let minHops = 1;
    let maxHops = 1;

    if (this._check(TokenKind.STAR)) {
      this._advance(); // consume *

      // [*]
      // [*2]
      // [*2..5]
      // [*..5]
      // [*2..]
      if (this._check(TokenKind.INTEGER)) {
        minHops = parseInt(this._advance().value, 10);
        maxHops = minHops;
      } else {
        minHops = 1;
        maxHops = Infinity;
      }

      if (this._check(TokenKind.DOT) && this._peek(1)?.value === '.') {
        // consume both dots of '..'
        this._advance(); // first dot
        this._advance(); // second dot

        if (this._check(TokenKind.INTEGER)) {
          maxHops = parseInt(this._advance().value, 10);
        } else {
          maxHops = Infinity;
        }
      }
    }

    this._consume(TokenKind.RBRACKET, "Expected ']' to close edge pattern");

    // Trailing direction indicator.
    if (this._check(TokenKind.ARROW_RIGHT)) {
      direction = 'out';
      this._advance();
    } else if (this._check(TokenKind.MINUS)) {
      this._advance();
    }

    return {
      kind: 'EdgePattern',
      variable,
      types,
      properties,
      direction,
      minHops,
      maxHops,
    };
  }

  /** LBRACE (IDENT COLON value (COMMA IDENT COLON value)*)? RBRACE */
  private _parsePropertyMap(): PropertyMap {
    this._consume(TokenKind.LBRACE, "Expected '{'");

    const props: PropertyMap = {};

    if (!this._check(TokenKind.RBRACE)) {
      do {
        const key = this._consume(TokenKind.IDENT, 'Expected property key').value;
        this._consume(TokenKind.COLON, "Expected ':' after property key");
        props[key] = this._parsePropertyValue();
      } while (this._check(TokenKind.COMMA) && this._advance());
    }

    this._consume(TokenKind.RBRACE, "Expected '}'");
    return props;
  }

  /**
   * Parse a value allowed inside a property map.
   * These are limited to literals and parameters.
   */
  private _parsePropertyValue(): PropertyValue {
    const token = this._peek();

    switch (token.kind) {
      case TokenKind.STRING:
        this._advance();
        return token.value;
      case TokenKind.INTEGER:
        this._advance();
        return parseInt(token.value, 10);
      case TokenKind.FLOAT:
        this._advance();
        return parseFloat(token.value);
      case TokenKind.BOOLEAN:
        this._advance();
        return token.value.toLowerCase() === 'true';
      case TokenKind.NULL:
        this._advance();
        return null;
      case TokenKind.PARAM:
        this._advance();
        return { kind: 'Parameter', name: token.value };
      case TokenKind.MINUS:
        // Handle negative numbers.
        if (this._peek(1)?.kind === TokenKind.INTEGER) {
          this._advance(); // consume minus
          const num = this._advance();
          return -parseInt(num.value, 10);
        }
        if (this._peek(1)?.kind === TokenKind.FLOAT) {
          this._advance(); // consume minus
          const num = this._advance();
          return -parseFloat(num.value);
        }
        throw new CypherSyntaxError(
          `Invalid property value: '${token.value}'`,
          token.line,
          token.col,
        );
      default:
        throw new CypherSyntaxError(
          `Invalid property value: '${token.value}'`,
          token.line,
          token.col,
        );
    }
  }

  // ── Expression parser (Pratt) ───────────────────────────────────

  /**
   * Entry point for expression parsing.
   *
   * Uses a Pratt-style precedence-climbing algorithm for binary operators.
   */
  private _parseExpression(minPrec: number = 0): Expression {
    let left = this._parsePrefix();

    while (true) {
      const token = this._peek();

      // Check for postfix operators first (IS NULL, IN, NOT IN).
      if (token.kind === TokenKind.IS) {
        left = this._parseIsNull(left);
        continue;
      }
      // NOT IN — handled as a combined postfix to avoid the ambiguity
      // of NOT being both a prefix and part of the IN predicate.
      if (token.kind === TokenKind.NOT && this._peek(1)?.kind === TokenKind.IN) {
        this._advance(); // consume NOT
        this._advance(); // consume IN
        const list = this._parseExpression(Prec.COMPARISON as Prec);
        left = { kind: 'In', expression: left, list, not: true } as InExpr;
        continue;
      }
      if (token.kind === TokenKind.IN) {
        this._advance();
        const list = this._parseExpression(Prec.COMPARISON as Prec);
        left = { kind: 'In', expression: left, list, not: false } as InExpr;
        continue;
      }

      // Check for binary operators.
      const prec = BINARY_PREC[token.kind];
      if (prec === undefined || prec < minPrec) break;

      this._advance();
      const right = this._parseExpression(
        // Left-associative: increase min precedence by 1.
        prec + 1,
      );
      left = this._makeBinary(left, token.kind, right);
    }

    return left;
  }

  /** Parse a prefix expression (unary NOT, unary -, or primary). */
  private _parsePrefix(): Expression {
    const token = this._peek();

    // NOT expression
    if (token.kind === TokenKind.NOT) {
      this._advance();
      // NOT binds tighter than comparison but looser than property access.
      // Use _parseExpression with comparison-level precedence so NOT
      // captures the full comparison (e.g. NOT p.name = 'Bob').
      const operand = this._parseExpression(Prec.COMPARISON);
      return { kind: 'Unary', op: 'NOT', operand } as UnaryExpr;
    }

    // Unary minus
    if (token.kind === TokenKind.MINUS) {
      // Only treat as unary minus if not followed by a number (numbers are handled in primary).
      this._advance();
      const operand = this._parsePrefix();
      return { kind: 'Unary', op: '-', operand } as UnaryExpr;
    }

    return this._parsePrimary();
  }

  /** Parse a primary expression (literal, identifier, parameter, parenthesised, function call). */
  private _parsePrimary(): Expression {
    const token = this._peek();

    switch (token.kind) {
      case TokenKind.STRING:
        this._advance();
        return { kind: 'Literal', value: token.value };

      case TokenKind.INTEGER:
        this._advance();
        return { kind: 'Literal', value: parseInt(token.value, 10) };

      case TokenKind.FLOAT:
        this._advance();
        return { kind: 'Literal', value: parseFloat(token.value) };

      case TokenKind.BOOLEAN:
        this._advance();
        return { kind: 'Literal', value: token.value.toLowerCase() === 'true' };

      case TokenKind.NULL:
        this._advance();
        return { kind: 'Literal', value: null };

      case TokenKind.PARAM:
        this._advance();
        return { kind: 'Parameter', name: token.value };

      case TokenKind.EXISTS: {
        this._advance();
        this._consume(TokenKind.LBRACE, "Expected '{' after EXISTS");
        
        let match: import('./ast/AstNode').MatchClause;
        if (this._check(TokenKind.MATCH)) {
            match = this._parseMatchClause(false);
        } else {
            const pattern = this._parsePatternPath();
            let where: import('./ast/AstNode').WhereClause | undefined;
            if (this._check(TokenKind.WHERE)) {
                where = this._parseWhereClause();
            }
            match = { kind: 'Match', optional: false, patterns: [pattern], where };
        }
        this._consume(TokenKind.RBRACE, "Expected '}' after EXISTS subquery");
        return { kind: 'ExistsSubquery', match };
      }

      case TokenKind.IDENT: {
        this._advance();

        // Check for function call: ident(...)
        if (this._check(TokenKind.LPAREN)) {
          return this._parseFunctionCall(token.value);
        }

        let expr: Expression = { kind: 'Identifier', name: token.value };

        // Chained property access: ident.prop1.prop2
        // The property name may be a reserved keyword (e.g. `order`
        // in `ch.order`).  Use _advance() instead of _consume(IDENT)
        // so keyword tokens are accepted as property identifiers.
        while (this._check(TokenKind.DOT)) {
          this._advance();
          const prop = this._advance().value;
          expr = { kind: 'PropertyAccess', object: expr, property: prop };
        }

        return expr;
      }

      // Aggregate function tokens (COUNT, SUM, AVG, MIN, MAX, COLLECT)
      case TokenKind.COUNT:
      case TokenKind.SUM:
      case TokenKind.AVG:
      case TokenKind.MIN:
      case TokenKind.MAX:
      case TokenKind.COLLECT: {
        const name = token.kind;
        this._advance();
        return this._parseFunctionCall(name);
      }

      case TokenKind.LPAREN: {
        this._advance(); // consume (
        const expr = this._parseExpression();
        this._consume(TokenKind.RPAREN, "Expected ')'");
        return expr;
      }

      // List literal [expr, expr, ...] or List Comprehension [var IN list WHERE exp | exp]
      case TokenKind.LBRACKET: {
        this._advance();

        // Check for list comprehension: [IDENT IN ... ]
        if (this._check(TokenKind.IDENT) && this._peek(1).kind === TokenKind.IN) {
          const variable = this._advance().value; // consume IDENT
          this._advance(); // consume IN
          const list = this._parseExpression();

          let where: Expression | undefined;
          if (this._check(TokenKind.WHERE)) {
            this._advance();
            where = this._parseExpression();
          }

          let projection: Expression | undefined;
          if (this._check(TokenKind.PIPE)) {
            this._advance();
            projection = this._parseExpression();
          }

          this._consume(TokenKind.RBRACKET, "Expected ']' at the end of list comprehension");
          return { kind: 'ListComprehension', variable, list, where, projection };
        }

        // Standard list literal
        const elements: Expression[] = [];

        if (!this._check(TokenKind.RBRACKET)) {
          do {
            elements.push(this._parseExpression());
          } while (this._check(TokenKind.COMMA) && this._advance());
        }

        this._consume(TokenKind.RBRACKET, "Expected ']'");
        return { kind: 'List', elements };
      }

      // Map literal { key: expr, ... }
      case TokenKind.LBRACE: {
        this._advance();
        const props: Record<string, Expression> = {};

        if (!this._check(TokenKind.RBRACE)) {
          do {
            const key = this._consume(TokenKind.IDENT, 'Expected property key').value;
            this._consume(TokenKind.COLON, "Expected ':' after property key");
            props[key] = this._parseExpression();
          } while (this._check(TokenKind.COMMA) && this._advance());
        }

        this._consume(TokenKind.RBRACE, "Expected '}'");
        return { kind: 'Map', props };
      }

      default:
        throw new CypherSyntaxError(
          `Unexpected token '${token.value}' in expression`,
          token.line,
          token.col,
        );
    }
  }

  /**
   * Parse a function call: name(args).
   *
   * Handles aggregate functions (COUNT, SUM, etc.) as well as generic
   * identifier-based function calls.
   *
   * @param name The function name (will be uppercased).
   */
  private _parseFunctionCall(name: string): FunctionCallExpr {
    this._consume(TokenKind.LPAREN, "Expected '(' after function name");

    let distinct = false;

    // DISTINCT modifier: COUNT(DISTINCT expr), SUM(DISTINCT expr), etc.
    if (this._check(TokenKind.DISTINCT)) {
      distinct = true;
      this._advance();
    }

    let args: Expression[];

    // Handle COUNT(*) — the * is a special argument
    if (this._check(TokenKind.STAR)) {
      this._advance();
      // Represent COUNT(*) args with a sentinel value
      args = [{ kind: 'Literal', value: '*' } as unknown as Expression];
    } else if (!this._check(TokenKind.RPAREN)) {
      // Parse comma-separated argument expressions
      args = [];
      do {
        args.push(this._parseExpression());
      } while (this._check(TokenKind.COMMA) && this._advance());
    } else {
      // Zero arguments: e.g., COUNT() — semantically invalid, but parsed
      args = [];
    }

    this._consume(TokenKind.RPAREN, "Expected ')' after function arguments");

    const result: FunctionCallExpr = {
      kind: 'FunctionCall',
      name: name.toUpperCase(),
      args,
    };
    if (distinct) {
      result.distinct = true;
    }

    return result;
  }

  /** Parse `IS [NOT] NULL` postfix. */
  private _parseIsNull(expression: Expression): Expression {
    this._advance(); // consume IS
    const not = this._check(TokenKind.NOT);
    if (not) this._advance();
    this._consume(TokenKind.NULL, "Expected 'NULL' after 'IS'");
    return { kind: 'IsNull', expression, not };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /** Build a BinaryExpr from its parts. */
  private _makeBinary(left: Expression, opKind: TokenKind, right: Expression): BinaryExpr {
    const opMap: Record<string, BinaryExpr['op']> = {
      [TokenKind.OR]: 'OR',
      [TokenKind.AND]: 'AND',
      [TokenKind.EQ]: '=',
      [TokenKind.NEQ]: '<>',
      [TokenKind.REGEX_MATCH]: '=~',
      [TokenKind.LT]: '<',
      [TokenKind.LTE]: '<=',
      [TokenKind.GT]: '>',
      [TokenKind.GTE]: '>=',
      [TokenKind.PLUS]: '+',
      [TokenKind.MINUS]: '-',
      [TokenKind.STAR]: '*',
      [TokenKind.SLASH]: '/',
    };

    return {
      kind: 'Binary',
      op: opMap[opKind],
      left,
      right,
    };
  }

  // ── Token stream helpers ────────────────────────────────────────

  /** Ensure the token stream is at EOF; throws if trailing tokens exist. */
  private _ensureAtEnd(context: string): void {
    if (!this._isAtEnd()) {
      const token = this._peek();
      throw new CypherSyntaxError(
        `Unexpected token '${token.value}' after ${context}`,
        token.line,
        token.col,
      );
    }
  }

  private _isAtEnd(): boolean {
    return this._peek().kind === TokenKind.EOF;
  }

  private _peek(offset: number = 0): Token {
    const idx = this._pos + offset;
    if (idx < 0 || idx >= this._tokens.length) {
      // Return a synthetic EOF for out-of-bounds access.
      return { kind: TokenKind.EOF, value: '', line: 0, col: 0 };
    }
    return this._tokens[idx];
  }

  private _check(kind: TokenKind): boolean {
    return this._peek().kind === kind;
  }

  private _advance(): Token {
    if (!this._isAtEnd()) {
      this._pos++;
    }
    return this._tokens[this._pos - 1];
  }

  private _consume(kind: TokenKind, message: string): Token {
    if (this._check(kind)) {
      return this._advance();
    }
    const token = this._peek();
    throw new CypherSyntaxError(
      `${message}, but found '${token.value}'`,
      token.line,
      token.col,
    );
  }
}
