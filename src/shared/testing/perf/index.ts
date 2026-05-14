/**
 * Unified performance scenarios for grafio storage providers.
 * 
 * This module provides a single source of truth for all benchmark scenarios.
 * Each storage provider uses the same scenario definitions with provider-specific
 * iteration counts calculated via iteration factors.
 */

// Re-export from commonScenarios
export { buildCommonScenarios } from './scenarios/commonScenarios';

// Re-export functions from benchmarkRunner
export { runScenario, printReport, printScaleHeader, printSectionTitle } from './benchmarkRunner';
export type { BenchmarkScenario, BenchmarkResult } from './benchmarkRunner';

// Re-export from graphGenerator
export { buildGraph } from './graphGenerator';
export type { GraphMeta } from './graphGenerator';
