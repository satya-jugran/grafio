import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider } from '../../index';
import { InvalidPropertyError } from '../../errors';

/**
 * Shared test scenarios for Graph property validation and indexing.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphPropertiesScenarios(
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

  describe('Graph Node/Edge Properties Validation', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    describe('Node property validation', () => {
      it('should accept primitive property values', async () => {
        const node = await graph.addNode('Person', {
          name: 'Alice',
          age: 30,
          active: true,
          email: null,
          score: undefined,
        });
        expect(node.properties.name).toBe('Alice');
        expect(node.properties.age).toBe(30);
        expect(node.properties.active).toBe(true);
        expect(node.properties.email).toBe(null);
      });

      it('should reject nested object property values', async () => {
        await expect(
          graph.addNode('Person', {
            name: 'Alice',
            address: { city: 'NYC' },
          })
        ).rejects.toThrow(InvalidPropertyError);
      });

      it('should reject array property values', async () => {
        await expect(
          graph.addNode('Person', {
            name: 'Alice',
            tags: ['admin', 'user'],
          })
        ).rejects.toThrow(InvalidPropertyError);
      });

      it('should reject function property values', async () => {
        await expect(
          graph.addNode('Person', {
            name: 'Alice',
            callback: () => {},
          })
        ).rejects.toThrow(InvalidPropertyError);
      });

      it('should reject deeply nested objects', async () => {
        await expect(
          graph.addNode('Course', {
            title: 'Math',
            metadata: { info: { author: 'Dr. Smith' } },
          })
        ).rejects.toThrow(InvalidPropertyError);
      });
    });

    describe('Edge property validation', () => {
      it('should accept primitive property values', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {
          since: 2020,
          weight: 0.95,
          active: true,
        });
        expect(edge.properties.since).toBe(2020);
        expect(edge.properties.weight).toBe(0.95);
        expect(edge.properties.active).toBe(true);
      });

      it('should reject nested object property values', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        await expect(
          graph.addEdge(alice.id, bob.id, 'KNOWS', {
            metadata: { level: 'high' },
          })
        ).rejects.toThrow(InvalidPropertyError);
      });

      it('should reject array property values', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        await expect(
          graph.addEdge(alice.id, bob.id, 'KNOWS', {
            skills: ['javascript', 'typescript'],
          })
        ).rejects.toThrow(InvalidPropertyError);
      });
    });
  });

  describe('Graph.createIndex', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    describe('createIndex on nodes', () => {
      it('should create simple index on node property', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math' });

        // Should not throw
        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();

        // Should be able to query by the indexed property
        const results = await graph.getNodes({ filter: { properties: [{ key: 'email', value: 'alice@example.com' }] } });
        expect(results).toHaveLength(1);
        expect(results[0].properties.name).toBe('Alice');
      });

      it('should create compound index on node property with type', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math' });

        // Create compound index for Person nodes only
        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();

        const results = await graph.getNodes({ filter: { types: ['Person'], properties: [{ key: 'email', value: 'alice@example.com' }] } });
        expect(results).toHaveLength(1);
        expect(results[0].labels).toEqual(['Person']);
      });

      it('should create simple index with type=*', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        // type='*' should create simple index across all types
        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();

        const results = await graph.getNodes({ filter: { properties: [{ key: 'email', value: 'math@example.com' }] } });
        expect(results).toHaveLength(1);
        expect(results[0].labels).toEqual(['Course']);
      });
    });

    describe('createIndex on edges', () => {
      it('should create simple index on edge property', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        await expect(graph.createIndex('weight-index', 'edge', ['weight'])).resolves.toBeUndefined();

        const results = await graph.getEdges({ filter: { properties: [{ key: 'weight', value: 0.8 }] } });
        expect(results).toHaveLength(1);
        expect(results[0].sourceId).toBe(alice.id);
      });
    });
  });

  describe('Graph.setNodeProperties', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should add and merge properties on a node', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });
      await graph.setNodeProperties(node.id, { age: 30, city: 'NYC' });

      const updated = await graph.getNode(node.id);
      expect(updated?.properties.name).toBe('Alice');
      expect(updated?.properties.age).toBe(30);
      expect(updated?.properties.city).toBe('NYC');
    });

    it('should update existing property while preserving others when merge is true', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
      await graph.setNodeProperties(node.id, { age: 31 });

      const updated = await graph.getNode(node.id);
      expect(updated?.properties.name).toBe('Alice');
      expect(updated?.properties.age).toBe(31);
    });

    it('should replace all properties when merge is false', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30, city: 'NYC' });
      await graph.setNodeProperties(node.id, { role: 'admin' }, { merge: false });

      const updated = await graph.getNode(node.id);
      expect(updated?.properties).toEqual({ role: 'admin' });
    });

    it('should clear all properties when replacing with empty object', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30, city: 'NYC' });
      await graph.setNodeProperties(node.id, {}, { merge: false });

      const updated = await graph.getNode(node.id);
      expect(Object.keys(updated?.properties || {}).length).toBe(0);
    });

    it('should reject non-primitive value', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });
      await expect(graph.setNodeProperties(node.id, { address: { city: 'NYC' } })).rejects.toThrow();
    });

    it('should throw NodeNotFoundError for non-existent node', async () => {
      await expect(graph.setNodeProperties('non-existent', { prop: 'value' })).rejects.toThrow();
    });
  });

  describe('Graph.unsetNodeProperties', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should delete properties from a node', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
      await graph.unsetNodeProperties(node.id, ['age']);

      const updated = await graph.getNode(node.id);
      expect(updated?.properties.name).toBe('Alice');
      expect(updated?.properties.age).toBeUndefined();
    });

    it('should throw NodeNotFoundError for non-existent node', async () => {
      await expect(graph.unsetNodeProperties('non-existent', ['prop'])).rejects.toThrow();
    });
  });

  describe('Graph.setEdgeProperties', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should add and merge properties on an edge', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {});

      await graph.setEdgeProperties(edge.id, { since: 2020 });

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties.since).toBe(2020);
    });

    it('should update existing edge property when merging', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

      await graph.setEdgeProperties(edge.id, { since: 2021 });

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties.since).toBe(2021);
    });

    it('should replace all properties when merge is false', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020, weight: 0.5 });

      await graph.setEdgeProperties(edge.id, {}, { merge: false });

      const updated = await graph.getEdge(edge.id);
      expect(Object.keys(updated?.properties || {}).length).toBe(0);
    });

    it('should reject non-primitive value', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {});

      await expect(graph.setEdgeProperties(edge.id, { metadata: { key: 'value' } })).rejects.toThrow();
    });

    it('should throw EdgeNotFoundError for non-existent edge', async () => {
      await expect(graph.setEdgeProperties('non-existent', { prop: 'value' })).rejects.toThrow();
    });
  });

  describe('Graph.unsetEdgeProperties', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should delete properties from an edge', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

      await graph.unsetEdgeProperties(edge.id, ['since']);

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties.since).toBeUndefined();
    });

    it('should throw EdgeNotFoundError for non-existent edge', async () => {
      await expect(graph.unsetEdgeProperties('non-existent', ['prop'])).rejects.toThrow();
    });
  });

  describe('Graph.addNodeLabels', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should add single and multiple labels idempotently without duplicating existing labels', async () => {
      const node = await graph.addNode(['Memory', 'STM'], { topic: 'graph' });
      await graph.addNodeLabels(node.id, ['LTM']);
      expect((await graph.getNode(node.id))?.labels).toEqual(['Memory', 'STM', 'LTM']);

      // Re-adding existing labels + duplicate in argument is a clean set-union
      await graph.addNodeLabels(node.id, ['LTM', 'Pinned', 'Pinned']);
      expect((await graph.getNode(node.id))?.labels).toEqual(['Memory', 'STM', 'LTM', 'Pinned']);
    });

    it('should update label-scoped secondary property indexes when adding a label', async () => {
      await graph.createIndex('idx_ltm_topic', 'node', ['topic'], { labelOrType: 'LTM' });
      const node = await graph.addNode(['STM'], { topic: 'synapse' });
      expect(await graph.getNodes({ filter: { types: ['LTM'], properties: [{ key: 'topic', value: 'synapse' }] } })).toHaveLength(0);

      await graph.addNodeLabels(node.id, ['LTM']);
      const matched = await graph.getNodes({ filter: { types: ['LTM'], properties: [{ key: 'topic', value: 'synapse' }] } });
      expect(matched.map((n) => n.id)).toEqual([node.id]);
    });

    it('should throw NodeNotFoundError for non-existent node', async () => {
      await expect(graph.addNodeLabels('non-existent', ['LTM'])).rejects.toThrow();
    });
  });
}