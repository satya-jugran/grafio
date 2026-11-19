import { describe, expect, it } from '@jest/globals';
import { Graph } from '../../../src/Graph';
import { InMemoryStorageProvider } from '../../../src/storage/InMemoryStorageProvider';

describe('PropertyIndexStore', () => {
  describe('Scoped hash and sorted range scans', () => {
    it('keeps hasIndex false by default and respects labelOrType scope and deleteIndex', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);

      expect(await graph.hasIndex('node', ['age'])).toBe(false);
      expect(await graph.hasIndex('node', ['age'], 'Person')).toBe(false);

      await graph.createIndex('idx_person_age', 'node', ['age'], { labelOrType: 'Person' });

      expect(await graph.hasIndex('node', ['age'], 'Person')).toBe(true);
      expect(await graph.hasIndex('node', ['age'], 'Company')).toBe(false);
      expect(await graph.hasIndex('node', ['age'])).toBe(false);

      await graph.addNode('Person', { name: 'Alice', age: 25 });
      await graph.addNode('Person', { name: 'Bob', age: 35 });
      await graph.addNode('Person', { name: 'Carol', age: 45 });
      await graph.addNode('Company', { name: 'Acme', age: 35 });

      const matched = await graph.getNodes({
        filter: {
          types: ['Person'],
          properties: [
            { key: 'age', op: '>=', value: 30 },
            { key: 'age', op: '<', value: 45 },
          ],
        },
      });
      expect(matched.map((n) => n.properties.name)).toEqual(['Bob']);

      // String STARTS_WITH sorted range index check
      await graph.createIndex('idx_person_name', 'node', ['name'], { labelOrType: 'Person' });
      const startsWithB = await graph.getNodes({
        filter: {
          types: ['Person'],
          properties: [{ key: 'name', op: 'STARTS_WITH', value: 'Bo' }],
        },
      });
      expect(startsWithB.map((n) => n.properties.name)).toEqual(['Bob']);

      await graph.deleteIndex('idx_person_age');
      expect(await graph.hasIndex('node', ['age'], 'Person')).toBe(false);

      // Queries still produce exact results via full scan after index deletion
      const afterDelete = await graph.getNodes({
        filter: {
          types: ['Person'],
          properties: [{ key: 'age', op: '>', value: 30 }],
        },
      });
      expect(afterDelete.map((n) => n.properties.name)).toEqual(['Bob', 'Carol']);
    });
  });

  describe('Range ordering, IN deduplication, compound index selection, and prototype safety', () => {
    it('applies label filtering after unscoped range scan before ORDER BY + LIMIT', async () => {
      const graph = new Graph();
      await graph.createIndex('idx_age', 'node', ['age']);
      await graph.addNode('Company', { name: 'C1', age: 100 });
      await graph.addNode('Company', { name: 'C2', age: 90 });
      await graph.addNode('Person', { name: 'P1', age: 40 });
      await graph.addNode('Person', { name: 'P2', age: 30 });
      await graph.addNode('Person', { name: 'P3', age: 20 });

      const persons = await graph.getNodes({
        filter: {
          types: ['Person'],
          properties: [{ key: 'age', op: '>', value: 0 }],
        },
        orderBy: { field: 'age', direction: 'desc' },
        limit: 2,
      });
      expect(persons.map((p) => p.properties.name)).toEqual(['P1', 'P2']);
    });

    it('deduplicates repeated values in indexed IN lookups and ignores Object.prototype keys', async () => {
      const graph = new Graph();
      await graph.createIndex('idx_age', 'node', ['age']);
      await graph.createIndex('idx_proto', 'node', ['toString']);
      await graph.addNode('Person', { name: 'Alice', age: 30 });
      await graph.addNode('Person', { name: 'Bob', age: 25 });

      const inRows = await graph.getNodes({
        filter: {
          types: ['Person'],
          properties: [{ key: 'age', op: 'IN', value: [30, 30] }],
        },
      });
      expect(inRows.map((n) => n.properties.name)).toEqual(['Alice']);

      const protoRows = await graph.getNodes({
        filter: { properties: [{ key: 'toString', value: 'foo' }] },
      });
      expect(protoRows).toEqual([]);
    });

    it('prefers wider compound indexes over narrower label-scoped indexes', async () => {
      const store = new InMemoryStorageProvider();
      await store.createIndex('wide3', 'node', ['a', 'b', 'c']);
      await store.createIndex('narrow2_scoped', 'node', ['a', 'b'], { labelOrType: 'Person' });
      const best = store.propertyIndexes.findCompoundIndex('node', ['a', 'b', 'c'], ['Person']);
      expect(best?.name).toBe('wide3');
    });
  });

  describe('Edge indexes, compound indexes, and filter operators', () => {
    it('supports edge property indexes, compound indexes, distinct aggregates, sorting, and filter operators', async () => {
      const store = new InMemoryStorageProvider();
      const graph = new Graph(store);

      await graph.createIndex('edge_weight', 'edge', ['weight'], { labelOrType: 'REL' });
      await graph.createIndex('node_compound', 'node', ['dept', 'level'], { labelOrType: 'Staff' });
      expect(await graph.hasIndex('edge', ['weight'], 'REL')).toBe(true);
      expect(await graph.hasIndex('node', ['dept', 'level'], 'Staff')).toBe(true);

      const n1 = await graph.addNode('Staff', { name: 'Alpha', dept: 'Eng', level: 2, score: 10 });
      const n2 = await graph.addNode('Staff', { name: 'Beta', dept: 'Eng', level: 2, score: 20 });
      const n3 = await graph.addNode('Staff', { name: 'Gamma', dept: 'Ops', level: 3, score: null });

      const e1 = await graph.addEdge(n1.id, n2.id, 'REL', { weight: 10, tag: 'x' });
      await graph.addEdge(n2.id, n3.id, 'REL', { weight: 10, tag: 'y' });
      await graph.addEdge(n1.id, n3.id, 'REL', { weight: 30, tag: 'z' });

      // Update indexed edge property + query range
      await graph.setEdgeProperties(e1.id, { weight: 25 });
      const rangedEdges = await graph.getEdges({
        filter: {
          types: ['REL'],
          properties: [{ key: 'weight', op: '>=', value: 20 }],
        },
        orderBy: { field: 'weight', direction: 'desc' },
      });
      expect(rangedEdges.map((e) => e.properties.weight)).toEqual([30, 25]);

      // Distinct aggregate on edge + mixed column edge aggregate
      const distinctAgg = await graph.aggregateEdgeProperty('weight', {
        filter: { types: ['REL'] },
        distinct: true,
      });
      expect(distinctAgg.count).toBe(3);

      // Update compound node property + query with IN / NOT_IN / CONTAINS / ENDS_WITH / IS_NULL / IS_NOT_NULL / OR
      await graph.setNodeProperties(n1.id, { level: 9 });
      const staff = await graph.getNodes({
        filter: {
          types: ['Staff'],
          properties: [
            { key: 'dept', op: '=', value: 'Eng' },
            { key: 'level', op: '=', value: 2 },
          ],
        },
      });
      expect(staff.map((n) => n.properties.name)).toEqual(['Beta']);

      const opRes = await graph.getNodes({
        filter: {
          types: ['Staff'],
          properties: [
            {
              OR: [
                { key: 'name', op: 'CONTAINS', value: 'lph' },
                { key: 'name', op: 'ENDS_WITH', value: 'eta' },
              ],
            },
            { key: 'score', op: 'IS_NOT_NULL', value: true },
          ],
        },
        orderBy: { field: 'score', direction: 'asc' },
      });
      expect(opRes.map((n) => n.properties.name)).toEqual(['Alpha', 'Beta']);

      const nullRes = await graph.getNodes({
        filter: {
          types: ['Staff'],
          properties: [
            { key: 'score', op: 'IS_NULL', value: null },
            { key: 'name', op: 'NOT_IN', value: ['Alpha', 'Beta'] },
          ],
        },
      });
      expect(nullRes.map((n) => n.properties.name)).toEqual(['Gamma']);

      await graph.removeNode(n3.id, true);
      expect(await graph.getEdgeCount()).toBe(1);
    });
  });

  describe('Sorted numeric and string range scans with ORDER BY and LIMIT', () => {
    it('evaluates sorted numeric and string range scans with ascending/descending ORDER BY and LIMIT', async () => {
      const graph = new Graph();
      await graph.createIndex('idx_score', 'node', ['score'], { labelOrType: 'Score' });
      await graph.createIndex('idx_code', 'node', ['code'], { labelOrType: 'Score' });
      await graph.createIndex('idx_ew', 'edge', ['w'], { labelOrType: 'EDGE' });

      // Empty index range queries before populating data
      expect(
        await graph.getNodes({
          filter: { types: ['Score'], properties: [{ key: 'score', op: '>', value: 0 }] },
        }),
      ).toEqual([]);
      expect(
        await graph.getNodes({
          filter: { types: ['Score'], properties: [{ key: 'code', op: '>=', value: 'a' }] },
        }),
      ).toEqual([]);

      const [s1, s2, s3, s4] = await graph.addNodes([
        { labels: 'Score', properties: { score: 10, code: 'b1' } },
        { labels: 'Score', properties: { score: 20, code: 'b2' } },
        { labels: 'Score', properties: { score: 30, code: 'c1' } },
        { labels: 'Score', properties: { score: 40, code: 'c2' } },
      ]);
      await graph.addEdge(s1.id, s2.id, 'EDGE', { w: 1 });
      await graph.addEdge(s2.id, s3.id, 'EDGE', { w: 2 });
      await graph.addEdge(s3.id, s4.id, 'EDGE', { w: 3 });

      // Numeric range queries with desc + limit shortcut and asc
      const numDesc = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'score', op: '>=', value: 15 }] },
        orderBy: { field: 'score', direction: 'desc' },
        limit: 2,
      });
      expect(numDesc.map((n) => n.properties.score)).toEqual([40, 30]);

      const numAsc = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'score', op: '>', value: 10 }] },
        orderBy: { field: 'score', direction: 'asc' },
        limit: 2,
      });
      expect(numAsc.map((n) => n.properties.score)).toEqual([20, 30]);

      const numLt = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'score', op: '<', value: 35 }] },
        orderBy: { field: 'score', direction: 'desc' },
        limit: 2,
      });
      expect(numLt.map((n) => n.properties.score)).toEqual([30, 20]);

      const numLte = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'score', op: '<=', value: 25 }] },
        orderBy: { field: 'score', direction: 'asc' },
        limit: 1,
      });
      expect(numLte.map((n) => n.properties.score)).toEqual([10]);

      // String range queries with STARTS_WITH, >, >=, <, <=, desc + limit, asc + limit, out-of-range
      const strDesc = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'code', op: '>=', value: 'b2' }] },
        orderBy: { field: 'code', direction: 'desc' },
        limit: 2,
      });
      expect(strDesc.map((n) => n.properties.code)).toEqual(['c2', 'c1']);

      const strAsc = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'code', op: '>', value: 'b1' }] },
        orderBy: { field: 'code', direction: 'asc' },
        limit: 2,
      });
      expect(strAsc.map((n) => n.properties.code)).toEqual(['b2', 'c1']);

      const strLt = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'code', op: '<', value: 'c2' }] },
        orderBy: { field: 'code', direction: 'desc' },
        limit: 2,
      });
      expect(strLt.map((n) => n.properties.code)).toEqual(['c1', 'b2']);

      const strLte = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'code', op: '<=', value: 'b2' }] },
        orderBy: { field: 'code', direction: 'asc' },
        limit: 1,
      });
      expect(strLte.map((n) => n.properties.code)).toEqual(['b1']);

      const strStarts = await graph.getNodes({
        filter: { types: ['Score'], properties: [{ key: 'code', op: 'STARTS_WITH', value: 'b' }] },
        orderBy: { field: 'code', direction: 'desc' },
        limit: 1,
      });
      expect(strStarts.map((n) => n.properties.code)).toEqual(['b2']);

      expect(
        await graph.getNodes({
          filter: { types: ['Score'], properties: [{ key: 'code', op: '>', value: 'zzz' }] },
        }),
      ).toEqual([]);
      expect(
        await graph.getNodes({
          filter: { types: ['Score'], properties: [{ key: 'code', op: '<', value: 'aaa' }] },
        }),
      ).toEqual([]);

      const edgeRange = await graph.getEdges({
        filter: { types: ['EDGE'], properties: [{ key: 'w', op: '>=', value: 2 }] },
      });
      expect(edgeRange.length).toBe(2);
    });
  });
});
