import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider } from '../../index';

/**
 * Shared test scenarios for Graph.isDAG() operation.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphIsDAGScenarios(
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

  describe('Graph.isDAG()', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should return true for empty graph', async () => {
      await expect(graph.isDAG()).resolves.toBe(true);
    });

    it('should return true for single node', async () => {
      await graph.addNode('Node', { name: 'A' });
      await expect(graph.isDAG()).resolves.toBe(true);
    });

    it('should return true for acyclic graph', async () => {
      // A -> B -> C
      const a = await graph.addNode('Node', { name: 'A' });
      const b = await graph.addNode('Node', { name: 'B' });
      const c = await graph.addNode('Node', { name: 'C' });
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(b.id, c.id, 'LINKS');
      await expect(graph.isDAG()).resolves.toBe(true);
    });

    it('should return true for disconnected acyclic graph', async () => {
      // A -> B and C -> D (two separate chains)
      const a = await graph.addNode('Node', { name: 'A' });
      const b = await graph.addNode('Node', { name: 'B' });
      const c = await graph.addNode('Node', { name: 'C' });
      const d = await graph.addNode('Node', { name: 'D' });
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(c.id, d.id, 'LINKS');
      await expect(graph.isDAG()).resolves.toBe(true);
    });

    it('should return false for graph with cycle', async () => {
      // A -> B -> C -> A
      const a = await graph.addNode('Node', { name: 'A' });
      const b = await graph.addNode('Node', { name: 'B' });
      const c = await graph.addNode('Node', { name: 'C' });
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(b.id, c.id, 'LINKS');
      await graph.addEdge(c.id, a.id, 'LINKS');
      await expect(graph.isDAG()).resolves.toBe(false);
    });

    it('should return false for self-loop', async () => {
      const a = await graph.addNode('Node', { name: 'A' });
      await graph.addEdge(a.id, a.id, 'LINKS');
      await expect(graph.isDAG()).resolves.toBe(false);
    });

    it('should return true for diamond graph (no cycles)', async () => {
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      const a = await graph.addNode('Node', { name: 'A' });
      const b = await graph.addNode('Node', { name: 'B' });
      const c = await graph.addNode('Node', { name: 'C' });
      const d = await graph.addNode('Node', { name: 'D' });
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(a.id, c.id, 'LINKS');
      await graph.addEdge(b.id, d.id, 'LINKS');
      await graph.addEdge(c.id, d.id, 'LINKS');
      await expect(graph.isDAG()).resolves.toBe(true);
    });

    it('should return false when cycle is not reachable from start', async () => {
      // A -> B (no cycle) and separate C -> D -> C (cycle)
      const a = await graph.addNode('Node', { name: 'A' });
      const b = await graph.addNode('Node', { name: 'B' });
      const c = await graph.addNode('Node', { name: 'C' });
      const d = await graph.addNode('Node', { name: 'D' });
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(c.id, d.id, 'LINKS');
      await graph.addEdge(d.id, c.id, 'LINKS');
      await expect(graph.isDAG()).resolves.toBe(false);
    });
  });
}