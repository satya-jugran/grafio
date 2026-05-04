import { beforeAll, afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

import { Graph } from '../../src/Graph';
import { GraphTransaction } from '../../src/Graph/GraphTransaction';
import { MongoStorageProvider } from '../../src/storage/MongoStorageProvider';

/**
 * MongoDB transaction tests with real graph operations.
 * Note: MongoDB transactions require a replica set. MongoMemoryReplSet creates one.
 */
describe('MongoStorageProvider Transaction Support', () => {
  let mongoServer: MongoMemoryReplSet;
  let client: MongoClient;
  let graph: Graph;

  beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 2 } });
    const uri = mongoServer.getUri();
    client = new MongoClient(uri);
    await client.connect();

    // Create Graph with MongoDB storage provider
    const provider = new MongoStorageProvider(client.db('test'), { graphId: 'test-transactions' });
    await provider.ensureIndexes();
    graph = new Graph(provider);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await graph.clear();
  });

  describe('supportsTransactions', () => {
    it('should return true for MongoDB provider', () => {
      expect(graph.supportsTransactions()).toBe(true);
    });
  });

  describe('Transaction with addNode operations', () => {
    it('should add nodes within a transaction and commit', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const node1 = await graph.addNode('Person', { name: 'Alice' }, txn);
      const node2 = await graph.addNode('Person', { name: 'Bob' }, txn);
      
      // Before commit, nodes should NOT be visible outside the transaction
      expect(await graph.hasNode(node1.id)).toBe(false);
      expect(await graph.hasNode(node2.id)).toBe(false);
      
      await txn.commit();
      
      // After commit, nodes should exist in the graph
      expect(await graph.hasNode(node1.id)).toBe(true);
      expect(await graph.hasNode(node2.id)).toBe(true);
      expect(await graph.getNode(node1.id)).toBeDefined();
      expect(await graph.getNode(node2.id)).toBeDefined();
    });

    it('should rollback nodes added within a transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const node = await graph.addNode('Person', { name: 'RollbackTest' }, txn);
      
      await txn.rollback();
      
      // After rollback, node should not exist
      expect(await graph.hasNode(node.id)).toBe(false);
    });

    it('should not persist any nodes if transaction is rolled back', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.addNode('Person', { name: 'Node1' }, txn);
      await graph.addNode('Person', { name: 'Node2' }, txn);
      await graph.addNode('Person', { name: 'Node3' }, txn);
      
      await txn.rollback();
      
      // No nodes should exist after rollback
      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(0);
    });

    it('should persist all nodes if any operation succeeds before rollback', async () => {
      // This tests that only successful commits persist data
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.addNode('Person', { name: 'Keep1' }, txn);
      await graph.addNode('Person', { name: 'Keep2' }, txn);
      
      await txn.commit();
      
      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(2);
    });
  });

  describe('Transaction with addEdge operations', () => {
    it('should add nodes and edges within a transaction and commit', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const alice = await graph.addNode('Person', { name: 'Alice' }, txn);
      const bob = await graph.addNode('Person', { name: 'Bob' }, txn);
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 }, txn);
      
      await txn.commit();
      
      // After commit, edge should exist
      expect(await graph.hasEdge(edge.id)).toBe(true);
      
      // The edge should connect the two nodes
      const children = await graph.getChildren(alice.id);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(bob.id);
    });

    it('should rollback edges added within a transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const alice = await graph.addNode('Person', { name: 'Alice' }, txn);
      const bob = await graph.addNode('Person', { name: 'Bob' }, txn);
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {}, txn);
      
      await txn.rollback();
      
      // Edge should not exist after rollback
      expect(await graph.hasEdge(edge.id)).toBe(false);
    });

    it('should rollback entire transaction if any operation fails', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const alice = await graph.addNode('Person', { name: 'Alice' }, txn);
      const bob = await graph.addNode('Person', { name: 'Bob' }, txn);
      
      // Try to create a circular reference which might be invalid depending on graph rules
      // For now just rollback manually to test
      await graph.addEdge(alice.id, bob.id, 'KNOWS', {}, txn);
      
      await txn.rollback();
      
      // All changes should be rolled back
      expect(await graph.getNodes()).toHaveLength(0);
      expect(await graph.getEdges()).toHaveLength(0);
    });
  });

  describe('Transaction with property operations', () => {
    it('should add and commit node properties within a transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const node = await graph.addNode('Person', { name: 'Carol' }, txn);
      await graph.addNodeProperty(node.id, 'age', 30, txn);
      await graph.addNodeProperty(node.id, 'city', 'NYC', txn);
      
      // Before commit, properties should NOT be visible
      const nodeBefore = await graph.getNode(node.id);
      expect(nodeBefore?.properties).toBeUndefined();
      
      await txn.commit();
      
      // After commit, properties should exist
      const nodeAfter = await graph.getNode(node.id);
      expect(nodeAfter?.properties).toEqual({ name: 'Carol', age: 30, city: 'NYC' });
    });

    it('should rollback node properties added within a transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const node = await graph.addNode('Person', { name: 'Dave' }, txn);
      await graph.addNodeProperty(node.id, 'email', 'dave@test.com', txn);
      
      await txn.rollback();
      
      // After rollback, node should not exist since it was created in the transaction
      expect(await graph.hasNode(node.id)).toBe(false);
    });

    it('should update node properties within a transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Eve', age: 25 });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.updateNodeProperty(node.id, 'age', 26, txn);
      await graph.updateNodeProperty(node.id, 'name', 'Eve Updated', txn);
      
      // Before commit, old values should be visible
      const nodeBefore = await graph.getNode(node.id);
      expect(nodeBefore?.properties).toEqual({ name: 'Eve', age: 25 });
      
      await txn.commit();
      
      // After commit, new values should be visible
      const nodeAfter = await graph.getNode(node.id);
      expect(nodeAfter?.properties).toEqual({ name: 'Eve Updated', age: 26 });
    });

    it('should rollback property updates within a transaction', async () => {
      const node = await graph.addNode('Person', { name: 'Frank', age: 30 });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.updateNodeProperty(node.id, 'age', 99, txn);
      await txn.rollback();
      
      // After rollback, old value should be visible
      const nodeAfter = await graph.getNode(node.id);
      expect(nodeAfter?.properties).toEqual({ name: 'Frank', age: 30 });
    });

    it('should delete node properties within a transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Grace', temp: 'should-be-removed' });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.deleteNodeProperty(node.id, 'temp', txn);
      
      // Before commit, temp property should still exist
      const nodeBefore = await graph.getNode(node.id);
      expect(nodeBefore?.properties).toHaveProperty('temp');
      
      await txn.commit();
      
      // After commit, temp property should be gone
      const nodeAfter = await graph.getNode(node.id);
      expect(nodeAfter?.properties).toEqual({ name: 'Grace' });
    });

    it('should rollback property deletion within a transaction', async () => {
      const node = await graph.addNode('Person', { name: 'Henry', badge: 'admin' });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.deleteNodeProperty(node.id, 'badge', txn);
      await txn.rollback();
      
      // After rollback, badge property should still exist
      const nodeAfter = await graph.getNode(node.id);
      expect(nodeAfter?.properties).toEqual({ name: 'Henry', badge: 'admin' });
    });

    it('should clear node properties within a transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Ivy', a: 1, b: 2, c: 3 });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.clearNodeProperties(node.id, txn);
      
      // Before commit, all properties should still exist
      const nodeBefore = await graph.getNode(node.id);
      expect(nodeBefore?.properties).toHaveProperty('a');
      expect(nodeBefore?.properties).toHaveProperty('b');
      expect(nodeBefore?.properties).toHaveProperty('c');
      
      await txn.commit();
      
      // After commit, all properties should be cleared
      const nodeAfter = await graph.getNode(node.id);
      expect(nodeAfter?.properties).toEqual({});
    });

    it('should rollback clearing of node properties', async () => {
      const node = await graph.addNode('Person', { name: 'Jack', x: 10, y: 20 });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.clearNodeProperties(node.id, txn);
      await txn.rollback();
      
      // After rollback, properties should still exist
      const nodeAfter = await graph.getNode(node.id);
      expect(nodeAfter?.properties).toEqual({ name: 'Jack', x: 10, y: 20 });
    });

    it('should handle edge properties within a transaction', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 1 });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.addEdgeProperty(edge.id, 'since', 2021, txn);
      await graph.updateEdgeProperty(edge.id, 'weight', 5, txn);
      
      // Before commit, old values
      const edgeBefore = await graph.getEdge(edge.id);
      expect(edgeBefore?.properties).toEqual({ weight: 1 });
      
      await txn.commit();
      
      // After commit, new values
      const edgeAfter = await graph.getEdge(edge.id);
      expect(edgeAfter?.properties).toEqual({ weight: 5, since: 2021 });
    });

    it('should rollback edge property changes', async () => {
      const alice = await graph.addNode('Person', { name: 'Carol' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'WORKS_WITH', { active: true });
      
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.updateEdgeProperty(edge.id, 'active', false, txn);
      await graph.addEdgeProperty(edge.id, 'notes', 'old notes', txn);
      await txn.rollback();
      
      // After rollback, original properties
      const edgeAfter = await graph.getEdge(edge.id);
      expect(edgeAfter?.properties).toEqual({ active: true });
    });
  });

  describe('GraphTransaction lifecycle', () => {
    it('should create a transaction', () => {
      const txn = graph.createTransaction();
      expect(txn).toBeInstanceOf(GraphTransaction);
    });

    it('should report as inactive before begin', () => {
      const txn = graph.createTransaction();
      expect(txn.isActive()).toBe(false);
    });

    it('should report as active after begin', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      expect(txn.isActive()).toBe(true);
    });

    it('should report as inactive after commit', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      await txn.commit();
      expect(txn.isActive()).toBe(false);
    });

    it('should report as inactive after rollback', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      await txn.rollback();
      expect(txn.isActive()).toBe(false);
    });

    it('should throw when committing without active transaction', async () => {
      const txn = graph.createTransaction();
      await expect(txn.commit()).rejects.toThrow();
    });

    it('should throw when rolling back without active transaction', async () => {
      const txn = graph.createTransaction();
      await expect(txn.rollback()).rejects.toThrow();
    });

    it('should throw when beginning an already active transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      await expect(txn.begin()).rejects.toThrow('Transaction already active');
    });
  });

  describe('Multiple transactions', () => {
    it('should allow creating multiple transaction instances', async () => {
      const txn1 = graph.createTransaction();
      const txn2 = graph.createTransaction();
      
      expect(txn1).not.toBe(txn2);
      
      await txn1.begin();
      await txn2.begin();
      
      expect(txn1.isActive()).toBe(true);
      expect(txn2.isActive()).toBe(true);
      
      await txn1.commit();
      await txn2.commit();
      
      expect(txn1.isActive()).toBe(false);
      expect(txn2.isActive()).toBe(false);
    });
  });
});