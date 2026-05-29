/**
 * Hand-written tokeniser for the openCypher subset supported by grafio.
 *
 * Converts a raw Cypher query string into a flat array of {@link Token}
 * objects consumed by the {@link Parser}.
 *
 * ### Tokenisation rules
 * - Keywords are **case-insensitive**.
 * - String literals accept single or double quotes with `\\n`, `\\t`, `\\\\`, `\\'`, `\\"` escapes.
 * - Parameter tokens match `$[a-zA-Z_][a-zA-Z0-9_]*`.
 * - Integer and float literals are recognised.
 * - Boolean literals (`true` / `false`) are recognised.
 * - Whitespace and `//` line comments are silently consumed.
 * - Lexer errors throw {@link CypherSyntaxError} with line/column info.
 *
 * @module cypher/Lexer
 */

import { Token, TokenKind } from './Token';
import { CypherSyntaxError } from './errors';

// ── Keyword map (case-insensitive lookup) ─────────────────────────

/**
 * Mapping from lowercase keyword strings to their {@link TokenKind}.
 * Populated once at module load.
 */
const KEYWORDS: Record<string, TokenKind> = {
  // Read keywords
  match: TokenKind.MATCH,
  where: TokenKind.WHERE,
  return: TokenKind.RETURN,
  order: TokenKind.ORDER,
  by: TokenKind.BY,
  skip: TokenKind.SKIP,
  limit: TokenKind.LIMIT,
  as: TokenKind.AS,
  distinct: TokenKind.DISTINCT,
  exists: TokenKind.EXISTS,
  in: TokenKind.IN,
  is: TokenKind.IS,
  null: TokenKind.NULL,
  not: TokenKind.NOT,
  and: TokenKind.AND,
  or: TokenKind.OR,
  asc: TokenKind.ASC,
  desc: TokenKind.DESC,
  union: TokenKind.UNION,
  all: TokenKind.ALL,
  // Future keywords
  create: TokenKind.CREATE,
  merge: TokenKind.MERGE,
  set: TokenKind.SET,
  remove: TokenKind.REMOVE,
  delete: TokenKind.DELETE,
  detach: TokenKind.DETACH,
  on: TokenKind.ON,
  count: TokenKind.COUNT,
  sum: TokenKind.SUM,
  avg: TokenKind.AVG,
  min: TokenKind.MIN,
  max: TokenKind.MAX,
  collect: TokenKind.COLLECT,
  optional: TokenKind.OPTIONAL,
  with: TokenKind.WITH,
  unwind: TokenKind.UNWIND,
  // DDL keywords
  index: TokenKind.INDEX,
  drop: TokenKind.DROP,
  for: TokenKind.FOR,
  show: TokenKind.SHOW,
  // Boolean literals
  true: TokenKind.BOOLEAN,
  false: TokenKind.BOOLEAN,
};

// ── Character classification helpers ──────────────────────────────

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

// ── Lexer ─────────────────────────────────────────────────────────

/**
 * Converts a raw Cypher query string into an array of {@link Token} objects.
 *
 * Usage:
 * ```typescript
 * const tokens = new Lexer("MATCH (n) RETURN n").tokenise();
 * ```
 */
export class Lexer {
  private readonly _source: string;
  private _pos: number = 0;
  private _line: number = 1;
  private _col: number = 1;

