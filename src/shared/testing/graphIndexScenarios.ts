import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, IStorageProvider } from '../../index';

/**
 * Shared test scenarios for Graph index operations.
 * Tests createIndex, getNodesByProperty, getEdgesByProperty functionality.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphIndexScenarios(
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

  describe('Graph Index Operations', () => {
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
      });

      it('should create compound index on node property with type', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math' });

        // Create compound index for Person nodes only
        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();
      });

      it('should create simple index with type=*', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        // type='*' should create simple index across all types
        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();
      });

      it('should throw error when creating index with same name twice', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();
        await expect(graph.createIndex('email-index', 'node', ['email'])).rejects.toThrow();
      });

      it('should throw error when creating index with different name but same property keys', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await expect(graph.createIndex('email-index-1', 'node', ['email'])).resolves.toBeUndefined();
        await expect(graph.createIndex('email-index-2', 'node', ['email'])).rejects.toThrow();
      });

      it('should allow multiple indexes on same target with different properties', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com', age: 30 });

        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();
        await expect(graph.createIndex('age-index', 'node', ['age'])).resolves.toBeUndefined();
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
      });

      it('should create compound index on edge property with type', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'LIKES', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        // Create compound index for LIKES edges only
        await expect(graph.createIndex('weight-index', 'edge', ['weight'])).resolves.toBeUndefined();
      });

      it('should throw error when creating edge index with same name twice', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });

        await expect(graph.createIndex('weight-index', 'edge', ['weight'])).resolves.toBeUndefined();
        await expect(graph.createIndex('weight-index', 'edge', ['weight'])).rejects.toThrow();
      });
    });

    describe('getIndex', () => {
      it('should retrieve an index by name after creation', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await graph.createIndex('email-index', 'node', ['email']);

        const index = await graph.getIndex('email-index');
        expect(index).toBeDefined();
        expect(index!.name).toBe('email-index');
        expect(index!.target).toBe('node');
        expect(index!.propertyKeys).toEqual(['email']);
      });

      it('should retrieve edge index by name', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('weight-index', 'edge', ['weight']);

        const index = await graph.getIndex('weight-index');
        expect(index).toBeDefined();
        expect(index!.name).toBe('weight-index');
        expect(index!.target).toBe('edge');
        expect(index!.propertyKeys).toEqual(['weight']);
      });

      it('should return undefined for non-existent index name', async () => {
        const index = await graph.getIndex('non-existent-index');
        expect(index).toBeUndefined();
      });

      it('should retrieve compound index by name', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com', age: 30 });

        await graph.createIndex('name-email-index', 'node', ['name', 'email']);

        const index = await graph.getIndex('name-email-index');
        expect(index).toBeDefined();
        expect(index!.name).toBe('name-email-index');
        expect(index!.target).toBe('node');
        expect(index!.propertyKeys).toEqual(['email', 'name']); // Sorted
      });
    });

    describe('deleteIndex', () => {
      it('should delete an existing index by name', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await graph.createIndex('email-index', 'node', ['email']);
        
        // Verify index exists
        const indexBefore = await graph.getIndex('email-index');
        expect(indexBefore).toBeDefined();

        // Delete the index
        await expect(graph.deleteIndex('email-index')).resolves.toBeUndefined();

        // Verify index no longer exists
        const indexAfter = await graph.getIndex('email-index');
        expect(indexAfter).toBeUndefined();
      });

      it('should throw error when deleting non-existent index', async () => {
        await expect(graph.deleteIndex('non-existent-index')).rejects.toThrow();
      });

      it('should allow recreating index after deletion', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await graph.createIndex('email-index', 'node', ['email']);
        await graph.deleteIndex('email-index');
        
        // Should be able to create a new index with the same name
        await expect(graph.createIndex('email-index', 'node', ['email'])).resolves.toBeUndefined();
        
        const index = await graph.getIndex('email-index');
        expect(index).toBeDefined();
        expect(index!.name).toBe('email-index');
      });

      it('should delete edge index by name', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('weight-index', 'edge', ['weight']);
        
        // Verify index exists
        const indexBefore = await graph.getIndex('weight-index');
        expect(indexBefore).toBeDefined();

        // Delete the index
        await expect(graph.deleteIndex('weight-index')).resolves.toBeUndefined();

        // Verify index no longer exists
        const indexAfter = await graph.getIndex('weight-index');
        expect(indexAfter).toBeUndefined();
      });
    });

    describe('getIndexes', () => {
      it('should return empty array when no indexes exist', async () => {
        const indexes = await graph.getIndexes();
        expect(indexes).toEqual([]);
      });

      it('should return all indexes after creation', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com', age: 30 });
        const alice = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, carol.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('email-index', 'node', ['email']);
        await graph.createIndex('age-index', 'node', ['age']);
        await graph.createIndex('weight-index', 'edge', ['weight']);

        const indexes = await graph.getIndexes();
        expect(indexes).toHaveLength(3);

        // Verify all indexes are present
        const indexNames = indexes.map(i => i.name).sort();
        expect(indexNames).toEqual(['age-index', 'email-index', 'weight-index']);
      });

      it('should return node and edge indexes correctly', async () => {
        await graph.addNode('Person', { name: 'Alice' });
        const alice = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, carol.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('name-index', 'node', ['name']);
        await graph.createIndex('weight-index', 'edge', ['weight']);

        const indexes = await graph.getIndexes();
        
        const nodeIndexes = indexes.filter(i => i.target === 'node');
        const edgeIndexes = indexes.filter(i => i.target === 'edge');

        expect(nodeIndexes).toHaveLength(1);
        expect(nodeIndexes[0].name).toBe('name-index');
        expect(nodeIndexes[0].propertyKeys).toEqual(['name']);

        expect(edgeIndexes).toHaveLength(1);
        expect(edgeIndexes[0].name).toBe('weight-index');
        expect(edgeIndexes[0].propertyKeys).toEqual(['weight']);
      });

      it('should reflect index deletion in getIndexes', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await graph.createIndex('email-index', 'node', ['email']);
        
        let indexes = await graph.getIndexes();
        expect(indexes).toHaveLength(1);

        await graph.deleteIndex('email-index');
        
        indexes = await graph.getIndexes();
        expect(indexes).toHaveLength(0);
      });

      it('should return compound indexes with all property keys', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com', age: 30 });

        await graph.createIndex('name-email-index', 'node', ['name', 'email']);

        const indexes = await graph.getIndexes();
        expect(indexes).toHaveLength(1);
        expect(indexes[0].name).toBe('name-email-index');
        expect(indexes[0].propertyKeys).toEqual(['email', 'name']); // Sorted
      });
    });

    describe('getNodes with filter.properties', () => {
      it('should find nodes by property value after creating index', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math' });

        await graph.createIndex('email-index', 'node', ['email']);

        const results = await graph.getNodes({ filter: { properties: [{ key: 'email', value: 'alice@example.com' }] } });
        expect(results).toHaveLength(1);
        expect(results[0].properties.name).toBe('Alice');
      });

      it('should find nodes by property with type filter', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        await graph.createIndex('email-index', 'node', ['email']);

        const results = await graph.getNodes({ filter: { types: ['Person'], properties: [{ key: 'email', value: 'alice@example.com' }] } });
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('Person');
      });

      it('should return empty array when property value does not match', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await graph.createIndex('email-index', 'node', ['email']);

        const results = await graph.getNodes({ filter: { properties: [{ key: 'email', value: 'notexist@example.com' }] } });
        expect(results).toHaveLength(0);
      });

      it('should find multiple nodes with same property value', async () => {
        await graph.addNode('Person', { name: 'Alice', city: 'NYC' });
        await graph.addNode('Person', { name: 'Bob', city: 'NYC' });
        await graph.addNode('Person', { name: 'Carol', city: 'LA' });

        await graph.createIndex('city-index', 'node', ['city']);

        const results = await graph.getNodes({ filter: { properties: [{ key: 'city', value: 'NYC' }] } });
        expect(results).toHaveLength(2);
      });
    });

    describe('getEdges with filter.properties', () => {
      it('should find edges by property value after creating index', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        await graph.createIndex('weight-index', 'edge', ['weight']);

        const results = await graph.getEdges({ filter: { properties: [{ key: 'weight', value: 0.8 }] } });
        expect(results).toHaveLength(1);
        expect(results[0].sourceId).toBe(alice.id);
      });

      it('should find edges by property with type filter', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'LIKES', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        await graph.createIndex('weight-index', 'edge', ['weight']);

        const results = await graph.getEdges({ filter: { types: ['LIKES'], properties: [{ key: 'weight', value: 0.8 }] } });
        expect(results).toHaveLength(1);
      });

      it('should return empty array when edge property value does not match', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('weight-index', 'edge', ['weight']);

        const results = await graph.getEdges({ filter: { properties: [{ key: 'weight', value: 0.5 }] } });
        expect(results).toHaveLength(0);
      });

      it('should find multiple edges with same property value', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });
        const dave = await graph.addNode('Person', { name: 'Dave' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
        await graph.addEdge(carol.id, dave.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('weight-index', 'edge', ['weight']);

        const results = await graph.getEdges({ filter: { properties: [{ key: 'weight', value: 0.8 }] } });
        expect(results).toHaveLength(2);
      });
    });

    describe('Index edge cases', () => {
      it('should handle index on property that does not exist on any node', async () => {
        await graph.addNode('Person', { name: 'Alice' });
        await graph.addNode('Person', { name: 'Bob' });

        // Creating index on non-existent property should not throw
        await expect(graph.createIndex('nonexistent-index', 'node', ['nonexistent'])).resolves.toBeUndefined();

        // Querying for that property should return empty
        const results = await graph.getNodes({ filter: { properties: [{ key: 'nonexistent', value: 'value' }] } });
        expect(results).toHaveLength(0);
      });

      it('should handle index on property that only exists on some nodes', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob' }); // No email property
        await graph.addNode('Course', { title: 'Math' });

        await graph.createIndex('email-index', 'node', ['email']);

        const results = await graph.getNodes({ filter: { properties: [{ key: 'email', value: 'alice@example.com' }] } });
        expect(results).toHaveLength(1);
      });

      it('should handle compound index with non-matching type filter', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        await graph.createIndex('email-index', 'node', ['email']);

        // Querying for Course nodes should not return Person nodes
        const results = await graph.getNodes({ filter: { types: ['Course'], properties: [{ key: 'email', value: 'alice@example.com' }] } });
        expect(results).toHaveLength(0);
      });
    });

    describe('warmCache', () => {
      it('should warm the cache without error', async () => {
        await graph.addNode('Person', { name: 'Alice' });
        await graph.addNode('Person', { name: 'Bob' });

        // warmCache should not throw - it preloads cache if configured
        await expect(graph.warmCache()).resolves.toBeUndefined();
      });

      it('should handle warmCache on empty graph', async () => {
        // warmCache on empty graph should not throw
        await expect(graph.warmCache()).resolves.toBeUndefined();
      });
    });
  });
}