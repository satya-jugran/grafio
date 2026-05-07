import { describe, expect, it } from '@jest/globals';
import type { IGraphFactory } from '../../storage/IGraphFactory';

/**
 * Shared test scenarios for IGraphFactory implementations.
 * Takes the factory directly since InMemoryGraphFactory doesn't need async setup.
 * Note: beforeEach cleanup should be provided by the caller.
 *
 * @param factory - The graph factory instance to test
 */
export function runGraphFactoryScenarios(
  factoryFunc: () => Promise<IGraphFactory> = undefined as any,
  beforeAllFunc: () => Promise<void> = async () => {},
  afterAllFunc: () => Promise<void> = async () => {},
  additionalTests: () => void = () => {}
): void {
  let factory: IGraphFactory;

  beforeAll(async () => {
    factory = factoryFunc ? await factoryFunc() : undefined as any;
    await beforeAllFunc();
  });

  afterAll(async () => {
    await afterAllFunc();
  });

  beforeEach(async () => {
    // Clear all graphs by clearing all known graph partitions
    const graphA = factory.forGraph('graph-a');
    const graphB = factory.forGraph('graph-b');
    const graphDefault = factory.forGraph('default');
    await Promise.all([graphA.clear(), graphB.clear(), graphDefault.clear()]);
  });

  additionalTests();
  
  describe('IGraphFactory', () => {
    it('forGraph() should return a Graph instance', () => {
      const graph = factory.forGraph('any-id');
      expect(graph).toBeDefined();
    });

    it('forGraph() should return independent graphs per call', async () => {
      const graphA = factory.forGraph('graph-a');
      const graphB = factory.forGraph('graph-b');

      await graphA.addNode('Person', { name: 'Alice' });
      await graphB.addNode('Person', { name: 'Bob' });

      const nodesA = await graphA.getNodes();
      const nodesB = await graphB.getNodes();

      expect(nodesA).toHaveLength(1);
      expect(nodesA[0].properties.name).toBe('Alice');
      expect(nodesB).toHaveLength(1);
      expect(nodesB[0].properties.name).toBe('Bob');
    });

    it.skip('forGraph() with no argument should default to "default" graphId', async () => {
      const graphDefault = factory.forGraph();
      const graphExplicit = factory.forGraph('default');

      await graphDefault.addNode('Person', { name: 'Carol' });

      const nodes = await graphExplicit.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Carol');
    });

    it('forGraph() should isolate clear() to the given graphId', async () => {
      const graphA = factory.forGraph('graph-a');
      const graphB = factory.forGraph('graph-b');

      await graphA.addNode('Person', { name: 'Alice' });
      await graphB.addNode('Person', { name: 'Bob' });

      await graphA.clear();

      expect(await graphA.getNodes()).toHaveLength(0);
      expect(await graphB.getNodes()).toHaveLength(1);
    });

    it('forGraph() with default graphId should isolate clear() to that graph', async () => {
      const graphA = factory.forGraph('graph-a');
      const graphDefault = factory.forGraph('default');

      await graphA.addNode('Person', { name: 'Alice' });
      await graphDefault.addNode('Person', { name: 'Bob' });

      await graphA.clear();

      expect(await graphA.getNodes()).toHaveLength(0);
      expect(await graphDefault.getNodes()).toHaveLength(1);
    });

    it('each forGraph() call returns a fresh provider (no shared state between calls)', async () => {
      const graph1 = factory.forGraph('graph-x');
      const graph2 = factory.forGraph('graph-y');

      await graph1.addNode('Person', { name: 'Dave' });

      // graph2 should be independent — empty
      expect(await graph2.getNodes()).toHaveLength(0);
    });
  });
}
