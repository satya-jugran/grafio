import { describe, expect, it } from '@jest/globals';
import { Graph } from '../../../src/Graph';
import { NodeNotFoundError } from '../../../src/errors';
import { InMemoryStorageProvider } from '../../../src/storage/InMemoryStorageProvider';
import { Uint32SlotSet } from '../../../src/storage/engine/Uint32SlotSet';
import { StringDictionary } from '../../../src/storage/engine/StringDictionary';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('SlotArena, Uint32SlotSet & StringDictionary', () => {
  describe('Uint32SlotSet', () => {
    it('supports small mode, indexed promotion (>32), growth, deletion, and intersection', () => {
      const s = new Uint32SlotSet(4);
      expect(s.add(10)).toBe(true);
      expect(s.add(10)).toBe(false);
      expect(s.add(20)).toBe(true);
      expect(s.add(30)).toBe(true);
      expect(s.has(20)).toBe(true);
      expect(s.has(99)).toBe(false);
      expect(s.delete(99)).toBe(false);
      expect(s.delete(20)).toBe(true); // middle swap-remove
      expect(s.delete(30)).toBe(true); // last element remove
      expect(s.toArray()).toEqual([10]);

      // Promote past SMALL_THRESHOLD (32) and trigger _grow beyond 64
      for (let i = 100; i < 180; i++) {
        expect(s.add(i)).toBe(true);
      }
      expect(s.add(150)).toBe(false); // duplicate in indexed mode
      expect(s.has(179)).toBe(true);
      expect(s.has(999)).toBe(false);
      expect(s.delete(999)).toBe(false);
      expect(s.delete(120)).toBe(true); // middle swap-remove in indexed mode
      expect(s.delete(179)).toBe(true); // tail remove in indexed mode

      const other = new Uint32SlotSet();
      other.add(10);
      other.add(130);
      other.add(500);

      const third = new Uint32SlotSet();
      third.add(10);
      third.add(130);

      expect(Array.from(Uint32SlotSet.intersect([]))).toEqual([]);
      expect(Array.from(Uint32SlotSet.intersect([other])).sort((a, b) => a - b)).toEqual([10, 130, 500]);
      expect(Array.from(Uint32SlotSet.intersect([s, other, third])).sort((a, b) => a - b)).toEqual([10, 130]);
      expect(Array.from(Uint32SlotSet.intersect([s, new Uint32SlotSet()]))).toEqual([]);

      s.clear();
      expect(s.size).toBe(0);
    });
  });

  describe('StringDictionary (>64 bitmask overflow)', () => {
    it('tracks size, interning, clearing, and bitmasks across 0..70 labels', () => {
      const dict = new StringDictionary();
      const names: string[] = [];
      for (let i = 0; i < 70; i++) {
        const name = `L${i}`;
        names.push(name);
        expect(dict.intern(name)).toBe(i);
      }
      expect(dict.size).toBe(70);
      expect(dict.getString(69)).toBe('L69');

      // Mask spanning lo (<32), hi (32..63), and overflow (>=64)
      const [lo, hi] = StringDictionary.computeMask64([1, 35, 68]);
      const qLow = dict.buildQueryMask(['L1'])!;
      const qHi = dict.buildQueryMask(['L35'])!;
      const qOver = dict.buildQueryMask(['L68', 'L999'])!;
      const qMissing = dict.buildQueryMask(['NOPE']);
      expect(qMissing).toBeNull();
      expect(StringDictionary.matchesQuery(lo, hi, qLow)).toBe(true);
      expect(StringDictionary.matchesQuery(lo, hi, qHi)).toBe(true);
      expect(StringDictionary.matchesQuery(lo, hi, qOver, [1, 35, 68])).toBe(true);
      expect(StringDictionary.matchesQuery(lo, hi, qOver, [1, 35])).toBe(false);

      dict.clear();
      expect(dict.size).toBe(0);
    });
  });

  describe('Slot-encoded IDs, custom IDs, UUID strategy, and generation safety', () => {
    it('allocates @n<slot>:<gen> and @e<slot>:<gen> by default and bumps generation on slot recycle', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);

      const n0 = await graph.addNode('Person', { name: 'A' });
      const n1 = await graph.addNode('Person', { name: 'B' });
      expect(n0.id).toBe('@n0:1');
      expect(n1.id).toBe('@n1:1');

      const e0 = await graph.addEdge(n0.id, n1.id, 'KNOWS', { since: 2020 });
      expect(e0.id).toBe('@e0:1');

      // Delete first node and edge, then allocate replacements on recycled slots
      await graph.removeEdge(e0.id);
      await graph.removeNode(n0.id);

      expect(await graph.getNode('@n0:1')).toBeUndefined();
      expect(await graph.getEdge('@e0:1')).toBeUndefined();

      const n0Recycled = await graph.addNode('Person', { name: 'Reborn' });
      expect(n0Recycled.id).toBe('@n0:2');
      // Stale generation ID still returns undefined
      expect(await graph.getNode('@n0:1')).toBeUndefined();
      expect((await graph.getNode('@n0:2'))?.properties.name).toBe('Reborn');

      const e0Recycled = await graph.addEdge(n0Recycled.id, n1.id, 'KNOWS', {});
      expect(e0Recycled.id).toBe('@e0:2');
      expect(await graph.getEdge('@e0:1')).toBeUndefined();
      expect(await graph.getEdge('@e0:2')).toBeDefined();
    });

    it('supports custom explicit IDs alongside compact slot IDs', async () => {
      const graph = new Graph(new InMemoryStorageProvider());
      const custom = await graph.addNode('User', { name: 'Custom' }, undefined, 'user-custom-1');
      const compact = await graph.addNode('User', { name: 'Auto' });

      expect(custom.id).toBe('user-custom-1');
      expect(compact.id).toBe('@n1:1');
      expect((await graph.getNode('user-custom-1'))?.properties.name).toBe('Custom');
      expect((await graph.getNode('@n1:1'))?.properties.name).toBe('Auto');
    });

    it('supports idStrategy: uuid generating RFC-4122 v4 UUIDs', async () => {
      const graph = new Graph(new InMemoryStorageProvider({ idStrategy: 'uuid' }));
      const n1 = await graph.addNode('Person', { name: 'U1' });
      const n2 = await graph.addNode('Person', { name: 'U2' });
      const e = await graph.addEdge(n1.id, n2.id, 'FOLLOWS');

      expect(n1.id).toMatch(UUID_REGEX);
      expect(n2.id).toMatch(UUID_REGEX);
      expect(e.id).toMatch(UUID_REGEX);
    });

    it('rejects non-canonical @n00:1 / @n0:01 IDs, separates [] vs [""] label interning, and supports >65,535 edgeTypeIds', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);
      const n = await graph.addNode('Person', { name: 'Zero' });
      expect(n.id).toBe('@n0:1');

      expect(await graph.getNode('@n00:1')).toBeUndefined();
      expect(await graph.getNode('@n0:01')).toBeUndefined();
      expect((await graph.removeNode('@n00:1')).result).toBe(false);
      expect((await graph.getNode('@n0:1'))?.properties.name).toBe('Zero');

      const empty = store.arena.internLabels([]);
      const blank = store.arena.internLabels(['']);
      expect(empty.frozenLabels).toEqual([]);
      expect(blank.frozenLabels).toEqual(['']);

      expect(store.arena.edgeTypeId).toBeInstanceOf(Uint32Array);
      for (let i = 0; i < 65540; i++) {
        store.arena.edgeTypeDict.intern(`T${i}`);
      }
      const highEdge = store.insertEdgeSync(n.id, n.id, 'T65539', {});
      const highSlot = store.arena.resolveEdgeSlot(highEdge.id);
      expect(store.arena.edgeTypeId[highSlot]).toBeGreaterThan(65535);
    });
  });

  describe('Capacity growth (>256 nodes)', () => {
    it('grows SlotArena & AdjacencyStore past initial capacities and compacts empty graph', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);

      graph.compact(); // empty graph fast path
      const batch = Array.from({ length: 280 }, (_, i) => ({
        labels: 'Item',
        properties: { idx: i },
      }));
      const nodes = await graph.addNodes(batch);
      expect(nodes).toHaveLength(280);

      // Add >4 incremental delta edges from node[0] to grow delta buffer
      for (let i = 1; i <= 8; i++) {
        await graph.addEdge(nodes[0].id, nodes[i].id, 'TO', { i });
      }
      expect(await graph.getEdgesFrom(nodes[0].id)).toHaveLength(8);
      graph.compact();
      expect(store.adjacency.csrEdgeCount).toBe(8);
    });
  });

  describe('Batch insert atomicity, dangling-edge lifecycle, CSR slot retirement, and undo checkpoints', () => {
    it('aborts insertEdges and insertEdgesSync atomically on mid-batch errors when graph has zero edges', async () => {
      const store = new InMemoryStorageProvider();
      await store.insertNode({ id: 'n1', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'n2', labels: ['N'], properties: {} });

      expect(() =>
        store.insertEdgesSync([
          { id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} },
          { id: 'e2', sourceId: 'n1', targetId: 'missing', type: 'T', properties: {} },
        ]),
      ).toThrow(NodeNotFoundError);

      expect(await store.getEdgeCount()).toBe(0);
      expect(await store.getEdgesBySource('n1')).toEqual([]);

      await expect(
        store.insertEdges([
          { id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} },
          { id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} },
        ]),
      ).rejects.toThrow();

      expect(await store.getEdgeCount()).toBe(0);
    });

    it('detaches incident edges on raw deleteNode without corrupting topologicalSort or recycled slots', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);
      await store.insertNode({ id: 'a', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'b', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'c', labels: ['N'], properties: {} });
      await store.insertEdge({ id: 'e_ab', sourceId: 'a', targetId: 'b', type: 'T', properties: {} });
      await store.insertEdge({ id: 'e_bc', sourceId: 'b', targetId: 'c', type: 'T', properties: {} });

      store.compact();
      await store.deleteNode('a');

      const order = await graph.topologicalSort();
      expect(order).toEqual(['b', 'c']);
      expect((await graph.getEdgesTo('b')).map((e) => e.id)).toEqual(['e_ab']);

      // Re-test delta free-slot reuse (no CSR) to ensure recycled slot 0 does not inherit e_ab
      const store2 = new InMemoryStorageProvider();
      const graph2 = new Graph(store2);
      const a2 = store2.insertNodeSync(['N'], { name: 'a2' });
      const b2 = store2.insertNodeSync(['N'], { name: 'b2' });
      store2.insertEdgeSync(a2.id, b2.id, 'T', {});
      await store2.deleteNode(a2.id);
      const reborn = store2.insertNodeSync(['N'], { name: 'reborn' });
      expect(reborn.id).toBe('@n0:2');
      expect(await graph2.getEdgesFrom(reborn.id)).toEqual([]);
      expect((await graph2.getEdgesTo(b2.id)).map((e) => e.sourceId)).toEqual(['@n0:1']);
    });

    it('binds dangling edges into AdjacencyStore when missing endpoint nodes are inserted later', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);
      await store.insertNode({ id: 'src', labels: ['N'], properties: {} });
      await store.insertEdge({
        id: 'dangling-e',
        sourceId: 'src',
        targetId: 'tgt',
        type: 'LINKS',
        properties: {},
      });

      expect((await graph.getEdgesFrom('src')).map((e) => e.id)).toEqual(['dangling-e']);

      await store.insertNode({ id: 'tgt', labels: ['N'], properties: {} });

      expect((await graph.getEdgesFrom('src')).map((e) => e.id)).toEqual(['dangling-e']);
      expect((await graph.getEdgesTo('tgt')).map((e) => e.id)).toEqual(['dangling-e']);
      expect(await graph.traverse('src', 'tgt')).toEqual([['src', 'tgt']]);
      expect(
        graph.querySync("MATCH (s)-[:LINKS]->(t) WHERE id(s) = 'src' RETURN id(t) AS tid").rows,
      ).toEqual([{ tid: 'tgt' }]);
    });

    it('restores dangling edges and preserves compact @slot:gen IDs on undo checkpoint rollback', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);
      const compactNode = await graph.addNode(['Person', 'Temp'], { name: 'Compact' });
      expect(compactNode.id).toBe('@n0:1');

      await store.insertEdge({
        id: 'd-edge',
        sourceId: compactNode.id,
        targetId: 'missing-node',
        type: 'PENDING',
        properties: {},
      });

      store.beginUndoCheckpoint();
      await store.deleteEdge('d-edge');
      store.removeNodeLabelsSync(compactNode.id, ['Temp']);
      store.rollbackUndoCheckpoint();

      expect((await graph.getEdge('d-edge'))?.id).toBe('d-edge');
      expect((await graph.getEdgesFrom(compactNode.id)).map((e) => e.id)).toEqual(['d-edge']);
      const restoredNode = await graph.getNode('@n0:1');
      expect(restoredNode?.labels).toEqual(['Person', 'Temp']);
      expect(store.arena.nodeHasCustomId[0]).toBe(0);
    });

    it('retires CSR edge slots across transactional cascade delete until compact()', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);
      await graph.addNode('N', { name: 'A' }, undefined, 'A');
      await graph.addNode('N', { name: 'B' }, undefined, 'B');
      await graph.addNode('N', { name: 'C' }, undefined, 'C');
      await graph.addNode('N', { name: 'D' }, undefined, 'D');
      await graph.addEdge('A', 'B', 'LINKS', {}, undefined, 'e0');
      graph.compact();

      const tx = graph.createTransaction();
      await tx.begin();
      await graph.removeNode('B', true, tx);
      await tx.commit();

      const ecd = await graph.addEdge('C', 'D', 'LINKS', {}, undefined, 'e_cd');
      expect(ecd.id).not.toBe('@e0:2');

      await graph.removeNode('A', false);

      expect(
        graph.querySync('MATCH (c)-[:LINKS]->(d) RETURN id(c) AS cid, id(d) AS did').rows,
      ).toEqual([{ cid: 'C', did: 'D' }]);
      expect(await graph.traverse('C', 'D')).toEqual([['C', 'D']]);
    });

    it('retires CSR edge slots across raw deleteNode followed by deleteEdge', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);
      await store.insertNode({ id: 'A', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'B', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'C', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'D', labels: ['N'], properties: {} });
      await store.insertEdge({ id: 'e0', sourceId: 'A', targetId: 'B', type: 'LINKS', properties: {} });
      graph.compact();

      await store.deleteNode('B');
      await store.deleteEdge('e0');

      await graph.addEdge('C', 'D', 'LINKS', {}, undefined, 'e_cd');
      await graph.removeNode('A', false);

      expect(
        graph.querySync('MATCH (c)-[:LINKS]->(d) RETURN id(c) AS cid, id(d) AS did').rows,
      ).toEqual([{ cid: 'C', did: 'D' }]);
      expect(await graph.traverse('C', 'D')).toEqual([['C', 'D']]);
    });

    it('retires CSR edge slots when detached, rebound into delta, and deleted, then reclaims on compact()', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);
      await store.insertNode({ id: 'A', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'B', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'C', labels: ['N'], properties: {} });
      await store.insertNode({ id: 'D', labels: ['N'], properties: {} });
      await store.insertEdge({ id: 'e0', sourceId: 'A', targetId: 'B', type: 'LINKS', properties: {} });
      graph.compact();

      await store.deleteNode('B');
      await store.insertNode({ id: 'B', labels: ['N'], properties: {} });
      await graph.removeEdge('e0');

      const beforeCompact = await graph.addEdge('C', 'D', 'LINKS', {});
      expect(beforeCompact.id).not.toBe('@e0:2');

      await graph.removeNode('A', false);

      expect(
        graph.querySync('MATCH (c)-[:LINKS]->(d) RETURN id(c) AS cid, id(d) AS did').rows,
      ).toEqual([{ cid: 'C', did: 'D' }]);
      expect(await graph.traverse('C', 'D')).toEqual([['C', 'D']]);

      graph.compact();
      const afterCompact = await graph.addEdge('C', 'D', 'LINKS2', {});
      expect(afterCompact.id).toBe('@e0:2');
    });

    it('cascades deletes across CSR-compacted and dangling edges and rejects non-detached DELETE on connected nodes', async () => {
      const store = new InMemoryStorageProvider();
      const gCsr = new Graph(store);
      const u = await gCsr.addNode('Node', { k: 'u' });
      const v = await gCsr.addNode('Node', { k: 'v' });
      const w = await gCsr.addNode('Node', { k: 'w' });
      await gCsr.addEdge(u.id, v.id, 'R');
      await gCsr.addEdge(w.id, u.id, 'R');
      gCsr.compact();
      await store.insertEdges([
        { id: 'dang-out', sourceId: v.id, targetId: 'ghost-1', type: 'R', properties: {} },
        { id: 'dang-in', sourceId: 'ghost-2', targetId: v.id, type: 'R', properties: {} },
      ]);
      await gCsr.removeNode(u.id, true);
      await gCsr.removeNode(v.id, true);
      expect(await gCsr.getEdgeCount()).toBe(0);

      const liveGraph = new Graph();
      const n1 = await liveGraph.addNode('Live', { v: 1 });
      const n2 = await liveGraph.addNode('Live', { v: 2 });
      await liveGraph.addEdge(n1.id, n2.id, 'REL', { w: 1 });

      expect(() =>
        liveGraph.querySync('MATCH (n:Live) WHERE id(n) = $id DELETE n', { id: n1.id }),
      ).toThrow(/DETACH DELETE/);
      const detachRes = liveGraph.querySync(
        'MATCH (n:Live) WHERE id(n) = $id DETACH DELETE n',
        { id: n1.id },
      );
      expect(detachRes.summary.edgesDeleted).toBeGreaterThanOrEqual(1);
    });
  });
});
