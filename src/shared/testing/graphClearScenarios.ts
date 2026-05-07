import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider } from '../../index';

/**
 * Shared test scenarios for Graph clear operation.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphClearScenarios(
  providerFunc: () => Promise<IStorageProvider> | IStorageProvider = undefined as any,
  beforeAllFunc: () => Promise<void> = async () => {},
  afterAllFunc: () => Promise<void> = async () => {}
): void {
  let provider: IStorageProvider | undefined;

  beforeAll(async () => {
    provider = providerFunc ? await (providerFunc as () => Promise<IStorageProvider>)() : undefined;
    await beforeAllFunc();
  });

  afterAll(async () => {
    await afterAllFunc();
  });

  beforeEach(async () => {
    if (provider) {
      await provider.clear();
    }
  });

  describe('Graph.clear()', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should remove all nodes and edges', async () => {
      const aliceId = (await graph.addNode('Person', { name: 'Alice' })).id;
      const bobId = (await graph.addNode('Person', { name: 'Bob' })).id;
      await graph.addEdge(aliceId, bobId, 'KNOWS');

      await graph.clear();

      await expect(graph.getNodes()).resolves.toHaveLength(0);
      await expect(graph.getEdges()).resolves.toHaveLength(0);
    });
  });
}