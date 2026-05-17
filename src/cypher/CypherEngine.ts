/**
 * Public facade for the Cypher query execution layer.
 *
 * The only class consumers instantiate. Orchestrates the full pipeline:
 * {@link Lexer} → {@link Parser} → {@link Semantic} → {@link Planner} → {@link Executor}.
 *
 * ### Validation gate
 * After tokenisation, the engine scans for unsupported clauses (write,
 * aggregation, WITH, OPTIONAL MATCH, etc.) and throws
 * {@link CypherNotSupportedError}. This keeps the public API read-only
 * while the internal pipeline remains permissive and extensible.
 *
 * ### Transaction support
 * Transactions can be passed via {@link CypherEngineOptions.transaction}.
 * When provided, all graph operations within the query execution will use
 * that transaction, enabling consistent reads within a transaction context.
 *
 * @module cypher/CypherEngine
 */

import { Graph } from '../Graph';
import { GraphTransaction } from '../Graph/GraphTransaction';
import { Lexer } from './Lexer';
import { Token, TokenKind } from './Token';
import { Parser } from './Parser';
import { Semantic } from './Semantic';
import { Planner } from './Planner';
import { Executor } from './Executor';
import { CypherResult } from './Result';
import { CypherNotSupportedError, UnboundParameterError } from './errors';
import { PlanFormatter, PlanFormat } from './plan/PlanFormatter';
import { QueryAst } from './ast/AstNode';

/**
 * Options for controlling query execution behavior.
 */
export interface CypherEngineOptions {
  /**
   * If provided, the query will be executed within this transaction,
   * enabling consistent reads within a transaction context.
   */
  transaction?: GraphTransaction;

  /**
   * If provided, the execution plan will be formatted and included in the result.
   */
  executionPlan?: {
    /** The output format for the execution plan. */
    format: PlanFormat;
  };
}

// ── Gated token kinds (not yet supported in the public API) ───────

/**
 * Token kinds that are deliberately gated in the current version.
 *
 * When a query contains any of these tokens, {@link CypherEngine} throws
 * {@link CypherNotSupportedError} before parsing, providing a clear error
 * message to the consumer.
 */
const GATED_TOKENS: ReadonlySet<TokenKind> = new Set([
  // Write clauses
  TokenKind.CREATE,
  TokenKind.MERGE,
  TokenKind.SET,
  TokenKind.REMOVE,
  TokenKind.DELETE,
  TokenKind.DETACH,
  // Other unsupported clauses
  TokenKind.OPTIONAL,
  TokenKind.WITH,
  TokenKind.UNWIND,
  TokenKind.ON,
]);

// ── CypherEngine ──────────────────────────────────────────────────

/**
 * Main entry point for executing Cypher queries against a {@link Graph}.
 *
 * ```typescript
 * import { Graph } from 'grafio';
 * import { CypherEngine } from 'grafio/cypher';
 *
 * const graph = new Graph();
 * const engine = new CypherEngine(graph);
 *
 * const result = await engine.execute(
 *   'MATCH (p:Person) WHERE p.name = $name RETURN p',
 *   { name: 'Alice' }
 * );
 * ```
 */
export class CypherEngine {
  private readonly _graph: Graph;

  constructor(graph: Graph) {
    this._graph = graph;
  }

  public async execute(query: string, options?: CypherEngineOptions): Promise<CypherResult & { executionPlan?: string }>;
  public async execute(query: string, params: Record<string, unknown>, options?: CypherEngineOptions): Promise<CypherResult & { executionPlan?: string }>;

