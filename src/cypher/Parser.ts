/**
 * Hand-written recursive-descent parser for the openCypher subset.
 *
 * Consumes a flat token array from the {@link Lexer} and produces a raw
 * (semantically unchecked) AST defined in {@link AstNode}.
 *
 * ### Grammar (simplified)
 * ```
 * query         → matchClause [whereClause] returnClause [orderByClause] [skipClause] [limitClause]
 * matchClause   → MATCH patternPath (',' patternPath)*
 * whereClause   → WHERE expression
 * returnClause  → RETURN [DISTINCT] returnItem (',' returnItem)*
 * returnItem    → expression [AS IDENT]
 * orderByClause → ORDER BY orderByItem (',' orderByItem)*
 * orderByItem   → expression [ASC | DESC]
 * skipClause    → SKIP expression
 * limitClause   → LIMIT expression
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
  WhereClause,
  HavingClause,
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
  public parse(): QueryAst {
    const match = this._parseMatchClause();
    const where = this._check(TokenKind.WHERE) ? this._parseWhereClause() : undefined;
    const ret = this._parseReturnClause();
    const having = this._check(TokenKind.HAVING) ? this._parseHavingClause() : undefined;
    const orderBy = this._check(TokenKind.ORDER) ? this._parseOrderByClause() : undefined;
    const skip = this._check(TokenKind.SKIP) ? this._parseSkipClause() : undefined;
    const limit = this._check(TokenKind.LIMIT) ? this._parseLimitClause() : undefined;

    // Ensure no trailing tokens beyond the supported clauses.
    if (!this._isAtEnd()) {
      const token = this._peek();
      throw new CypherSyntaxError(
        `Unexpected token '${token.value}' after query clauses`,
        token.line,
        token.col,
      );
    }

    return {
      kind: 'Query',
      match,
      where,
      return: ret,
      having,
      orderBy,
      skip,
      limit,
    };
  }

  // ── Clause parsers ──────────────────────────────────────────────

  /** MATCH patternPath (',' patternPath)* */
  private _parseMatchClause(): MatchClause {
    this._consume(TokenKind.MATCH, "Expected 'MATCH'");
    const patterns: PatternPath[] = [this._parsePatternPath()];

    while (this._check(TokenKind.COMMA)) {
      this._advance();
      patterns.push(this._parsePatternPath());
    }

    return { kind: 'Match', patterns };
  }

  /** WHERE expression */
  private _parseWhereClause(): WhereClause {
    this._consume(TokenKind.WHERE, "Expected 'WHERE'");
    const expression = this._parseExpression();
    return { kind: 'Where', expression };
  }

  /** HAVING expression */
  private _parseHavingClause(): HavingClause {
    this._consume(TokenKind.HAVING, "Expected 'HAVING'");
    const expression = this._parseExpression();
    return { kind: 'Having', expression };
  }

  /** RETURN [DISTINCT] returnItem (',' returnItem)* */
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

  // ── Pattern parsers ─────────────────────────────────────────────

  /**
   * patternPath → nodePattern (edgePattern nodePattern)*
   *
   * A path always starts and ends with a node. Edges alternate between nodes.
   */
  private _parsePatternPath(): PatternPath {
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

      case TokenKind.IDENT: {
        this._advance();

        // Check for function call: ident(...)
        if (this._check(TokenKind.LPAREN)) {
          return this._parseFunctionCall(token.value);
        }

        let expr: Expression = { kind: 'Identifier', name: token.value };

        // Chained property access: ident.prop1.prop2
        while (this._check(TokenKind.DOT)) {
          this._advance();
          const prop = this._consume(TokenKind.IDENT, 'Expected property name after .');
          expr = { kind: 'PropertyAccess', object: expr, property: prop.value };
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

      // List literal [expr, expr, ...]
      case TokenKind.LBRACKET: {
        this._advance();
        const elements: Expression[] = [];

        if (!this._check(TokenKind.RBRACKET)) {
          do {
            elements.push(this._parseExpression());
          } while (this._check(TokenKind.COMMA) && this._advance());
        }

        this._consume(TokenKind.RBRACKET, "Expected ']'");
        return { kind: 'List', elements };
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

    // Attach distinct metadata for downstream phases (Planner/Semantic).
    // The FunctionCallExpr type doesn't declare 'distinct' yet, so we
    // attach it as an extra property for later use.
    const result: FunctionCallExpr = {
      kind: 'FunctionCall',
      name: name.toUpperCase(),
      args,
    };
    if (distinct) {
      (result as any).distinct = true;
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
