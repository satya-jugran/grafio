/**
 * Unified performance scenarios for grafio storage providers.
 * 
 * This module provides a single source of truth for all benchmark scenarios.
 * Each storage provider uses the same scenario definitions with provider-specific
 * iteration counts calculated via iteration factors.
 */

export { ITERATION_FACTORS, getIterationFactor } from './scenarios/iterationFactors';
export type { StorageProvider } from './scenarios/iterationFactors';

export { buildCommonScenarios } from './scenarios/commonScenarios';

import type { BenchmarkScenario } from './benchmarkRunner';
import type { StorageProvider } from './scenarios/iterationFactors';
import { ITERATION_FACTORS } from './scenarios/iterationFactors';
import { buildCommonScenarios } from './scenarios/commonScenarios';

/**
 * Builds benchmark scenarios for a specific storage provider.
 * 
 * @param provider - The storage provider type
 * @param nodeCount - Number of nodes in the benchmark graph
 * @returns Array of benchmark scenarios with provider-specific iterations
 */
export function buildScenarios(
  provider: StorageProvider,
  nodeCount: number
): BenchmarkScenario[] {
  const factor = ITERATION_FACTORS[provider];
  return buildCommonScenarios(provider, nodeCount, factor);
}