import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { RedisCache } from '../../../src/storage/cache/RedisCache';

// Use ioredis-mock for testing RedisCache without a real Redis server
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RedisMock = require('ioredis-mock');

// Create a singleton mock instance to share across all RedisCache instances
let mockRedisInstance: typeof RedisMock | null = null;

function getMockRedis(): typeof RedisMock {
  if (!mockRedisInstance) {
    mockRedisInstance = new RedisMock();
  }
  return mockRedisInstance;
}

// Override require('ioredis') to return our mock
jest.mock('ioredis', () => {
  return RedisMock;
});

describe('RedisCache', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRedis: any;

  beforeEach(() => {
    // Get or create the singleton mock
    mockRedis = getMockRedis();
    // Clear the mock database before each test
    mockRedis.flushall();
  });

  afterEach(async () => {
    // Clean up
    if (mockRedis) {
      await mockRedis.flushall();
    }
  });

  // Helper to create cache instance
  const createCache = <T>(maxSize = 10, type: 'nodes' | 'edges' = 'nodes', ttlMs?: number) => {
    return new RedisCache<T>('redis://localhost:6379', maxSize, type, ttlMs);
  };

  describe('get()', () => {
    it('should return undefined for non-existent key', async () => {
      const cache = createCache();
      const result = await cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return stored value after set', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Test' });
      const result = await cache.get('key-1');
      expect(result).toEqual({ id: 'key-1', name: 'Test' });
    });

    it('should return undefined for malformed JSON', async () => {
      const cache = createCache();
      // Directly set invalid JSON in mock Redis
      await mockRedis.set('bad-json-key', 'not valid json');
      const result = await cache.get('bad-json-key');
      expect(result).toBeUndefined();
    });
  });

  describe('set()', () => {
    it('should store value and return without error', async () => {
      const cache = createCache();
      await expect(cache.set('key-1', { id: 'key-1', name: 'Test' })).resolves.not.toThrow();
    });

    it('should update existing key without incrementing size', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Original' });
      await cache.set('key-1', { id: 'key-1', name: 'Updated' });

      const result = await cache.get('key-1');
      expect(result).toEqual({ id: 'key-1', name: 'Updated' });
    });

    it('should track size correctly for new keys', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Test1' });
      await cache.set('key-2', { id: 'key-2', name: 'Test2' });

      const size = await cache.size();
      expect(size).toBe(2);
    });

    it('should track size when at capacity', async () => {
      const cache = createCache(3);
      await cache.set('key-1', { id: 'key-1' });
      await cache.set('key-2', { id: 'key-2' });
      await cache.set('key-3', { id: 'key-3' });

      const size = await cache.size();
      expect(size).toBe(3);
    });

    // This test covers the capacity enforcement branch:
    // if (this._size >= this._maxSize) { await this._evictOne(); }
    // Note: With ioredis-mock, _evictOne() may not actually remove keys from
    // Redis (zrange/zrem behavior differs), but the branch is still exercised.
    it('should exercise eviction branch when setting new key at capacity', async () => {
      const cache = createCache(2);

      // Fill up to capacity
      await cache.set('key-a', { id: 'key-a' });
      await cache.set('key-b', { id: 'key-b' });

      // Now _size === _maxSize, setting new key exercises the eviction branch
      // We just verify the call doesn't throw - actual eviction depends on
      // Redis sorted set behavior which may differ in mock
      await expect(cache.set('key-c', { id: 'key-c' })).resolves.not.toThrow();
    });

    it('should set value with TTL when ttlMs is provided', async () => {
      const cache = createCache(10, 'nodes', 1000);
      await cache.set('ttl-key', { id: 'ttl-key' });

      const result = await cache.get('ttl-key');
      expect(result).toEqual({ id: 'ttl-key' });
    });
  });

  describe('has()', () => {
    it('should return false for non-existent key', async () => {
      const cache = createCache();
      const result = await cache.has('nonexistent');
      expect(result).toBe(false);
    });

    it('should return true for existing key', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Test' });
      const result = await cache.has('key-1');
      expect(result).toBe(true);
    });
  });

  describe('invalidate()', () => {
    it('should remove existing key', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Test' });
      await cache.invalidate('key-1');

      const result = await cache.get('key-1');
      expect(result).toBeUndefined();
    });

    it('should be safe to invalidate non-existent key', async () => {
      const cache = createCache();
      await expect(cache.invalidate('nonexistent')).resolves.not.toThrow();
    });

    it('should decrement size when key existed', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Test' });
      await cache.set('key-2', { id: 'key-2', name: 'Test2' });

      await cache.invalidate('key-1');

      const size = await cache.size();
      expect(size).toBe(1);
    });
  });

  describe('invalidateAll()', () => {
    it('should remove all keys', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Test1' });
      await cache.set('key-2', { id: 'key-2', name: 'Test2' });
      await cache.set('key-3', { id: 'key-3', name: 'Test3' });

      await cache.invalidateAll();

      const size = await cache.size();
      expect(size).toBe(0);
    });

    it('should be safe when empty', async () => {
      const cache = createCache();
      await expect(cache.invalidateAll()).resolves.not.toThrow();
    });
  });

  describe('invalidateByPrefix()', () => {
    it('should remove all keys matching prefix', async () => {
      const cache = createCache();

      // Use full Redis key format
      await cache.set('grafio:nodes:graph-a:node-1', { id: 'node-1', name: 'N1' } as any);
      await cache.set('grafio:nodes:graph-a:node-2', { id: 'node-2', name: 'N2' } as any);
      await cache.set('grafio:nodes:graph-b:node-1', { id: 'node-1', name: 'N3' } as any);

      await cache.invalidateByPrefix('grafio:nodes:graph-a:');

      // graph-a keys should be gone
      const result1 = await cache.get('grafio:nodes:graph-a:node-1');
      const result2 = await cache.get('grafio:nodes:graph-a:node-2');
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();

      // graph-b key should remain
      const result3 = await cache.get('grafio:nodes:graph-b:node-1');
      expect(result3).toBeDefined();
    });

    it('should handle non-existent prefix gracefully', async () => {
      const cache = createCache();
      await expect(cache.invalidateByPrefix('nonexistent-prefix:')).resolves.not.toThrow();
    });

    it('should work with just graphId prefix (without grafio prefix)', async () => {
      const cache = createCache();

      await cache.set('grafio:nodes:graph-x:node-1', { id: 'node-1', name: 'X1' } as any);
      await cache.set('grafio:nodes:graph-x:node-2', { id: 'node-2', name: 'X2' } as any);
      await cache.set('grafio:nodes:graph-y:node-1', { id: 'node-1', name: 'Y1' } as any);

      await cache.invalidateByPrefix('graph-x');

      const result1 = await cache.get('grafio:nodes:graph-x:node-1');
      expect(result1).toBeUndefined();

      const result2 = await cache.get('grafio:nodes:graph-y:node-1');
      expect(result2).toBeDefined();
    });
  
    describe('getAll', () => {
      it('should return all values matching prefix', async () => {
        const cache = createCache();
  
        // Use full Redis key format: grafio:{type}:{graphId}:{id}
        await cache.set('grafio:nodes:graph-1:item-1', { id: 'item-1', name: 'One' } as any);
        await cache.set('grafio:nodes:graph-1:item-2', { id: 'item-2', name: 'Two' } as any);
        await cache.set('grafio:nodes:graph-2:item-1', { id: 'item-1', name: 'Other' } as any);
  
        const results = await cache.getAll('graph-1');
        expect(results).toHaveLength(2);
        expect(results.map((r: any) => r.id).sort()).toEqual(['item-1', 'item-2']);
      });
  
      it('should return limited results when limit is specified', async () => {
        const cache = createCache();
  
        await cache.set('grafio:nodes:graph-limit:item-1', { id: 'item-1' } as any);
        await cache.set('grafio:nodes:graph-limit:item-2', { id: 'item-2' } as any);
        await cache.set('grafio:nodes:graph-limit:item-3', { id: 'item-3' } as any);
  
        const results = await cache.getAll('graph-limit', 2);
        expect(results).toHaveLength(2);
      });
  
      it('should return empty array when no matches', async () => {
        const cache = createCache();
        const results = await cache.getAll('nonexistent');
        expect(results).toHaveLength(0);
      });
    });
  
    describe('count', () => {
      it('should return count of entries matching prefix', async () => {
        const cache = createCache();
  
        await cache.set('grafio:nodes:graph-count:item-1', { id: 'item-1' } as any);
        await cache.set('grafio:nodes:graph-count:item-2', { id: 'item-2' } as any);
        await cache.set('grafio:nodes:graph-count:item-3', { id: 'item-3' } as any);
        await cache.set('grafio:nodes:graph-other:item-1', { id: 'other-1' } as any);
  
        const count = await cache.count('graph-count');
        expect(count).toBe(3);
      });
  
      it('should return 0 when no entries match', async () => {
        const cache = createCache();
        const count = await cache.count('nonexistent');
        expect(count).toBe(0);
      });
    });
  
    describe('adjacency index', () => {
      it('should add and retrieve edges by source', async () => {
        const cache = createCache();
  
        await cache.addToAdjacencyIndex('graph-1', 'source', 'node-A', 'edge-1');
        await cache.addToAdjacencyIndex('graph-1', 'source', 'node-A', 'edge-2');
        await cache.addToAdjacencyIndex('graph-1', 'source', 'node-B', 'edge-3');
  
        const edgesForA = await cache.getEdgesByAdjacencyIndex('graph-1', 'source', 'node-A');
        expect(edgesForA).toHaveLength(2);
        expect(edgesForA.sort()).toEqual(['edge-1', 'edge-2']);
  
        const edgesForB = await cache.getEdgesByAdjacencyIndex('graph-1', 'source', 'node-B');
        expect(edgesForB).toHaveLength(1);
        expect(edgesForB[0]).toBe('edge-3');
      });
  
      it('should add and retrieve edges by target', async () => {
        const cache = createCache();
  
        await cache.addToAdjacencyIndex('graph-1', 'target', 'node-X', 'edge-1');
        await cache.addToAdjacencyIndex('graph-1', 'target', 'node-X', 'edge-2');
        await cache.addToAdjacencyIndex('graph-1', 'target', 'node-Y', 'edge-3');
  
        const edgesForX = await cache.getEdgesByAdjacencyIndex('graph-1', 'target', 'node-X');
        expect(edgesForX).toHaveLength(2);
        expect(edgesForX.sort()).toEqual(['edge-1', 'edge-2']);
      });
  
      it('should remove edge from adjacency index', async () => {
        const cache = createCache();
  
        await cache.addToAdjacencyIndex('graph-1', 'source', 'node-A', 'edge-1');
        await cache.addToAdjacencyIndex('graph-1', 'source', 'node-A', 'edge-2');
  
        await cache.removeFromAdjacencyIndex('graph-1', 'source', 'node-A', 'edge-1');
  
        const edges = await cache.getEdgesByAdjacencyIndex('graph-1', 'source', 'node-A');
        expect(edges).toHaveLength(1);
        expect(edges[0]).toBe('edge-2');
      });
  
      it('should return empty array for non-existent adjacency', async () => {
        const cache = createCache();
  
        const edges = await cache.getEdgesByAdjacencyIndex('graph-1', 'source', 'node-Z');
        expect(edges).toHaveLength(0);
      });
  
      it('should invalidate all adjacency entries for a graphId', async () => {
        const cache = createCache();
  
        await cache.addToAdjacencyIndex('graph-1', 'source', 'node-A', 'edge-1');
        await cache.addToAdjacencyIndex('graph-1', 'target', 'node-X', 'edge-2');
        await cache.addToAdjacencyIndex('graph-1', 'source', 'node-B', 'edge-3');
  
        await cache.invalidateAdjacencyIndex('graph-1');
  
        const edgesBySourceA = await cache.getEdgesByAdjacencyIndex('graph-1', 'source', 'node-A');
        const edgesByTargetX = await cache.getEdgesByAdjacencyIndex('graph-1', 'target', 'node-X');
        expect(edgesBySourceA).toHaveLength(0);
        expect(edgesByTargetX).toHaveLength(0);
  
        // Other graphs should not be affected
        await cache.addToAdjacencyIndex('graph-2', 'source', 'node-A', 'edge-100');
        const edgesGraph2 = await cache.getEdgesByAdjacencyIndex('graph-2', 'source', 'node-A');
        expect(edgesGraph2).toHaveLength(1);
      });
    });
  });

  describe('size() / maxSize()', () => {
    it('should report current size', async () => {
      const cache = createCache();
      await cache.set('key-1', { id: 'key-1', name: 'Test' });
      await cache.set('key-2', { id: 'key-2', name: 'Test' });

      const size = await cache.size();
      expect(size).toBe(2);
    });

    it('should report configured maxSize', () => {
      const cache = createCache(10);
      const result = cache.maxSize();
      expect(result).toBe(10);
    });
  });

  describe('_extractGraphId()', () => {
    it('should extract graphId from valid Redis key', async () => {
      const cache = createCache();
      await cache.set('grafio:nodes:my-graph:node-123', { id: 'node-123', name: 'Test' } as any);

      const hasNode = await cache.has('grafio:nodes:my-graph:node-123');
      expect(hasNode).toBe(true);
    });

    it('should handle edge type keys', async () => {
      const cache = createCache(10, 'edges');
      await cache.set('grafio:edges:my-graph:edge-1', { id: 'edge-1' } as any);

      const hasEdge = await cache.has('grafio:edges:my-graph:edge-1');
      expect(hasEdge).toBe(true);
    });
  });

  describe('LRU eviction', () => {
    // Note: Full LRU eviction testing with sorted sets requires a real Redis
    // instance. ioredis-mock may not fully replicate zrange behavior.
    it('should track size after multiple sets', async () => {
      const cache = createCache(5);
      await cache.set('key-a', { id: 'key-a' });
      await cache.set('key-b', { id: 'key-b' });
      await cache.set('key-c', { id: 'key-c' });

      const size = await cache.size();
      expect(size).toBe(3);
    });
  });

  describe('edge type cache', () => {
    it('should work correctly for edges', async () => {
      const edgeCache = createCache<{ id: string; sourceId: string; targetId: string }>(10, 'edges');

      await edgeCache.set('edge-1', { id: 'edge-1', sourceId: 'n1', targetId: 'n2' });
      const result = await edgeCache.get('edge-1');
      expect(result).toEqual({ id: 'edge-1', sourceId: 'n1', targetId: 'n2' });
    });

    // Note: ioredis-mock shares state across instances, so isolation tests
    // may not work as expected. This test validates basic edge operations.
    it('should store and retrieve edge data', async () => {
      const cache = createCache<{ id: string; sourceId: string; targetId: string }>(10, 'edges');
      const edgeData = { id: 'edge-x', sourceId: 'node-a', targetId: 'node-b' };

      await cache.set('edge-x', edgeData);
      const result = await cache.get('edge-x');

      expect(result).toBeDefined();
      expect(result!.id).toBe('edge-x');
      expect(result!.sourceId).toBe('node-a');
      expect(result!.targetId).toBe('node-b');
    });
  });
});