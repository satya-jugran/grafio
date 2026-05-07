import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider } from '../../index';

/**
 * Shared test scenarios for Graph.topologicalSort() operation.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphTopologicalSortScenarios(
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

  describe('Graph.topologicalSort()', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should return empty array for empty graph', async () => {
      const result = await graph.topologicalSort();
      expect(result).toEqual([]);
    });

    it('should return array with single node when no edges', async () => {
      const node = await graph.addNode('Test', { name: 'A' });
      const result = await graph.topologicalSort();
      expect(result).toEqual([node.id]);
    });

    it('should return nodes in topological order for linear chain', async () => {
      const a = await graph.addNode('Test', { name: 'A' });
      const b = await graph.addNode('Test', { name: 'B' });
      const c = await graph.addNode('Test', { name: 'C' });

      // A -> B -> C
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(b.id, c.id, 'LINKS');

      const result = await graph.topologicalSort()!;
      expect(result).toHaveLength(3);
      expect(result!.indexOf(a.id)).toBeLessThan(result!.indexOf(b.id));
      expect(result!.indexOf(b.id)).toBeLessThan(result!.indexOf(c.id));
    });

    it('should handle multiple roots (nodes with no incoming edges)', async () => {
      const a = await graph.addNode('Test', { name: 'A' });
      const b = await graph.addNode('Test', { name: 'B' });
      const c = await graph.addNode('Test', { name: 'C' });

      // A -> C and B -> C (A and B are both roots)
      await graph.addEdge(a.id, c.id, 'LINKS');
      await graph.addEdge(b.id, c.id, 'LINKS');

      const result = await graph.topologicalSort()!;
      expect(result).toHaveLength(3);
      expect(result).toContain(a.id);
      expect(result).toContain(b.id);
      expect(result).toContain(c.id);
      // Both A and B should come before C
      expect(result!.indexOf(c.id)).toBeGreaterThan(result!.indexOf(a.id));
      expect(result!.indexOf(c.id)).toBeGreaterThan(result!.indexOf(b.id));
    });

    it('should return null for graph with cycle', async () => {
      const a = await graph.addNode('Test', { name: 'A' });
      const b = await graph.addNode('Test', { name: 'B' });
      const c = await graph.addNode('Test', { name: 'C' });

      // A -> B -> C -> A (cycle)
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(b.id, c.id, 'LINKS');
      await graph.addEdge(c.id, a.id, 'LINKS');

      const result = await graph.topologicalSort();
      expect(result).toBeNull();
    });

    it('should return null for self-referencing cycle', async () => {
      const a = await graph.addNode('Test', { name: 'A' });

      // A -> A (self-loop)
      await graph.addEdge(a.id, a.id, 'LINKS');

      const result = await graph.topologicalSort();
      expect(result).toBeNull();
    });

    it('should handle diamond dependency structure', async () => {
      const a = await graph.addNode('Test', { name: 'A' });
      const b = await graph.addNode('Test', { name: 'B' });
      const c = await graph.addNode('Test', { name: 'C' });
      const d = await graph.addNode('Test', { name: 'D' });

      // A -> B -> D
      // A -> C -> D
      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(b.id, d.id, 'LINKS');
      await graph.addEdge(a.id, c.id, 'LINKS');
      await graph.addEdge(c.id, d.id, 'LINKS');

      const result = await graph.topologicalSort()!;
      expect(result).toHaveLength(4);
      // A must come before both B and C
      expect(result!.indexOf(a.id)).toBeLessThan(result!.indexOf(b.id));
      expect(result!.indexOf(a.id)).toBeLessThan(result!.indexOf(c.id));
      // Both B and C must come before D
      expect(result!.indexOf(b.id)).toBeLessThan(result!.indexOf(d.id));
      expect(result!.indexOf(c.id)).toBeLessThan(result!.indexOf(d.id));
    });

    it('should handle isolated nodes (no edges)', async () => {
      const a = await graph.addNode('Test', { name: 'A' });
      const b = await graph.addNode('Test', { name: 'B' });
      const c = await graph.addNode('Test', { name: 'C' });

      const result = await graph.topologicalSort();
      expect(result).toHaveLength(3);
      expect(result).toContain(a.id);
      expect(result).toContain(b.id);
      expect(result).toContain(c.id);
    });

    it('should correctly sort after cascade-removing a middle node', async () => {
      const a = await graph.addNode('Test', { name: 'A' });
      const b = await graph.addNode('Test', { name: 'B' });
      const c = await graph.addNode('Test', { name: 'C' });

      await graph.addEdge(a.id, b.id, 'LINKS');
      await graph.addEdge(b.id, c.id, 'LINKS');

      // Remove B with cascade — both incident edges are also removed
      await graph.removeNode(b.id, true);

      const result = await graph.topologicalSort();
      expect(result).toHaveLength(2);
      expect(result).toContain(a.id);
      expect(result).toContain(c.id);
    });
  });
}