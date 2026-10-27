import { describe, expect, it } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { GraphToMermaid } from '../../src/Graph/GraphToMermaid';
import { Node } from '../../src/Node';
import { InMemoryStorageProvider } from '../../src/storage/InMemoryStorageProvider';

describe('graph edge cases', () => {
  it('supports wildcard traversal with node-type filtering', async () => {
    const graph = new Graph();
    const person = await graph.addNode('Person', { name: 'Alice' });
    const target = await graph.addNode('Person', { name: 'Bob' });
    await graph.addNode('Employee', { name: 'Carol' });
    await graph.addEdge(person.id, target.id, 'KNOWS');

    const paths = await graph.traverse('*', target.id, {
      nodeTypes: ['Person'],
      maxResults: 5,
    });

    expect(paths).toEqual([
      [person.id, target.id],
      [target.id],
    ]);
  });

  it('limits wildcard-to-wildcard traversal results', async () => {
    const graph = new Graph();
    const first = await graph.addNode('Person');
    const second = await graph.addNode('Person');
    await graph.addEdge(first.id, second.id, 'KNOWS');

    const paths = await graph.traverse('*', '*', { maxResults: 1 });

    expect(paths).toHaveLength(1);
  });

  it('rejects an unbounded wildcard traversal at the node limit', async () => {
    const graph = new Graph();
    for (let i = 0; i < 101; i++) {
      await graph.addNode('Person', { index: i });
    }

    await expect(graph.traverse('*', 'missing')).rejects.toThrow();
  });

  it('skips dangling edges during topological sorting', async () => {
    const graph = await Graph.importJSON({
      nodes: [
        { id: 'a', labels: ['Node'], properties: {} },
      ],
      edges: [
        { id: 'dangling', sourceId: 'a', targetId: 'missing', type: 'LINKS', properties: {} },
      ],
    });

    expect(await graph.topologicalSort()).toEqual(['a']);
  });

  it('handles transaction handles before and after begin', async () => {
    const graph = new Graph();
    const transaction = graph.createTransaction();

    expect((transaction as any)._getHandle()).toBeUndefined();
    await transaction.begin();
    expect((transaction as any)._getHandle()).toBeDefined();
    await transaction.rollback();
  });

  it('validates Mermaid JSON and formats long and colliding ids', () => {
    expect(() => new GraphToMermaid('{invalid json}')).toThrow();
    expect(() => new GraphToMermaid('{}')).toThrow();
    expect(() => new GraphToMermaid('{"nodes":[]}')).toThrow();

    const mermaid = new GraphToMermaid({
      nodes: [
        { id: 'node!', labels: ['Person'], properties: { bio: 'This is a long property value' } },
        { id: 'node?', labels: ['Person'], properties: {} },
      ],
      edges: [],
    }, { showProperties: true });

    const output = mermaid.toString();
    expect(output).toContain('...');
    expect(output).toContain('node_');
  });

  it('accepts an already-frozen node property object', () => {
    const properties = Object.freeze({ name: 'Alice' });
    const node = new Node('Person', properties);

    expect(node.properties.name).toBe('Alice');
  });

  it('rejects unsupported node and edge property values', async () => {
    const graph = new Graph();
    const source = await graph.addNode('Person');
    const target = await graph.addNode('Person');

    await expect(graph.addNode('Person', { metadata: { nested: true } }))
      .rejects.toThrow();
    await expect(graph.addNode('Person', { callback: () => undefined }))
      .rejects.toThrow();
    await expect(graph.addEdge(source.id, target.id, 'LINKS', { metadata: { nested: true } }))
      .rejects.toThrow();
  });

  it('reports missing edge endpoints and missing direct-edge nodes', async () => {
    const graph = new Graph();
    const node = await graph.addNode('Person');

    await expect(graph.addEdge('missing', node.id, 'LINKS')).rejects.toThrow();
    await expect(graph.addEdge(node.id, 'missing', 'LINKS')).rejects.toThrow();
    await expect(graph.getDirectEdgesBetween('missing', node.id)).rejects.toThrow();
    await expect(graph.getDirectEdgesBetween(node.id, 'missing')).rejects.toThrow();
  });

  it('passes filtering options to aggregate queries', async () => {
    const graph = new Graph();
    const source = await graph.addNode('Person', { age: 30 });
    const target = await graph.addNode('Person', { age: 40 });
    await graph.addEdge(source.id, target.id, 'KNOWS', { weight: 2 });

    const nodeStats = await graph.aggregateNodeProperty('age', {
      filter: { types: ['Person'] },
      distinct: true,
    });
    const edgeStats = await graph.aggregateEdgeProperty('weight', {
      filter: { types: ['KNOWS'] },
      distinct: true,
    });

    expect(nodeStats.count).toBe(2);
    expect(edgeStats.count).toBe(1);
  });

  it('delegates cache warming to providers that support it', async () => {
    const provider = new InMemoryStorageProvider() as InMemoryStorageProvider & {
      warmCache: () => Promise<void>;
    };
    let warmed = false;
    provider.warmCache = async () => {
      warmed = true;
    };

    const graph = new Graph(provider);
    await graph.warmCache();

    expect(warmed).toBe(true);
  });
});
