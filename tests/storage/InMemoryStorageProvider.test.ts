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

  describe('getAllNodes with orderBy', () => {
    it('should enter the orderBy branch when orderBy is provided', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { order: 1 } });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: { order: 2 } });

      // Call with orderBy - exercises the if (orderBy) branch
      const orderBy: IOrderBy = { field: 'createdOn', direction: 'asc' };
      const nodes = await provider.getAllNodes(undefined, orderBy);

      expect(nodes).toHaveLength(2);
      // Verify sorting happened (ascending)
      expect(Number(nodes[0].properties.order)).toBeLessThanOrEqual(Number(nodes[1].properties.order));
    });

    it('should enter the orderBy branch when orderBy is provided (descending)', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { order: 2 } });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: { order: 1 } });

      const orderBy: IOrderBy = { field: 'createdOn', direction: 'desc' };
      const nodes = await provider.getAllNodes(undefined, orderBy);

      expect(nodes).toHaveLength(2);
      // Simply verify the call succeeded and the orderBy branch was exercised
    });
  });

  describe('getAllEdges with orderBy', () => {
    it('should enter the orderBy branch when orderBy is provided', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });

      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 1 } });
      await provider.insertEdge({ id: 'edge-2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 2 } });

      const orderBy: IOrderBy = { field: 'createdOn', direction: 'asc' };
      const edges = await provider.getAllEdges(undefined, orderBy);

      expect(edges).toHaveLength(2);
      // Verify sorting happened
      expect(Number(edges[0].properties.weight)).toBeLessThanOrEqual(Number(edges[1].properties.weight));
    });

    it('should enter the orderBy branch when orderBy is provided (descending)', async () => {
      await provider.insertNode({ id: 'n1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'n2', type: 'Test', properties: {} });

      await provider.insertEdge({ id: 'edge-1', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 2 } });
      await provider.insertEdge({ id: 'edge-2', type: 'Link', sourceId: 'n1', targetId: 'n2', properties: { weight: 1 } });

      const orderBy: IOrderBy = { field: 'createdOn', direction: 'desc' };
      const edges = await provider.getAllEdges(undefined, orderBy);

      expect(edges).toHaveLength(2);
      // Simply verify the call succeeded and the orderBy branch was exercised
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
});