  constructor(source: string) {
    this._source = source;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Tokenise the entire source string.
   *
   * @returns An array of tokens ending with {@link TokenKind.EOF}.
   * @throws {CypherSyntaxError} on unrecognised characters or unterminated strings.
   */
  public tokenise(): Token[] {
    const tokens: Token[] = [];

    while (!this._isAtEnd()) {
      // Skip whitespace and comments before attempting to match a token.
      if (this._skipWhitespaceAndComments()) {
        continue;
      }

      const startLine = this._line;
      const startCol = this._col;
      const ch = this._peek();

      // ── Single-character tokens ─────────────────────────────────
      switch (ch) {
        case '(': tokens.push(this._makeToken(TokenKind.LPAREN, '(')); this._advance(); continue;
        case ')': tokens.push(this._makeToken(TokenKind.RPAREN, ')')); this._advance(); continue;
        case '[': tokens.push(this._makeToken(TokenKind.LBRACKET, '[')); this._advance(); continue;
        case ']': tokens.push(this._makeToken(TokenKind.RBRACKET, ']')); this._advance(); continue;
        case '{': tokens.push(this._makeToken(TokenKind.LBRACE, '{')); this._advance(); continue;
        case '}': tokens.push(this._makeToken(TokenKind.RBRACE, '}')); this._advance(); continue;
        case ':': tokens.push(this._makeToken(TokenKind.COLON, ':')); this._advance(); continue;
        case ',': tokens.push(this._makeToken(TokenKind.COMMA, ',')); this._advance(); continue;
        case '.': tokens.push(this._makeToken(TokenKind.DOT, '.')); this._advance(); continue;
        case '|': tokens.push(this._makeToken(TokenKind.PIPE, '|')); this._advance(); continue;
        case '*': tokens.push(this._makeToken(TokenKind.STAR, '*')); this._advance(); continue;
        case '/': tokens.push(this._makeToken(TokenKind.SLASH, '/')); this._advance(); continue;
      }

      // ── Two-character tokens (arrows, comparisons) ──────────────
      if (ch === '+' && this._peek(1) === '=') {
        tokens.push(this._makeToken(TokenKind.PLUS_EQ, '+='));
        this._advance(2);
        continue;
      }
      if (ch === '+') {
        tokens.push(this._makeToken(TokenKind.PLUS, '+'));
        this._advance();
        continue;
      }
      if (ch === '-' && this._peek(1) === '>') {
        tokens.push(this._makeToken(TokenKind.ARROW_RIGHT, '->'));
        this._advance(2);
        continue;
      }
      if (ch === '<' && this._peek(1) === '-') {
        tokens.push(this._makeToken(TokenKind.ARROW_LEFT, '<-'));
        this._advance(2);
        continue;
      }
      if (ch === '-' && this._peek(1) === '-') {
        // `-->` is a common Cypher variant for ARROW_RIGHT
        if (this._peek(2) === '>') {
          tokens.push(this._makeToken(TokenKind.ARROW_RIGHT, '-->'));
          this._advance(3);
          continue;
        }
      }
      if (ch === '<' && this._peek(1) === '-' && this._peek(2) === '-') {
        tokens.push(this._makeToken(TokenKind.ARROW_LEFT, '<--'));
        this._advance(3);
        continue;
      }
      if (ch === '-') {
        tokens.push(this._makeToken(TokenKind.MINUS, '-'));
        this._advance();
        continue;
      }
      if (ch === '<' && this._peek(1) === '=') {
        tokens.push(this._makeToken(TokenKind.LTE, '<='));
        this._advance(2);
        continue;
      }
      if (ch === '>' && this._peek(1) === '=') {
        tokens.push(this._makeToken(TokenKind.GTE, '>='));
        this._advance(2);
        continue;
      }
      if (ch === '<' && this._peek(1) === '>') {
        tokens.push(this._makeToken(TokenKind.NEQ, '<>'));
        this._advance(2);
        continue;
      }
      if (ch === '!' && this._peek(1) === '=') {
        tokens.push(this._makeToken(TokenKind.NEQ, '!='));
        this._advance(2);
        continue;
      }
      if (ch === '=') {
        if (this._peek(1) === '~') {
          tokens.push(this._makeToken(TokenKind.REGEX_MATCH, '=~'));
          this._advance(2);
        } else {
          tokens.push(this._makeToken(TokenKind.EQ, '='));
          this._advance();
        }
        continue;
      }
      if (ch === '<') {
        tokens.push(this._makeToken(TokenKind.LT, '<'));
        this._advance();
        continue;
      }
      if (ch === '>') {
        tokens.push(this._makeToken(TokenKind.GT, '>'));
        this._advance();
        continue;
      }

      // ── String literals ─────────────────────────────────────────
      if (ch === "'" || ch === '"') {
        tokens.push(this._readString(ch));
        continue;
      }

      // ── Parameter placeholder ───────────────────────────────────
      if (ch === '$') {
        tokens.push(this._readParam());
        continue;
      }

      // ── Numbers ─────────────────────────────────────────────────
      if (isDigit(ch)) {
        tokens.push(this._readNumber());
        continue;
      }

      // ── Identifiers & keywords ──────────────────────────────────
      if (isAlpha(ch)) {
        tokens.push(this._readIdentOrKeyword());
        continue;
      }

      // ── Unrecognised character ──────────────────────────────────
      throw new CypherSyntaxError(
        `Unexpected character '${ch}'`,
        startLine,
        startCol,
      );
    }

    // Append EOF sentinel.
    tokens.push({
      kind: TokenKind.EOF,
      value: '',
      line: this._line,
      col: this._col,
    });

    return tokens;
  }

  // ── Internal helpers ────────────────────────────────────────────

  /** True when the cursor has consumed all source characters. */
  private _isAtEnd(): boolean {
    return this._pos >= this._source.length;
  }

  /** Peek at the current character, or `n` characters ahead. */
  private _peek(offset: number = 0): string {
    const idx = this._pos + offset;
    if (idx >= this._source.length) return '\0';
    return this._source[idx];
  }

  /** Advance the cursor by `n` characters, updating line/col. */
  private _advance(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      if (this._isAtEnd()) break;
      const ch = this._source[this._pos];
      if (ch === '\n') {
        this._line++;
        this._col = 1;
      } else {
        this._col++;
      }
      this._pos++;
    }
  }

