import { afterEach, describe, expect, it } from '@jest/globals';
import { GraphManager } from '../../src/GraphManager';
import { InMemoryGraphFactory } from '../../src/storage/InMemoryGraphFactory';

describe('InMemoryGraphFactory integration behavior', () => {
  afterEach(() => {
    GraphManager.reset();
  });

  it('creates the default graph when no graph id is supplied', async () => {
    const graph = new InMemoryGraphFactory().forGraph();
    await graph.addNode('Person', { name: 'Alice' });

    expect(await graph.getNodeCount()).toBe(1);
  });

  it('does not wrap storage when GraphManager has no cache configured', async () => {
    GraphManager.init({});
    const graph = new InMemoryGraphFactory().forGraph('uncached');

    await graph.addNode('Person', { name: 'Alice' });
    await expect(graph.warmCache()).resolves.toBeUndefined();
  });

  it('keeps InMemoryStorageProvider uncached on sync kernel even when GraphManager cache is configured', async () => {
    GraphManager.init({
      cache: {
        cacheStore: 'in-memory',
        maxNodesCount: 10,
        maxEdgesCount: 10,
        evictionStrategy: 'LRU',
        preloadStrategy: 'all',
      },
    });
    const graph = new InMemoryGraphFactory().forGraph('cached');

    expect(graph._getSyncKernel()).not.toBeNull();
    await graph.addNode('Person', { name: 'Alice' });
    await expect(graph.warmCache()).resolves.toBeUndefined();
    expect(GraphManager.getInstance().isCachingEnabled()).toBe(true);
  });
});
