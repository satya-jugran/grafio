/**
 * AST node types produced by the Cypher parser.
 *
 * Every node carries a `kind` discriminant for type-safe pattern matching.
 * The AST is a pure data structure — no methods, no logic.
 *
 * @module cypher/ast/AstNode
 */

// ── Property map ──────────────────────────────────────────────────

/**
 * Inline property map used in node/edge patterns.
 *
 * Example: `{name: 'Alice', age: 30}`
 *
 * Values are constrained to JSON-compatible primitives plus
 * {@link ParameterRef} for `$param` placeholders.
 */
export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | ParameterRef;

export type PropertyMap = Record<string, PropertyValue>;

// ── Write clauses ─────────────────────────────────────────────────

export interface CreateClause {
  kind: 'Create';
  /** One or more pattern paths to create (same structure as MATCH patterns). */
  patterns: MatchPattern[];
}

export interface SetClause {
  kind: 'Set';
  items: SetItem[];
}

export interface SetItem {
  kind: 'SetItem';
  /** The entity variable being modified (e.g., `n` in `SET n.prop = val`). */
  variable: Expression;
  /** The property key. */
  property: string;
  /** The value expression. */
  value: Expression;
}

export interface DeleteClause {
  kind: 'Delete';
  /** Whether DETACH was specified (cascade edge removal). */
  detach: boolean;
  /** Variables to delete (must be nodes or edges). */
  variables: string[];
}

export interface RemoveClause {
  kind: 'Remove';
  items: RemoveItem[];
}

export interface RemoveItem {
  kind: 'RemoveItem';
  /** The variable whose property is being removed. */
  variable: IdentifierExpr;
  /** The property key to remove. */
  property: string;
}

// ── Top-level query ───────────────────────────────────────────────

export interface QueryAst {
  kind: 'Query';
  /** The MATCH clause (required). */
  match: MatchClause;
  /** Optional WHERE clause. */
  where?: WhereClause;
  /** Optional CREATE clause. */
  create?: CreateClause;
  /** Optional SET clause. */
  set?: SetClause;
  /** Optional DELETE clause. */
  delete?: DeleteClause;
  /** Optional REMOVE clause. */
  remove?: RemoveClause;
  /** The RETURN clause (required). */
  return: ReturnClause;
  /** Optional HAVING clause (post-aggregation filter). */
  having?: HavingClause;
  /** Optional ORDER BY clause. */
  orderBy?: OrderByClause;
  /** Optional SKIP expression. */
  skip?: SkipClause;
  /** Optional LIMIT expression. */
  limit?: LimitClause;
}

// ── Clauses ───────────────────────────────────────────────────────

export type MatchPattern = PatternPath | NamedPath;

export interface MatchClause {
  kind: 'Match';
  /** One or more pattern paths (or named paths) in the MATCH clause. */
  patterns: MatchPattern[];
}

export interface WhereClause {
  kind: 'Where';
  /** The boolean expression that filters rows. */
  expression: Expression;
}

export interface HavingClause {
  kind: 'Having';
  /** The boolean expression to evaluate against post-aggregation rows. */
  expression: Expression;
}

export interface ReturnClause {
  kind: 'Return';
  /** Whether DISTINCT is specified. */
  distinct: boolean;
  /** Projected items. */
  items: ReturnItem[];
}

export interface ReturnItem {
  kind: 'ReturnItem';
  /** The expression to evaluate. */
  expression: Expression;
  /** Optional alias (the part after AS). */
  alias?: string;
}

export interface OrderByClause {
  kind: 'OrderBy';
  /** Sort specifications, in order of precedence. */
  items: OrderByItem[];
}

export interface OrderByItem {
  kind: 'OrderByItem';
  /** The expression to sort by. */
  expression: Expression;
  /** Sort direction. */
  direction: 'ASC' | 'DESC';
}

export interface SkipClause {
  kind: 'Skip';
  /** Expression that evaluates to a non-negative integer. */
  expression: Expression;
}

export interface LimitClause {
  kind: 'Limit';
  /** Expression that evaluates to a non-negative integer. */
  expression: Expression;
}

// ── Patterns ──────────────────────────────────────────────────────

/**
 * A pattern path represents a connected chain of node-edge-node triples.
 *
 * Example: `(a:Person)-[:KNOWS]->(b:Person)-[:LIVES_IN]->(c:City)`
 * produces one PatternPath with two segments.
 */
/**
 * A named pattern path assigns a variable to a pattern path.
 * Used in queries like: `MATCH path = (a)-[:REL]->(b) RETURN path`
 */
