import { beforeAll, afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

import { MongoGraphFactory } from '../../src/storage/MongoGraphFactory';

describe('MongoGraphFactory', () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let factory: MongoGraphFactory;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    client = new MongoClient(uri);
    await client.connect();
    factory = new MongoGraphFactory(client.db('test'));
    await factory.ensureIndexes();
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear all graphs by clearing all known graph partitions
    const graphA = factory.forGraph('graph-a');
    const graphB = factory.forGraph('graph-b');
    const graphDefault = factory.forGraph('default');
    await Promise.all([graphA.clear(), graphB.clear(), graphDefault.clear()]);
  });

  it('forGraph() should return a Graph instance', () => {
    const graph = factory.forGraph('any-id');
    expect(graph).toBeDefined();
  });

  it('forGraph() should return graphs for different graphIds that share the same collections', async () => {
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

  it('forGraph() should isolate clear() to the given graphId', async () => {
    const graphA = factory.forGraph('graph-a');
    const graphB = factory.forGraph('graph-b');

    await graphA.addNode('Person', { name: 'Alice' });
    await graphB.addNode('Person', { name: 'Bob' });

    await graphA.clear();

    expect(await graphA.getNodes()).toHaveLength(0);
    expect(await graphB.getNodes()).toHaveLength(1);
  });

  it('forGraph() with no argument should default to "default" graphId', async () => {
    const graphDefault = factory.forGraph();
    const graphExplicit = factory.forGraph('default');

    await graphDefault.addNode('Person', { name: 'Carol' });

    const nodes = await graphExplicit.getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].properties.name).toBe('Carol');
  });

  it('forGraph() should allow same element id in different graphId partitions', async () => {
    const graphA = factory.forGraph('graph-a');
    const graphB = factory.forGraph('graph-b');

    await graphA.addNode('Person', { name: 'Dan' });
    await graphB.addNode('Person', { name: 'Eve' });

    // Both graphs can have a node with id 'n1'
    const nodeA = await graphA.getNode((await graphA.getNodes())[0].id);
    const nodeB = await graphB.getNode((await graphB.getNodes())[0].id);

    expect(nodeA?.properties.name).toBe('Dan');
    expect(nodeB?.properties.name).toBe('Eve');
  });

  describe('fromGraphData()', () => {
    it('should import graph data and return a Graph instance', async () => {
      const data = {
        nodes: [
          { id: 'n1', type: 'Person', properties: { name: 'Alice' } },
          { id: 'n2', type: 'Person', properties: { name: 'Bob' } },
        ],
        edges: [
          { id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'KNOWS', properties: {} },
        ],
      };

      const graph = await factory.fromGraphData(data, 'import-test');

      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes[0].properties.name).toBe('Alice');
      expect(nodes[1].properties.name).toBe('Bob');

      const edges = await graph.getEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0].type).toBe('KNOWS');
    });

    it('should use default graphId when not specified', async () => {
      const data = {
        nodes: [
          { id: 'n1', type: 'Person', properties: { name: 'Carol' } },
        ],
        edges: [],
      };

      const graph = await factory.fromGraphData(data);

      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Carol');
    });

    it('should filter out data when graphId does not match', async () => {
      const data = {
        graphId: 'other-graph',
        nodes: [
          { id: 'n1', type: 'Person', properties: { name: 'ShouldNotImport' } },
        ],
        edges: [],
      };

      const graph = await factory.fromGraphData(data, 'my-graph');

      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(0);
    });

    it('should import data when graphId matches', async () => {
      const data = {
        graphId: 'my-graph',
        nodes: [
          { id: 'n1', type: 'Person', properties: { name: 'ShouldImport' } },
        ],
        edges: [],
      };

      const graph = await factory.fromGraphData(data, 'my-graph');

      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('ShouldImport');
    });

  });
});
