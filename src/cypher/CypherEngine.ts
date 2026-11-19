/**
 * Public facade for the Cypher query execution layer.
 *
 * Orchestrates the full pipeline:
 * {@link Lexer} → {@link Parser} → {@link Semantic} → {@link Planner} → {@link Executor},
 * accelerated on v8 with an LRU {@link PlanCache} keyed by query string and `indexEpoch`,
 * plus synchronous execution via {@link executeSync} on `InMemoryStorageProvider`.
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
import { Executor } from './executor/Executor';
import { CypherResult } from './Result';
import { CypherNotSupportedError, CypherRuntimeError, UnboundParameterError } from './errors';
import { PlanFormatter, PlanFormat } from './plan/PlanFormatter';
import { getOrBuildCompiledPlanMeta } from './plan/CompiledPlanMeta';
import { PlanCache, type CachedPlanEntry } from './PlanCache';
import type { Statement } from './ast/AstNode';

/**
 * Options for configuring the {@link CypherEngine} instance itself.
 */
export interface CypherEngineOptions {
  /**
   * Maximum number of compiled query plans retained in the LRU cache.
   * Default: `512`. Pass `0` to disable plan caching.
   */
  planCacheSize?: number;
}

/**
 * Options for controlling per-query execution behavior.
 */
export interface CypherQueryOptions {
  /**
   * If provided, the query will be executed within this transaction,
   * enabling consistent reads and deferred commits within a transaction context.
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

const GATED_TOKENS: ReadonlySet<TokenKind> = new Set([]);
const OPTION_KEYS: ReadonlyArray<keyof CypherQueryOptions> = ['transaction', 'executionPlan'];

/**
 * Main entry point for executing Cypher queries against a {@link Graph}.
 */
export class CypherEngine {
  private readonly _graph: Graph;
  private readonly _planCache: PlanCache;
  private readonly _planner: Planner;
  private readonly _executor: Executor;

  /**
   * @param graph   - The Graph instance to query against.
   * @param options - Engine-level configuration options.
   */
  constructor(graph: Graph, options?: CypherEngineOptions) {
    this._graph = graph;
    this._planCache = new PlanCache(options?.planCacheSize ?? 512);
    this._planner = new Planner(graph);
    this._executor = new Executor(graph);
  }

  public async execute(
    query: string,
    options?: CypherQueryOptions,
  ): Promise<CypherResult & { executionPlan?: string }>;
  public async execute(
    query: string,
    params: Record<string, unknown> | undefined,
    options?: CypherQueryOptions,
  ): Promise<CypherResult & { executionPlan?: string }>;

  /**
   * Parse, plan, and execute a Cypher query asynchronously.
   * Automatically runs the zero-microtask kernel pipeline when backed by
   * `InMemoryStorageProvider`.
   */
  public async execute(
    query: string,
    params?: Record<string, unknown> | CypherQueryOptions,
    options?: CypherQueryOptions,
  ): Promise<CypherResult & { executionPlan?: string }> {
    if (this._graph._getSyncKernel()) {
      return this._executeSyncInternal(query, params, options);
    }

    const { resolvedParams, resolvedOptions } = this._resolveParamsAndOptions(params, options);
    const epoch = this._graph.indexEpoch;
    let entry = this._planCache.get(query, epoch);

    if (!entry) {
      const tokens = new Lexer(query).tokenise();
      this._validateTokens(tokens);
      const rawAst = new Parser(tokens).parse();
      new Semantic().analyseStatement(rawAst);
      const plan = await this._planner.plan(rawAst);
      const meta = getOrBuildCompiledPlanMeta(plan);
      const paramNames = this._collectParameterNames(rawAst);
      entry = { plan, meta, paramNames, indexEpoch: epoch };
      this._planCache.set(query, entry);
    }

    const result = await this._executor.execute(
      entry.plan,
      resolvedParams,
      resolvedOptions?.transaction,
      entry.meta,
    );

    const planFormat = resolvedOptions?.executionPlan?.format;
    if (planFormat && result.summary.planExecutionStats) {
      const formatter = new PlanFormatter();
      const resultWithPlan = result as CypherResult & { executionPlan?: string };
      resultWithPlan.executionPlan = formatter.format(
        entry.plan,
        planFormat,
        result.summary.planExecutionStats,
        resolvedParams,
      );
      return resultWithPlan;
    }

    return result;
  }

  public executeSync(
    query: string,
    options?: CypherQueryOptions,
  ): CypherResult & { executionPlan?: string };
  public executeSync(
    query: string,
    params: Record<string, unknown> | undefined,
    options?: CypherQueryOptions,
  ): CypherResult & { executionPlan?: string };

  /**
   * Parse, plan, and execute a Cypher query synchronously against
   * an `InMemoryStorageProvider` graph.
   */
  public executeSync(
    query: string,
    params?: Record<string, unknown> | CypherQueryOptions,
    options?: CypherQueryOptions,
  ): CypherResult & { executionPlan?: string } {
    return this._executeSyncInternal(query, params, options);
  }

