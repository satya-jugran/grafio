import { describe, expect, it } from '@jest/globals';
import { Graph, TransactionConflictError } from '../../src/Graph';
import { InvalidPropertyError, NodeHasEdgesError } from '../../src/errors';
import { runGraphTransactionScenarios } from '../../src/shared/testing';

runGraphTransactionScenarios(
  async () => undefined as any,
  async () => {},
  async () => {}
);

describe('GraphTransaction concurrent conflict detection & isolation', () => {
  it('throws TransactionConflictError when two transactions write the same (node, property)', async () => {
    const graph = new Graph();
    const alice = await graph.addNode('Person', { name: 'Alice', age: 25, city: 'TX' });

    const txn1 = graph.createTransaction();
    const txn2 = graph.createTransaction();
    await txn1.begin();
    await txn2.begin();

    await graph.setNodeProperties(alice.id, { age: 30 }, { transaction: txn1 });
    await graph.setNodeProperties(alice.id, { age: 40 }, { transaction: txn2 });

    await txn1.commit();
    await expect(txn2.commit()).rejects.toThrow(TransactionConflictError);

    await txn2.rollback();
    expect((await graph.getNode(alice.id))?.properties.age).toBe(30);
  });

  it('throws TransactionConflictError on delete-vs-update conflict across concurrent transactions', async () => {
    const graph = new Graph();
    const bob = await graph.addNode('Person', { name: 'Bob', role: 'Dev' });

    const txn1 = graph.createTransaction();
    const txn2 = graph.createTransaction();
    await txn1.begin();
    await txn2.begin();

    await graph.removeNode(bob.id, false, txn1);
    await graph.setNodeProperties(bob.id, { role: 'Lead' }, { transaction: txn2 });

    await txn1.commit();
    await expect(txn2.commit()).rejects.toThrow(TransactionConflictError);

    await txn2.rollback();
    expect(await graph.getNode(bob.id)).toBeUndefined();
  });

  it('merges disjoint property writes on the same node across overlapping concurrent transactions', async () => {
    const graph = new Graph();
    const carol = await graph.addNode('Person', { name: 'Carol', age: 28, city: 'Austin' });

    const txn1 = graph.createTransaction();
    const txn2 = graph.createTransaction();
    await txn1.begin();
    await txn2.begin();

    await graph.setNodeProperties(carol.id, { age: 29 }, { transaction: txn1 });
    await graph.setNodeProperties(carol.id, { city: 'Seattle' }, { transaction: txn2 });

    await txn1.commit();
    await txn2.commit();

    const merged = await graph.getNode(carol.id);
    expect(merged?.properties).toEqual({ name: 'Carol', age: 29, city: 'Seattle' });
  });

  it('supports deleting and reinserting the same node and edge IDs within a single transaction', async () => {
    const graph = new Graph();
    await graph.addNode('Person', { name: 'original-x' }, undefined, 'x');
    await graph.addNode('Person', { name: 'y' }, undefined, 'y');
    await graph.addEdge('x', 'y', 'KNOWS', { weight: 1 }, undefined, 'e1');

    const tx = graph.createTransaction();
    await tx.begin();

    await graph.removeEdge('e1', tx);
    await graph.removeNode('x', false, tx);
    expect(await graph.hasNode('x', tx)).toBe(false);
    expect(await graph.getNode('x', tx)).toBeUndefined();

    await graph.addNode('Person', { name: 'reborn-x' }, tx, 'x');
    await graph.addEdge('x', 'y', 'KNOWS', { weight: 9 }, tx, 'e1');
    expect((await graph.getNode('x', tx))?.properties.name).toBe('reborn-x');
    expect((await graph.getEdge('e1', tx))?.properties.weight).toBe(9);

    await tx.commit();

    expect((await graph.getNode('x'))?.properties.name).toBe('reborn-x');
    expect((await graph.getEdge('e1'))?.properties.weight).toBe(9);
    expect(await graph.getNodeCount()).toBe(2);
    expect(await graph.getEdgeCount()).toBe(1);
  });

  it('supports delete -> reinsert -> re-delete of the same node ID within a single transaction', async () => {
    const graph = new Graph();
    await graph.addNode('Person', { name: 'orig' }, undefined, 'x');

    const tx = graph.createTransaction();
    await tx.begin();
    await graph.removeNode('x', false, tx);
    await graph.addNode('Person', { name: 'temp' }, tx, 'x');
    await graph.removeNode('x', false, tx);
    await tx.commit();

    expect(await graph.hasNode('x')).toBe(false);
    expect(await graph.getNodeCount()).toBe(0);
  });

  it('detects write conflicts symmetrically when full property replacement (merge: false) wipes a concurrently updated key', async () => {
    for (const replaceCommitsFirst of [true, false]) {
      const graph = new Graph();
      const node = await graph.addNode('Person', { a: 1, b: 2 });
      const edge = await graph.addEdge(node.id, node.id, 'LOOP', { x: 1, y: 2 });

      const tx1 = graph.createTransaction();
      const tx2 = graph.createTransaction();
      await tx1.begin();
      await tx2.begin();

      await graph.setNodeProperties(node.id, { a: 10 }, { merge: false, transaction: tx1 });
      await graph.setNodeProperties(node.id, { b: 99 }, { merge: true, transaction: tx2 });
      await graph.setEdgeProperties(edge.id, { x: 10 }, { merge: false, transaction: tx1 });
      await graph.setEdgeProperties(edge.id, { y: 99 }, { merge: true, transaction: tx2 });

      if (replaceCommitsFirst) {
        await tx1.commit();
        await expect(tx2.commit()).rejects.toThrow(TransactionConflictError);
      } else {
        await tx2.commit();
        await expect(tx1.commit()).rejects.toThrow(TransactionConflictError);
      }
    }
  });

  it('merges disjoint removeNodeLabels and property updates symmetrically regardless of commit order', async () => {
    for (const labelsFirst of [true, false]) {
      const graph = new Graph();
      const node = await graph.addNode(['Person', 'Temp'], { age: 30 });

      const tx1 = graph.createTransaction();
      const tx2 = graph.createTransaction();
      await tx1.begin();
      await tx2.begin();

      await graph.removeNodeLabels(node.id, ['Temp'], tx1);
      await graph.setNodeProperties(node.id, { age: 31 }, { merge: true, transaction: tx2 });

      if (labelsFirst) {
        await tx1.commit();
        await tx2.commit();
      } else {
        await tx2.commit();
        await tx1.commit();
      }

      const updated = await graph.getNode(node.id);
      expect(updated?.labels).toEqual(['Person']);
      expect(updated?.properties.age).toBe(31);
    }
  });

  it('composes addNodeLabels and removeNodeLabels within transactions, merges with disjoint property writes, and detects conflicts', async () => {
    const graph = new Graph();
    const node = await graph.addNode(['Memory', 'STM'], { weight: 1 });

    // 1. Rollback discards staged addNodeLabels
    const txRb = graph.createTransaction();
    await txRb.begin();
    await graph.addNodeLabels(node.id, ['LTM', 'Pinned'], txRb);
    expect((await graph.getNode(node.id, txRb))?.labels).toEqual(['Memory', 'STM', 'LTM', 'Pinned']);
    await txRb.rollback();
    expect((await graph.getNode(node.id))?.labels).toEqual(['Memory', 'STM']);

    // 2. Intra-transaction composition: remove STM -> add LTM + Pinned -> remove Pinned -> re-add STM, plus created node
    const txCompose = graph.createTransaction();
    await txCompose.begin();
    const created = await graph.addNode('Draft', { v: 1 }, txCompose);
    await graph.addNodeLabels(created.id, ['Reviewed', 'Reviewed'], txCompose);
    await graph.removeNodeLabels(node.id, ['STM'], txCompose);
    await graph.addNodeLabels(node.id, ['LTM', 'Pinned'], txCompose);
    await graph.removeNodeLabels(node.id, ['Pinned'], txCompose);
    expect((await graph.getNode(node.id, txCompose))?.labels).toEqual(['Memory', 'LTM']);
    await graph.addNodeLabels(node.id, ['STM'], txCompose);
    expect((await graph.getNode(node.id, txCompose))?.labels).toEqual(['Memory', 'STM', 'LTM']);
    await txCompose.commit();

    expect((await graph.getNode(created.id))?.labels).toEqual(['Draft', 'Reviewed']);
    expect((await graph.getNode(node.id))?.labels).toEqual(['Memory', 'STM', 'LTM']);

    // 3. Disjoint addNodeLabels + property update + concurrent label conflict
    const tAdd = graph.createTransaction();
    const tProp = graph.createTransaction();
    const tConflict = graph.createTransaction();
    await tAdd.begin();
    await tProp.begin();
    await tConflict.begin();

    await graph.addNodeLabels(node.id, ['Pinned'], tAdd);
    await graph.setNodeProperties(node.id, { weight: 2 }, { merge: true, transaction: tProp });
    await graph.addNodeLabels(node.id, ['Archived'], tConflict);

    await tAdd.commit();
    await tProp.commit();
    await expect(tConflict.commit()).rejects.toThrow(TransactionConflictError);
    await tConflict.rollback();

    const finalNode = await graph.getNode(node.id);
    expect(finalNode?.labels).toEqual(['Memory', 'STM', 'LTM', 'Pinned']);
    expect(finalNode?.properties.weight).toBe(2);
  });

  it('detects concurrent edge property, edge delete-vs-update, and node replace conflicts', async () => {
    const graph = new Graph();
    const a = await graph.addNode('N', { name: 'Alice' });
    const b = await graph.addNode('N', { name: 'Bob' });
    const e = await graph.addEdge(a.id, b.id, 'GO', { weight: 1, tag: 'v1' });

    // Overlapping edge property writes fail
    const t1 = graph.createTransaction();
    const t2 = graph.createTransaction();
    await t1.begin();
    await t2.begin();
    await graph.setEdgeProperties(e.id, { weight: 2 }, { transaction: t1 });
    await graph.setEdgeProperties(e.id, { weight: 3 }, { transaction: t2 });
    await t1.commit();
    await expect(t2.commit()).rejects.toThrow(TransactionConflictError);
    await t2.rollback();

    // Edge delete-vs-update conflict
    const t3 = graph.createTransaction();
    const t4 = graph.createTransaction();
    await t3.begin();
    await t4.begin();
    await graph.removeEdge(e.id, t3);
    await graph.setEdgeProperties(e.id, { tag: 'v2' }, { transaction: t4 });
    await t3.commit();
    await expect(t4.commit()).rejects.toThrow(TransactionConflictError);
    await t4.rollback();

    // Full-replace property conflict on node
    const t5 = graph.createTransaction();
    const t6 = graph.createTransaction();
    await t5.begin();
    await t6.begin();
    await graph.setNodeProperties(a.id, { name: 'Alice2' }, { transaction: t5 });
    await graph.setNodeProperties(a.id, { replaced: true }, { merge: false, transaction: t6 });
    await t5.commit();
    await expect(t6.commit()).rejects.toThrow(TransactionConflictError);
    await t6.rollback();
  });

  it('marks active transactions failed on validation or storage errors and detects label/endpoint conflicts', async () => {
    const graph = new Graph();
    const a = await graph.addNode(['N', 'Removable'], { name: 'A' });
    const b = await graph.addNode(['N', 'Removable'], { name: 'B' });
    const e = await graph.addEdge(a.id, b.id, 'REL', { w: 1 });

    // Property validation failures before transaction execution
    await expect(graph.addNode('N', { bad: { nested: 1 } })).rejects.toThrow(InvalidPropertyError);
    await expect(graph.setNodeProperties(a.id, { bad: { nested: 1 } })).rejects.toThrow(InvalidPropertyError);
    await expect(graph.setEdgeProperties(e.id, { bad: { nested: 1 } })).rejects.toThrow(InvalidPropertyError);

    // transaction.markFailed() across mutating Graph APIs
    const expectFailedTx = async (op: (tx: ReturnType<Graph['createTransaction']>) => Promise<unknown>) => {
      const tx = graph.createTransaction();
      await tx.begin();
      await expect(op(tx)).rejects.toThrow();
      expect(tx.isFailed()).toBe(true);
      await tx.rollback();
    };

    await expectFailedTx((tx) => graph.addNode('N', {}, tx, a.id));
    await expectFailedTx((tx) => graph.addNodes([{ labels: 'N', id: a.id }], tx));
    await expectFailedTx((tx) => graph.removeNode(a.id, false, tx));
    await expectFailedTx((tx) => graph.addEdge(a.id, 'missing-target', 'REL', {}, tx));
    await expectFailedTx((tx) => graph.addEdges([{ sourceId: a.id, targetId: 'missing', type: 'REL' }], tx));
    await expectFailedTx((tx) => graph.setNodeProperties('missing-node', { k: 1 }, { transaction: tx }));
    await expectFailedTx((tx) => graph.unsetNodeProperties('missing-node', ['k'], tx));
    await expectFailedTx((tx) => graph.removeNodeLabels('missing-node', ['Removable'], tx));
    await expectFailedTx((tx) => graph.addNodeLabels('missing-node', ['LTM'], tx));
    await expectFailedTx((tx) => graph.setEdgeProperties('missing-edge', { k: 1 }, { transaction: tx }));
    await expectFailedTx((tx) => graph.unsetEdgeProperties('missing-edge', ['k'], tx));

    // Non-cascade check outside transaction
    await expect(graph.removeNode(a.id, false)).rejects.toThrow(NodeHasEdgesError);

    // Concurrent removeNodeLabels vs cascade delete conflict
    const tDel = graph.createTransaction();
    const tLbl = graph.createTransaction();
    await tDel.begin();
    await tLbl.begin();
    await graph.removeNode(b.id, true, tDel);
    await graph.removeNodeLabels(b.id, ['Removable'], tLbl);
    await tDel.commit();
    await expect(tLbl.commit()).rejects.toThrow(TransactionConflictError);
    await tLbl.rollback();

    // Concurrent endpoint delete before addEdge conflict
    const c = await graph.addNode('N', { name: 'C' });
    const tEndDel = graph.createTransaction();
    const tEdgeAdd = graph.createTransaction();
    await tEndDel.begin();
    await tEdgeAdd.begin();
    await graph.removeNode(c.id, true, tEndDel);
    await graph.addEdge(a.id, c.id, 'REL', {}, tEdgeAdd);
    await tEndDel.commit();
    await expect(tEdgeAdd.commit()).rejects.toThrow(TransactionConflictError);
    await tEdgeAdd.rollback();
  });

  it('tracks concurrent non-transactional mutations while an explicit transaction is open', async () => {
    const liveGraph = new Graph();
    const n1 = await liveGraph.addNode('Live', { v: 1 });
    const n2 = await liveGraph.addNode('Live', { v: 2 });
    const n3 = await liveGraph.addNode('Live', { v: 3 });
    const e1 = await liveGraph.addEdge(n1.id, n2.id, 'REL', { w: 1 });
    const e2 = await liveGraph.addEdge(n2.id, n3.id, 'REL', { w: 2 });

    const txOpen = liveGraph.createTransaction();
    await txOpen.begin();
    await liveGraph.setNodeProperties(n1.id, { k: 1 });
    await liveGraph.setEdgeProperties(e1.id, { w: 9 });
    await liveGraph.removeEdge(e2.id);
    await liveGraph.removeNode(n3.id, true);
    await txOpen.rollback();

    expect((await liveGraph.getNode(n1.id))?.properties).toEqual({ v: 1, k: 1 });
    expect((await liveGraph.getEdge(e1.id))?.properties.w).toBe(9);
    expect(await liveGraph.getNode(n3.id)).toBeUndefined();
  });
});
