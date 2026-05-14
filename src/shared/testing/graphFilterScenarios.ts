import { beforeAll, afterAll, beforeEach, describe, it, expect } from '@jest/globals';
import { Graph } from '../../index';
import type { IStorageProvider } from '../../index';

/**
 * Shared test scenarios for Graph property filter operators.
 * Both InMemory and other providers run the exact same assertions.
 *
 * @param providerFunc - Function that returns the storage provider (undefined for InMemory)
 * @param beforeAllFunc - Optional beforeAll setup function
 * @param afterAllFunc - Optional afterAll cleanup function
 */
export function runGraphFilterScenarios(
  providerFunc: () => Promise<IStorageProvider> | IStorageProvider = undefined as any,
  beforeAllFunc: () => Promise<void> = async () => {},
  afterAllFunc: () => Promise<void> = async () => {}
): void {
  let provider: IStorageProvider | undefined;

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

  describe('Graph getNodes with property filter operators', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should filter with greater than (>) operator', async () => {
      await graph.addNode('Person', { age: 25, name: 'Alice' });
      await graph.addNode('Person', { age: 35, name: 'Bob' });
      await graph.addNode('Person', { age: 45, name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'age', value: 30, op: '>' }] }
      });
      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.properties.name as string).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should filter with less than (<) operator', async () => {
      await graph.addNode('Person', { age: 25, name: 'Alice' });
      await graph.addNode('Person', { age: 35, name: 'Bob' });
      await graph.addNode('Person', { age: 45, name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'age', value: 40, op: '<' }] }
      });
      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.properties.name as string).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should filter with greater than or equal (>=) operator', async () => {
      await graph.addNode('Person', { age: 25, name: 'Alice' });
      await graph.addNode('Person', { age: 35, name: 'Bob' });
      await graph.addNode('Person', { age: 45, name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'age', value: 35, op: '>=' }] }
      });
      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.properties.name as string).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should filter with less than or equal (<=) operator', async () => {
      await graph.addNode('Person', { age: 25, name: 'Alice' });
      await graph.addNode('Person', { age: 35, name: 'Bob' });
      await graph.addNode('Person', { age: 45, name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'age', value: 35, op: '<=' }] }
      });
      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.properties.name as string).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should filter with not equal (<>) operator', async () => {
      await graph.addNode('Person', { city: 'NYC', name: 'Alice' });
      await graph.addNode('Person', { city: 'LA', name: 'Bob' });
      await graph.addNode('Person', { city: 'NYC', name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'city', value: 'NYC', op: '<>' }] }
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Bob');
    });

    it('should filter with CONTAINS operator', async () => {
      await graph.addNode('Person', { name: 'Alice Johnson' });
      await graph.addNode('Person', { name: 'Bob Smith' });
      await graph.addNode('Person', { name: 'David Park' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'name', value: 'li', op: 'CONTAINS' }] }
      });
      // Alice Johnson contains 'li' (Al i ce)
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Alice Johnson');
    });

    it('should filter with STARTS_WITH operator', async () => {
      await graph.addNode('Person', { name: 'Alice' });
      await graph.addNode('Person', { name: 'Bob' });
      await graph.addNode('Person', { name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'name', value: 'Bo', op: 'STARTS_WITH' }] }
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Bob');
    });

    it('should filter with ENDS_WITH operator', async () => {
      await graph.addNode('Person', { name: 'Alice' });
      await graph.addNode('Person', { name: 'Bob' });
      await graph.addNode('Person', { name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'name', value: 'lie', op: 'ENDS_WITH' }] }
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Charlie');
    });

    it('should filter with IN operator', async () => {
      await graph.addNode('Person', { city: 'NYC', name: 'Alice' });
      await graph.addNode('Person', { city: 'LA', name: 'Bob' });
      await graph.addNode('Person', { city: 'SF', name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'city', value: ['NYC', 'SF'], op: 'IN' }] }
      });
      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.properties.name as string).sort()).toEqual(['Alice', 'Charlie']);
    });

    it('should filter with NOT_IN operator', async () => {
      await graph.addNode('Person', { city: 'NYC', name: 'Alice' });
      await graph.addNode('Person', { city: 'LA', name: 'Bob' });
      await graph.addNode('Person', { city: 'SF', name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'city', value: ['NYC', 'SF'], op: 'NOT_IN' }] }
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Bob');
    });

    it('should filter with IS_NULL operator', async () => {
      await graph.addNode('Person', { email: null, name: 'Alice' });
      await graph.addNode('Person', { email: 'bob@example.com', name: 'Bob' });
      await graph.addNode('Person', { email: 'charlie@example.com', name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'email', value: null, op: 'IS_NULL' }] }
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Alice');
    });

    it('should filter with IS_NOT_NULL operator', async () => {
      await graph.addNode('Person', { email: null, name: 'Alice' });
      await graph.addNode('Person', { email: 'bob@example.com', name: 'Bob' });
      await graph.addNode('Person', { email: 'charlie@example.com', name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'email', value: null, op: 'IS_NOT_NULL' }] }
      });
      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.properties.name as string).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('should default to equality (=) when op not specified', async () => {
      await graph.addNode('Person', { city: 'NYC', name: 'Alice' });
      await graph.addNode('Person', { city: 'LA', name: 'Bob' });
      await graph.addNode('Person', { city: 'NYC', name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [{ key: 'city', value: 'NYC' }] }
      });
      expect(nodes).toHaveLength(2);
    });

    it('should combine multiple property filters with AND logic', async () => {
      await graph.addNode('Person', { city: 'NYC', age: 25, name: 'Alice' });
      await graph.addNode('Person', { city: 'NYC', age: 35, name: 'Bob' });
      await graph.addNode('Person', { city: 'LA', age: 45, name: 'Charlie' });

      const nodes = await graph.getNodes({
        filter: { properties: [
          { key: 'city', value: 'NYC' },
          { key: 'age', value: 30, op: '>' }
        ] }
      });
      expect(nodes).toHaveLength(1);
      expect(nodes[0].properties.name).toBe('Bob');
    });

    it('should combine multiple property filters with AND logic - getEdgesTo/From', async () => {
      const n1 = await graph.addNode('Person', { city: 'NYC', age: 25, name: 'Alice' });
      const n2 = await graph.addNode('Person', { city: 'NYC', age: 35, name: 'Bob' });
      const n3 = await graph.addNode('Person', { city: 'LA', age: 45, name: 'Charlie' });
      const n4 = await graph.addNode('Person', { city: 'NYC', age: 28, name: 'David' });

      await graph.addEdge(n1.id, n2.id, 'KNOWS', { since: 2020, as: 'friend' });
      await graph.addEdge(n3.id, n2.id, 'KNOWS', { since: 2021, as: 'colleague', introducedBy: 'Charlie' });
      await graph.addEdge(n4.id, n2.id, 'KNOWS', { since: 2019, as: 'neighbor', introducedBy: 'Charlie' });

      const edges = await graph.getEdgesTo(n2.id, {
        filter: { properties: [
          { key: 'since', value: 2020, op: '>=' },
          { key: 'since', value: 2010, op: '>' },
          { key: 'since', value: 2025, op: '<' },
          { key: 'since', value: 2030, op: '<=' },
          { key: 'since', value: 2024, op: '<>' },
          { key: 'as', value: 'friend' },
          { key: 'as', value: 'friend', op: 'CONTAINS' },
          { key: 'as', value: ['friend', 'neighbor'], op: 'IN' },
          { key: 'as', value: ['colleague'], op: 'NOT_IN' },
          { key: 'as', value: null, op: 'IS_NOT_NULL' },
          { key: 'introducedBy', value: null, op: 'IS_NULL' },
          { key: 'as', value: 'fri', op: 'STARTS_WITH' },
          { key: 'as', value: 'end', op: 'ENDS_WITH' },
        ] }
      });
      expect(edges).toHaveLength(1);
      expect(edges[0].sourceId).toBe(n1.id);
      expect(edges[0].targetId).toBe(n2.id);
    });
  });

  describe('Graph getEdges with property filter operators', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should filter edges with greater than (>) operator', async () => {
      const n1 = await graph.addNode('Node', {});
      const n2 = await graph.addNode('Node', {});
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 10 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 50 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 100 });

      const edges = await graph.getEdges({
        filter: { properties: [{ key: 'weight', value: 50, op: '>' }] }
      });
      expect(edges).toHaveLength(1);
      expect(edges[0].properties.weight).toBe(100);
    });

    it('should filter edges with less than (<) operator', async () => {
      const n1 = await graph.addNode('Node', {});
      const n2 = await graph.addNode('Node', {});
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 10 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 50 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 100 });

      const edges = await graph.getEdges({
        filter: { properties: [{ key: 'weight', value: 50, op: '<' }] }
      });
      expect(edges).toHaveLength(1);
      expect(edges[0].properties.weight).toBe(10);
    });

    it('should filter edges with CONTAINS operator', async () => {
      const n1 = await graph.addNode('Node', {});
      const n2 = await graph.addNode('Node', {});
      await graph.addEdge(n1.id, n2.id, 'Link', { label: 'connects' });
      await graph.addEdge(n1.id, n2.id, 'Link', { label: 'links_to' });
      await graph.addEdge(n1.id, n2.id, 'Link', { label: 'attached_to' });

      const edges = await graph.getEdges({
        filter: { properties: [{ key: 'label', value: 'ks', op: 'CONTAINS' }] }
      });
      // only 'links_to' contains 'ks'
      expect(edges).toHaveLength(1);
      expect(edges[0].properties.label).toBe('links_to');
    });

    it('should filter edges with IN operator', async () => {
      const n1 = await graph.addNode('Node', {});
      const n2 = await graph.addNode('Node', {});
      await graph.addEdge(n1.id, n2.id, 'Link', { status: 'active' });
      await graph.addEdge(n1.id, n2.id, 'Link', { status: 'inactive' });
      await graph.addEdge(n1.id, n2.id, 'Link', { status: 'pending' });

      const edges = await graph.getEdges({
        filter: { properties: [{ key: 'status', value: ['active', 'pending'], op: 'IN' }] }
      });
      expect(edges).toHaveLength(2);
      expect(edges.map(e => e.properties.status as string).sort()).toEqual(['active', 'pending']);
    });

    it('should filter edges with IS_NULL operator', async () => {
      const n1 = await graph.addNode('Node', {});
      const n2 = await graph.addNode('Node', {});
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 10, status: 'active' });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 25 }); // no status
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 50, status: 'inactive' });

      const edges = await graph.getEdges({
        filter: { properties: [{ key: 'status', value: null, op: 'IS_NULL' }] }
      });
      expect(edges).toHaveLength(1);
      expect(edges[0].properties.weight).toBe(25);
    });
  });

  describe('Graph getNodeCount with property filter operators', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should count with greater than operator', async () => {
      await graph.addNode('Item', { price: 100 });
      await graph.addNode('Item', { price: 200 });
      await graph.addNode('Item', { price: 300 });

      const count = await graph.getNodeCount({
        filter: { properties: [{ key: 'price', value: 150, op: '>' }] }
      });
      expect(count).toBe(2);
    });

    it('should count with IN operator', async () => {
      await graph.addNode('Item', { price: 100 });
      await graph.addNode('Item', { price: 200 });
      await graph.addNode('Item', { price: 300 });

      const count = await graph.getNodeCount({
        filter: { properties: [{ key: 'price', value: [100, 300], op: 'IN' }] }
      });
      expect(count).toBe(2);
    });
  });

  describe('Graph getEdgeCount with property filter operators', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should count edges with greater than operator', async () => {
      const n1 = await graph.addNode('Node', {});
      const n2 = await graph.addNode('Node', {});
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 10 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 20 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 30 });

      const count = await graph.getEdgeCount({
        filter: { properties: [{ key: 'weight', value: 15, op: '>' }] }
      });
      expect(count).toBe(2);
    });

    it('should count edges with IN operator', async () => {
      const n1 = await graph.addNode('Node', {});
      const n2 = await graph.addNode('Node', {});
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 10 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 20 });
      await graph.addEdge(n1.id, n2.id, 'Link', { weight: 30 });

      const count = await graph.getEdgeCount({
        filter: { properties: [{ key: 'weight', value: [10, 30], op: 'IN' }] }
      });
      expect(count).toBe(2);
    });
  });
}