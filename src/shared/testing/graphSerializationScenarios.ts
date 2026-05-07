import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider } from '../../index';

/**
 * Shared test scenarios for Graph serialization (exportJSON/importJSON round-trip).
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphSerializationScenarios(
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

  describe('Graph.Serialization', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should serialize an empty graph', async () => {
      const data = await graph.exportJSON();
      expect(data).toEqual({ graphId: 'default', nodes: [], edges: [] });
    });

    it('should serialize a graph with nodes and edges', async () => {
      const aliceId = (await graph.addNode('Person', { name: 'Alice', age: 30 })).id;
      const bobId = (await graph.addNode('Person', { name: 'Bob', age: 25 })).id;
      const edge = await graph.addEdge(aliceId, bobId, 'KNOWS', { since: 2020 });

      const data = await graph.exportJSON();
      expect(data.nodes).toHaveLength(2);
      expect(data.edges).toHaveLength(1);
      const aliceNode = data.nodes.find(n => n.id === aliceId);
      const bobNode = data.nodes.find(n => n.id === bobId);
      expect(aliceNode).toEqual({ id: aliceId, type: 'Person', properties: { name: 'Alice', age: 30 } });
      expect(bobNode).toEqual({ id: bobId, type: 'Person', properties: { name: 'Bob', age: 25 } });
      expect(data.edges[0].id).toBeDefined();
      expect(data.edges[0].id).toBe(edge.id);
      expect(data.edges[0]).toEqual({
        id: edge.id,
        sourceId: aliceId,
        targetId: bobId,
        type: 'KNOWS',
        properties: { since: 2020 },
      });
    });

    it('should reconstruct graph from data', async () => {
      const aliceId = (await graph.addNode('Person', { name: 'Alice', age: 30 })).id;
      const bobId = (await graph.addNode('Person', { name: 'Bob', age: 25 })).id;
      await graph.addEdge(aliceId, bobId, 'KNOWS', { since: 2020 });

      const data = await graph.exportJSON();
      await graph.clear();
      const restored = await Graph.importJSON(data, provider);

      const restoredNodes = await restored.getNodes();
      const restoredEdges = await restored.getEdges();
      expect(restoredNodes).toHaveLength(2);
      expect(restoredEdges).toHaveLength(1);

      const alice = restoredNodes.find(n => n.properties.name === 'Alice');
      expect(alice?.properties).toEqual({ name: 'Alice', age: 30 });
    });

    it('should handle round-trip serialization', async () => {
      const a = await graph.addNode('Node', { name: 'A' });
      const b = await graph.addNode('Node', { name: 'B' });
      const c = await graph.addNode('Node', { name: 'C' });
      await graph.addEdge(a.id, b.id, 'CONNECTS', { label: 'first' });
      await graph.addEdge(b.id, c.id, 'CONNECTS', { label: 'second' });

      const data = await graph.exportJSON();
      await graph.clear();
      const restored = await Graph.importJSON(data, provider);

      expect(await restored.getNodes()).toHaveLength(3);
      expect(await restored.getEdges()).toHaveLength(2);
    });

    it('exportJSON() returns a deep copy — mutating the snapshot does not affect the live graph', async () => {
      const nodeId = (await graph.addNode('Person', { name: 'Alice', tag: 'a' })).id;

      const snapshot = await graph.exportJSON();
      // Mutate the snapshot
      snapshot.nodes[0].properties['name'] = 'Mutated';
      snapshot.nodes[0].properties['tag'] = 'b';

      // Live graph must be unchanged
      const live = await graph.getNode(nodeId);
      expect(live?.properties['name']).toBe('Alice');
      expect(live?.properties['tag']).toBe('a');
    });
  });
}