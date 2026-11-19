import { describe, expect, it } from '@jest/globals';
import { Graph } from '../../../src/Graph';
import { InMemoryStorageProvider } from '../../../src/storage/InMemoryStorageProvider';

describe('AdjacencyStore', () => {
  describe('Hybrid CSR + Delta adjacency and compaction', () => {
    it('maintains exact topology across bulk insert, delta adds/deletes, and compact()', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);

      const nodes = await graph.addNodes([
        { labels: 'Node', properties: { name: 'n0' } },
        { labels: 'Node', properties: { name: 'n1' } },
        { labels: 'Node', properties: { name: 'n2' } },
        { labels: 'Node', properties: { name: 'n3' } },
      ]);

      // Initial bulk addEdges compacts straight into CSR
      const edges = await graph.addEdges([
        { sourceId: nodes[0].id, targetId: nodes[1].id, type: 'GO' },
        { sourceId: nodes[1].id, targetId: nodes[2].id, type: 'GO' },
      ]);
      expect(store.adjacency.csrEdgeCount).toBe(2);
      expect(store.adjacency.deltaEdgeCount).toBe(0);

      // Incremental add goes to delta tier while delete masks CSR tombstone
      await graph.addEdge(nodes[2].id, nodes[3].id, 'GO');
      await graph.removeEdge(edges[0].id);
      await graph.addEdge(nodes[0].id, nodes[1].id, 'GO2');

      expect(store.adjacency.deltaEdgeCount).toBe(2);
      expect(store.adjacency.deadCsrEdges).toBe(1);

      expect(await graph.traverse(nodes[0].id, nodes[3].id)).toEqual([
        [nodes[0].id, nodes[1].id, nodes[2].id, nodes[3].id],
      ]);
      expect(await graph.getEdgesFrom(nodes[0].id)).toHaveLength(1);
      expect((await graph.getEdgesFrom(nodes[0].id))[0].type).toBe('GO2');

      // Compaction folds all deltas & purges tombstones
      graph.compact();
      expect(store.adjacency.csrEdgeCount).toBe(3);
      expect(store.adjacency.deltaEdgeCount).toBe(0);
      expect(store.adjacency.deadCsrEdges).toBe(0);

      expect(await graph.traverse(nodes[0].id, nodes[3].id)).toEqual([
        [nodes[0].id, nodes[1].id, nodes[2].id, nodes[3].id],
      ]);
      expect(await graph.topologicalSort()).toEqual([
        nodes[0].id,
        nodes[1].id,
        nodes[2].id,
        nodes[3].id,
      ]);
    });
  });
});
