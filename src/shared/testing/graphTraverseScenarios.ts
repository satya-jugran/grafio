import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider } from '../../index';

/**
 * Shared test scenarios for Graph traverse operations.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphTraverseScenarios(
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

  describe('Graph.traverse()', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
      // Create a simple graph:
      //   A -> B -> C
      //   A -> D -> E
      //   D -> F
      //   B -> D (creates a cycle potential)
      const a = await graph.addNode('Node', { name: 'A' });
      const b = await graph.addNode('Node', { name: 'B' });
      const c = await graph.addNode('Node', { name: 'C' });
      const d = await graph.addNode('Node', { name: 'D' });
      const e = await graph.addNode('Node', { name: 'E' });
      const f = await graph.addNode('Node', { name: 'F' });

      await graph.addEdge(a.id, b.id, 'CONNECTS');
      await graph.addEdge(b.id, c.id, 'CONNECTS');
      await graph.addEdge(a.id, d.id, 'CONNECTS');
      await graph.addEdge(d.id, e.id, 'CONNECTS');
      await graph.addEdge(d.id, f.id, 'CONNECTS');
      await graph.addEdge(b.id, d.id, 'CONNECTS');
    });

    it('should return null when source node does not exist', async () => {
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      await expect(graph.traverse('non-existent', b.id)).resolves.toBeNull();
    });

    it('should return null when target node does not exist', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      await expect(graph.traverse(a.id, 'non-existent')).resolves.toBeNull();
    });

    it('should return [source] when source equals target', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      await expect(graph.traverse(a.id, a.id)).resolves.toEqual([[a.id]]);
    });

    it('should find direct path with BFS', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      await expect(graph.traverse(a.id, b.id, { method: 'bfs' })).resolves.toEqual([[a.id, b.id]]);
    });

    it('should find multi-hop path with BFS', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      const c = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'C' }] } }))[0];
      await expect(graph.traverse(a.id, c.id, { method: 'bfs' })).resolves.toEqual([[a.id, b.id, c.id]]);
    });

    it('should find path through different branches with BFS', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const d = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'D' }] } }))[0];
      const f = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'F' }] } }))[0];
      await expect(graph.traverse(a.id, f.id, { method: 'bfs' })).resolves.toEqual([[a.id, d.id, f.id]]);
    });

    it('should find path with BFS (shortest)', async () => {
      // A -> D -> E vs A -> B -> D -> E
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const d = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'D' }] } }))[0];
      const e = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'E' }] } }))[0];
      await expect(graph.traverse(a.id, e.id, { method: 'bfs' })).resolves.toEqual([[a.id, d.id, e.id]]);
    });

    it('should find path with DFS', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      const c = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'C' }] } }))[0];
      await expect(graph.traverse(a.id, c.id, { method: 'dfs' })).resolves.toEqual([[a.id, b.id, c.id]]);
    });

    it('should return null when no path exists', async () => {
      // Add isolated node G with no connections
      await graph.addNode('Node', { name: 'G' });
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const g = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'G' }] } }))[0];
      await expect(graph.traverse(a.id, g.id)).resolves.toBeNull();
    });

    it('should handle cycle without infinite loop', async () => {
      // Add edge that would create cycle
      const d = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'D' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      await graph.addEdge(d.id, b.id, 'CONNECTS');
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const c = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'C' }] } }))[0];
      await expect(graph.traverse(a.id, c.id, { method: 'bfs' })).resolves.toEqual([[a.id, b.id, c.id]]);
    });

    it('should default to BFS when method not specified', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      const c = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'C' }] } }))[0];
      await expect(graph.traverse(a.id, c.id)).resolves.toEqual([[a.id, b.id, c.id]]);
    });

    it('should filter by nodeTypes during traversal', async () => {
      // Create a mixed-type graph:
      //   A (TypeA) -> B (TypeA) -> C (TypeA)
      //   A (TypeA) -> D (TypeB) -> E (TypeB)
      const typeA = await graph.addNode('TypeA', { name: 'A2' });
      const typeB = await graph.addNode('TypeB', { name: 'B2' });
      const target = await graph.addNode('TypeB', { name: 'Target' });
      await graph.addEdge(typeA.id, typeB.id, 'LINKS');
      await graph.addEdge(typeB.id, target.id, 'LINKS');

      // Without nodeTypes filter - should find path through TypeB nodes
      await expect(graph.traverse(typeA.id, target.id)).resolves.toEqual([[typeA.id, typeB.id, target.id]]);

      // With nodeTypes filter - should NOT find path (blocked by TypeB intermediate)
      await expect(graph.traverse(typeA.id, target.id, { nodeTypes: ['TypeA'] })).resolves.toBeNull();
    });

    it('should filter by edgeTypes during traversal', async () => {
      // Create a mixed-edge graph:
      //   A --PREFER--> B --AVOID--> C
      //   A --AVOID--> D --PREFER--> E
      const a = await graph.addNode('Node', { name: 'X' });
      const b = await graph.addNode('Node', { name: 'Y' });
      const c = await graph.addNode('Node', { name: 'Z' });
      const d = await graph.addNode('Node', { name: 'W' });
      const e = await graph.addNode('Node', { name: 'V' });

      await graph.addEdge(a.id, b.id, 'PREFER');
      await graph.addEdge(b.id, c.id, 'AVOID');
      await graph.addEdge(a.id, d.id, 'AVOID');
      await graph.addEdge(d.id, e.id, 'PREFER');

      // Without edgeTypes filter - shortest path is A -> D -> E (2 hops via AVOID)
      await expect(graph.traverse(a.id, e.id, { method: 'bfs' })).resolves.toEqual([[a.id, d.id, e.id]]);

      // With edgeTypes=PREFER filter - should find A -> B -> ... (blocked by AVOID edges)
      await expect(graph.traverse(a.id, e.id, { method: 'bfs', edgeTypes: ['PREFER'] })).resolves.toBeNull();
    });

    it('should combine nodeTypes and edgeTypes filters', async () => {
      const testGraph = new Graph(provider);
      const src = await testGraph.addNode('Alpha', {});
      const m1 = await testGraph.addNode('Beta', {});
      const tgt = await testGraph.addNode('Beta', {});

      await testGraph.addEdge(src.id, m1.id, 'FOO');
      await testGraph.addEdge(m1.id, tgt.id, 'FOO');

      await expect(testGraph.traverse(src.id, tgt.id, { method: 'bfs' })).resolves.toEqual([[src.id, m1.id, tgt.id]]);

      await expect(testGraph.traverse(src.id, tgt.id, { nodeTypes: ['Beta'], edgeTypes: ['FOO'] }))
        .resolves.toEqual([[src.id, m1.id, tgt.id]]);

      await expect(testGraph.traverse(src.id, tgt.id, { nodeTypes: ['Beta'], edgeTypes: ['BAR'] }))
        .resolves.toBeNull();
    });

    it('should filter by multiple nodeTypes and edgeTypes', async () => {
      // Create a graph with multiple node and edge types:
      //   A (TypeX) --EDGE1--> B (TypeY) --EDGE2--> C (TypeZ)
      //   A (TypeX) --EDGE3--> D (TypeY) --EDGE4--> E (TypeZ)
      const a = await graph.addNode('TypeX', { name: 'A' });
      const b = await graph.addNode('TypeY', { name: 'B' });
      const c = await graph.addNode('TypeZ', { name: 'C' });
      const d = await graph.addNode('TypeY', { name: 'D' });
      const e = await graph.addNode('TypeZ', { name: 'E' });

      await graph.addEdge(a.id, b.id, 'EDGE1');
      await graph.addEdge(b.id, c.id, 'EDGE2');
      await graph.addEdge(a.id, d.id, 'EDGE3');
      await graph.addEdge(d.id, e.id, 'EDGE4');

      // Without any filters - shortest path is A -> D -> E (2 hops)
      await expect(graph.traverse(a.id, e.id, { method: 'bfs' })).resolves.toEqual([[a.id, d.id, e.id]]);

      // With multiple edge types including EDGE3 and EDGE4 - should find path A -> D -> E
      await expect(graph.traverse(a.id, e.id, { method: 'bfs', edgeTypes: ['EDGE3', 'EDGE4', 'OTHER'] }))
        .resolves.toEqual([[a.id, d.id, e.id]]);

      // With multiple node types including TypeY and TypeZ - should find path
      await expect(graph.traverse(a.id, e.id, { method: 'bfs', nodeTypes: ['TypeX', 'TypeY', 'TypeZ'] }))
        .resolves.toEqual([[a.id, d.id, e.id]]);

      // With both multiple nodeTypes and edgeTypes - should find path
      await expect(graph.traverse(a.id, e.id, {
        method: 'bfs',
        nodeTypes: ['TypeX', 'TypeY', 'TypeZ'],
        edgeTypes: ['EDGE3', 'EDGE4']
      })).resolves.toEqual([[a.id, d.id, e.id]]);

      // With edgeTypes NOT including EDGE3 - should fail (blocked by wrong edge type)
      await expect(graph.traverse(a.id, e.id, {
        method: 'bfs',
        edgeTypes: ['EDGE1', 'EDGE2', 'OTHER']
      })).resolves.toBeNull();

      // With nodeTypes NOT including TypeY - should fail (blocked by intermediate node type)
      await expect(graph.traverse(a.id, e.id, {
        method: 'bfs',
        nodeTypes: ['TypeX', 'TypeZ']  // Missing TypeY
      })).resolves.toBeNull();

      // With wildcard '*' in nodeTypes - should include all nodes
      await expect(graph.traverse(a.id, e.id, {
        method: 'bfs',
        nodeTypes: ['*']
      })).resolves.toEqual([[a.id, d.id, e.id]]);

      // With wildcard '*' in edgeTypes - should include all edges
      await expect(graph.traverse(a.id, e.id, {
        method: 'bfs',
        edgeTypes: ['*']
      })).resolves.toEqual([[a.id, d.id, e.id]]);
    });

    it('should find all paths using wildcard source', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      const c = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'C' }] } }))[0];
      const d = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'D' }] } }))[0];
      const e = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'E' }] } }))[0];
      const f = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'F' }] } }))[0];

      // Find all paths from A to any node
      const paths = await graph.traverse(a.id, '*');

      expect(paths).not.toBeNull();
      expect(paths!.length).toBeGreaterThan(0);

      const targets = paths!.map(p => p[p.length - 1]);
      expect(targets).toContain(b.id);
      expect(targets).toContain(c.id);
      expect(targets).toContain(d.id);
      expect(targets).toContain(e.id);
      expect(targets).toContain(f.id);
    });

    it('should find all paths using wildcard target', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      const c = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'C' }] } }))[0];
      const d = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'D' }] } }))[0];

      // Find all paths to D from any node
      const paths = await graph.traverse('*', d.id);

      expect(paths).not.toBeNull();
      expect(paths!.length).toBeGreaterThan(0);

      const sources = paths!.map(p => p[0]);
      expect(sources).toContain(a.id);
      expect(sources).toContain(b.id);
    });

    it('should find all paths using wildcard source and target', async () => {
      const paths = await graph.traverse('*', '*');

      expect(paths).not.toBeNull();
      expect(paths!.length).toBeGreaterThan(0);

      // Each path should have at least 1 node (source = target for single node)
      paths!.forEach(p => {
        expect(p.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should find all paths using array of sources', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      const e = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'E' }] } }))[0];

      // Find paths from [A, B] to E
      const paths = await graph.traverse([a.id, b.id], e.id);

      expect(paths).not.toBeNull();
      expect(paths!.length).toBeGreaterThan(0);

      const sources = paths!.map(p => p[0]);
      expect(sources).toContain(a.id);
      expect(sources).toContain(b.id);
      paths!.forEach(p => {
        expect(p[p.length - 1]).toBe(e.id);
      });
    });

    it('should find all paths using array of sources and targets', async () => {
      const a = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'A' }] } }))[0];
      const b = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'B' }] } }))[0];
      const c = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'C' }] } }))[0];
      const e = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'E' }] } }))[0];
      const f = (await graph.getNodes({ filter: { properties: [{ key: 'name', value: 'F' }] } }))[0];

      // Find paths from [A, B] to [C, E, F]
      const paths = await graph.traverse([a.id, b.id], [c.id, e.id, f.id]);

      expect(paths).not.toBeNull();
      expect(paths!.length).toBeGreaterThan(0);

      paths!.forEach(p => {
        expect([a.id, b.id]).toContain(p[0]);
        expect([c.id, e.id, f.id]).toContain(p[p.length - 1]);
      });
    });
  });
}