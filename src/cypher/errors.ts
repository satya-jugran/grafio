/**
 * Cypher-specific error hierarchy.
 *
 * All Cypher errors extend {@link GraphError} from the core so consumers
 * can catch them with a single `instanceof GraphError` guard.
 *
 * @module cypher/errors
 */

import { GraphError } from '../errors';

// ── Base Cypher error ─────────────────────────────────────────────

/**
 * Base class for all errors originating from the Cypher query layer.
 */
export class CypherError extends GraphError {
  constructor(message: string) {
    super(message);
    this.name = 'CypherError';
    Object.setPrototypeOf(this, CypherError.prototype);
  }
}

// ── Syntax errors ─────────────────────────────────────────────────

/**
 * Thrown when the Lexer or Parser encounters invalid syntax.
 *
 * The message includes the offending line:column and the problematic lexeme
 * to aid debugging.
 */
export class CypherSyntaxError extends CypherError {
  /** 1-based line number of the error. */
  public readonly line: number;
  /** 1-based column number of the error. */
  public readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`[${line}:${col}] ${message}`);
    this.name = 'CypherSyntaxError';
    this.line = line;
    this.col = col;
    Object.setPrototypeOf(this, CypherSyntaxError.prototype);
  }
}

// ── Not-supported errors ──────────────────────────────────────────

/**
 * Thrown when a query uses a clause or feature that is not yet supported
 * in the current version (e.g., write clauses, aggregations, WITH).
 */
export class CypherNotSupportedError extends CypherError {
  constructor(feature: string) {
    super(`Feature not supported: ${feature}`);
    this.name = 'CypherNotSupportedError';
    Object.setPrototypeOf(this, CypherNotSupportedError.prototype);
  }
}

// ── Semantic errors ───────────────────────────────────────────────

/**
 * Thrown when the Semantic analyser detects a violation such as an
 * unresolved variable reference or a duplicate binding.
 */
export class CypherSemanticError extends CypherError {
  constructor(message: string) {
    super(message);
    this.name = 'CypherSemanticError';
    Object.setPrototypeOf(this, CypherSemanticError.prototype);
  }
}

// ── Runtime errors ────────────────────────────────────────────────

/**
 * Thrown at execution time when a runtime condition prevents the query
 * from completing (e.g., unbound parameter, type mismatch).
 */
export class CypherRuntimeError extends CypherError {
  constructor(message: string) {
    super(message);
    this.name = 'CypherRuntimeError';
    Object.setPrototypeOf(this, CypherRuntimeError.prototype);
  }
}

/**
 * Thrown when a `$param` placeholder is referenced in the query but not
 * supplied in the params map.
 */
export class UnboundParameterError extends CypherRuntimeError {
  constructor(paramName: string) {
    super(`Parameter '${paramName}' is not bound`);
    this.name = 'UnboundParameterError';
    Object.setPrototypeOf(this, UnboundParameterError.prototype);
  }
}

/**
 * Thrown when an operation attempts to compare or combine incompatible
 * types (e.g., comparing a string to an integer in a WHERE clause).
 */
export class TypeMismatchError extends CypherRuntimeError {
  constructor(detail: string) {
    super(`Type mismatch: ${detail}`);
    this.name = 'TypeMismatchError';
    Object.setPrototypeOf(this, TypeMismatchError.prototype);
  }
}