  /** Create a token at the given position. */
  private _makeToken(kind: TokenKind, value: string, line?: number, col?: number): Token {
    return {
      kind,
      value,
      line: line ?? this._line,
      col: col ?? this._col,
    };
  }

  /**
   * Skip whitespace and `//` line comments.
   * @returns `true` if any characters were consumed.
   */
  private _skipWhitespaceAndComments(): boolean {
    let consumed = false;

    while (!this._isAtEnd()) {
      const ch = this._peek();

      if (isWhitespace(ch)) {
        this._advance();
        consumed = true;
        continue;
      }

      // Line comment: //
      if (ch === '/' && this._peek(1) === '/') {
        // Consume until end of line or EOF.
        while (!this._isAtEnd() && this._peek() !== '\n') {
          this._advance();
        }
        consumed = true;
        continue;
      }

      break;
    }

    return consumed;
  }

  /**
   * Read a single- or double-quoted string literal.
   * Supports escape sequences: `\\n`, `\\t`, `\\\\`, `\\'`, `\\"`.
   */
  private _readString(quote: string): Token {
    const startLine = this._line;
    const startCol = this._col;
    this._advance(); // consume opening quote

    let value = '';
    while (!this._isAtEnd() && this._peek() !== quote) {
      const ch = this._peek();

      if (ch === '\\') {
        this._advance(); // consume backslash
        if (this._isAtEnd()) {
          throw new CypherSyntaxError('Unterminated string literal', startLine, startCol);
        }
        const escaped = this._peek();
        switch (escaped) {
          case 'n':  value += '\n'; break;
          case 't':  value += '\t'; break;
          case '\\': value += '\\'; break;
          case "'":  value += "'";  break;
          case '"':  value += '"';  break;
          default:
            // For unrecognised escapes, keep the backslash and the character.
            value += '\\' + escaped;
            break;
        }
        this._advance();
      } else {
        if (ch === '\n') {
          throw new CypherSyntaxError('Unterminated string literal', startLine, startCol);
        }
        value += ch;
        this._advance();
      }
    }

    if (this._isAtEnd()) {
      throw new CypherSyntaxError('Unterminated string literal', startLine, startCol);
    }

    this._advance(); // consume closing quote
    return this._makeToken(TokenKind.STRING, value, startLine, startCol);
  }

  /**
   * Read a parameter placeholder: `$name`.
   */
  private _readParam(): Token {
    const startLine = this._line;
    const startCol = this._col;
    this._advance(); // consume $

    if (this._isAtEnd() || !isAlpha(this._peek())) {
      throw new CypherSyntaxError(
        'Expected parameter name after $',
        startLine,
        startCol,
      );
    }

    let name = '';
    while (!this._isAtEnd() && isAlphaNumeric(this._peek())) {
      name += this._peek();
      this._advance();
    }

    return this._makeToken(TokenKind.PARAM, name, startLine, startCol);
  }

  /**
   * Read an integer or float literal.
   */
  private _readNumber(): Token {
    const startLine = this._line;
    const startCol = this._col;
    let value = '';
    let isFloat = false;

    // Integer part.
    while (!this._isAtEnd() && isDigit(this._peek())) {
      value += this._peek();
      this._advance();
    }

    // Optional fractional part.
    if (this._peek() === '.' && isDigit(this._peek(1))) {
      isFloat = true;
      value += '.';
      this._advance(); // consume dot
      while (!this._isAtEnd() && isDigit(this._peek())) {
        value += this._peek();
        this._advance();
      }
    }

    return this._makeToken(
      isFloat ? TokenKind.FLOAT : TokenKind.INTEGER,
      value,
      startLine,
      startCol,
    );
  }

  /**
   * Read an identifier or keyword.
   *
   * Identifiers that match a keyword (case-insensitive) are emitted as
   * the corresponding keyword token; otherwise they are emitted as
   * {@link TokenKind.IDENT}.
   */
  private _readIdentOrKeyword(): Token {
    const startLine = this._line;
    const startCol = this._col;
    let value = '';

    while (!this._isAtEnd() && isAlphaNumeric(this._peek())) {
      value += this._peek();
      this._advance();
    }

    // Check against keyword table (case-insensitive).
    const lower = value.toLowerCase();
    const keywordKind = KEYWORDS[lower];
    if (keywordKind !== undefined) {
      return this._makeToken(keywordKind, value, startLine, startCol);
    }

    return this._makeToken(TokenKind.IDENT, value, startLine, startCol);
  }
}