import { describe, expect, it } from '@jest/globals';
import { parallelMap } from '../../src/cypher/executor/parallelMap';

describe('parallelMap', () => {
  it('uses serial processing when parallelism is disabled', async () => {
    const calls: number[][] = [];
    const result = await parallelMap([1, 2, 3], async chunk => {
      calls.push(chunk);
      return chunk.map(value => value * 2);
    }, 1);

    expect(result).toEqual([2, 4, 6]);
    expect(calls).toEqual([[1, 2, 3]]);
  });

  it('uses serial processing for inputs below the chunk threshold', async () => {
    const calls: number[][] = [];
    await parallelMap([1, 2], async chunk => {
      calls.push(chunk);
      return chunk;
    }, 4, 3);

    expect(calls).toEqual([[1, 2]]);
  });

  it('splits larger inputs into bounded concurrent chunks', async () => {
    const calls: number[][] = [];
    const result = await parallelMap([1, 2, 3, 4, 5, 6], async chunk => {
      calls.push(chunk);
      return chunk.map(value => value * 2);
    }, 3, 2);

    expect(result).toEqual([2, 4, 6, 8, 10, 12]);
    expect(calls).toHaveLength(3);
    expect(calls.every(chunk => chunk.length >= 2)).toBe(true);
  });
});
