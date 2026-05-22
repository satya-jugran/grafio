/**
 * Concurrency utility for parallel row processing.
 *
 * Splits an input array into chunks and processes each chunk concurrently
 * via {@link Promise.all}, respecting a maximum concurrency limit. Falls
 * back to serial execution when parallelism is disabled or the input is
 * too small to justify chunking overhead.
 *
 * @module cypher/executor/parallelMap
 */

/**
 * Process items in parallel with bounded concurrency.
 *
 * @param items          - The array to process in parallel.
 * @param fn             - Processing function that receives a chunk
 *                         and returns a promise of results.
 * @param maxConcurrency - Maximum number of concurrent chunks.
 * @param minChunkSize   - Minimum items per chunk before parallelizing
 *                         (default: 100). Arrays smaller than this are
 *                         processed serially.
 * @returns Flattened array of all processed results.
 *
 * @typeParam T - Input item type.
 * @typeParam R - Output item type.
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (chunk: T[]) => Promise<R[]>,
  maxConcurrency: number,
  minChunkSize: number = 100,
): Promise<R[]> {
  if (maxConcurrency <= 1 || items.length <= minChunkSize) {
    return fn(items);
  }

  const chunkSize = Math.ceil(items.length / Math.min(maxConcurrency, items.length));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  const results = await Promise.all(chunks.map(fn));
  return results.flat();
}
