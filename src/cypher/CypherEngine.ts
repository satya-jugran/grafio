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
 * ### Transaction lifecycle (future)
 * The engine does **not** create transactions in v1 (read-only only).
 * When `QueryPlan` will include write steps in a future version, the
 * engine will become the single orchestration point for the transaction
 * lifecycle (create → pass to Executor → commit/rollback).
 *
 * @module cypher/CypherEngine
 */

import { Graph } from '../Graph';
import { Lexer } from './Lexer';
import { Token, TokenKind } from './Token';
import { Parser } from './Parser';
import { Semantic } from './Semantic';
import { Planner } from './Planner';
import { Executor } from './Executor';
import { CypherResult } from './Result';
import { CypherNotSupportedError } from './errors';

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
    params: Record<string, unknown> = {},
  ): Promise<CypherResult> {
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
    const planner = new Planner();
    const plan = planner.plan(rawAst);

    // ── 6. Execute ────────────────────────────────────────────────
    const executor = new Executor(this._graph);
    return executor.execute(plan, params);
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
}
