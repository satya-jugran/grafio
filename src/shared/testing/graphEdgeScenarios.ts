import { beforeEach, describe, it, expect } from '@jest/globals';
import { Graph } from '../../index';
import type { IStorageProvider } from '../../index';
import { NodeNotFoundError } from '../../errors';

/**
 * Shared test scenarios for Graph Edge operations.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Function that returns the storage provider (undefined for InMemory)
 * @param beforeAllFunc - Optional beforeAll setup function
 * @param afterAllFunc - Optional afterAll cleanup function
 */
export function runGraphEdgeScenarios(
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

  describe('Graph.Edge Operations', () => {
    let graph: Graph;
    let aliceId: string;
    let bobId: string;
    let charlieId: string;

    beforeEach(async () => {
      graph = new Graph(provider);
      aliceId = (await graph.addNode('Person', { name: 'Alice' })).id;
      bobId = (await graph.addNode('Person', { name: 'Bob' })).id;
      charlieId = (await graph.addNode('Person', { name: 'Charlie' })).id;
    });

    it('should add an edge between nodes', async () => {
      const edge = await graph.addEdge(aliceId, bobId, 'KNOWS');
      expect(edge.id).toBeDefined();
      expect(edge.sourceId).toBe(aliceId);
      expect(edge.targetId).toBe(bobId);
      expect(edge.type).toBe('KNOWS');
    });

    it('should throw NodeNotFoundError when source does not exist', async () => {
      await expect(graph.addEdge('non-existent', bobId, 'KNOWS')).rejects.toThrow(NodeNotFoundError);
    });

    it('should throw NodeNotFoundError when target does not exist', async () => {
      await expect(graph.addEdge(aliceId, 'non-existent', 'KNOWS')).rejects.toThrow(NodeNotFoundError);
    });

    it('should get edge by id', async () => {
      const edge = await graph.addEdge(aliceId, bobId, 'KNOWS');
      const retrieved = await graph.getEdge(edge.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(edge.id);
    });

    it('should check if edge exists by id', async () => {
      const edge = await graph.addEdge(aliceId, bobId, 'KNOWS');
      await expect(graph.hasEdge(edge.id)).resolves.toBe(true);
      await expect(graph.hasEdge('non-existent-id')).resolves.toBe(false);
    });

    it('should remove an edge', async () => {
      const edge = await graph.addEdge(aliceId, bobId, 'KNOWS');
      await expect(graph.removeEdge(edge.id)).resolves.toBe(true);
      await expect(graph.hasEdge(edge.id)).resolves.toBe(false);
    });

    it('should return false when removing non-existent edge', async () => {
      await expect(graph.removeEdge('non-existent-id')).resolves.toBe(false);
    });

    it('should get parents of a node', async () => {
      await graph.addEdge(bobId, aliceId, 'KNOWS');
      await graph.addEdge(charlieId, aliceId, 'KNOWS');

      const parents = await graph.getParents(aliceId);
      expect(parents).toHaveLength(2);
      expect(parents.map(n => n.properties.name).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should get children of a node', async () => {
      await graph.addEdge(aliceId, bobId, 'KNOWS');
      await graph.addEdge(aliceId, charlieId, 'KNOWS');

      const children = await graph.getChildren(aliceId);
      expect(children).toHaveLength(2);
      expect(children.map(n => n.properties.name).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should get edges from a node', async () => {
      await graph.addEdge(aliceId, bobId, 'KNOWS');
      await graph.addEdge(aliceId, charlieId, 'LIKES');

      const edges = await graph.getEdgesFrom(aliceId);
      expect(edges).toHaveLength(2);
      expect(edges.map(e => e.type).sort()).toEqual(['KNOWS', 'LIKES']);
    });

    it('should get edges to a node', async () => {
      await graph.addEdge(bobId, aliceId, 'KNOWS');
      await graph.addEdge(charlieId, aliceId, 'LIKES');

      const edges = await graph.getEdgesTo(aliceId);
      expect(edges).toHaveLength(2);
      expect(edges.map(e => e.type).sort()).toEqual(['KNOWS', 'LIKES']);
    });

    it('should get edges between two nodes', async () => {
      await graph.addEdge(aliceId, bobId, 'KNOWS');
      await graph.addEdge(bobId, aliceId, 'KNOWS');

      const edges = await graph.getDirectEdgesBetween(aliceId, bobId);
      expect(edges).toHaveLength(2);
    });

    it('should get edges by type', async () => {
      await graph.addEdge(aliceId, bobId, 'KNOWS');
      await graph.addEdge(aliceId, charlieId, 'KNOWS');
      await graph.addEdge(bobId, charlieId, 'LIKES');

      const knowsEdges = await graph.getEdgesByType('KNOWS');
      expect(knowsEdges).toHaveLength(2);
    });

    it('should throw NodeNotFoundError for getParents on non-existent node', async () => {
      await expect(graph.getParents('non-existent')).rejects.toThrow(NodeNotFoundError);
    });

    it('should throw NodeNotFoundError for getChildren on non-existent node', async () => {
      await expect(graph.getChildren('non-existent')).rejects.toThrow(NodeNotFoundError);
    });
  });
}