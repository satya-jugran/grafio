/**
 * Public barrel for the Cypher query execution layer.
 *
 * Import from `grafio/cypher` (deep import path — not included in the
 * main `grafio` barrel to keep the base bundle size unchanged).
 *
 * ```typescript
 * import { CypherEngine, CypherNotSupportedError } from 'grafio/cypher';
 * ```
 *
 * @module cypher
 */

export { CypherEngine } from './CypherEngine';
export type { CypherEngineOptions, CypherQueryOptions } from './CypherEngine';
export type { CypherResult, CypherRow, CypherSummary } from './Result';
export {
  CypherError,
  CypherSyntaxError,
  CypherNotSupportedError,
  CypherSemanticError,
  CypherRuntimeError,
  UnboundParameterError,
  TypeMismatchError,
} from './errors';
export { PlanFormatter } from './plan/PlanFormatter';
export type { PlanFormat } from './plan/PlanFormatter';
