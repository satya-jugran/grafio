import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import type { NodeData, EdgeData } from '../../src/types';
import { CachedStorageProvider } from '../../src/storage/CachedStorageProvider';
import { CacheManager } from '../../src/storage/cache/CacheManager';
import { CacheConfig } from '../../src/storage/cache/CacheConfig';
import { IStorageProvider, ITransactionHandle } from '../../src/storage/IStorageProvider';
import { InMemoryStorageProvider } from '../../src';
import { Graph } from '../../src/Graph';

describe('CachedStorageProvider', () => {
  const defaultConfig: CacheConfig = {
    maxNodesCount: 100,
    maxEdgesCount: 200,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  };

  let mockProvider: InMemoryStorageProvider;
  let cacheManager: CacheManager;
  let provider: CachedStorageProvider;

  beforeEach(() => {
    mockProvider = new InMemoryStorageProvider();
    cacheManager = new CacheManager(defaultConfig);
    provider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, defaultConfig);
  });

  afterEach(async () => {
    await cacheManager.invalidateAll();
  });

  describe('transaction bypass — insertNode/insertEdge', () => {
    it('should NOT populate cache when inserting inside a transaction', async () => {
      const txn = await provider.beginTransaction();
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} }, txn);

      // Cache should NOT have the node
      const cached = await cacheManager.getNode('graph-test', 'node-1');
      expect(cached).toBeUndefined();

      // But underlying storage should have it
      expect(await mockProvider.hasNode('node-1', txn)).toBe(true);
    });

    it('should populate cache after commit when insert was in transaction', async () => {
      const txn = await provider.beginTransaction();
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} }, txn);
      await provider.commitTransaction(txn);

      // After commit, cache should be populated on next read (not during commit)
      const node = await provider.getNode('node-1');
      expect(node).not.toBeUndefined();
    });

    it('should NOT populate cache when inserting edge inside a transaction', async () => {
      const txn = await provider.beginTransaction();
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} }, txn);

      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });
  });

  describe('transaction bypass — hasNode/getNode', () => {
    it('should bypass cache on hasNode when inside transaction', async () => {
      // Insert node without transaction first
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      // Cache it
      await cacheManager.setNode('graph-test', 'node-1', { id: 'node-1', labels: ['Test'], properties: {} });

      // Now query inside transaction — should hit underlying (which knows about the node)
      const txn = await provider.beginTransaction();
      const cacheHitCountBefore = (await cacheManager.getStats()).hitCount;
      const result = await provider.hasNode('node-1', txn);
      const cacheHitCountAfter = (await cacheManager.getStats()).hitCount;

      expect(result).toBe(true);
      // Cache hit should not have increased
      expect(cacheHitCountAfter).toBe(cacheHitCountBefore);
    });

    it('should bypass cache on getNode when inside transaction', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });

      const txn = await provider.beginTransaction();
      const cacheHitCountBefore = (await cacheManager.getStats()).hitCount;
      await provider.getNode('node-1', txn);
      const cacheHitCountAfter = (await cacheManager.getStats()).hitCount;

      // Cache hit should not have increased
      expect(cacheHitCountAfter).toBe(cacheHitCountBefore);
    });
  });

  describe('write-through cache population (no transaction)', () => {
    it('should populate cache after insertNode without transaction', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });

      const cached = await cacheManager.getNode('graph-test', 'node-1');
      expect(cached).not.toBeUndefined();
      expect(cached!.id).toBe('node-1');
    });

    it('should populate cache after insertEdge without transaction', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();
    });

    it('should NOT populate cache when node budget exceeded', async () => {
      // Use a tiny budget
      const tinyConfig: CacheConfig = { ...defaultConfig, maxNodesCount: 1 };
      const tinyCacheManager = new CacheManager(tinyConfig);
      const tinyProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', tinyCacheManager, tinyConfig);

      // Insert first node (should be cached)
      await tinyProvider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      const cached1 = await tinyCacheManager.getNode('graph-test', 'node-1');
      expect(cached1).not.toBeUndefined();

      // Insert second node - budget exceeded, should NOT be cached
      await tinyProvider.insertNode({ id: 'node-2', labels: ['Test'], properties: {} });
      const cached2 = await tinyCacheManager.getNode('graph-test', 'node-2');
      expect(cached2).toBeUndefined(); // Budget exceeded, not cached

      await tinyCacheManager.invalidateAll();
    });

    it('should NOT populate cache when edge budget exceeded', async () => {
      // Use a tiny budget
      const tinyConfig: CacheConfig = { ...defaultConfig, maxEdgesCount: 1 };
      const tinyCacheManager = new CacheManager(tinyConfig);
      const tinyProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', tinyCacheManager, tinyConfig);

      // Insert first edge (should be cached)
      await tinyProvider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      const cached1 = await tinyCacheManager.getEdge('graph-test', 'edge-1');
      expect(cached1).not.toBeUndefined();

      // Insert second edge - budget exceeded, should NOT be cached
      await tinyProvider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} });
      const cached2 = await tinyCacheManager.getEdge('graph-test', 'edge-2');
      expect(cached2).toBeUndefined(); // Budget exceeded, not cached

      await tinyCacheManager.invalidateAll();
    });
  });

  describe('cache hit branches — getNode', () => {
    it('should return cached node without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setNode('graph-test', 'node-cached', { id: 'node-cached', labels: ['Test'], properties: {} });

      const cacheHitCountBefore = (await cacheManager.getStats()).hitCount;
      const node = await provider.getNode('node-cached');
      const cacheHitCountAfter = (await cacheManager.getStats()).hitCount;

      expect(node).not.toBeUndefined();
      expect(node!.id).toBe('node-cached');

      // Cache hit should have occurred, so hitCount should increase by 1 
      expect(cacheHitCountAfter).toBe(cacheHitCountBefore + 1);
    });
  });

  describe('warmCache() strategies', () => {
    it('should do nothing when preloadStrategy is none', async () => {
      const freshCacheManager = new CacheManager(defaultConfig);
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'none' };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', freshCacheManager, config);

      // Add some data to underlying via insert (which write-through caches)
      await p.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });

      // warmCache with 'none' should not add more
      await p.warmCache();

      // Cache has the write-through entry but warmCache did nothing additional
      const cached = await freshCacheManager.getNode('graph-test', 'node-1');
      expect(cached).not.toBeUndefined(); // write-through already populated it

      await freshCacheManager.invalidateAll();
    });

    it('should load all nodes/edges when preloadStrategy is all', async () => {
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, config);

      await p.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      await p.insertNode({ id: 'node-2', labels: ['Test'], properties: {} });
      await p.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      await p.warmCache();

      const node1 = await cacheManager.getNode('graph-test', 'node-1');
      const node2 = await cacheManager.getNode('graph-test', 'node-2');
      const edge1 = await cacheManager.getEdge('graph-test', 'edge-1');

      expect(node1).not.toBeUndefined();
      expect(node2).not.toBeUndefined();
      expect(edge1).not.toBeUndefined();
    });

    it('should load nodes/edges sorted by updatedOn desc when preloadStrategy is recent', async () => {
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'recent', maxNodesCount: 10, maxEdgesCount: 10 };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, config);

      // Insert nodes with different updatedOn timestamps
      await p.insertNode({ id: 'node-old', labels: ['Test'], properties: {}, updatedOn: 100 });
      await p.insertNode({ id: 'node-new', labels: ['Test'], properties: {}, updatedOn: 200 });
      await p.insertNode({ id: 'node-mid', labels: ['Test'], properties: {}, updatedOn: 150 });

      // Insert edges to test adjacency index population
      await p.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'node-old', targetId: 'node-new', properties: {} });
      await p.insertEdge({ id: 'edge-2', type: 'KNOWS', sourceId: 'node-mid', targetId: 'node-old', properties: {} });

      await p.warmCache();

      // Cache should have all nodes
      const nodeOld = await cacheManager.getNode('graph-test', 'node-old');
      const nodeNew = await cacheManager.getNode('graph-test', 'node-new');
      const nodeMid = await cacheManager.getNode('graph-test', 'node-mid');

      expect(nodeOld).not.toBeUndefined();
      expect(nodeNew).not.toBeUndefined();
      expect(nodeMid).not.toBeUndefined();

      // Verify adjacency index is populated for edges
      const edgesFromOld = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'node-old');
      expect(edgesFromOld).toContain('edge-1');

      const edgesToOld = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'node-old');
      expect(edgesToOld).toContain('edge-2');
    });

    it('should load first N nodes/edges when preloadStrategy is first-n', async () => {
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'first-n', maxNodesCount: 2, maxEdgesCount: 2 };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, config);

      // Insert 5 nodes
      for (let i = 1; i <= 5; i++) {
        await p.insertNode({ id: `node-${i}`, labels: ['Test'], properties: {} });
      }

      // Insert edges to test adjacency index population
      await p.insertEdge({ id: 'edge-a', type: 'KNOWS', sourceId: 'node-1', targetId: 'node-2', properties: {} });
      await p.insertEdge({ id: 'edge-b', type: 'KNOWS', sourceId: 'node-2', targetId: 'node-3', properties: {} });
      await p.insertEdge({ id: 'edge-c', type: 'KNOWS', sourceId: 'node-3', targetId: 'node-4', properties: {} });

      await p.warmCache();

      // Should only cache first 2 (maxNodesCount limit)
      const node1 = await cacheManager.getNode('graph-test', 'node-1');
      const node2 = await cacheManager.getNode('graph-test', 'node-2');

      expect(node1).not.toBeUndefined();
      expect(node2).not.toBeUndefined();

      // Verify adjacency index is populated for edges
      const edgesFrom1 = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'node-1');
      expect(edgesFrom1).toContain('edge-a');

      const edgesTo2 = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'node-2');
      expect(edgesTo2).toContain('edge-a');
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate node from cache on deleteNode', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });

      const cached = await cacheManager.getNode('graph-test', 'node-1');
      expect(cached).not.toBeUndefined();

      await provider.deleteNode('node-1');

      const afterDelete = await cacheManager.getNode('graph-test', 'node-1');
      expect(afterDelete).toBeUndefined();
    });

    it('should invalidate edge from cache on deleteEdge', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();

      await provider.deleteEdge('edge-1');

      const afterDelete = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(afterDelete).toBeUndefined();
    });

    it('should invalidate all for graph on clear()', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      await provider.clear();

      const nodeStats = await cacheManager.getStats();
      expect(nodeStats.totalNodes).toBe(0);
    });
  });

  describe('delegation to underlying — hasNode (no transaction)', () => {
    it('should return true when node exists', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });

      const result = await provider.hasNode('node-1');

      expect(result).toBe(true);
    });

    it('should return false when node does not exist', async () => {
      const result = await provider.hasNode('nonexistent');
      expect(result).toBe(false);
    });

    it('should return true from cache without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setNode('graph-test', 'node-cached', { id: 'node-cached', labels: ['Test'], properties: {} });

      const cacheHitCountBefore = (await cacheManager.getStats()).hitCount;
      const result = await provider.hasNode('node-cached');
      const cacheHitCountAfter = (await cacheManager.getStats()).hitCount;

      expect(result).toBe(true);
      // Cache hit should have occurred, so hitCount should increase by 1
      expect(cacheHitCountAfter).toBe(cacheHitCountBefore + 1);
    });

    it('should cache node data after hasNode finds it in underlying on cache miss', async () => {
      // Insert node directly into mock storage (bypassing cache)
      await mockProvider.insertNode({ id: 'node-orphan', labels: ['Test'], properties: {} });

      // hasNode should find it in underlying and cache it
      const result = await provider.hasNode('node-orphan');
      expect(result).toBe(true);

      // Verify cache was populated (subsequent getNode should hit cache)
      const cached = await cacheManager.getNode('graph-test', 'node-orphan');
      expect(cached).not.toBeUndefined();
      expect(cached!.id).toBe('node-orphan');
    });
  });

  describe('delegation to underlying — hasEdge', () => {
    it('should return true when edge exists', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const result = await provider.hasEdge('edge-1');

      expect(result).toBe(true);
    });

    it('should return false when edge does not exist', async () => {
      const result = await provider.hasEdge('nonexistent');
      expect(result).toBe(false);
    });

    it('should return true from cache without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setEdge('graph-test', 'edge-cached', { id: 'edge-cached', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const result = await provider.hasEdge('edge-cached');

      expect(result).toBe(true);
    });

    it('should cache edge data after hasEdge finds it in underlying on cache miss', async () => {
      // Insert edge directly into mock storage (bypassing cache)
      await mockProvider.insertEdge({ id: 'edge-orphan', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      // hasEdge should find it in underlying and cache it
      const result = await provider.hasEdge('edge-orphan');
      expect(result).toBe(true);

      // Verify cache was populated
      const cached = await cacheManager.getEdge('graph-test', 'edge-orphan');
      expect(cached).not.toBeUndefined();
      expect(cached!.id).toBe('edge-orphan');
    });
  });

  describe('delegation to underlying — getEdge', () => {
    it('should return edge when it exists', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const edge = await provider.getEdge('edge-1');

      expect(edge).not.toBeUndefined();
      expect(edge!.id).toBe('edge-1');
    });

    it('should return undefined when edge does not exist', async () => {
      const edge = await provider.getEdge('nonexistent');
      expect(edge).toBeUndefined();
    });

    it('should return edge from cache without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setEdge('graph-test', 'edge-cached', { id: 'edge-cached', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const cacheHitCountBefore = (await cacheManager.getStats()).hitCount;
      const edge = await provider.getEdge('edge-cached');
      const cacheHitCountAfter = (await cacheManager.getStats()).hitCount;

      expect(edge).not.toBeUndefined();
      expect(edge!.id).toBe('edge-cached');
      // Cache hit should have occurred, so hitCount should increase by 1
      expect(cacheHitCountAfter).toBe(cacheHitCountBefore + 1);
    });

    it('should return undefined when getEdge finds no edge in underlying on cache miss', async () => {
      // No edge inserted, cache miss, underlying returns undefined
      const edge = await provider.getEdge('nonexistent-edge');
      expect(edge).toBeUndefined();
    });
  });

  describe('delegation to underlying — getAllNodes', () => {
    it('should return all nodes from underlying', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      await provider.insertNode({ id: 'node-2', labels: ['Test'], properties: {} });

      const nodes = await provider.getNodes();

      expect(nodes).toHaveLength(2);
    });

    it('should return empty array when no nodes', async () => {
      const nodes = await provider.getNodes();
      expect(nodes).toHaveLength(0);
    });
  });

  describe('delegation to underlying — getAllEdges', () => {
    it('should return all edges from underlying', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} });

      const edges = await provider.getEdges();

      expect(edges).toHaveLength(2);
    });

    it('should return empty array when no edges', async () => {
      const edges = await provider.getEdges();
      expect(edges).toHaveLength(0);
    });
  });

  describe('delegation to underlying — getNodesByType', () => {
    it('should return nodes filtered by type', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Person'], properties: {} });
      await provider.insertNode({ id: 'node-2', labels: ['Place'], properties: {} });
      await provider.insertNode({ id: 'node-3', labels: ['Person'], properties: {} });

      const nodes = await provider.getNodes({ filter: { types: ['Person'] } });

      expect(nodes).toHaveLength(2);
    });
  });

  describe('delegation to underlying — getEdgesByType', () => {
    it('should return edges filtered by type', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'LIKES', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'KNOWS', sourceId: 'n3', targetId: 'n4', properties: {} });

      const edges = await provider.getEdges({ filter: { types: ['KNOWS'] } });

      expect(edges).toHaveLength(2);
    });
  });

  describe('delegation to underlying — getEdgesBySource', () => {
    it('should return edges filtered by source', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'KNOWS', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'KNOWS', sourceId: 'n4', targetId: 'n5', properties: {} });

      const edges = await provider.getEdgesBySource('n1');

      expect(edges).toHaveLength(2);
    });
  });

  describe('delegation to underlying — getEdgesByTarget', () => {
    it('should return edges filtered by target', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'KNOWS', sourceId: 'n3', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'KNOWS', sourceId: 'n4', targetId: 'n5', properties: {} });

      const edges = await provider.getEdgesByTarget('n2');

      expect(edges).toHaveLength(2);
    });
  });

  describe('delegation to underlying — property operations', () => {
    it('should delegate patchProperties with set and invalidate node cache', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      const spy = jest.spyOn(mockProvider, 'patchProperties');
      await provider.patchProperties('node', 'node-1', { set: { name: 'Alice' } });
      expect(spy).toHaveBeenCalledWith('node', 'node-1', { set: { name: 'Alice' } }, undefined);
      expect(await cacheManager.getNode('graph-test', 'node-1')).toBeUndefined();
    });

    it('should delegate patchProperties with unset', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: { name: 'Alice' } });
      const spy = jest.spyOn(mockProvider, 'patchProperties');
      await provider.patchProperties('node', 'node-1', { unset: ['name'] });
      expect(spy).toHaveBeenCalledWith('node', 'node-1', { unset: ['name'] }, undefined);
    });

    it('should delegate patchProperties with replace', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: { name: 'Alice', age: 30 } });
      const spy = jest.spyOn(mockProvider, 'patchProperties');
      await provider.patchProperties('node', 'node-1', { set: {}, replace: true });
      expect(spy).toHaveBeenCalledWith('node', 'node-1', { set: {}, replace: true }, undefined);
    });

    it('should invalidate edge cache when patchProperties adds edge property', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      let cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();
      await provider.patchProperties('edge', 'edge-1', { set: { weight: 5 } });
      cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });

    it('should invalidate edge cache when patchProperties updates edge property', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: { weight: 5 } });
      let cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();
      await provider.patchProperties('edge', 'edge-1', { set: { weight: 10 } });
      cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });

    it('should invalidate edge cache when patchProperties unsets edge property', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: { weight: 5 } });
      let cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();
      await provider.patchProperties('edge', 'edge-1', { unset: ['weight'] });
      cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });

    it('should invalidate edge cache when patchProperties clears edge properties', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      let cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();
      await provider.patchProperties('edge', 'edge-1', { set: {}, replace: true });
      cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });
  });

  describe('delegation to underlying — createIndex', () => {
    it('should delegate createIndex', async () => {
      const spy = jest.spyOn(mockProvider, 'createIndex');
      await provider.createIndex('name-index', 'node', ['name']);
      expect(spy).toHaveBeenCalledWith('name-index', 'node', ['name']);
    });
  });

  describe('delegation to underlying — exportJSON/importJSON', () => {
    it('should delegate exportJSON', async () => {
      const spy = jest.spyOn(mockProvider, 'exportJSON');
      await provider.exportJSON();
      expect(spy).toHaveBeenCalled();
    });

    it('should delegate importJSON', async () => {
      const spy = jest.spyOn(mockProvider, 'importJSON');
      await provider.importJSON({ nodes: [], edges: [] });
      expect(spy).toHaveBeenCalledWith({ nodes: [], edges: [] });
    });
  });

  describe('delegation to underlying — supportsTransactions', () => {
    it('should return underlying supportsTransactions', () => {
      expect(provider.supportsTransactions()).toBe(true);
    });
  });

  describe('delegation to underlying — rollbackTransaction', () => {
    it('should delegate rollbackTransaction', async () => {
      const spy = jest.spyOn(mockProvider, 'rollbackTransaction');
      const txn = await provider.beginTransaction();
      await provider.rollbackTransaction(txn);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('getAllNodes cache optimization', () => {
    it('should serve from cache when orderBy is undefined and cache has entries', async () => {
      // Insert nodes into underlying
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      await provider.insertNode({ id: 'node-2', labels: ['Test'], properties: {} });

      // Warm the cache to populate it (need preloadStrategy: all)
      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      const nodes = await warmProvider.getNodes();

      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.id).sort()).toEqual(['node-1', 'node-2']);
    });

    it('should delegate to underlying when orderBy provided but cache is incomplete', async () => {
      // Insert only some nodes into cache via insertNode
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });
      await provider.insertNode({ id: 'node-2', labels: ['Test'], properties: {} });

      // Warm cache for only 2 nodes
      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Manually add a node to underlying but not to cache
      mockProvider.insertNode({ id: 'node-3', labels: ['Test'], properties: {} });

      const nodes = await warmProvider.getNodes({ orderBy: { field: 'updatedOn', direction: 'asc' } });

      // Should get all 3 nodes from underlying since cache is incomplete
      expect(nodes).toHaveLength(3);
    });

    it('should delegate to underlying when inside transaction', async () => {
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: {} });

      const txn = await provider.beginTransaction();
      const nodes = await provider.getNodes({ transaction: txn });

      expect(nodes).toHaveLength(1);
    });

    it('should limit results when limit <= cachedCount', async () => {
      // Insert 5 nodes
      for (let i = 1; i <= 5; i++) {
        await provider.insertNode({ id: `node-${i}`, labels: ['Test'], properties: { order: i } });
      }

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      // Request only 3 nodes, cache has 5
      const nodes = await warmProvider.getNodes({ limit: 3 });

      expect(nodes).toHaveLength(3);
    });

    it('should serve from cache with sorting when orderBy provided and cache is complete', async () => {
      // Insert nodes with different createdOn timestamps
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: { name: 'A' }, createdOn: 1000 });
      await provider.insertNode({ id: 'node-2', labels: ['Test'], properties: { name: 'B' }, createdOn: 3000 });
      await provider.insertNode({ id: 'node-3', labels: ['Test'], properties: { name: 'C' }, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // NOTE: Do NOT clear underlying here - the orderBy case requires cachedCount === totalCount
      // If we clear underlying, totalCount would be 0 while cachedCount is 3, breaking the condition

      const nodes = await warmProvider.getNodes({ orderBy: { field: 'createdOn', direction: 'desc' } });

      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe('node-2'); // highest createdOn
      expect(nodes[1].id).toBe('node-3');
      expect(nodes[2].id).toBe('node-1'); // lowest createdOn
    });

    it('should handle undefined fields during sorting', async () => {
      // Insert nodes where some have undefined createdOn
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: { name: 'A' }, createdOn: 1000 });
      await provider.insertNode({ id: 'node-2', labels: ['Test'], properties: { name: 'B' } }); // createdOn undefined
      await provider.insertNode({ id: 'node-3', labels: ['Test'], properties: { name: 'C' }, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const nodes = await warmProvider.getNodes({ orderBy: { field: 'createdOn', direction: 'asc' } });

      // node-2 with undefined createdOn should come last in asc order
      expect(nodes).toHaveLength(3);
      expect(nodes[2].id).toBe('node-2'); // undefined values sort to end in asc
    });

    it('should sort desc with undefined fields', async () => {
      // Insert nodes where some have undefined createdOn
      await provider.insertNode({ id: 'node-1', labels: ['Test'], properties: { name: 'A' }, createdOn: 1000 });
      await provider.insertNode({ id: 'node-2', labels: ['Test'], properties: { name: 'B' } }); // createdOn undefined
      await provider.insertNode({ id: 'node-3', labels: ['Test'], properties: { name: 'C' }, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const nodes = await warmProvider.getNodes({ orderBy: { field: 'createdOn', direction: 'desc' } });

      // node-2 with undefined createdOn should come first in desc order
      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe('node-2'); // undefined values sort to start in desc
    });
  });

  describe('getAllEdges cache optimization', () => {
    it('should serve from cache when orderBy is undefined and cache has entries', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      const spy = jest.spyOn(mockProvider, 'getEdges');
      const edges = await warmProvider.getEdges();

      expect(edges).toHaveLength(2);
      expect(edges.map(e => e.id).sort()).toEqual(['edge-1', 'edge-2']);
    });

    it('should limit results when limit <= cachedCount', async () => {
      // Insert 5 edges
      for (let i = 1; i <= 5; i++) {
        await provider.insertEdge({ id: `edge-${i}`, type: 'Test', sourceId: `n${i}`, targetId: `n${i + 1}`, properties: {} });
      }

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      // Request only 3 edges, cache has 5
      const edges = await warmProvider.getEdges({ limit: 3 });

      expect(edges).toHaveLength(3);
    });

    it('should serve from cache with sorting when orderBy provided and cache is complete', async () => {
      // Insert edges with different createdOn timestamps
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {}, createdOn: 3000 });
      await provider.insertEdge({ id: 'edge-3', type: 'Test', sourceId: 'n5', targetId: 'n6', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // NOTE: Do NOT clear underlying here - the orderBy case requires cachedCount === totalCount

      const edges = await warmProvider.getEdges({ orderBy: { field: 'createdOn', direction: 'desc' } });

      expect(edges).toHaveLength(3);
      expect(edges[0].id).toBe('edge-2'); // highest createdOn
      expect(edges[1].id).toBe('edge-3');
      expect(edges[2].id).toBe('edge-1'); // lowest createdOn
    });

    it('should handle undefined fields during edge sorting', async () => {
      // Insert edges where some have undefined createdOn
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} }); // createdOn undefined
      await provider.insertEdge({ id: 'edge-3', type: 'Test', sourceId: 'n5', targetId: 'n6', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdges({ orderBy: { field: 'createdOn', direction: 'asc' } });

      // edge-2 with undefined createdOn should come last in asc order
      expect(edges).toHaveLength(3);
      expect(edges[2].id).toBe('edge-2'); // undefined values sort to end in asc
    });

    it('should sort edges desc with undefined fields', async () => {
      // Insert edges where some have undefined createdOn
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} }); // createdOn undefined
      await provider.insertEdge({ id: 'edge-3', type: 'Test', sourceId: 'n5', targetId: 'n6', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdges({ orderBy: { field: 'createdOn', direction: 'desc' } });

      // edge-2 with undefined createdOn should come first in desc order
      expect(edges).toHaveLength(3);
      expect(edges[0].id).toBe('edge-2'); // undefined values sort to start in desc
    });
  });

  describe('getEdgesBySource cache optimization', () => {
    it('should delegate to underlying when inside transaction', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      const txn = await provider.beginTransaction();
      const edges = await provider.getEdgesBySource('n1', { transaction: txn });

      expect(edges).toHaveLength(1);
    });

    it('should apply orderBy when sorting edges by createdOn', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n1', targetId: 'n3', properties: {}, createdOn: 3000 });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n1', targetId: 'n4', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesBySource('n1', { orderBy: { field: 'createdOn', direction: 'asc' } });

      expect(edges).toHaveLength(3);
      expect(edges[0].id).toBe('edge-1');
      expect(edges[1].id).toBe('edge-3');
      expect(edges[2].id).toBe('edge-2');
    });

    it('should apply limit to edges from source', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n1', targetId: 'n4', properties: {} });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesBySource('n1', { limit: 2 });

      expect(edges).toHaveLength(2);
    });

    it('should handle undefined property values during orderBy', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: { weight: 100 } });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n1', targetId: 'n4', properties: { weight: 50 } });
      await provider.insertEdge({ id: 'edge-4', type: 'A', sourceId: 'n1', targetId: 'n5', properties: { weight: 200 } });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesBySource('n1', { orderBy: { field: 'weight', direction: 'asc' } });

      expect(edges).toHaveLength(4);
      // undefined values should sort to the end in asc order
      expect(edges[0].id).toBe('edge-3'); // 50
      expect(edges[1].id).toBe('edge-1'); // 100
      expect(edges[2].id).toBe('edge-4'); // 200
      expect(edges[3].id).toBe('edge-2'); // undefined
    });

    it('should handle when both values are undefined during orderBy', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n1', targetId: 'n4', properties: { weight: 50 } });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesBySource('n1', { orderBy: { field: 'weight', direction: 'asc' } });

      expect(edges).toHaveLength(3);
      // weight:50 comes first, both undefined stay in original order
      expect(edges[0].id).toBe('edge-3'); // 50
      expect(edges[1].id).toBe('edge-1'); // undefined
      expect(edges[2].id).toBe('edge-2'); // undefined
    });

    it('should combine orderBy and limit on edges from source', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n1', targetId: 'n3', properties: {}, createdOn: 3000 });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n1', targetId: 'n4', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesBySource('n1', {
        orderBy: { field: 'createdOn', direction: 'desc' },
        limit: 2
      });

      expect(edges).toHaveLength(2);
      expect(edges[0].id).toBe('edge-2'); // highest createdOn
      expect(edges[1].id).toBe('edge-3');
    });
  });

  describe('getEdgesByTarget cache optimization', () => {
    it('should delegate to underlying when inside transaction', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      const txn = await provider.beginTransaction();
      const edges = await provider.getEdgesByTarget('n2', { transaction: txn });

      expect(edges).toHaveLength(1);
    });

    it('should apply orderBy when sorting edges by createdOn', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n3', targetId: 'n2', properties: {}, createdOn: 3000 });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n4', targetId: 'n2', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesByTarget('n2', { orderBy: { field: 'createdOn', direction: 'desc' } });

      expect(edges).toHaveLength(3);
      expect(edges[0].id).toBe('edge-2');
      expect(edges[1].id).toBe('edge-3');
      expect(edges[2].id).toBe('edge-1');
    });

    it('should apply limit to edges to target', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n3', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n4', targetId: 'n2', properties: {} });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesByTarget('n2', { limit: 2 });

      expect(edges).toHaveLength(2);
    });

    it('should handle undefined property values during orderBy', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: { weight: 100 } });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n3', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n4', targetId: 'n2', properties: { weight: 50 } });
      await provider.insertEdge({ id: 'edge-4', type: 'A', sourceId: 'n5', targetId: 'n2', properties: { weight: 200 } });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesByTarget('n2', { orderBy: { field: 'weight', direction: 'asc' } });

      expect(edges).toHaveLength(4);
      // undefined values should sort to the end in asc order
      expect(edges[0].id).toBe('edge-3'); // 50
      expect(edges[1].id).toBe('edge-1'); // 100
      expect(edges[2].id).toBe('edge-4'); // 200
      expect(edges[3].id).toBe('edge-2'); // undefined
    });

    it('should handle when both values are undefined during orderBy', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n3', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n4', targetId: 'n2', properties: { weight: 50 } });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesByTarget('n2', { orderBy: { field: 'weight', direction: 'asc' } });

      expect(edges).toHaveLength(3);
      // weight:50 comes first, both undefined stay in original order
      expect(edges[0].id).toBe('edge-3'); // 50
      expect(edges[1].id).toBe('edge-1'); // undefined
      expect(edges[2].id).toBe('edge-2'); // undefined
    });

    it('should combine orderBy and limit on edges to target', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'A', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'A', sourceId: 'n3', targetId: 'n2', properties: {}, createdOn: 3000 });
      await provider.insertEdge({ id: 'edge-3', type: 'A', sourceId: 'n4', targetId: 'n2', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getEdgesByTarget('n2', {
        orderBy: { field: 'createdOn', direction: 'asc' },
        limit: 2
      });

      expect(edges).toHaveLength(2);
      expect(edges[0].id).toBe('edge-1'); // lowest createdOn
      expect(edges[1].id).toBe('edge-3');
    });
  });

  describe('adjacency index maintenance', () => {
    it('should update adjacency index on insertEdge', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      const sourceEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'n1');
      const targetEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'n2');

      expect(sourceEdges).toContain('edge-1');
      expect(targetEdges).toContain('edge-1');
    });

    it('should remove from adjacency index on deleteEdge', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      await provider.deleteEdge('edge-1');

      const sourceEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'n1');
      const targetEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'n2');

      expect(sourceEdges).not.toContain('edge-1');
      expect(targetEdges).not.toContain('edge-1');
    });

    it('should invalidate adjacency on clear', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      await provider.clear();

      const sourceEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'n1');
      expect(sourceEdges).toHaveLength(0);
    });

    it('preserves pre-existing uncached edges on insertEdge with preloadStrategy: none and invalidates cache on commitTransaction', async () => {
      const backing = new InMemoryStorageProvider();
      const cm = new CacheManager(defaultConfig);
      const cached = new CachedStorageProvider(backing, 'adj-complete-test', cm, defaultConfig);
      const graph = new Graph(cached);

      await backing.insertNode({ id: 'n1', labels: ['N'], properties: { score: 10 } });
      await backing.insertNode({ id: 'n2', labels: ['N'], properties: {} });
      await backing.insertEdge({ id: 'e-old', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} });

      await cached.insertEdge({ id: 'e-new', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} });

      const fromEdges = await cached.getEdgesBySource('n1');
      const toEdges = await cached.getEdgesByTarget('n2');
      expect(fromEdges.map((e) => e.id).sort()).toEqual(['e-new', 'e-old']);
      expect(toEdges.map((e) => e.id).sort()).toEqual(['e-new', 'e-old']);

      expect((await graph.getNode('n1'))?.properties.score).toBe(10);
      const tx = graph.createTransaction();
      await tx.begin();
      await graph.setNodeProperties('n1', { score: 88 }, { merge: true, transaction: tx });
      await graph.addEdge('n1', 'n2', 'T', {}, tx, 'e-tx');
      await tx.commit();

      expect((await graph.getNode('n1'))?.properties.score).toBe(88);
      expect((await graph.getEdgesFrom('n1')).map((e) => e.id).sort()).toEqual([
        'e-new',
        'e-old',
        'e-tx',
      ]);
      await cm.invalidateAll();
    });

    it('serves target edges after warmCache(all) and keeps rolled-back transaction writes isolated from cache', async () => {
      const cfg: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const backing = new InMemoryStorageProvider();
      await backing.insertNode({ id: 'n1', labels: ['N'], properties: { v: 1 } });
      await backing.insertNode({ id: 'n2', labels: ['N'], properties: { v: 2 } });
      await backing.insertEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} });

      const cm = new CacheManager(cfg);
      const cached = new CachedStorageProvider(backing, 'warm-tx-test', cm, cfg);
      const graph = new Graph(cached);

      await graph.warmCache();
      expect((await cached.getEdgesByTarget('n2')).map((e) => e.id)).toEqual(['e1']);
      expect(await cached.getEdgesByTarget('n2', { filter: { types: ['T'] } })).toHaveLength(1);

      const tx = graph.createTransaction();
      await tx.begin();
      await graph.setNodeProperties('n1', { v: 999 }, { merge: true, transaction: tx });
      await graph.addEdge('n1', 'n2', 'T', {}, tx, 'e-tx-abort');
      await tx.rollback();

      expect((await graph.getNode('n1'))?.properties.v).toBe(1);
      expect((await cached.getEdgesBySource('n1')).map((e) => e.id)).toEqual(['e1']);
      await cm.invalidateAll();
    });
  });

  describe('Batch and pushdown capabilities', () => {
    it('batches getEdgesBySources and getEdgesByTargets across cache hits and misses', async () => {
      const base = new InMemoryStorageProvider();
      await base.insertNode({ id: 'n1', labels: ['N'], properties: {} });
      await base.insertNode({ id: 'n2', labels: ['N'], properties: {} });
      await base.insertNode({ id: 'n3', labels: ['N'], properties: {} });
      await base.insertEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'KNOWS', properties: { w: 2 } });
      await base.insertEdge({ id: 'e2', sourceId: 'n1', targetId: 'n3', type: 'LIKES', properties: { w: 1 } });
      await base.insertEdge({ id: 'e3', sourceId: 'n2', targetId: 'n3', type: 'KNOWS', properties: { w: 5 } });

      const getBySourcesSpy = jest.fn(async (nodeIds: readonly string[], options?: any) => {
        const out = new Map<string, EdgeData[]>();
        for (const id of nodeIds) {
          out.set(id, (await base.getEdgesBySource(id, options)) as EdgeData[]);
        }
        return out;
      });
      const getByTargetsSpy = jest.fn(async (nodeIds: readonly string[], options?: any) => {
        const out = new Map<string, EdgeData[]>();
        for (const id of nodeIds) {
          out.set(id, (await base.getEdgesByTarget(id, options)) as EdgeData[]);
        }
        return out;
      });

      const underlying = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
        getEdgesBySources: getBySourcesSpy,
        getEdgesByTargets: getByTargetsSpy,
      }) as IStorageProvider;

      const cm = new CacheManager(defaultConfig);
      const cached = new CachedStorageProvider(underlying, 'batch-test', cm, defaultConfig);

      expect((await cached.getEdgesBySources([])).size).toBe(0);

      // Warm n1 only; n2 misses and triggers a single batch fetch for ['n2']
      await cached.getEdgesBySource('n1');
      const srcMap = await cached.getEdgesBySources(['n1', 'n2', 'n1']);
      expect(srcMap.get('n1')?.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
      expect(srcMap.get('n2')?.map((e) => e.id)).toEqual(['e3']);
      expect(getBySourcesSpy).toHaveBeenCalledTimes(1);
      expect(getBySourcesSpy.mock.calls[0]?.[0]).toEqual(['n2']);

      // Filtered/sorted cached read hits memory without hitting underlying again
      const filtered = await cached.getEdgesBySources(['n1'], {
        filter: { types: ['KNOWS', 'LIKES'] },
        orderBy: { field: 'w', direction: 'asc' },
        limit: 1,
      });
      expect(filtered.get('n1')?.map((e) => e.id)).toEqual(['e2']);
      expect(getBySourcesSpy).toHaveBeenCalledTimes(1);

      // Warm n2 target; n3 misses
      await cached.getEdgesByTarget('n2');
      const tgtMap = await cached.getEdgesByTargets(['n2', 'n3']);
      expect(tgtMap.get('n2')?.map((e) => e.id)).toEqual(['e1']);
      expect(tgtMap.get('n3')?.map((e) => e.id).sort()).toEqual(['e2', 'e3']);
      expect(getByTargetsSpy).toHaveBeenCalledTimes(1);
      expect(getByTargetsSpy.mock.calls[0]?.[0]).toEqual(['n3']);

      // Transaction bypass routes straight to underlying batch method
      const txn = await cached.beginTransaction();
      await cached.getEdgesBySources(['n1'], { transaction: txn });
      expect(getBySourcesSpy).toHaveBeenCalledTimes(2);
      await cached.rollbackTransaction(txn);

      await cm.invalidateAll();
    });

    it('falls back to single adjacency queries and handles deleteEdges, aggregateGrouped, and traverseShortestPath', async () => {
      await provider.insertNode({ id: 'n1', labels: ['N'], properties: {} });
      await provider.insertNode({ id: 'n2', labels: ['N'], properties: {} });
      await provider.insertEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} });
      await provider.insertEdge({ id: 'e2', sourceId: 'n2', targetId: 'n1', type: 'T', properties: {} });

      // InMemoryStorageProvider lacks optional Tier 2 methods
      const srcFallback = await provider.getEdgesBySources(['n1', 'n2']);
      const tgtFallback = await provider.getEdgesByTargets(['n1', 'n2']);
      expect(srcFallback.get('n1')?.map((e) => e.id)).toEqual(['e1']);
      expect(tgtFallback.get('n1')?.map((e) => e.id)).toEqual(['e2']);
      expect(
        await provider.aggregateGrouped({
          target: 'node',
          groupByKeys: ['city'],
          aggregates: [{ alias: 'c', fn: 'COUNT' }],
        }),
      ).toBeNull();
      expect(await provider.traverseShortestPath('n1', 'n2')).toBeUndefined();

      // deleteEdges invalidates cache + adjacency index cleanly (and skips invalidation inside txn)
      await provider.deleteEdges([]);
      const tx = await provider.beginTransaction();
      await provider.deleteEdges(['e1'], tx);
      expect(await cacheManager.getEdge('graph-test', 'e1')).toBeDefined();
      await provider.rollbackTransaction(tx);

      await provider.deleteEdges(['e1', 'e2']);
      expect(await mockProvider.hasEdge('e1')).toBe(false);
      expect(await mockProvider.hasEdge('e2')).toBe(false);
      expect(await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'n1')).not.toContain('e1');
      expect(await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'n1')).not.toContain('e2');

      // Delegates deleteEdges, aggregateGrouped, traverseShortestPath when underlying implements them
      const deleteEdgesSpy = jest.fn(async (ids: readonly string[]) => {
        for (const id of ids) await mockProvider.deleteEdge(id);
      });
      const aggSpy = jest.fn(async () => [{ groupValues: ['NYC'], aggValues: { c: 3 } }]);
      const travSpy = jest.fn(async () => ['n1', 'n2']);
      const delegatingUnderlying: IStorageProvider = Object.assign(
        Object.create(Object.getPrototypeOf(mockProvider)),
        mockProvider,
        {
          deleteEdges: deleteEdgesSpy,
          aggregateGrouped: aggSpy,
          traverseShortestPath: travSpy,
        },
      );
      const delegating = new CachedStorageProvider(
        delegatingUnderlying,
        'delegate-test',
        cacheManager,
        defaultConfig,
      );
      await delegating.insertEdge({ id: 'e3', sourceId: 'n1', targetId: 'n2', type: 'T', properties: {} });
      await delegating.deleteEdges(['e3']);
      expect(deleteEdgesSpy).toHaveBeenCalledWith(['e3'], undefined);
      expect(
        await delegating.aggregateGrouped({
          target: 'node',
          groupByKeys: ['city'],
          aggregates: [{ alias: 'c', fn: 'COUNT' }],
        }),
      ).toEqual([{ groupValues: ['NYC'], aggValues: { c: 3 } }]);
      expect(await delegating.traverseShortestPath('n1', 'n2', ['T'])).toEqual(['n1', 'n2']);
    });
  });
});

