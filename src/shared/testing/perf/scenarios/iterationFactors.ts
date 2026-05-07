/**
 * Iteration factors for different storage providers.
 * 
 * Base iterations are defined for in-memory provider (factor = 1.0).
 * Other providers use proportional factors based on their relative speed.
 */

export const ITERATION_FACTORS = {
  'in-memory': 1.0,
  'mongodb': 0.05,
} as const;

export type StorageProvider = keyof typeof ITERATION_FACTORS;

/**
 * Returns the iteration factor for a given storage provider.
 */
export function getIterationFactor(provider: StorageProvider): number {
  return ITERATION_FACTORS[provider];
}