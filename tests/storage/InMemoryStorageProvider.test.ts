import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { InMemoryStorageProvider } from '../../src/storage/InMemoryStorageProvider';
import type { IOrderBy } from '../../src/storage/IStorageProvider';
import { NodeNotFoundError, EdgeNotFoundError } from '../../src/errors';

describe('InMemoryStorageProvider', () => {
  let provider: InMemoryStorageProvider;

  beforeEach(async () => {
    provider = new InMemoryStorageProvider();
  });

  afterEach(async () => {
    await provider.clear();
  });

  describe('getNodes with orderBy on custom property', () => {
    it('should order nodes by a custom property (ascending)', async () => {
      // Insert in reverse order to verify sorting works
      await provider.insertNode({ id: 'node-3', type: 'Item', properties: { priority: 30 } });
      await provider.insertNode({ id: 'node-1', type: 'Item', properties: { priority: 10 } });
      await provider.insertNode({ id: 'node-2', type: 'Item', properties: { priority: 20 } });

      const nodes = await provider.getNodes({ orderBy: { field: 'priority', direction: 'asc' } });

      expect(nodes).toHaveLength(3);
      expect(nodes[0].properties.priority).toBe(10);
      expect(nodes[1].properties.priority).toBe(20);
      expect(nodes[2].properties.priority).toBe(30);
    });

    it('should order nodes by a custom property (descending)', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Item', properties: { priority: 10 } });
      await provider.insertNode({ id: 'node-2', type: 'Item', properties: { priority: 20 } });
      await provider.insertNode({ id: 'node-3', type: 'Item', properties: { priority: 30 } });

      const nodes = await provider.getNodes({ orderBy: { field: 'priority', direction: 'desc' } });

      expect(nodes).toHaveLength(3);
      expect(nodes[0].properties.priority).toBe(30);
      expect(nodes[1].properties.priority).toBe(20);
      expect(nodes[2].properties.priority).toBe(10);
    });

    it('should order nodes by createdOn (direct field)', async () => {
      // Insert in reverse order
      await provider.insertNode({ id: 'node-3', type: 'Item', properties: { name: 'third' } });
      await provider.insertNode({ id: 'node-1', type: 'Item', properties: { name: 'first' } });
      await provider.insertNode({ id: 'node-2', type: 'Item', properties: { name: 'second' } });

      const nodes = await provider.getNodes({ orderBy: { field: 'createdOn', direction: 'asc' } });

      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe('node-3'); // inserted first
      expect(nodes[1].id).toBe('node-1'); // inserted second
      expect(nodes[2].id).toBe('node-2'); // inserted third
    });
  });

  describe('getEdges with orderBy on custom property', () => {
    it('should order edges by a custom property (ascending)', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });

      // Insert in reverse order
      await provider.insertEdge({ id: 'edge-3', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { cost: 30 } });
      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { cost: 10 } });
      await provider.insertEdge({ id: 'edge-2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { cost: 20 } });

      const edges = await provider.getEdges({ orderBy: { field: 'cost', direction: 'asc' } });

      expect(edges).toHaveLength(3);
      expect(edges[0].properties.cost).toBe(10);
      expect(edges[1].properties.cost).toBe(20);
      expect(edges[2].properties.cost).toBe(30);
    });

    it('should order edges by a custom property (descending)', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });

      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { cost: 10 } });
      await provider.insertEdge({ id: 'edge-2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { cost: 20 } });
      await provider.insertEdge({ id: 'edge-3', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { cost: 30 } });

      const edges = await provider.getEdges({ orderBy: { field: 'cost', direction: 'desc' } });

      expect(edges).toHaveLength(3);
      expect(edges[0].properties.cost).toBe(30);
      expect(edges[1].properties.cost).toBe(20);
      expect(edges[2].properties.cost).toBe(10);
    });
  });

  describe('updateProperty with transaction overlay', () => {
    it('should enter the overlayRecord branch when updating within transaction', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Original' } });

      const txn = await provider.beginTransaction();

      // First, add a NEW property - this puts the node into the overlay
      await provider.addProperty('node', 'node-1', 'city', 'NYC', txn);

      // Now update the existing 'name' property - overlayRecord should exist for node-1
      await provider.updateProperty('node', 'node-1', 'name', 'Updated', txn);

      // Verify the update happened within the transaction
      const nodeInTxn = await provider.getNode('node-1', txn);
      expect(nodeInTxn?.properties.name).toBe('Updated');

      await provider.commitTransaction(txn);

      // Verify committed value
      const committedNode = await provider.getNode('node-1');
      expect(committedNode?.properties.name).toBe('Updated');
    });

    it('should rollback updateProperty changes on rollback', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Original' } });

      const txn = await provider.beginTransaction();

      // First add a NEW property to populate overlay, then update existing property
      await provider.addProperty('node', 'node-1', 'city', 'NYC', txn);
      await provider.updateProperty('node', 'node-1', 'name', 'Modified', txn);

      await provider.rollbackTransaction(txn);

      // Verify original value is restored
      const node = await provider.getNode('node-1');
      expect(node?.properties.name).toBe('Original');
    });
  });

  describe('deleteProperty with transaction overlay', () => {
    it('should enter the overlayRecord branch when deleting within transaction', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Alice', age: '30' } });

      const txn = await provider.beginTransaction();

      // First add a property to get the node into the overlay
      await provider.addProperty('node', 'node-1', 'city', 'NYC', txn);

      // Now delete a property - overlayRecord should exist
      await provider.deleteProperty('node', 'node-1', 'name', txn);

      // Verify property is deleted within transaction
      const nodeInTxn = await provider.getNode('node-1', txn);
      expect(nodeInTxn?.properties.name).toBeUndefined();
      expect(nodeInTxn?.properties.age).toBe('30');

      await provider.commitTransaction(txn);

      // Verify committed deletion
      const committedNode = await provider.getNode('node-1');
      expect(committedNode?.properties.name).toBeUndefined();
      expect(committedNode?.properties.age).toBe('30');
    });
  });

  describe('clearProperties with transaction overlay', () => {
    it('should enter the overlayRecord branch when clearing within transaction', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Alice', age: '30' } });

      const txn = await provider.beginTransaction();

      // First add a property to get the node into the overlay
      await provider.addProperty('node', 'node-1', 'city', 'NYC', txn);

      // Now clear properties - overlayRecord should exist
      await provider.clearProperties('node', 'node-1', txn);

      // Verify properties are cleared within transaction
      const nodeInTxn = await provider.getNode('node-1', txn);
      expect(nodeInTxn?.properties.name).toBeUndefined();
      expect(nodeInTxn?.properties.age).toBeUndefined();

      await provider.commitTransaction(txn);

      // Verify committed clear
      const committedNode = await provider.getNode('node-1');
      expect(committedNode?.properties.name).toBeUndefined();
      expect(committedNode?.properties.age).toBeUndefined();
    });
  });

  describe('tombstone handling (overlayRecord === null)', () => {
    // When a node/edge is deleted within a transaction, a tombstone (null) is stored in the overlay
    // Trying to modify properties on a tombstoned entity should throw NodeNotFoundError/EdgeNotFoundError

    it('should throw NodeNotFoundError when addProperty targets a tombstoned node', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Alice' } });

      const txn = await provider.beginTransaction();

      // Delete the node within transaction - this creates a tombstone (null) in overlay
      await provider.deleteNode('node-1', txn);

      // Now try to add a property to the deleted node - should throw
      await expect(
        provider.addProperty('node', 'node-1', 'city', 'NYC', txn)
      ).rejects.toThrow(NodeNotFoundError);

      await provider.rollbackTransaction(txn);
    });

    it('should throw NodeNotFoundError when updateProperty targets a tombstoned node', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Alice' } });

      const txn = await provider.beginTransaction();

      // Delete the node within transaction - this creates a tombstone
      await provider.deleteNode('node-1', txn);

      // Now try to update a property on the deleted node - should throw
      await expect(
        provider.updateProperty('node', 'node-1', 'name', 'Bob', txn)
      ).rejects.toThrow(NodeNotFoundError);

      await provider.rollbackTransaction(txn);
    });

    it('should throw NodeNotFoundError when deleteProperty targets a tombstoned node', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Alice' } });

      const txn = await provider.beginTransaction();

      // Delete the node within transaction - this creates a tombstone
      await provider.deleteNode('node-1', txn);

      // Now try to delete a property on the deleted node - should throw
      await expect(
        provider.deleteProperty('node', 'node-1', 'name', txn)
      ).rejects.toThrow(NodeNotFoundError);

      await provider.rollbackTransaction(txn);
    });

    it('should throw NodeNotFoundError when clearProperties targets a tombstoned node', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'Alice', age: '30' } });

      const txn = await provider.beginTransaction();

      // Delete the node within transaction - this creates a tombstone
      await provider.deleteNode('node-1', txn);

      // Now try to clear properties on the deleted node - should throw
      await expect(
        provider.clearProperties('node', 'node-1', txn)
      ).rejects.toThrow(NodeNotFoundError);

      await provider.rollbackTransaction(txn);
    });

    it('should throw EdgeNotFoundError when addProperty targets a tombstoned edge', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 1 } });

      const txn = await provider.beginTransaction();

      // Delete the edge within transaction - this creates a tombstone
      await provider.deleteEdge('edge-1', txn);

      // Now try to add a property to the deleted edge - should throw
      await expect(
        provider.addProperty('edge', 'edge-1', 'cost', 100, txn)
      ).rejects.toThrow(EdgeNotFoundError);

      await provider.rollbackTransaction(txn);
    });

    it('should throw EdgeNotFoundError when updateProperty targets a tombstoned edge', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 1 } });

      const txn = await provider.beginTransaction();

      // Delete the edge within transaction - this creates a tombstone
      await provider.deleteEdge('edge-1', txn);

      // Now try to update a property on the deleted edge - should throw
      await expect(
        provider.updateProperty('edge', 'edge-1', 'weight', 99, txn)
      ).rejects.toThrow(EdgeNotFoundError);

      await provider.rollbackTransaction(txn);
    });

    it('should throw EdgeNotFoundError when deleteProperty targets a tombstoned edge', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 1 } });

      const txn = await provider.beginTransaction();

      // Delete the edge within transaction - this creates a tombstone
      await provider.deleteEdge('edge-1', txn);

      // Now try to delete a property on the deleted edge - should throw
      await expect(
        provider.deleteProperty('edge', 'edge-1', 'weight', txn)
      ).rejects.toThrow(EdgeNotFoundError);

      await provider.rollbackTransaction(txn);
    });

    it('should throw EdgeNotFoundError when clearProperties targets a tombstoned edge', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 1 } });

      const txn = await provider.beginTransaction();

      // Delete the edge within transaction - this creates a tombstone
      await provider.deleteEdge('edge-1', txn);

      // Now try to clear properties on the deleted edge - should throw
      await expect(
        provider.clearProperties('edge', 'edge-1', txn)
      ).rejects.toThrow(EdgeNotFoundError);

      await provider.rollbackTransaction(txn);
    });
  });

  describe('getNodeCount', () => {
    it('should return 0 for empty graph', async () => {
      const count = await provider.getNodeCount();
      expect(count).toBe(0);
    });

    it('should return correct count after inserting nodes', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n3', type: 'Test', properties: {} });

      const count = await provider.getNodeCount();
      expect(count).toBe(3);
    });

    it('should return count with type filter', async () => {
      await provider.insertNode({ id: 'n1', type: 'User', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Admin', properties: {} });
      await provider.insertNode({ id: 'n3', type: 'User', properties: {} });

      const count = await provider.getNodeCount({ filter: { types: ['User'] } });
      expect(count).toBe(2);
    });

    it('should return count with property filter', async () => {
      await provider.insertNode({ id: 'n1', type: 'Item', properties: { active: true } });
      await provider.insertNode({ id: 'n2', type: 'Item', properties: { active: false } });
      await provider.insertNode({ id: 'n3', type: 'Item', properties: { active: true } });

      const count = await provider.getNodeCount({
        filter: { properties: [{ key: 'active', value: true }] }
      });
      expect(count).toBe(2);
    });
  });

  describe('getEdgeCount', () => {
    it('should return 0 for empty graph', async () => {
      const count = await provider.getEdgeCount();
      expect(count).toBe(0);
    });

    it('should return correct count after inserting edges', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n3', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'e1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'e2', type: 'Link', sourceId: 'n2', targetId: 'n3', properties: {} });

      const count = await provider.getEdgeCount();
      expect(count).toBe(2);
    });

    it('should return count with type filter', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n3', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'e1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'e2', type: 'LIKES', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'e3', type: 'KNOWS', sourceId: 'n2', targetId: 'n3', properties: {} });

      const count = await provider.getEdgeCount({ filter: { types: ['KNOWS'] } });
      expect(count).toBe(2);
    });

    it('should return count with property filter', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n3', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'e1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 5 } });
      await provider.insertEdge({ id: 'e2', type: 'Link', sourceId: 'n2', targetId: 'n3', properties: { weight: 10 } });
      await provider.insertEdge({ id: 'e3', type: 'Link', sourceId: 'n1', targetId: 'n3', properties: { weight: 5 } });

      const count = await provider.getEdgeCount({
        filter: { properties: [{ key: 'weight', value: 5 }] }
      });
      expect(count).toBe(2);
    });
  });

  describe('aggregateNodeProperty', () => {
    it('should return zero count for empty graph', async () => {
      const result = await provider.aggregateNodeProperty('score');
      expect(result.count).toBe(0);
      expect(result.sum).toBeUndefined();
      expect(result.avg).toBeUndefined();
      expect(result.min).toBeUndefined();
      expect(result.max).toBeUndefined();
    });

    it('should aggregate numeric property values', async () => {
      await provider.insertNode({ id: 'n1', type: 'Item', properties: { price: 10 } });
      await provider.insertNode({ id: 'n2', type: 'Item', properties: { price: 20 } });
      await provider.insertNode({ id: 'n3', type: 'Item', properties: { price: 30 } });

      const result = await provider.aggregateNodeProperty('price');

      expect(result.count).toBe(3);
      expect(result.sum).toBe(60);
      expect(result.avg).toBe(20);
      expect(result.min).toBe(10);
      expect(result.max).toBe(30);
    });

    it('should ignore non-numeric property values', async () => {
      await provider.insertNode({ id: 'n1', type: 'Item', properties: { price: 10 } });
      await provider.insertNode({ id: 'n2', type: 'Item', properties: { price: 'twenty' } }); // string
      await provider.insertNode({ id: 'n3', type: 'Item', properties: { price: null } }); // null
      await provider.insertNode({ id: 'n4', type: 'Item', properties: { price: 30 } });

      const result = await provider.aggregateNodeProperty('price');

      expect(result.count).toBe(2);
      expect(result.sum).toBe(40);
      expect(result.min).toBe(10);
      expect(result.max).toBe(30);
    });

    it('should aggregate with type filter', async () => {
      await provider.insertNode({ id: 'n1', type: 'Book', properties: { pages: 100 } });
      await provider.insertNode({ id: 'n2', type: 'Magazine', properties: { pages: 50 } });
      await provider.insertNode({ id: 'n3', type: 'Book', properties: { pages: 200 } });

      const result = await provider.aggregateNodeProperty('pages', { filter: { types: ['Book'] } });

      expect(result.count).toBe(2);
      expect(result.sum).toBe(300);
      expect(result.min).toBe(100);
      expect(result.max).toBe(200);
    });

    it('should aggregate with property filter', async () => {
      await provider.insertNode({ id: 'n1', type: 'Product', properties: { price: 100, active: true } });
      await provider.insertNode({ id: 'n2', type: 'Product', properties: { price: 200, active: false } });
      await provider.insertNode({ id: 'n3', type: 'Product', properties: { price: 300, active: true } });

      const result = await provider.aggregateNodeProperty('price', {
        filter: { properties: [{ key: 'active', value: true }] }
      });

      expect(result.count).toBe(2);
      expect(result.sum).toBe(400);
    });
  });

  describe('aggregateEdgeProperty', () => {
    it('should return zero count for empty graph', async () => {
      const result = await provider.aggregateEdgeProperty('weight');
      expect(result.count).toBe(0);
      expect(result.sum).toBeUndefined();
    });

    it('should aggregate numeric property values', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'e1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 5 } });
      await provider.insertEdge({ id: 'e2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 15 } });

      const result = await provider.aggregateEdgeProperty('weight');

      expect(result.count).toBe(2);
      expect(result.sum).toBe(20);
      expect(result.avg).toBe(10);
      expect(result.min).toBe(5);
      expect(result.max).toBe(15);
    });

    it('should ignore non-numeric property values', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'e1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 10 } });
      await provider.insertEdge({ id: 'e2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 'ten' } });

      const result = await provider.aggregateEdgeProperty('weight');

      expect(result.count).toBe(1);
      expect(result.sum).toBe(10);
    });

    it('should aggregate with type filter', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'e1', type: 'FRIEND', sourceId: 'n1', targetId: 'n2', properties: { strength: 80 } });
      await provider.insertEdge({ id: 'e2', type: 'COLLEAGUE', sourceId: 'n1', targetId: 'n2', properties: { strength: 50 } });

      const result = await provider.aggregateEdgeProperty('strength', { filter: { types: ['FRIEND'] } });

      expect(result.count).toBe(1);
      expect(result.sum).toBe(80);
    });
  });

  describe('_applyOrderAndLimit sorting branches', () => {
    describe('getNodes with orderBy on custom property with undefined values', () => {
      it('should handle when both values are undefined', async () => {
        await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
        await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
        await provider.insertNode({ id: 'n3', type: 'Test', properties: { weight: 50 } });

        const nodes = await provider.getNodes({ orderBy: { field: 'weight', direction: 'asc' } });

        expect(nodes).toHaveLength(3);
        // weight:50 comes first, both undefined stay in original order
        expect(nodes[0].id).toBe('n3'); // 50
        expect(nodes[1].id).toBe('n1'); // undefined
        expect(nodes[2].id).toBe('n2'); // undefined
      });

      it('should handle when aVal is undefined but bVal is not', async () => {
        await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
        await provider.insertNode({ id: 'n2', type: 'Test', properties: { weight: 100 } });
        await provider.insertNode({ id: 'n3', type: 'Test', properties: { weight: 50 } });

        const nodes = await provider.getNodes({ orderBy: { field: 'weight', direction: 'asc' } });

        expect(nodes).toHaveLength(3);
        // undefined (n1) should sort to the end in asc
        expect(nodes[0].id).toBe('n3'); // 50
        expect(nodes[1].id).toBe('n2'); // 100
        expect(nodes[2].id).toBe('n1'); // undefined
      });

      it('should handle when bVal is undefined but aVal is not', async () => {
        await provider.insertNode({ id: 'n1', type: 'Test', properties: { weight: 50 } });
        await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
        await provider.insertNode({ id: 'n3', type: 'Test', properties: { weight: 100 } });

        const nodes = await provider.getNodes({ orderBy: { field: 'weight', direction: 'asc' } });

        expect(nodes).toHaveLength(3);
        // n2 (undefined) should sort to the end in asc
        expect(nodes[0].id).toBe('n1'); // 50
        expect(nodes[1].id).toBe('n3'); // 100
        expect(nodes[2].id).toBe('n2'); // undefined
      });
    });

    describe('getEdges with orderBy on custom property with undefined values', () => {
      it('should handle when both values are undefined', async () => {
        await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
        await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
        await provider.insertEdge({ id: 'e1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: {} });
        await provider.insertEdge({ id: 'e2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: {} });
        await provider.insertEdge({ id: 'e3', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 50 } });

        const edges = await provider.getEdges({ orderBy: { field: 'weight', direction: 'asc' } });

        expect(edges).toHaveLength(3);
        // weight:50 comes first, both undefined stay in original order
        expect(edges[0].id).toBe('e3'); // 50
        expect(edges[1].id).toBe('e1'); // undefined
        expect(edges[2].id).toBe('e2'); // undefined
      });

      it('should handle when aVal is undefined but bVal is not', async () => {
        await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
        await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
        await provider.insertEdge({ id: 'e1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: {} });
        await provider.insertEdge({ id: 'e2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 100 } });
        await provider.insertEdge({ id: 'e3', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 50 } });

        const edges = await provider.getEdges({ orderBy: { field: 'weight', direction: 'asc' } });

        expect(edges).toHaveLength(3);
        // undefined (e1) should sort to the end in asc
        expect(edges[0].id).toBe('e3'); // 50
        expect(edges[1].id).toBe('e2'); // 100
        expect(edges[2].id).toBe('e1'); // undefined
      });

      it('should handle when bVal is undefined but aVal is not', async () => {
        await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
        await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });
        await provider.insertEdge({ id: 'e1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 50 } });
        await provider.insertEdge({ id: 'e2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: {} });
        await provider.insertEdge({ id: 'e3', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 100 } });

        const edges = await provider.getEdges({ orderBy: { field: 'weight', direction: 'asc' } });

        expect(edges).toHaveLength(3);
        // e2 (undefined) should sort to the end in asc
        expect(edges[0].id).toBe('e1'); // 50
        expect(edges[1].id).toBe('e3'); // 100
        expect(edges[2].id).toBe('e2'); // undefined
      });
    });
  });
});
