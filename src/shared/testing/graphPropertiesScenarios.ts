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
        await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();

        // Should be able to query by the indexed property
        const results = await graph.getNodesByProperty('email', 'alice@example.com');
        expect(results).toHaveLength(1);
        expect(results[0].properties.name).toBe('Alice');
      });

      it('should create compound index on node property with type', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math' });

        // Create compound index for Person nodes only
        await expect(graph.createIndex('node', 'email', 'Person')).resolves.toBeUndefined();

        const results = await graph.getNodesByProperty('email', 'alice@example.com', { filter: { nodeType: 'Person' } });
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('Person');
      });

      it('should create simple index with type=*', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        // type='*' should create simple index across all types
        await expect(graph.createIndex('node', 'email', '*')).resolves.toBeUndefined();

        const results = await graph.getNodesByProperty('email', 'math@example.com');
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('Course');
      });
    });

    describe('createIndex on edges', () => {
      it('should create simple index on edge property', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        await expect(graph.createIndex('edge', 'weight')).resolves.toBeUndefined();

        const results = await graph.getEdgesByProperty('weight', 0.8);
        expect(results).toHaveLength(1);
        expect(results[0].sourceId).toBe(alice.id);
      });
    });
  });

  describe('Graph.addNodeProperty', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should add a new property to a node', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });
      await graph.addNodeProperty(node.id, 'age', 30);

      const updated = await graph.getNode(node.id);
      expect(updated?.properties.age).toBe(30);
    });

    it('should reject if property already exists', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
      await expect(graph.addNodeProperty(node.id, 'age', 31)).rejects.toThrow();
    });

    it('should reject non-primitive value', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });
      await expect(graph.addNodeProperty(node.id, 'address', { city: 'NYC' })).rejects.toThrow();
    });

    it('should throw NodeNotFoundError for non-existent node', async () => {
      await expect(graph.addNodeProperty('non-existent', 'prop', 'value')).rejects.toThrow();
    });
  });

  describe('Graph.updateNodeProperty', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should update an existing node property', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
      await graph.updateNodeProperty(node.id, 'age', 31);

      const updated = await graph.getNode(node.id);
      expect(updated?.properties.age).toBe(31);
    });

    it('should throw PropertyNotFoundError if property does not exist', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });
      await expect(graph.updateNodeProperty(node.id, 'age', 31)).rejects.toThrow();
    });

    it('should reject non-primitive value', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
      await expect(graph.updateNodeProperty(node.id, 'age', { value: 31 })).rejects.toThrow();
    });

    it('should throw NodeNotFoundError for non-existent node', async () => {
      await expect(graph.updateNodeProperty('non-existent', 'prop', 'value')).rejects.toThrow();
    });
  });

  describe('Graph.deleteNodeProperty', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should delete a property from a node', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
      await graph.deleteNodeProperty(node.id, 'age');

      const updated = await graph.getNode(node.id);
      expect(updated?.properties.age).toBeUndefined();
    });

    it('should throw NodeNotFoundError for non-existent node', async () => {
      await expect(graph.deleteNodeProperty('non-existent', 'prop')).rejects.toThrow();
    });
  });

  describe('Graph.clearNodeProperties', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should clear all properties from a node', async () => {
      const node = await graph.addNode('Person', { name: 'Alice', age: 30, city: 'NYC' });
      await graph.clearNodeProperties(node.id);

      const updated = await graph.getNode(node.id);
      expect(Object.keys(updated?.properties || {}).length).toBe(0);
    });

    it('should throw NodeNotFoundError for non-existent node', async () => {
      await expect(graph.clearNodeProperties('non-existent')).rejects.toThrow();
    });
  });

  describe('Graph.addEdgeProperty', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should add a new property to an edge', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {});

      await graph.addEdgeProperty(edge.id, 'since', 2020);

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties.since).toBe(2020);
    });

    it('should reject if property already exists', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

      await expect(graph.addEdgeProperty(edge.id, 'since', 2021)).rejects.toThrow();
    });

    it('should reject non-primitive value', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {});

      await expect(graph.addEdgeProperty(edge.id, 'metadata', { key: 'value' })).rejects.toThrow();
    });

    it('should throw EdgeNotFoundError for non-existent edge', async () => {
      await expect(graph.addEdgeProperty('non-existent', 'prop', 'value')).rejects.toThrow();
    });
  });

  describe('Graph.updateEdgeProperty', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should update an existing edge property', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

      await graph.updateEdgeProperty(edge.id, 'since', 2021);

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties.since).toBe(2021);
    });

    it('should throw PropertyNotFoundError if property does not exist', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {});

      await expect(graph.updateEdgeProperty(edge.id, 'since', 2021)).rejects.toThrow();
    });

    it('should reject non-primitive value', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

      await expect(graph.updateEdgeProperty(edge.id, 'since', { year: 2021 })).rejects.toThrow();
    });

    it('should throw EdgeNotFoundError for non-existent edge', async () => {
      await expect(graph.updateEdgeProperty('non-existent', 'prop', 'value')).rejects.toThrow();
    });
  });

  describe('Graph.deleteEdgeProperty', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should delete a property from an edge', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });

      await graph.deleteEdgeProperty(edge.id, 'since');

      const updated = await graph.getEdge(edge.id);
      expect(updated?.properties.since).toBeUndefined();
    });

    it('should throw EdgeNotFoundError for non-existent edge', async () => {
      await expect(graph.deleteEdgeProperty('non-existent', 'prop')).rejects.toThrow();
    });
  });

  describe('Graph.clearEdgeProperties', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
    });

    it('should clear all properties from an edge', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020, weight: 0.5 });

      await graph.clearEdgeProperties(edge.id);

      const updated = await graph.getEdge(edge.id);
      expect(Object.keys(updated?.properties || {}).length).toBe(0);
    });

    it('should throw EdgeNotFoundError for non-existent edge', async () => {
      await expect(graph.clearEdgeProperties('non-existent')).rejects.toThrow();
    });
  });
}