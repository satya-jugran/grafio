import { beforeEach, describe, expect, it } from '@jest/globals';
import { Graph, GraphTransaction, TransactionNotActiveError, TransactionFailedError } from '../../src/index';

describe('Graph Transaction Support', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  describe('GraphTransaction basic lifecycle', () => {
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
  });

  describe('Graph transaction operations', () => {
    it('should support addNode within a transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const node1 = await graph.addNode('Person', { name: 'Alice' }, txn);
      const node2 = await graph.addNode('Person', { name: 'Bob' }, txn);
      
      // Nodes should be visible within the transaction but not committed yet
      // (In in-memory provider, they are visible immediately but will be snapshotted)
      
      await txn.commit();
      
      // After commit, nodes should definitely be there
      expect(await graph.hasNode(node1.id)).toBe(true);
      expect(await graph.hasNode(node2.id)).toBe(true);
    });

    it('should support addEdge within a transaction', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const node1 = await graph.addNode('Person', { name: 'Alice' }, txn);
      const node2 = await graph.addNode('Person', { name: 'Bob' }, txn);
      const edge = await graph.addEdge(node1.id, node2.id, 'KNOWS', {}, txn);
      
      await txn.commit();
      
      expect(await graph.hasEdge(edge.id)).toBe(true);
    });

    it('should rollback all changes on rollback', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      const node = await graph.addNode('Person', { name: 'RollbackTest' }, txn);
      
      await txn.rollback();
      
      // Node should not exist after rollback
      expect(await graph.hasNode(node.id)).toBe(false);
    });

    it('should not commit any changes if rollback is called after some operations', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      await graph.addNode('Person', { name: 'Alice' }, txn);
      const bob = await graph.addNode('Person', { name: 'Bob' }, txn);
      
      // Add an edge that we'll check later
      const alice = await graph.getNodes();
      if (alice.length > 0) {
        await graph.addEdge(alice[0].id, bob.id, 'KNOWS', {}, txn);
      }
      
      await txn.rollback();
      
      // No nodes should exist after rollback
      const nodes = await graph.getNodes();
      expect(nodes).toHaveLength(0);
    });
  });

  describe('supportsTransactions', () => {
    it('should return true for in-memory provider', () => {
      expect(graph.supportsTransactions()).toBe(true);
    });
  });

  describe('Transaction error handling', () => {
    it('should track failed transaction state', async () => {
      const txn = graph.createTransaction();
      await txn.begin();
      
      // Add a node then simulate failure by calling rollback
      await graph.addNode('Person', { name: 'Test' }, txn);
      await txn.rollback();
      
      expect(txn.isFailed()).toBe(false); // Rollback clears failed state
      expect(txn.isActive()).toBe(false);
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