export interface NamedPath {
  kind: 'NamedPath';
  /** The variable name assigned to this path, e.g. `path` in `path = (a)->(b)` */
  name: string;
  /** The pattern path being named */
  pattern: PatternPath;
}

/**
 * Returns the segments array from a PatternPath or NamedPath.
 * For NamedPath, returns the inner pattern's segments.
 */
export function getPatternSegments(pattern: PatternPath | NamedPath): PatternSegment[] {
  return pattern.kind === 'NamedPath' ? pattern.pattern.segments : pattern.segments;
}

export interface PatternPath {
  kind: 'PatternPath';
  /** Ordered list of alternating node and edge patterns.
   *  Always starts and ends with a NodePattern.
   *  Length is always odd: node, edge, node, edge, node, ... */
  segments: PatternSegment[];
}

/**
 * A single element in a pattern path — either a node or an edge.
 */
export type PatternSegment = NodePattern | EdgePattern;

export interface NodePattern {
  kind: 'NodePattern';
  /** Variable binding, e.g. `n` in `(n:Person)`. Undefined for anonymous nodes. */
  variable?: string;
  /** Label(s), e.g. `['Person']` in `(n:Person)`. Empty array if no label. */
  labels: string[];
  /** Inline property map, e.g. `{name: 'Alice'}`. Empty object if none. */
  properties: PropertyMap;
}

export interface EdgePattern {
  kind: 'EdgePattern';
  /** Variable binding, e.g. `r` in `[r:KNOWS]`. Undefined for anonymous edges. */
  variable?: string;
  /** Edge type(s), e.g. `['KNOWS']`. Empty array for any type. */
  types: string[];
  /** Inline property map. Empty object if none. */
  properties: PropertyMap;
  /** Direction of traversal: `'out'` for `-->`, `'in'` for `<--`. */
  direction: 'out' | 'in';
  /** Minimum hops. 1 for fixed-length patterns. */
  minHops: number;
  /** Maximum hops. 1 for fixed-length, `Infinity` for `[*]` unbounded. */
  maxHops: number;
}

// ── Expressions ───────────────────────────────────────────────────

/**
 * Discriminated union of all expression node types.
 */
export type Expression =
  | LiteralExpr
  | ParameterRef
  | IdentifierExpr
  | PropertyAccessExpr
  | BinaryExpr
  | UnaryExpr
  | InExpr
  | IsNullExpr
  | ListExpr
  | FunctionCallExpr;

// -- Literals --

export interface LiteralExpr {
  kind: 'Literal';
  /** The runtime value. Type is determined by the source token. */
  value: string | number | boolean | null;
}

export interface ParameterRef {
  kind: 'Parameter';
  /** Parameter name without the leading `$`. */
  name: string;
}

// -- Identifiers & property access --

export interface IdentifierExpr {
  kind: 'Identifier';
  /** Variable name. */
  name: string;
}

export interface PropertyAccessExpr {
  kind: 'PropertyAccess';
  /** The object whose property is being accessed. */
  object: Expression;
  /** The property key. */
  property: string;
}

// -- Binary expressions --

export type BinaryOp = 'AND' | 'OR' | '=' | '<>' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/';

export interface BinaryExpr {
  kind: 'Binary';
  /** The operator. */
  op: BinaryOp;
  /** Left-hand operand. */
  left: Expression;
  /** Right-hand operand. */
  right: Expression;
}

// -- Unary expressions --

export type UnaryOp = 'NOT' | '-';

export interface UnaryExpr {
  kind: 'Unary';
  /** The operator. */
  op: UnaryOp;
  /** The operand. */
  operand: Expression;
}

// -- Special predicates --

export interface InExpr {
  kind: 'In';
  /** The value being tested. */
  expression: Expression;
  /** The list to test membership against. */
  list: Expression;
  /** Whether this is a negated test (`NOT IN`). */
  not: boolean;
}

export interface IsNullExpr {
  kind: 'IsNull';
  /** The value being tested. */
  expression: Expression;
  /** Whether this is `IS NOT NULL`. */
  not: boolean;
}

// -- Lists & function calls (for future use) --

export interface ListExpr {
  kind: 'List';
  /** The elements of the list. */
  elements: Expression[];
}

export interface FunctionCallExpr {
  kind: 'FunctionCall';
  /** Function name, e.g. `COUNT`. */
  name: string;
  /** Argument expressions. */
  args: Expression[];
  /** Whether DISTINCT modifier was applied, e.g. `COUNT(DISTINCT x)`. */
  distinct?: boolean;
}
