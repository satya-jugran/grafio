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
        await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();
      });

      it('should create compound index on node property with type', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math' });

        // Create compound index for Person nodes only
        await expect(graph.createIndex('node', 'email', 'Person')).resolves.toBeUndefined();
      });

      it('should create simple index with type=*', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        // type='*' should create simple index across all types
        await expect(graph.createIndex('node', 'email', '*')).resolves.toBeUndefined();
      });

      it('should be idempotent - calling twice should not error', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();
        await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();
      });

      it('should allow multiple indexes on same target', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com', age: 30 });

        await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();
        await expect(graph.createIndex('node', 'age')).resolves.toBeUndefined();
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
      });

      it('should create compound index on edge property with type', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'LIKES', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        // Create compound index for LIKES edges only
        await expect(graph.createIndex('edge', 'weight', 'LIKES')).resolves.toBeUndefined();
      });

      it('should be idempotent for edges - calling twice should not error', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });

        await expect(graph.createIndex('edge', 'weight')).resolves.toBeUndefined();
        await expect(graph.createIndex('edge', 'weight')).resolves.toBeUndefined();
      });
    });

    describe('getNodesByProperty with index', () => {
      it('should find nodes by property value after creating index', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math' });

        await graph.createIndex('node', 'email');

        const results = await graph.getNodesByProperty('email', 'alice@example.com');
        expect(results).toHaveLength(1);
        expect(results[0].properties.name).toBe('Alice');
      });

      it('should find nodes by property with type filter', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        await graph.createIndex('node', 'email', 'Person');

        const results = await graph.getNodesByProperty('email', 'alice@example.com', { filter: { nodeType: 'Person' } });
        expect(results).toHaveLength(1);
        expect(results[0].type).toBe('Person');
      });

      it('should return empty array when property value does not match', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

        await graph.createIndex('node', 'email');

        const results = await graph.getNodesByProperty('email', 'notexist@example.com');
        expect(results).toHaveLength(0);
      });

      it('should find multiple nodes with same property value', async () => {
        await graph.addNode('Person', { name: 'Alice', city: 'NYC' });
        await graph.addNode('Person', { name: 'Bob', city: 'NYC' });
        await graph.addNode('Person', { name: 'Carol', city: 'LA' });

        await graph.createIndex('node', 'city');

        const results = await graph.getNodesByProperty('city', 'NYC');
        expect(results).toHaveLength(2);
      });
    });

    describe('getEdgesByProperty with index', () => {
      it('should find edges by property value after creating index', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        await graph.createIndex('edge', 'weight');

        const results = await graph.getEdgesByProperty('weight', 0.8);
        expect(results).toHaveLength(1);
        expect(results[0].sourceId).toBe(alice.id);
      });

      it('should find edges by property with type filter', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });

        await graph.addEdge(alice.id, bob.id, 'LIKES', { weight: 0.8 });
        await graph.addEdge(bob.id, carol.id, 'KNOWS', { weight: 0.9 });

        await graph.createIndex('edge', 'weight', 'LIKES');

        const results = await graph.getEdgesByProperty('weight', 0.8, { filter: { edgeType: 'LIKES' } });
        expect(results).toHaveLength(1);
      });

      it('should return empty array when edge property value does not match', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('edge', 'weight');

        const results = await graph.getEdgesByProperty('weight', 0.5);
        expect(results).toHaveLength(0);
      });

      it('should find multiple edges with same property value', async () => {
        const alice = await graph.addNode('Person', { name: 'Alice' });
        const bob = await graph.addNode('Person', { name: 'Bob' });
        const carol = await graph.addNode('Person', { name: 'Carol' });
        const dave = await graph.addNode('Person', { name: 'Dave' });

        await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
        await graph.addEdge(carol.id, dave.id, 'KNOWS', { weight: 0.8 });

        await graph.createIndex('edge', 'weight');

        const results = await graph.getEdgesByProperty('weight', 0.8);
        expect(results).toHaveLength(2);
      });
    });

    describe('Index edge cases', () => {
      it('should handle index on property that does not exist on any node', async () => {
        await graph.addNode('Person', { name: 'Alice' });
        await graph.addNode('Person', { name: 'Bob' });

        // Creating index on non-existent property should not throw
        await expect(graph.createIndex('node', 'nonexistent')).resolves.toBeUndefined();

        // Querying for that property should return empty
        const results = await graph.getNodesByProperty('nonexistent', 'value');
        expect(results).toHaveLength(0);
      });

      it('should handle index on property that only exists on some nodes', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Person', { name: 'Bob' }); // No email property
        await graph.addNode('Course', { title: 'Math' });

        await graph.createIndex('node', 'email');

        const results = await graph.getNodesByProperty('email', 'alice@example.com');
        expect(results).toHaveLength(1);
      });

      it('should handle compound index with non-matching type filter', async () => {
        await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
        await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

        await graph.createIndex('node', 'email', 'Person');

        // Querying for Course nodes should not return Person nodes
        const results = await graph.getNodesByProperty('email', 'alice@example.com', { filter: { nodeType: 'Course' } });
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