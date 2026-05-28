/**
 * Token types produced by the Cypher lexer.
 *
 * @module cypher/Token
 */

/**
 * Enumeration of all token kinds recognised by the Cypher lexer.
 *
 * The enum is split into logical groups:
 * - **Read keywords** — used in the v1 read-only grammar.
 * - **Future keywords** — tokenised but gated by {@link CypherEngine}; reserved for future extensibility.
 * - **Literals** — scalar values and parameter placeholders.
 * - **Identifiers & punctuation** — names, operators, and structural tokens.
 */
export const enum TokenKind {
  // ── Read keywords (v1) ──────────────────────────────────────────
  MATCH = 'MATCH',
  WHERE = 'WHERE',
  RETURN = 'RETURN',
  ORDER = 'ORDER',
  BY = 'BY',
  SKIP = 'SKIP',
  LIMIT = 'LIMIT',
  AS = 'AS',
  DISTINCT = 'DISTINCT',
  EXISTS = 'EXISTS',
  IN = 'IN',
  IS = 'IS',
  NULL = 'NULL',
  NOT = 'NOT',
  AND = 'AND',
  OR = 'OR',
  ASC = 'ASC',
  DESC = 'DESC',
  UNION = 'UNION',
  ALL = 'ALL',

  // ── Future keywords (tokenised, gated in CypherEngine) ──────────
  CREATE = 'CREATE',
  MERGE = 'MERGE',
  SET = 'SET',
  REMOVE = 'REMOVE',
  DELETE = 'DELETE',
  DETACH = 'DETACH',
  ON = 'ON',
  COUNT = 'COUNT',
  SUM = 'SUM',
  AVG = 'AVG',
  MIN = 'MIN',
  MAX = 'MAX',
  COLLECT = 'COLLECT',
  OPTIONAL = 'OPTIONAL',
  WITH = 'WITH',
  UNWIND = 'UNWIND',

  // ── DDL keywords ─────────────────────────────────────────────────
  INDEX = 'INDEX',
  DROP = 'DROP',
  FOR = 'FOR',
  SHOW = 'SHOW',

  // ── Literals ────────────────────────────────────────────────────
  INTEGER = 'INTEGER',
  FLOAT = 'FLOAT',
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  /** Parameter placeholder: `$name` */
  PARAM = 'PARAM',

  // ── Identifiers & punctuation ───────────────────────────────────
  IDENT = 'IDENT',
  COLON = 'COLON',
  COMMA = 'COMMA',
  DOT = 'DOT',
  PIPE = 'PIPE',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  /** `-->` or `->` */
  ARROW_RIGHT = 'ARROW_RIGHT',
  /** `<--` or `<-` */
  ARROW_LEFT = 'ARROW_LEFT',
  EQ = 'EQ',
  NEQ = 'NEQ',
  LT = 'LT',
  LTE = 'LTE',
  GT = 'GT',
  GTE = 'GTE',
  PLUS = 'PLUS',
  PLUS_EQ = 'PLUS_EQ',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',

  /** End-of-input sentinel. */
  EOF = 'EOF',
}

/**
 * A single token produced by the {@link Lexer}.
 */
export interface Token {
  /** The category of the token. */
  kind: TokenKind;
  /** The raw source text that produced this token. */
  value: string;
  /** 1-based line number where the token starts. */
  line: number;
  /** 1-based column number where the token starts. */
  col: number;
}