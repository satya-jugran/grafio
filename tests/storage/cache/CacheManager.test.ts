import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import type { NodeData, EdgeData } from '../../../src/types';
import { CacheManager } from '../../../src/storage/cache/CacheManager';
import { CacheConfig } from '../../../src/storage/cache/CacheConfig';
import { RedisCache } from '../../../src/storage/cache/RedisCache';

// Mock RedisCache to avoid needing actual Redis connection
jest.mock('../../../src/storage/cache/RedisCache');

describe('CacheManager', () => {
  const defaultConfig: CacheConfig = {
    maxNodesCount: 100,
    maxEdgesCount: 200,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  };

  describe('constructor', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw error when cacheStore is redis but redisUrl is missing', () => {
      const config: CacheConfig = {
        maxNodesCount: 100,
        maxEdgesCount: 200,
        cacheStore: 'redis',
        evictionStrategy: 'LRU',
        preloadStrategy: 'none',
        // redisUrl is missing
      };

      expect(() => new CacheManager(config)).toThrow(
        '[CacheManager] redisUrl is required when cacheStore is "redis"'
      );
    });

    it('should create RedisCache instances when cacheStore is redis with redisUrl', () => {
      const config: CacheConfig = {
        maxNodesCount: 100,
        maxEdgesCount: 200,
        cacheStore: 'redis',
        redisUrl: 'redis://localhost:6379',
        evictionStrategy: 'LRU',
        preloadStrategy: 'none',
      };

      const manager = new CacheManager(config);

      expect(RedisCache).toHaveBeenCalledTimes(2);
      expect(RedisCache).toHaveBeenCalledWith(
        'redis://localhost:6379',
        100,
        'nodes'
      );
      expect(RedisCache).toHaveBeenCalledWith(
        'redis://localhost:6379',
        200,
        'edges'
      );
    });

    it('should create InMemoryCache instances when cacheStore is in-memory', () => {
      const config: CacheConfig = {
        maxNodesCount: 100,
        maxEdgesCount: 200,
        cacheStore: 'in-memory',
        evictionStrategy: 'LRU',
        preloadStrategy: 'none',
      };

      const manager = new CacheManager(config);

      // RedisCache should not be called
      expect(RedisCache).not.toHaveBeenCalled();
    });
  });

  describe('graphId registration and metadata', () => {
    it('should register graphId on first setNode', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });

      const stats = await manager.getStats();
      expect(stats.totalGraphIds).toBe(1);
    });

    it('should register graphId on first setEdge', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const stats = await manager.getStats();
      expect(stats.totalGraphIds).toBe(1);
    });

    it('should track per-graphId node and edge counts', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });
      await manager.setNode('graph-a', 'node-2', { id: 'node-2', type: 'Test', properties: {} });
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const stats = await manager.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.totalEdges).toBe(1);
    });
  });

  describe('invalidateAllForGraph()', () => {
    it('should remove all nodes and edges for a specific graphId', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });
      await manager.setNode('graph-a', 'node-2', { id: 'node-2', type: 'Test', properties: {} });
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await manager.setNode('graph-b', 'node-3', { id: 'node-3', type: 'Test', properties: {} });

      await manager.invalidateAllForGraph('graph-a');

      const stats = await manager.getStats();
      expect(stats.totalNodes).toBe(1);
      expect(stats.totalEdges).toBe(0);
      expect(stats.totalGraphIds).toBe(2); // graph-a metadata retained but counts zeroed
    });

    it('should be safe when graphId has no entries', async () => {
      const manager = new CacheManager(defaultConfig);
      await expect(manager.invalidateAllForGraph('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('graphId TTL eviction', () => {
    it('should evict expired graphId entries when setNode triggers expiration check', async () => {
      // Use longer TTL for reliable test timing
      const config: CacheConfig = {
        ...defaultConfig,
        graphIdTtlMs: 200, // 200ms TTL
      };
      const manager = new CacheManager(config);
      
      // Register graph-a with a node
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });
      
      // Wait for graph-a to expire
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Register graph-b (this triggers _evictExpiredGraphId for graph-a)
      await manager.setNode('graph-b', 'node-2', { id: 'node-2', type: 'Test', properties: {} });
      
      // graph-a entries should be evicted (cache cleared)
      const nodeA = await manager.getNode('graph-a', 'node-1');
      expect(nodeA).toBeUndefined();
      
      // graph-b entries should remain
      const nodeB = await manager.getNode('graph-b', 'node-2');
      expect(nodeB).not.toBeUndefined();
    });

    it('should refresh TTL on graphId access', async () => {
      const config: CacheConfig = {
        ...defaultConfig,
        graphIdTtlMs: 150,
      };
      const manager = new CacheManager(config);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });

      // Wait 80ms then touch to refresh TTL
      await new Promise(resolve => setTimeout(resolve, 80));
      await manager.getNode('graph-a', 'node-1');

      // Wait another 80ms (total 160ms) — TTL should have been refreshed
      await new Promise(resolve => setTimeout(resolve, 80));

      // Set new node — graph-a should still be alive since TTL was refreshed
      await manager.setNode('graph-b', 'node-2', { id: 'node-2', type: 'Test', properties: {} });

      const nodeA = await manager.getNode('graph-a', 'node-1');
      expect(nodeA).not.toBeUndefined();
    });
  });

  describe('global budget eviction', () => {
    it('should evict least-recently-used graphId when node budget exceeded', async () => {
      const config: CacheConfig = {
        ...defaultConfig,
        maxNodesCount: 3,
      };
      const manager = new CacheManager(config);

      // Fill up graph-a with 2 nodes
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });
      await manager.setNode('graph-a', 'node-2', { id: 'node-2', type: 'Test', properties: {} });

      // Touch graph-b nodes to make them more recently used
      await manager.setNode('graph-b', 'node-3', { id: 'node-3', type: 'Test', properties: {} });
      await manager.getNode('graph-b', 'node-3'); // Access to update LRU

      // Adding 4th node should evict from graph-a (LRU)
      await manager.setNode('graph-c', 'node-4', { id: 'node-4', type: 'Test', properties: {} });

      // graph-a entries should be gone
      const nodeA1 = await manager.getNode('graph-a', 'node-1');
      expect(nodeA1).toBeUndefined();
    });

    it('should evict least-recently-used graphId when edge budget exceeded', async () => {
      const config: CacheConfig = {
        ...defaultConfig,
        maxEdgesCount: 3,
      };
      const manager = new CacheManager(config);

      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await manager.setEdge('graph-a', 'edge-2', { id: 'edge-2', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await manager.setEdge('graph-b', 'edge-3', { id: 'edge-3', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await manager.getEdge('graph-b', 'edge-3'); // Access to update LRU

      await manager.setEdge('graph-c', 'edge-4', { id: 'edge-4', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const edgeA1 = await manager.getEdge('graph-a', 'edge-1');
      expect(edgeA1).toBeUndefined();
    });
  });

  describe('invalidateNode() / invalidateEdge()', () => {
    it('should remove specific node and decrement graphId count', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });
      await manager.setNode('graph-a', 'node-2', { id: 'node-2', type: 'Test', properties: {} });

      await manager.invalidateNode('graph-a', 'node-1');

      const stats = await manager.getStats();
      expect(stats.totalNodes).toBe(1);
      const node = await manager.getNode('graph-a', 'node-1');
      expect(node).toBeUndefined();
    });

    it('should remove specific edge and decrement graphId count', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await manager.setEdge('graph-a', 'edge-2', { id: 'edge-2', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      await manager.invalidateEdge('graph-a', 'edge-1');

      const stats = await manager.getStats();
      expect(stats.totalEdges).toBe(1);
    });
  });

  describe('invalidateAll()', () => {
    it('should clear all caches and reset stats', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      await manager.invalidateAll();

      const stats = await manager.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
      expect(stats.totalGraphIds).toBe(0);
    });
  });

  describe('getNode() branches', () => {
    it('should increment hitCount on cache hit', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });

      await manager.getNode('graph-a', 'node-1');

      const stats = await manager.getStats();
      expect(stats.hitCount).toBe(1);
      expect(stats.missCount).toBe(0);
    });

    it('should increment missCount on cache miss', async () => {
      const manager = new CacheManager(defaultConfig);

      await manager.getNode('graph-a', 'nonexistent');

      const stats = await manager.getStats();
      expect(stats.missCount).toBe(1);
      expect(stats.hitCount).toBe(0);
    });
  });

  describe('getEdge() branches', () => {
    it('should increment hitCount on cache hit', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      await manager.getEdge('graph-a', 'edge-1');

      const stats = await manager.getStats();
      expect(stats.hitCount).toBe(1);
      expect(stats.missCount).toBe(0);
    });

    it('should increment missCount on cache miss', async () => {
      const manager = new CacheManager(defaultConfig);

      await manager.getEdge('graph-a', 'nonexistent');

      const stats = await manager.getStats();
      expect(stats.missCount).toBe(1);
      expect(stats.hitCount).toBe(0);
    });
  });

  describe('setEdge() branches', () => {
    it('should call _evictExpiredGraphId before setting', async () => {
      const config: CacheConfig = {
        ...defaultConfig,
        graphIdTtlMs: 50,
      };
      const manager = new CacheManager(config);
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100));

      // Set new edge — should trigger eviction of expired graph-a first
      await manager.setEdge('graph-b', 'edge-2', { id: 'edge-2', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      // graph-a entries should be evicted
      const edgeA = await manager.getEdge('graph-a', 'edge-1');
      expect(edgeA).toBeUndefined();

      // graph-b entries should remain
      const edgeB = await manager.getEdge('graph-b', 'edge-2');
      expect(edgeB).not.toBeUndefined();
    });

    it('should only register new entries to keep per-graphId counts accurate', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      // Update existing edge — should NOT increment count
      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const stats = await manager.getStats();
      expect(stats.totalEdges).toBe(1); // Still 1, not 2
    });

    it('should evict graphId from edges when edge budget exceeded', async () => {
      const config: CacheConfig = {
        ...defaultConfig,
        maxEdgesCount: 2,
      };
      const manager = new CacheManager(config);

      await manager.setEdge('graph-a', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await manager.setEdge('graph-b', 'edge-2', { id: 'edge-2', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      // Touch graph-b to make it more recently used
      await manager.getEdge('graph-b', 'edge-2');

      // Adding 3rd edge should evict from graph-a (LRU)
      await manager.setEdge('graph-c', 'edge-3', { id: 'edge-3', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const edgeA = await manager.getEdge('graph-a', 'edge-1');
      expect(edgeA).toBeUndefined();
    });
  });

  describe('getStats()', () => {
    it('should track hit/miss counts', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });

      // Cache hit
      await manager.getNode('graph-a', 'node-1');
      // Cache miss
      await manager.getNode('graph-a', 'nonexistent');

      const stats = await manager.getStats();
      expect(stats.hitCount).toBe(1);
      expect(stats.missCount).toBe(1);
    });

    it('should calculate hit rate correctly', async () => {
      const manager = new CacheManager(defaultConfig);
      await manager.setNode('graph-a', 'node-1', { id: 'node-1', type: 'Test', properties: {} });

      await manager.getNode('graph-a', 'node-1');
      await manager.getNode('graph-a', 'node-1');
      await manager.getNode('graph-a', 'nonexistent');

      const stats = await manager.getStats();
      expect(stats.hitRate).toBeCloseTo(0.666, 2);
    });
  });
});
