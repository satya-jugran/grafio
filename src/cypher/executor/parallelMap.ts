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
 * The array is split into chunks that are processed concurrently
 * via {@link Promise.all}.  When parallelism is disabled or the
 * input is too small to justify chunking overhead the function
 * falls back to serial execution.
 *
 * Chunk size is derived from {@link maxConcurrency} but never
 * drops below {@link minChunkSize} – effective concurrency is
 * clamped to `⌊items.length / minChunkSize⌋` so each chunk
 * contains at least that many items.
 *
 * @param items          - The array to process in parallel.
 * @param fn             - Processing function that receives a chunk
 *                         and returns a promise of results.
 * @param maxConcurrency - Maximum number of concurrent chunks.
 * @param minChunkSize   - Minimum number of items guaranteed per
 *                         chunk when parallelizing (default: 100).
 *                         Inputs with fewer items than this threshold
 *                         are processed serially in a single chunk.
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

  // Clamp effective concurrency so every chunk holds at least
  // minChunkSize items, preventing unbounded chunk creation when
  // maxConcurrency is set excessively high.
  const maxChunks = Math.max(1, Math.floor(items.length / minChunkSize));
  const effectiveConcurrency = Math.min(maxConcurrency, maxChunks);
  const chunkSize = Math.ceil(items.length / effectiveConcurrency);

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  const results = await Promise.all(chunks.map(fn));
  return results.flat();
}
