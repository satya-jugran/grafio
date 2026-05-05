import { beforeEach, describe, expect, it } from '@jest/globals';
import { Graph, GraphTransaction, TransactionNotActiveError, TransactionFailedError } from '../../src/index';

/**
 * Comprehensive transaction tests for Graph transaction support.
 * These tests cover the transaction overlay system in InMemoryStorageProvider,
 * ensuring proper isolation, commit, and rollback behavior.
 */
describe('Graph Transaction Support', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  // ===========================================================================
  // Transaction Lifecycle
  // ===========================================================================
  describe('Transaction lifecycle', () => {
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
      await expect(txn.commit()).rejects.toThrow(TransactionNotActiveError);
    });

    it('should throw when rolling back without active transaction', async () => {
      const txn = graph.createTransaction();
      await expect(txn.rollback()).rejects.toThrow(TransactionNotActiveError);
    });

    it('should throw when beginning an already active transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      await expect(txn.begin()).rejects.toThrow('Transaction already active');
    });

    it('should support multiple concurrent transactions', async () => {
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

    // it.skip('should return true for supportsTransactions', () => {
    //   expect(graph.supportsTransactions()).toBe(true);
    // });
  });

  // ===========================================================================
  // Node CRUD Operations in Transactions
  // ===========================================================================
  describe('Node CRUD in transactions', () => {
    it('should add node within transaction and commit', async () => {
      const txn = graph.createTransaction();
      await txn.begin();

      const node = await graph.addNode('Person', { name: 'Alice' }, txn);
      await txn.commit();

      expect(await graph.hasNode(node.id)).toBe(true);
      const found = await graph.getNode(node.id);
      expect(found?.type).toBe('Person');
      expect(found?.properties['name']).toBe('Alice');
    });

    // it.skip('should add multiple nodes within transaction and commit', async () => {
    //   const txn = graph.createTransaction();
    //   await txn.begin();
    //
    //   const node1 = await graph.addNode('Person', { name: 'Alice' }, txn);
    //   const node2 = await graph.addNode('Person', { name: 'Bob' }, txn);
    //   const node3 = await graph.addNode('Course', { title: 'Math' }, txn);
    //
    //   await txn.commit();
    //
    //   expect(await graph.hasNode(node1.id)).toBe(true);
    //   expect(await graph.hasNode(node2.id)).toBe(true);
    //   expect(await graph.hasNode(node3.id)).toBe(true);
    //   expect(await graph.getNodes()).toHaveLength(3);
    // });

    it('should rollback added node on rollback', async () => {
      const txn = graph.createTransaction();
      await txn.begin();

      const node = await graph.addNode('Person', { name: 'Alice' }, txn);
      await txn.rollback();

      expect(await graph.hasNode(node.id)).toBe(false);
    });

    it('should remove existing node within transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.removeNode(node.id, false, txn);
      await txn.commit();

      expect(await graph.hasNode(node.id)).toBe(false);
    });

    it('should rollback removed node on rollback', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.removeNode(node.id, false, txn);
      await txn.rollback();

      expect(await graph.hasNode(node.id)).toBe(true);
      const found = await graph.getNode(node.id);
      expect(found?.properties['name']).toBe('Alice');
    });

    it('should remove node with cascade within transaction and commit', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.removeNode(node1.id, true, txn);
      await txn.commit();

      expect(await graph.hasNode(node1.id)).toBe(false);
      // Verify edge was cascade-deleted
      const edges = await graph.getEdges();
      expect(edges.some(e => e.sourceId === node1.id && e.targetId === node2.id)).toBe(false);
    });

    it('should rollback remove node with cascade', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.removeNode(node1.id, true, txn);
      await txn.rollback();

      expect(await graph.hasNode(node1.id)).toBe(true);
      expect(await graph.hasNode(node2.id)).toBe(true);
      expect(await graph.hasEdge(edge.id)).toBe(true);
    });
  });

  // ===========================================================================
  // Edge CRUD Operations in Transactions
  // ===========================================================================
  describe('Edge CRUD in transactions', () => {
    it('should add edge within transaction and commit', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });

      const txn = graph.createTransaction();
      await txn.begin();

      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.8 }, txn);
      await txn.commit();

      expect(await graph.hasEdge(edge.id)).toBe(true);
      const found = await graph.getEdge(edge.id);
      expect(found?.type).toBe('KNOWS');
      expect(found?.properties['weight']).toBe(0.8);
    });

    // it.skip('should add multiple edges within transaction and commit', async () => {
    //   const node1 = await graph.addNode('Person', { name: 'Alice' });
    //   const node2 = await graph.addNode('Person', { name: 'Bob' });
    //   const node3 = await graph.addNode('Person', { name: 'Carol' });
    //
    //   const txn = graph.createTransaction();
    //   await txn.begin();
    //
    //   const edge1 = await graph.addEdge(node1.id, node2.id, 'KNOWS', {}, txn);
    //   const edge2 = await graph.addEdge(node2.id, node3.id, 'KNOWS', {}, txn);
    //   const edge3 = await graph.addEdge(node1.id, node3.id, 'LIKES', {}, txn);
    //
    //   await txn.commit();
    //
    //   expect(await graph.hasEdge(edge1.id)).toBe(true);
    //   expect(await graph.hasEdge(edge2.id)).toBe(true);
    //   expect(await graph.hasEdge(edge3.id)).toBe(true);
    //   expect(await graph.getEdges()).toHaveLength(3);
    // });

    it('should rollback added edge on rollback', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });

      const txn = graph.createTransaction();
      await txn.begin();

      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {}, txn);
      await txn.rollback();

      expect(await graph.hasEdge(edge.id)).toBe(false);
    });

    it('should remove existing edge within transaction and commit', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.removeEdge(edge.id, txn);
      await txn.commit();

      expect(await graph.hasEdge(edge.id)).toBe(false);
    });

    it('should rollback removed edge on rollback', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.removeEdge(edge.id, txn);
      await txn.rollback();

      expect(await graph.hasEdge(edge.id)).toBe(true);
    });
  });

  // ===========================================================================
  // Node Property Operations in Transactions
  // ===========================================================================
  describe('Node property operations in transactions', () => {
    it('should add node property within transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addNodeProperty(node.id, 'age', 30, txn);
      await txn.commit();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(30);
    });

    it('should rollback added node property on rollback', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addNodeProperty(node.id, 'age', 30, txn);
      await txn.rollback();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBeUndefined();
    });

    it('should update node property within transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.updateNodeProperty(node.id, 'age', 30, txn);
      await txn.commit();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(30);
      expect(updated?.properties['name']).toBe('Alice');
    });

    it('should rollback updated node property on rollback', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.updateNodeProperty(node.id, 'age', 30, txn);
      await txn.rollback();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(25);
    });

    it('should delete node property within transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.deleteNodeProperty(node.id, 'age', txn);
      await txn.commit();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBeUndefined();
      expect(updated?.properties['name']).toBe('Alice');
    });

    it('should rollback deleted node property on rollback', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.deleteNodeProperty(node.id, 'age', txn);
      await txn.rollback();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(25);
    });

    it('should clear node properties within transaction and commit', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.clearNodeProperties(node.id, txn);
      await txn.commit();

      const updated = await graph.getNode(node.id);
      expect(Object.keys(updated?.properties ?? {})).toHaveLength(0);
    });

    it('should rollback cleared node properties on rollback', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.clearNodeProperties(node.id, txn);
      await txn.rollback();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['name']).toBe('Alice');
      expect(updated?.properties['age']).toBe(25);
    });
  });

  // ===========================================================================
  // Edge Property Operations in Transactions
  // ===========================================================================
  describe('Edge property operations in transactions', () => {
    it('should add edge property within transaction and commit', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addEdgeProperty(edge.id, 'weight', 0.8, txn);
      await txn.commit();

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties['weight']).toBe(0.8);
    });

    it('should rollback added edge property on rollback', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addEdgeProperty(edge.id, 'weight', 0.8, txn);
      await txn.rollback();

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties['weight']).toBeUndefined();
    });

    it('should update edge property within transaction and commit', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.5 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.updateEdgeProperty(edge.id, 'weight', 0.9, txn);
      await txn.commit();

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties['weight']).toBe(0.9);
    });

    it('should rollback updated edge property on rollback', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.5 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.updateEdgeProperty(edge.id, 'weight', 0.9, txn);
      await txn.rollback();

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties['weight']).toBe(0.5);
    });

    it('should delete edge property within transaction and commit', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.5 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.deleteEdgeProperty(edge.id, 'weight', txn);
      await txn.commit();

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties['weight']).toBeUndefined();
    });

    it('should rollback deleted edge property on rollback', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.5 });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.deleteEdgeProperty(edge.id, 'weight', txn);
      await txn.rollback();

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties['weight']).toBe(0.5);
    });

    it('should clear edge properties within transaction and commit', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.5, active: true });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.clearEdgeProperties(edge.id, txn);
      await txn.commit();

      const updated = await graph.getEdge(edge.id);
      expect(Object.keys(updated?.properties ?? {})).toHaveLength(0);
    });

    it('should rollback cleared edge properties on rollback', async () => {
      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.5, active: true });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.clearEdgeProperties(edge.id, txn);
      await txn.rollback();

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties['weight']).toBe(0.5);
      expect(updated?.properties['active']).toBe(true);
    });
  });

  // ===========================================================================
  // Mixed Operations in Transactions
  // ===========================================================================
  describe('Mixed operations in transactions', () => {
    it('should commit multiple mixed operations in a single transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();

      const alice = await graph.addNode('Person', { name: 'Alice' }, txn);
      const bob = await graph.addNode('Person', { name: 'Bob' }, txn);
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 }, txn);

      await txn.commit();

      expect(await graph.hasNode(alice.id)).toBe(true);
      expect(await graph.hasNode(bob.id)).toBe(true);
      expect(await graph.hasEdge(edge.id)).toBe(true);
    });

    it('should rollback multiple mixed operations on rollback', async () => {
      const txn = graph.createTransaction();
      await txn.begin();

      const node1 = await graph.addNode('Person', { name: 'Alice' }, txn);
      const node2 = await graph.addNode('Person', { name: 'Bob' }, txn);
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', { weight: 0.8 }, txn);

      await txn.rollback();

      expect(await graph.hasNode(node1.id)).toBe(false);
      expect(await graph.hasNode(node2.id)).toBe(false);
      expect(await graph.hasEdge(edge.id)).toBe(false);
    });

  });

  // ===========================================================================
  // Query Operations Within Transactions
  // ===========================================================================
  describe('Query operations within transactions', () => {

    it('should query all transaction-aware methods within a transaction before commit', async () => {
      // Create indexes first
      await graph.createIndex('node', 'status');
      await graph.createIndex('edge', 'weight');

      // Create pre-existing nodes for various queries
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const existingEdge = await graph.addEdge(alice.id, bob.id, 'FRIEND', { weight: 0.5 });

      const txn = graph.createTransaction();
      await txn.begin();

      // CRUD operations within transaction
      const carol = await graph.addNode('Person', { name: 'Carol', status: 'active' }, txn);
      const dave = await graph.addNode('Person', { name: 'Dave', status: 'inactive' }, txn);
      const newEdge = await graph.addEdge(alice.id, carol.id, 'KNOWS', { weight: 0.9 }, txn);

      // Add properties within transaction
      await graph.addNodeProperty(bob.id, 'status', 'active', txn);
      await graph.addEdgeProperty(existingEdge.id, 'status', 'verified', txn);

      // Add new properties to existing nodes within transaction
      await graph.addNodeProperty(alice.id, 'age', 30, txn);
      await graph.addEdgeProperty(newEdge.id, 'verified', true, txn);

      // Query transaction-aware methods WITHIN transaction - should see uncommitted changes
      expect(await graph.getNodes(txn)).toHaveLength(4); // alice, bob, carol, dave
      expect(await graph.getEdges(txn)).toHaveLength(2); // existingEdge, newEdge
      expect(await graph.hasNode(carol.id, txn)).toBe(true);
      expect(await graph.hasEdge(newEdge.id, txn)).toBe(true);
      expect((await graph.getNode(carol.id, txn))?.properties['name']).toBe('Carol');
      expect((await graph.getEdge(newEdge.id, txn))?.properties['weight']).toBe(0.9);
      expect(await graph.getNodesByProperty('status', 'active', { transaction: txn })).toHaveLength(2); // carol + bob with updated prop
      expect(await graph.getEdgesByProperty('weight', 0.9, { transaction: txn })).toHaveLength(1);
      expect(await graph.getNodesByType('Person', txn)).toHaveLength(4);
      expect(await graph.getEdgesByType('KNOWS', txn)).toHaveLength(1);
      expect(await graph.getParents(carol.id, { transaction: txn })).toHaveLength(1); // alice -> carol
      expect(await graph.getChildren(alice.id, { transaction: txn })).toHaveLength(2); // bob + carol

      // hasNode/hasEdge on modified existing node/edge
      expect(await graph.hasNode(bob.id, txn)).toBe(true);
      expect(await graph.hasEdge(existingEdge.id, txn)).toBe(true);

      await txn.commit();

      // After commit, queries WITHOUT transaction should also see the changes
      expect((await graph.getNode(carol.id))?.properties['name']).toBe('Carol');
      expect((await graph.getEdge(newEdge.id))?.properties['weight']).toBe(0.9);
      expect(await graph.getNodesByProperty('status', 'active')).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Property Index Updates Within Transactions
  // ===========================================================================
  describe('Property index updates within transactions', () => {
    it('should update property index when adding property in transaction', async () => {
      // Create index first
      await graph.createIndex('node', 'status');

      const node = await graph.addNode('Person', { name: 'Alice' });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addNodeProperty(node.id, 'status', 'active', txn);
      await txn.commit();

      // Query by property should find the node
      const activeNodes = await graph.getNodesByProperty('status', 'active');
      expect(activeNodes).toHaveLength(1);
      expect(activeNodes[0].id).toBe(node.id);
    });

    it('should rollback property index updates on rollback', async () => {
      // Create index first
      await graph.createIndex('node', 'status');

      const node = await graph.addNode('Person', { name: 'Alice' });

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addNodeProperty(node.id, 'status', 'active', txn);
      await txn.rollback();

      // Should not be found after rollback
      const activeNodes = await graph.getNodesByProperty('status', 'active');
      expect(activeNodes).toHaveLength(0);
    });

    it('should update edge property index when adding property in transaction', async () => {
      // Create index first
      await graph.createIndex('edge', 'weight');

      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addEdgeProperty(edge.id, 'weight', 0.8, txn);
      await txn.commit();

      // Query by property should find the edge
      const weightedEdges = await graph.getEdgesByProperty('weight', 0.8);
      expect(weightedEdges).toHaveLength(1);
      expect(weightedEdges[0].id).toBe(edge.id);
    });

    it('should rollback edge property index updates on rollback', async () => {
      // Create index first
      await graph.createIndex('edge', 'weight');

      const node1 = await graph.addNode('Person', { name: 'Alice' });
      const node2 = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {});

      const txn = graph.createTransaction();
      await txn.begin();

      await graph.addEdgeProperty(edge.id, 'weight', 0.8, txn);
      await txn.rollback();

      // Should not be found after rollback
      const weightedEdges = await graph.getEdgesByProperty('weight', 0.8);
      expect(weightedEdges).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Sequential Transactions
  // ===========================================================================
  describe('Sequential transactions', () => {
    it('should work with multiple sequential transactions', async () => {
      const txn1 = graph.createTransaction();
      await txn1.begin();
      const node1 = await graph.addNode('Person', { name: 'Alice' }, txn1);
      await txn1.commit();

      const txn2 = graph.createTransaction();
      await txn2.begin();
      const node2 = await graph.addNode('Person', { name: 'Bob' }, txn2);
      await txn2.commit();

      expect(await graph.hasNode(node1.id)).toBe(true);
      expect(await graph.hasNode(node2.id)).toBe(true);
      expect(await graph.getNodes()).toHaveLength(2);
    });

    it('should allow property changes in sequential transactions', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn1 = graph.createTransaction();
      await txn1.begin();
      await graph.updateNodeProperty(node.id, 'age', 30, txn1);
      await txn1.commit();

      const txn2 = graph.createTransaction();
      await txn2.begin();
      await graph.updateNodeProperty(node.id, 'age', 35, txn2);
      await txn2.commit();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(35);
    });

    it('should rollback first transaction and commit second', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      const txn1 = graph.createTransaction();
      await txn1.begin();
      await graph.updateNodeProperty(node.id, 'age', 30, txn1);
      await txn1.rollback();

      const txn2 = graph.createTransaction();
      await txn2.begin();
      await graph.updateNodeProperty(node.id, 'age', 35, txn2);
      await txn2.commit();

      const updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(35);
    });
  });

  // ===========================================================================
  // Transaction Isolation
  // ===========================================================================
  describe('Transaction isolation', () => {
    it('should maintain isolation between concurrent transactions', async () => {
      // Transaction 1: Alice
      const txn1 = graph.createTransaction();
      await txn1.begin();
      const alice = await graph.addNode('Person', { name: 'Alice' }, txn1);

      // Transaction 2: Bob (separate transaction, not yet committed)
      const txn2 = graph.createTransaction();
      await txn2.begin();
      const bob = await graph.addNode('Person', { name: 'Bob' }, txn2);

      // Both transactions are active, they should not see each other's uncommitted changes
      // until they commit

      await txn1.commit();
      await txn2.commit();

      // After both commit, both should be visible
      expect(await graph.hasNode(alice.id)).toBe(true);
      expect(await graph.hasNode(bob.id)).toBe(true);
    });

    it('should not see uncommitted changes from other transaction', async () => {
      // Transaction 1: Add Alice
      const txn1 = graph.createTransaction();
      await txn1.begin();
      const alice = await graph.addNode('Person', { name: 'Alice' }, txn1);

      // Transaction 2: Should not see Alice yet
      const txn2 = graph.createTransaction();
      await txn2.begin();
      const bob = await graph.addNode('Person', { name: 'Bob' }, txn2);

      // Commit txn2 first
      await txn2.commit();

      // Alice should not be visible yet (txn1 not committed)
      expect(await graph.hasNode(alice.id)).toBe(false);
      expect(await graph.hasNode(bob.id)).toBe(true);

      // Now commit txn1
      await txn1.commit();

      // Now both should be visible
      expect(await graph.hasNode(alice.id)).toBe(true);
      expect(await graph.hasNode(bob.id)).toBe(true);
    });

    it('should isolate property changes between concurrent transactions', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

      // Transaction 1: Update age to 30
      const txn1 = graph.createTransaction();
      await txn1.begin();
      await graph.updateNodeProperty(node.id, 'age', 30, txn1);

      // Transaction 2: Update age to 35 (should see original value)
      const txn2 = graph.createTransaction();
      await txn2.begin();
      await graph.updateNodeProperty(node.id, 'age', 35, txn2);

      // Commit txn2 first
      await txn2.commit();

      // Txn1's change should still be pending
      let updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(35);

      // Commit txn1
      await txn1.commit();

      // Final value depends on commit order
      updated = await graph.getNode(node.id);
      expect(updated?.properties['age']).toBe(30);
    });
  });

  // ===========================================================================
  // Transaction Error Handling
  // ===========================================================================
  describe('Transaction error handling', () => {
    it('should track failed transaction state', async () => {
      const txn = graph.createTransaction();
      await txn.begin();

      // Add a node then rollback
      await graph.addNode('Person', { name: 'Test' }, txn);
      await txn.rollback();

      expect(txn.isFailed()).toBe(false); // Rollback clears failed state
      expect(txn.isActive()).toBe(false);
    });
  });
});