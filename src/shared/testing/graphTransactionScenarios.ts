import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, GraphTransaction, IStorageProvider, TransactionNotActiveError, TransactionFailedError } from '../../index';

/**
 * Shared test scenarios for Graph transaction support.
 * Tests the transaction overlay system in InMemoryStorageProvider.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphTransactionScenarios(
  providerFunc: () => Promise<IStorageProvider> | IStorageProvider = undefined as any,
  beforeAllFunc: () => Promise<void> = async () => { },
  afterAllFunc: () => Promise<void> = async () => { }
): void {
  let provider: IStorageProvider | undefined;
  let graph: Graph;
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

  describe('Graph Transaction Support', () => {

    beforeEach(async () => {
      graph = new Graph(provider);
      await graph.createIndex('edge', 'weight');
      await graph.createIndex('node', 'email');
    });


    // ===========================================================================
    // Transaction Lifecycle
    // ===========================================================================
    describe('Transaction lifecycle', () => {
      it('should create a transaction', async () => {
        const txn = graph.createTransaction();
        expect(txn).toBeInstanceOf(GraphTransaction);
      });

      it('should report as inactive before begin', async () => {
        const txn = graph.createTransaction();
        expect(txn.isActive()).toBe(false);
      });

      it('should report as active after begin', async () => {
        const txn = graph.createTransaction();
        await txn.begin();
        expect(txn.isActive()).toBe(true);
        await txn.commit();
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
        await txn.commit();
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

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(1);
        expect(allNodes[0].properties.name).toBe('Alice');
      });

      it('should rollback added node on rollback', async () => {
        const txn = graph.createTransaction();
        await txn.begin();

        await graph.addNode('Person', { name: 'Alice' }, txn);
        await txn.rollback();

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(0);
      });

      it('should remove existing node within transaction and commit', async () => {
        const existing = await graph.addNode('Person', { name: 'Bob' });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.removeNode(existing.id, false, txn);
        await txn.commit();

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(0);
      });

      it('should rollback removed node on rollback', async () => {
        const existing = await graph.addNode('Person', { name: 'Bob' });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.removeNode(existing.id, false, txn);
        await txn.rollback();

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(1);
        expect(allNodes[0].id).toBe(existing.id);
      });

      it('should remove node with cascade within transaction and commit', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        await graph.addEdge(alice.id, bob.id, 'KNOWS');

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.removeNode(alice.id, true, txn);
        await txn.commit();

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(1);
        expect(allNodes[0].id).toBe(bob.id);
      });

      it('should rollback remove node with cascade', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        await graph.addEdge(alice.id, bob.id, 'KNOWS');

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.removeNode(alice.id, true, txn);
        await txn.rollback();

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(2);
      });
    });

    // ===========================================================================
    // Edge CRUD Operations in Transactions
    // ===========================================================================
    describe('Edge CRUD in transactions', () => {
      it('should add edge within transaction and commit', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.addEdge(alice.id, bob.id, 'KNOWS', {}, txn);
        await txn.commit();

        const allEdges = await graph.getEdges();
        expect(allEdges).toHaveLength(1);
        expect(allEdges[0].type).toBe('KNOWS');
      });

      it('should rollback added edge on rollback', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.addEdge(alice.id, bob.id, 'KNOWS', {}, txn);
        await txn.rollback();

        const allEdges = await graph.getEdges();
        expect(allEdges).toHaveLength(0);
      });

      it('should remove existing edge within transaction and commit', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.removeEdge(edge.id, txn);
        await txn.commit();

        const allEdges = await graph.getEdges();
        expect(allEdges).toHaveLength(0);
      });

      it('should rollback removed edge on rollback', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.removeEdge(edge.id, txn);
        await txn.rollback();

        const allEdges = await graph.getEdges();
        expect(allEdges).toHaveLength(1);
        expect(allEdges[0].id).toBe(edge.id);
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
        expect(updated?.properties.age).toBe(30);
      });

      it('should rollback added node property on rollback', async () => {
        const node = await graph.addNode('Person', { name: 'Alice' });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.addNodeProperty(node.id, 'age', 30, txn);
        await txn.rollback();

        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBeUndefined();
      });

      it('should update node property within transaction and commit', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.updateNodeProperty(node.id, 'age', 30, txn);
        await txn.commit();

        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBe(30);
      });

      it('should rollback updated node property on rollback', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.updateNodeProperty(node.id, 'age', 30, txn);
        await txn.rollback();

        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBe(25);
      });

      it('should delete node property within transaction and commit', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.deleteNodeProperty(node.id, 'age', txn);
        await txn.commit();

        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBeUndefined();
      });

      it('should rollback deleted node property on rollback', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.deleteNodeProperty(node.id, 'age', txn);
        await txn.rollback();

        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBe(25);
      });

      it('should clear node properties within transaction and commit', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25, city: 'NYC' });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.clearNodeProperties(node.id, txn);
        await txn.commit();

        const updated = await graph.getNode(node.id);
        expect(Object.keys(updated?.properties || {}).length).toBe(0);
      });

      it('should rollback cleared node properties on rollback', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25, city: 'NYC' });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.clearNodeProperties(node.id, txn);
        await txn.rollback();

        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBe(25);
        expect(updated?.properties.city).toBe('NYC');
      });
    });

    // ===========================================================================
    // Edge Property Operations in Transactions
    // ===========================================================================
    describe('Edge property operations in transactions', () => {
      it('should add edge property within transaction and commit', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.addEdgeProperty(edge.id, 'since', 2020, txn);
        await txn.commit();

        const updated = await graph.getEdge(edge.id);
        expect(updated?.properties.since).toBe(2020);
      });

      it('should rollback added edge property on rollback', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.addEdgeProperty(edge.id, 'since', 2020, txn);
        await txn.rollback();

        const updated = await graph.getEdge(edge.id);
        expect(updated?.properties.since).toBeUndefined();
      });

      it('should update edge property within transaction and commit', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2019 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.updateEdgeProperty(edge.id, 'since', 2020, txn);
        await txn.commit();

        const updated = await graph.getEdge(edge.id);
        expect(updated?.properties.since).toBe(2020);
      });

      it('should rollback updated edge property on rollback', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2019 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.updateEdgeProperty(edge.id, 'since', 2020, txn);
        await txn.rollback();

        const updated = await graph.getEdge(edge.id);
        expect(updated?.properties.since).toBe(2019);
      });

      it('should delete edge property within transaction and commit', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.deleteEdgeProperty(edge.id, 'since', txn);
        await txn.commit();

        const updated = await graph.getEdge(edge.id);
        expect(updated?.properties.since).toBeUndefined();
      });

      it('should rollback deleted edge property on rollback', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.deleteEdgeProperty(edge.id, 'since', txn);
        await txn.rollback();

        const updated = await graph.getEdge(edge.id);
        expect(updated?.properties.since).toBe(2020);
      });

      it('should clear edge properties within transaction and commit', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020, weight: 0.5 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.clearEdgeProperties(edge.id, txn);
        await txn.commit();

        const updated = await graph.getEdge(edge.id);
        expect(Object.keys(updated?.properties || {}).length).toBe(0);
      });

      it('should rollback cleared edge properties on rollback', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020, weight: 0.5 });

        const txn = graph.createTransaction();
        await txn.begin();

        await graph.clearEdgeProperties(edge.id, txn);
        await txn.rollback();

        const updated = await graph.getEdge(edge.id);
        expect(updated?.properties.since).toBe(2020);
        expect(updated?.properties.weight).toBe(0.5);
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
        await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 }, txn);
        await graph.addNodeProperty(alice.id, 'age', 30, txn);

        await txn.commit();

        const allNodes = await graph.getNodes();
        const allEdges = await graph.getEdges();
        const aliceNode = await graph.getNode(alice.id);

        expect(allNodes).toHaveLength(2);
        expect(allEdges).toHaveLength(1);
        expect(aliceNode?.properties.age).toBe(30);
      });

      it('should rollback multiple mixed operations on rollback', async () => {
        const txn = graph.createTransaction();
        await txn.begin();

        const alice = await graph.addNode('Person', { name: 'Alice' }, txn);
        const bob = await graph.addNode('Person', { name: 'Bob' }, txn);
        await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 }, txn);
        await graph.addNodeProperty(alice.id, 'age', 30, txn);

        await txn.rollback();

        const allNodes = await graph.getNodes();
        const allEdges = await graph.getEdges();

        expect(allNodes).toHaveLength(0);
        expect(allEdges).toHaveLength(0);
      });
    });

    // ===========================================================================
    // Query Operations Within Transactions
    // ===========================================================================
    describe('Query operations within transactions', () => {
      it('should query all transaction-aware methods within a transaction before commit', async () => {

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
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });

        const txn = graph.createTransaction();
        await txn.begin();

        const carol = await graph.addNode('Person', { name: 'Carol', email: 'carol@example.com' }, txn);
        await graph.addNodeProperty(carol.id, 'age', 30, txn);

        await txn.commit();

        // Index should be updated after commit
        const results = await graph.getNodesByProperty('email', 'carol@example.com');
        expect(results).toHaveLength(1);
        expect(results[0].properties.name).toBe('Carol');
      });

      it('should rollback property index updates on rollback', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        const txn = graph.createTransaction();
        await txn.begin();

        const carol = await graph.addNode('Person', { name: 'Carol', email: 'carol@example.com' }, txn);

        await txn.rollback();

        // Index should not have the rolled-back data
        const results = await graph.getNodesByProperty('email', 'carol@example.com');
        expect(results).toHaveLength(0);
      });

      it('should update edge property index when adding property in transaction', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.5 });

        const txn = graph.createTransaction();
        await txn.begin();

        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 }, txn);
        await graph.addEdgeProperty(edge.id, 'since', 2020, txn);

        await txn.commit();

        // Index should be updated after commit
        const results = await graph.getEdgesByProperty('weight', 0.8);
        expect(results).toHaveLength(1);
      });

      it('should rollback edge property index updates on rollback', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.5 });

        const txn = graph.createTransaction();
        await txn.begin();

        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 }, txn);

        await txn.rollback();

        // Index should not have the rolled-back data
        const results = await graph.getEdgesByProperty('weight', 0.8);
        expect(results).toHaveLength(0);
      });
    });

    // ===========================================================================
    // Sequential Transactions
    // ===========================================================================
    describe('Sequential transactions', () => {
      it('should work with multiple sequential transactions', async () => {
        const txn1 = graph.createTransaction();
        await txn1.begin();
        await graph.addNode('Person', { name: 'Alice' }, txn1);
        await txn1.commit();

        const txn2 = graph.createTransaction();
        await txn2.begin();
        await graph.addNode('Person', { name: 'Bob' }, txn2);
        await txn2.commit();

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(2);
      });

      it('should allow property changes in sequential transactions', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25, city: 'TX' });

        const txn1 = graph.createTransaction();
        await txn1.begin();
        await graph.updateNodeProperty(node.id, 'age', 30, txn1);
        await txn1.commit();

        const txn2 = graph.createTransaction();
        await txn2.begin();
        await graph.updateNodeProperty(node.id, 'city', 'NYC', txn2);
        await txn2.commit();

        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBe(30);
        expect(updated?.properties.city).toBe('NYC');
      });

      it('should rollback first transaction and commit second', async () => {
        const txn1 = graph.createTransaction();
        await txn1.begin();
        await graph.addNode('Person', { name: 'Alice' }, txn1);
        await txn1.rollback();

        const txn2 = graph.createTransaction();
        await txn2.begin();
        await graph.addNode('Person', { name: 'Bob' }, txn2);
        await txn2.commit();

        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(1);
        expect(allNodes[0].properties.name).toBe('Bob');
      });
    });

    // ===========================================================================
    // Transaction Isolation
    // ===========================================================================
    describe('Transaction isolation', () => {
      it('should maintain isolation between concurrent transactions', async () => {
        const txn1 = graph.createTransaction();
        const txn2 = graph.createTransaction();

        await txn1.begin();
        await txn2.begin();

        // Both transactions add nodes
        await graph.addNode('Person', { name: 'Alice' }, txn1);
        await graph.addNode('Person', { name: 'Bob' }, txn2);

        // Each should only see its own changes
        const nodesInTxn1 = await graph.getNodes(txn1);
        const nodesInTxn2 = await graph.getNodes(txn2);

        expect(nodesInTxn1).toHaveLength(1);
        expect(nodesInTxn2).toHaveLength(1);

        await txn1.commit();
        await txn2.commit();

        // After both commit, all nodes should be visible
        const allNodes = await graph.getNodes();
        expect(allNodes).toHaveLength(2);
      });

      it('should not see uncommitted changes from other transaction', async () => {
        const txn1 = graph.createTransaction();
        const txn2 = graph.createTransaction();

        await txn1.begin();
        await txn2.begin();

        // Txn1 adds a node but doesn't commit yet
        await graph.addNode('Person', { name: 'Alice' }, txn1);

        // Txn2 should not see txn1's uncommitted changes
        const nodesInTxn2 = await graph.getNodes(txn2);
        expect(nodesInTxn2).toHaveLength(0);

        await txn1.rollback();
        await txn2.commit();
      });

      it('should isolate property changes between concurrent transactions', async () => {
        const node = await graph.addNode('Person', { name: 'Alice', age: 25, city: 'TX' });

        const txn1 = graph.createTransaction();
        const txn2 = graph.createTransaction();

        await txn1.begin();
        await txn2.begin();

        // Txn1 updates age to 30
        await graph.updateNodeProperty(node.id, 'age', 30, txn1);
        await txn1.commit();

        // Txn2 updates city to NYC
        await graph.updateNodeProperty(node.id, 'city', 'NYC', txn2);
        await txn2.commit();

        // Both changes should be visible after both commit
        const updated = await graph.getNode(node.id);
        expect(updated?.properties.age).toBe(30);
        expect(updated?.properties.city).toBe('NYC');
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

    it('should throw error TransactionFailedError error when fail to commit', async () => {
      const txn = graph.createTransaction();
      await txn.begin();

      // Simulate an error during commit by adding a node with invalid data (e.g., missing required property)
      // Assuming the graph implementation throws an error for invalid operations
      await graph.addNode('Person', { name: 'Alice' }, txn); // Valid operation

      // Now we will simulate a failure by trying to add an edge with non-existent nodes
      await expect(graph.addEdge('nonexistent1', 'nonexistent2', 'KNOWS', {}, txn)).rejects.toThrow();

      // The transaction should now be in a failed state
      expect(txn.isFailed()).toBe(true);

      // Attempting to commit should throw a TransactionFailedError
      await expect(txn.commit()).rejects.toThrow(TransactionFailedError);
    });
  });
}