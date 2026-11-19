import { describe, expect, it } from '@jest/globals';
import { Graph } from '../../../src/Graph';
import { InMemoryStorageProvider } from '../../../src/storage/InMemoryStorageProvider';
import { StringDictionary } from '../../../src/storage/engine/StringDictionary';
import { ColumnStore } from '../../../src/storage/engine/ColumnStore';

describe('ColumnStore', () => {
  describe('Typed column promotion and frozen entity snapshots', () => {
    it('stores homogeneous number/boolean/string columns and promotes cleanly to mixed', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);

      const n1 = await graph.addNode('Metric', {
        score: 42.5,
        active: true,
        tag: 'alpha',
      });
      const n2 = await graph.addNode('Metric', {
        score: 99,
        active: false,
        tag: 'beta',
      });

      const scoreKeyId = store.arena.nodePropDict.lookup('score');
      const activeKeyId = store.arena.nodePropDict.lookup('active');
      const tagKeyId = store.arena.nodePropDict.lookup('tag');

      expect(store.arena.nodeColumns.getColumnByKeyId(scoreKeyId)?.kind).toBe('number');
      expect(store.arena.nodeColumns.getColumnByKeyId(scoreKeyId)?.numValues).toBeInstanceOf(Float64Array);
      expect(store.arena.nodeColumns.getColumnByKeyId(activeKeyId)?.kind).toBe('boolean');
      expect(store.arena.nodeColumns.getColumnByKeyId(tagKeyId)?.kind).toBe('string');

      // Writing a string into numeric column promotes it cleanly to 'mixed' without data loss
      await graph.setNodeProperties(n2.id, { score: 'N/A' });
      const promotedCol = store.arena.nodeColumns.getColumnByKeyId(scoreKeyId);
      expect(promotedCol?.kind).toBe('mixed');
      expect((await graph.getNode(n1.id))?.properties.score).toBe(42.5);
      expect((await graph.getNode(n2.id))?.properties.score).toBe('N/A');
    });

    it('freezes materialized .properties and .labels objects', async () => {
      const graph = new Graph();
      const a = await graph.addNode('Item', { qty: 3 });
      const b = await graph.addNode('Item', { qty: 5 });
      const e = await graph.addEdge(a.id, b.id, 'LINK', { weight: 1.5 });

      expect(Object.isFrozen(a.properties)).toBe(true);
      expect(Object.isFrozen(a.labels)).toBe(true);
      expect(Object.isFrozen(e.properties)).toBe(true);
      expect(() => {
        (a.properties as Record<string, unknown>).qty = 999;
      }).toThrow();

      await graph.setNodeProperties(a.id, { qty: 10 });
      // Previously materialized wrapper kept its snapshot; new fetch gets fresh frozen props
      expect(a.properties.qty).toBe(3);
      expect((await graph.getNode(a.id))?.properties.qty).toBe(10);
    });
  });

  describe('Null/undefined tags, capacity growth, and >64 property masks', () => {
    it('promotes untyped, boolean, number, string, and mixed columns across capacity growth and >64 property keys', () => {
      const dict = new StringDictionary();
      const cs = new ColumnStore(dict, 2);

      // Untyped -> null / undefined -> grow -> typed promotions
      const kNum = cs.setValue('uNum', 0, null);
      cs.setValue('uNum', 1, undefined);
      expect(cs.getValueByKeyId(kNum, 0)).toBeNull();
      expect(cs.getValueByKeyId(kNum, 1)).toBeUndefined();
      cs.grow(8);
      cs.setValue('uNum', 2, 12.5);
      expect(cs.getValueByKeyId(kNum, 0)).toBeNull();
      expect(cs.getValueByKeyId(kNum, 1)).toBeUndefined();
      expect(cs.getValueByKeyId(kNum, 2)).toBe(12.5);

      const kBool = cs.setValue('uBool', 0, null);
      cs.setValue('uBool', 1, true);
      cs.setValue('uBool', 2, false);
      cs.setValue('uBool', 3, undefined);
      expect(cs.getValueByKeyId(kBool, 0)).toBeNull();
      expect(cs.getValueByKeyId(kBool, 1)).toBe(true);
      expect(cs.getValueByKeyId(kBool, 2)).toBe(false);
      expect(cs.getValueByKeyId(kBool, 3)).toBeUndefined();
      // Promoting boolean column to mixed when non-boolean written
      cs.setValue('uBool', 4, 'yes');
      expect(cs.getValueByKeyId(kBool, 1)).toBe(true);
      expect(cs.getValueByKeyId(kBool, 4)).toBe('yes');

      const kStr = cs.setValue('uStr', 0, null);
      cs.setValue('uStr', 1, 'hello');
      cs.grow(12);
      cs.setValue('uStr', 5, 'grown');
      expect(cs.getValueByKeyId(kStr, 0)).toBeNull();
      expect(cs.getValueByKeyId(kStr, 1)).toBe('hello');
      expect(cs.getValueByKeyId(kStr, 5)).toBe('grown');
      cs.setValue('uStr', 5, undefined);
      expect(cs.getValueByKeyId(kStr, 5)).toBeUndefined();
      // Promote string column to mixed
      cs.setValue('uStr', 2, 42);
      expect(cs.getValueByKeyId(kStr, 1)).toBe('hello');
      expect(cs.getValueByKeyId(kStr, 2)).toBe(42);

      // Slot with 70 properties exercises slotMaskLo, slotMaskHi, and overflow key list
      const bigRecord: Record<string, unknown> = {};
      for (let k = 0; k < 70; k++) {
        bigRecord[`p_${k}`] = k;
      }
      cs.setRecord(6, bigRecord);
      const materialized = cs.materializeRecord(6);
      expect(materialized['p_0']).toBe(0);
      expect(materialized['p_40']).toBe(40);
      expect(materialized['p_69']).toBe(69);

      const overflowId = dict.lookup('p_69');
      cs.deleteValueByKeyId(overflowId, 6);
      expect(cs.materializeRecord(6)['p_69']).toBeUndefined();

      cs.clearSlot(6);
      expect(Object.keys(cs.materializeRecord(6))).toHaveLength(0);
      cs.clearAll();
      expect(cs.getValueByKeyId(kNum, 2)).toBeUndefined();
    });
  });
});