  private _executeSyncInternal(
    query: string,
    params?: Record<string, unknown> | CypherQueryOptions,
    options?: CypherQueryOptions,
  ): CypherResult & { executionPlan?: string } {
    if (!this._graph._getSyncKernel()) {
      throw new CypherRuntimeError(
        'executeSync requires a Graph backed by an in-memory storage kernel',
      );
    }

    const { resolvedParams, resolvedOptions } = this._resolveParamsAndOptions(params, options);
    const epoch = this._graph.indexEpoch;
    let entry = this._planCache.get(query, epoch);

    if (!entry) {
      entry = this._compileSync(query, epoch);
      this._planCache.set(query, entry);
    }

    const result = this._executor.executeSync(
      entry.plan,
      resolvedParams,
      resolvedOptions?.transaction,
      entry.meta,
    );

    const planFormat = resolvedOptions?.executionPlan?.format;
    if (planFormat && result.summary.planExecutionStats) {
      const formatter = new PlanFormatter();
      const resultWithPlan = result as CypherResult & { executionPlan?: string };
      resultWithPlan.executionPlan = formatter.format(
        entry.plan,
        planFormat,
        result.summary.planExecutionStats,
        resolvedParams,
      );
      return resultWithPlan;
    }

    return result;
  }

  /**
   * Returns the execution plan for a Cypher query without executing it.
   */
  public async getQueryPlan(
    query: string,
    params: Record<string, unknown> = {},
    format: PlanFormat = 'json',
  ): Promise<string> {
    const epoch = this._graph.indexEpoch;
    let entry = this._planCache.get(query, epoch);

    if (!entry) {
      if (this._graph._getSyncKernel()) {
        entry = this._compileSync(query, epoch);
      } else {
        const tokens = new Lexer(query).tokenise();
        this._validateTokens(tokens);
        const rawAst = new Parser(tokens).parse();
        new Semantic().analyseStatement(rawAst);
        const plan = await this._planner.plan(rawAst);
        const meta = getOrBuildCompiledPlanMeta(plan);
        const paramNames = this._collectParameterNames(rawAst);
        entry = { plan, meta, paramNames, indexEpoch: epoch };
      }
      this._planCache.set(query, entry);
    }

    for (let i = 0; i < entry.paramNames.length; i++) {
      const name = entry.paramNames[i];
      if (!(name in params)) {
        throw new UnboundParameterError(name);
      }
    }

    return new PlanFormatter().format(entry.plan, format, undefined, params);
  }

  /** @internal Clears cached plans on demand. */
  public _clearPlanCache(): void {
    this._planCache.clear();
  }

  /** @internal Current cached plan count. */
  public _getPlanCacheSize(): number {
    return this._planCache.size;
  }

  private _compileSync(query: string, indexEpoch: number): CachedPlanEntry {
    const tokens = new Lexer(query).tokenise();
    this._validateTokens(tokens);
    const rawAst = new Parser(tokens).parse();
    new Semantic().analyseStatement(rawAst);
    const plan = this._planner.planSync(rawAst);
    const meta = getOrBuildCompiledPlanMeta(plan);
    const paramNames = this._collectParameterNames(rawAst);
    return { plan, meta, paramNames, indexEpoch };
  }

  private _resolveParamsAndOptions(
    paramsOrOptions?: Record<string, unknown> | CypherQueryOptions,
    options?: CypherQueryOptions,
  ): { resolvedParams: Record<string, unknown>; resolvedOptions?: CypherQueryOptions } {
    if (options !== undefined) {
      return {
        resolvedParams: (paramsOrOptions ?? {}) as Record<string, unknown>,
        resolvedOptions: options,
      };
    }
    if (
      paramsOrOptions &&
      typeof paramsOrOptions === 'object' &&
      !Array.isArray(paramsOrOptions) &&
      this._isQueryOptionsObject(paramsOrOptions)
    ) {
      return {
        resolvedParams: {},
        resolvedOptions: paramsOrOptions as CypherQueryOptions,
      };
    }
    return {
      resolvedParams: (paramsOrOptions ?? {}) as Record<string, unknown>,
      resolvedOptions: undefined,
    };
  }

  private _isQueryOptionsObject(obj: object): boolean {
    const rec = obj as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 0) return false;
    for (let i = 0; i < keys.length; i++) {
      if (!OPTION_KEYS.includes(keys[i] as keyof CypherQueryOptions)) {
        return false;
      }
    }
    if ('transaction' in rec) {
      if (rec.transaction !== undefined && !(rec.transaction instanceof GraphTransaction)) {
        return false;
      }
    }
    if ('executionPlan' in rec) {
      const ep = rec.executionPlan;
      if (ep !== undefined) {
        if (typeof ep !== 'object' || ep === null || Array.isArray(ep)) return false;
        const fmt = (ep as { format?: unknown }).format;
        if (fmt !== 'json' && fmt !== 'text' && fmt !== 'mermaid') return false;
      }
    }
    return true;
  }

  private _validateTokens(tokens: Token[]): void {
    for (const token of tokens) {
      if (GATED_TOKENS.has(token.kind)) {
        throw new CypherNotSupportedError(
          `Clause or function '${token.value.toUpperCase()}' is not supported in this version`,
        );
      }
    }
  }

  private _collectParameterNames(ast: Statement): string[] {
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
