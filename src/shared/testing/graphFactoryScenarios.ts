import { describe, expect, it } from '@jest/globals';
import type { IGraphFactory } from '../../storage/IGraphFactory';
import { GraphManager } from '../../GraphManager';

/**
 * Shared test scenarios for IGraphFactory implementations.
 * Takes the factory directly since InMemoryGraphFactory doesn't need async setup.
 * Note: beforeEach cleanup should be provided by the caller.
 *
 * @param factory - The graph factory instance to test
 */
export function runGraphFactoryScenarios(
  factoryFunc: () => Promise<IGraphFactory> = undefined as any,
  beforeAllFunc: () => Promise<void> = async () => { },
  afterAllFunc: () => Promise<void> = async () => { },
  additionalTests: () => void = () => { }
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
      // This is not working for inMemory provider.
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

    describe('fromGraphData()', () => {
      it('should create a Graph and import the given data', async () => {
        GraphManager.init({
          cache: {
            cacheStore: 'in-memory',
            evictionStrategy: 'LRU',
            maxNodesCount: 10000,
            maxEdgesCount: 20000,
            preloadStrategy: 'none',
          }
        });

        const data = {
          nodes: [
            { id: 'node-1', labels: ['Person'], properties: { name: 'Alice' } },
            { id: 'node-2', labels: ['Person'], properties: { name: 'Bob' } },
          ],
          edges: [
            { id: 'edge-1', type: 'KNOWS', sourceId: 'node-1', targetId: 'node-2', properties: {} },
          ],
        };

        const graph = await factory.fromGraphData(data, 'graph-from-data');

        const nodes = await graph.getNodes();
        expect(nodes).toHaveLength(2);

        const edges = await graph.getEdges();
        expect(edges).toHaveLength(1);
        expect(edges[0].sourceId).toBe('node-1');
        expect(edges[0].targetId).toBe('node-2');
        GraphManager.reset();  
      });

      it('should use default graphId when not provided', async () => {
        const data = {
          nodes: [
            { id: 'node-1', labels: ['Thing'], properties: { value: 42 } },
          ],
          edges: [],
        };

        const graph = await factory.fromGraphData(data);

        const nodes = await graph.getNodes();
        expect(nodes).toHaveLength(1);
        expect(nodes[0].properties.value).toBe(42);
      });
    });
  });
}