  /**
   * Parse, plan, and execute a read-only Cypher query string.
   *
   * Supported clauses: `MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `SKIP`, `LIMIT`.
   *
   * @param query  - Cypher query string.
   * @param params - Named parameter map (`$key` → value).
   * @returns A {@link CypherResult} containing rows and execution summary.
   * @throws {CypherSyntaxError}       on tokenisation / parse errors.
   * @throws {CypherNotSupportedError} on unsupported clauses (write, aggregation, WITH, etc.).
   * @throws {CypherSemanticError}     on variable scope violations.
   * @throws {CypherRuntimeError}      on execution-time errors (unbound parameter, etc.).
   */
  public async execute(
    query: string,
    params: Record<string, unknown> | CypherEngineOptions,
    options?: CypherEngineOptions,
  ): Promise<CypherResult & { executionPlan?: string }> {

    // Handle overloaded signature where options may be passed as the second argument
    let _params: Record<string, unknown> = {};
    let _options: CypherEngineOptions | undefined = options;
    if (typeof params === 'object' && !Array.isArray(params) && !('executionPlan' in params)) {
      _params = params as Record<string, unknown>;
      _options = options;
    } else if (typeof params === 'object' && !Array.isArray(params) && 'executionPlan' in params) {
      _params = {};
      _options = params as CypherEngineOptions;
    }


    // ── 1. Tokenise ───────────────────────────────────────────────
    const lexer = new Lexer(query);
    const tokens = lexer.tokenise();

    // ── 2. Validation gate: reject unsupported clauses ────────────
    this._validateTokens(tokens);

    // ── 3. Parse ──────────────────────────────────────────────────
    const parser = new Parser(tokens);
    const rawAst = parser.parse();

    // ── 4. Semantic analysis ──────────────────────────────────────
    const semantic = new Semantic();
    semantic.analyse(rawAst);

    // ── 5. Plan ───────────────────────────────────────────────────
    const planner = new Planner(this._graph);
    const plan = await planner.plan(rawAst);

    // ── 6. Execute ────────────────────────────────────────────────
    const executor = new Executor(this._graph);
    const result = await executor.execute(plan, _params, _options?.transaction);

    // ── 7. Format execution plan if requested ───────────────────
    const planFormat = _options?.executionPlan?.format;
    if (planFormat && result.summary.planExecutionStats) {
      const formatter = new PlanFormatter();
      const resultWithPlan = result as CypherResult & { executionPlan?: string };
      resultWithPlan.executionPlan = formatter.format(plan, planFormat, result.summary.planExecutionStats, _params);
      return resultWithPlan;
    }

    return result;
  }

  /**
   * Returns the execution plan for a Cypher query without executing it.
   *
   * This method parses and plans the query (same steps 1-5 as {@link execute})
   * but returns the formatted plan instead of executing it. Useful for
   * debugging, optimization analysis, and query understanding.
   *
   * @param query  - Cypher query string.
   * @param params - Named parameter map (`$key` → value).
   * @param format - Output format: 'json' | 'ascii' | 'mermaid' (default: 'json').
   * @returns A formatted string representation of the query execution plan.
   * @throws {CypherSyntaxError}       on tokenisation / parse errors.
   * @throws {CypherNotSupportedError} on unsupported clauses (write, aggregation, WITH, etc.).
   * @throws {CypherSemanticError}     on variable scope violations.
   */
  public async getQueryPlan(
    query: string,
    params: Record<string, unknown> = {},
    format: PlanFormat = 'json',
  ): Promise<string> {
    // ── 1. Tokenise ───────────────────────────────────────────────
    const lexer = new Lexer(query);
    const tokens = lexer.tokenise();

    // ── 2. Validation gate: reject unsupported clauses ───────────
    this._validateTokens(tokens);

    // ── 3. Parse ──────────────────────────────────────────────────
    const parser = new Parser(tokens);
    const rawAst = parser.parse();

    // ── 4. Semantic analysis ──────────────────────────────────────
    const semantic = new Semantic();
    semantic.analyse(rawAst);

    // ── 5. Plan ───────────────────────────────────────────────────
    const planner = new Planner(this._graph);
    const plan = await planner.plan(rawAst);

    // ── 6. Validate parameters ──────────────────────────────────────
    this._validateParameters(rawAst, params);

    // ── 7. Format ─────────────────────────────────────────────────
    const formatter = new PlanFormatter();
    return formatter.format(plan, format, undefined, params);
  }

  /**
   * Scan the token stream for unsupported clauses and throw
   * {@link CypherNotSupportedError} if any are found.
   *
   * This gate is intentionally placed after tokenisation but before
   * parsing so that the parser never encounters unsupported syntax
   * in production, while remaining internally permissive.
   */
  private _validateTokens(tokens: Token[]): void {
    for (const token of tokens) {
      if (GATED_TOKENS.has(token.kind)) {
        throw new CypherNotSupportedError(
          `Clause or function '${token.value.toUpperCase()}' is not supported in this version`,
        );
      }
    }
  }

  /**
   * Walk the AST and validate that all Parameter references have corresponding
   * entries in the params map. Throws UnboundParameterError if any are missing.
   */
  private _validateParameters(ast: QueryAst, params: Record<string, unknown>): void {
    const paramNames = this._collectParameterNames(ast);
    for (const name of paramNames) {
      if (!(name in params)) {
        throw new UnboundParameterError(name);
      }
    }
  }

  /**
   * Recursively collect all parameter names referenced in an AST.
   */
  private _collectParameterNames(ast: QueryAst): string[] {
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.kind === 'Parameter' && typeof obj.name === 'string') {
        names.push(obj.name);
        return;
      }
      for (const value of Object.values(obj)) {
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
        } else if (value && typeof value === 'object') {
          walk(value);
        }
      }
    };
    walk(ast);
    return names;
  }
}
