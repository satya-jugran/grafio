import { describe, expect, it } from '@jest/globals';
import { InMemoryCache } from '../../../src/storage/cache/InMemoryCache';

describe('InMemoryCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve a value', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('key-1', 'value-1');
      expect(await cache.get('key-1')).toBe('value-1');
    });

    it('should return undefined for missing keys', async () => {
      const cache = new InMemoryCache<string>(3);
      expect(await cache.get('nonexistent')).toBeUndefined();
    });

    it('should track size correctly', async () => {
      const cache = new InMemoryCache<string>(5);
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');
      expect(await cache.size()).toBe(3);
    });

    it('should report maxSize correctly', async () => {
      const cache = new InMemoryCache<string>(10);
      expect(cache.maxSize()).toBe(10);
    });

    it('should report has() correctly', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('key-1', 'value');
      expect(await cache.has('key-1')).toBe(true);
      expect(await cache.has('nonexistent')).toBe(false);
    });

    it('should update existing key', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('key-1', 'value-1');
      await cache.set('key-1', 'updated-value');
      expect(await cache.get('key-1')).toBe('updated-value');
      expect(await cache.size()).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');

      // 'a' is now LRU (it was accessed first)
      await cache.get('a'); // touch 'a' — it becomes MRU
      await cache.set('d', '4'); // 'b' (oldest after touching a) should be evicted

      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });

    it('should move accessed item to head of list', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');

      // Access 'a', making it MRU
      await cache.get('a');

      // Now evict — 'b' (oldest besides 'a') should be evicted
      await cache.set('d', '4');

      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
    });

    it('should evict on set when at capacity with no prior access', async () => {
      const cache = new InMemoryCache<string>(2);
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3'); // 'a' (oldest) should be evicted

      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
      expect(await cache.has('c')).toBe(true);
    });
  });

  describe('FIFO eviction', () => {
    it('should evict oldest inserted item regardless of access', async () => {
      const cache = new InMemoryCache<string>(3, 'FIFO');
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');

      // Access 'a' multiple times — but FIFO should still evict 'a' first
      await cache.get('a');
      await cache.get('a');

      // Now 'a' is still oldest, so evict it
      await cache.set('d', '4');

      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });
  });

  describe('LFU eviction', () => {
    it('should evict least frequently used item', async () => {
      const cache = new InMemoryCache<string>(3, 'LFU');
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');

      // Access 'b' and 'c' multiple times, but 'a' only once
      await cache.get('a');
      await cache.get('b');
      await cache.get('b');
      await cache.get('c');
      await cache.get('c');
      await cache.get('c');

      // 'a' has count=2 (set + 1 get), lowest frequency, should be evicted
      await cache.set('d', '4');

      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });

    it('should increment frequency on set of existing key', async () => {
      const cache = new InMemoryCache<string>(2, 'LFU');
      await cache.set('a', '1');
      await cache.set('b', '2');

      // Access 'a' once
      await cache.get('a');

      // Set 'a' again — frequency should increment
      await cache.set('a', 'updated');

      // Now evict — 'b' has count=0 (never accessed), should be evicted
      await cache.set('c', '3');

      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(true);
    });
  });

  describe('invalidate()', () => {
    it('should remove a specific key', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('key-1', 'value-1');
      await cache.set('key-2', 'value-2');
      await cache.invalidate('key-1');

      expect(await cache.has('key-1')).toBe(false);
      expect(await cache.has('key-2')).toBe(true);
    });

    it('should be safe to invalidate nonexistent key', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.invalidate('nonexistent'); // should not throw
      expect(await cache.size()).toBe(0);
    });
  });

  describe('invalidateAll()', () => {
    it('should remove all entries', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');

      await cache.invalidateAll();

      expect(await cache.size()).toBe(0);
      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(false);
    });
  });

  describe('invalidateByPrefix()', () => {
    it('should remove only keys with matching prefix', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.set('graph-a:node-1', 'value-1');
      await cache.set('graph-a:node-2', 'value-2');
      await cache.set('graph-b:node-1', 'value-3');

      await cache.invalidateByPrefix('graph-a:');

      expect(await cache.size()).toBe(1);
      expect(await cache.has('graph-a:node-1')).toBe(false);
      expect(await cache.has('graph-a:node-2')).toBe(false);
      expect(await cache.has('graph-b:node-1')).toBe(true);
    });

    it('should be safe when no keys match prefix', async () => {
      const cache = new InMemoryCache<string>(3);
      await cache.set('a', '1');
      await cache.set('b', '2');

      await cache.invalidateByPrefix('nonexistent:');

      expect(await cache.size()).toBe(2);
    });

    it('should handle empty prefix (matches all keys)', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.set('a:node-1', 'value-1');
      await cache.set('b:node-1', 'value-2');

      // Empty prefix should match all keys
      await cache.invalidateByPrefix('');

      expect(await cache.size()).toBe(0);
    });
  });

  describe('getAll', () => {
    it('should return all values matching prefix', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.set('graph-a:node-1', 'value-1');
      await cache.set('graph-a:node-2', 'value-2');
      await cache.set('graph-b:node-1', 'value-3');

      const results = await cache.getAll('graph-a:');
      expect(results).toContain('value-1');
      expect(results).toContain('value-2');
      expect(results).not.toContain('value-3');
    });

    it('should return limited results when limit is specified', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.set('graph-a:node-1', 'value-1');
      await cache.set('graph-a:node-2', 'value-2');
      await cache.set('graph-a:node-3', 'value-3');

      const results = await cache.getAll('graph-a:', 2);
      expect(results.length).toBe(2);
    });

    it('should return empty array when no matches', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.set('graph-a:node-1', 'value-1');

      const results = await cache.getAll('graph-b:');
      expect(results).toEqual([]);
    });
  });

  describe('count', () => {
    it('should return count of entries matching prefix', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.set('graph-a:node-1', 'value-1');
      await cache.set('graph-a:node-2', 'value-2');
      await cache.set('graph-b:node-1', 'value-3');

      expect(await cache.count('graph-a:')).toBe(2);
      expect(await cache.count('graph-b:')).toBe(1);
      expect(await cache.count('graph-c:')).toBe(0);
    });

    it('should return 0 for empty cache', async () => {
      const cache = new InMemoryCache<string>(10);
      expect(await cache.count('graph-a:')).toBe(0);
    });
  });

  describe('adjacency index', () => {
    it('should add and retrieve edges by source', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.addToAdjacencyIndex('graph-a', 'source', 'node-1', 'edge-1');
      await cache.addToAdjacencyIndex('graph-a', 'source', 'node-1', 'edge-2');
      await cache.addToAdjacencyIndex('graph-a', 'source', 'node-2', 'edge-3');

      const edges = await cache.getEdgesByAdjacencyIndex('graph-a', 'source', 'node-1');
      expect(edges).toContain('edge-1');
      expect(edges).toContain('edge-2');
      expect(edges).not.toContain('edge-3');
    });

    it('should add and retrieve edges by target', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.addToAdjacencyIndex('graph-a', 'target', 'node-1', 'edge-1');
      await cache.addToAdjacencyIndex('graph-a', 'target', 'node-1', 'edge-2');

      const edges = await cache.getEdgesByAdjacencyIndex('graph-a', 'target', 'node-1');
      expect(edges).toContain('edge-1');
      expect(edges).toContain('edge-2');
    });

    it('should remove edge from adjacency index', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.addToAdjacencyIndex('graph-a', 'source', 'node-1', 'edge-1');
      await cache.addToAdjacencyIndex('graph-a', 'source', 'node-1', 'edge-2');

      await cache.removeFromAdjacencyIndex('graph-a', 'source', 'node-1', 'edge-1');

      const edges = await cache.getEdgesByAdjacencyIndex('graph-a', 'source', 'node-1');
      expect(edges).not.toContain('edge-1');
      expect(edges).toContain('edge-2');
    });

    it('should return empty array for non-existent adjacency', async () => {
      const cache = new InMemoryCache<string>(10);
      const edges = await cache.getEdgesByAdjacencyIndex('graph-a', 'source', 'node-1');
      expect(edges).toEqual([]);
    });

    it('should invalidate all adjacency entries for a graphId', async () => {
      const cache = new InMemoryCache<string>(10);
      await cache.addToAdjacencyIndex('graph-a', 'source', 'node-1', 'edge-1');
      await cache.addToAdjacencyIndex('graph-a', 'target', 'node-2', 'edge-2');
      await cache.addToAdjacencyIndex('graph-b', 'source', 'node-3', 'edge-3');

      await cache.invalidateAdjacencyIndex('graph-a');

      const edgesA = await cache.getEdgesByAdjacencyIndex('graph-a', 'source', 'node-1');
      expect(edgesA).toEqual([]);
      const edgesB = await cache.getEdgesByAdjacencyIndex('graph-b', 'source', 'node-3');
      expect(edgesB).toContain('edge-3');
    });
  });

  describe('constructor validation', () => {
    it('should accept maxSize of 1', async () => {
      const cache = new InMemoryCache<string>(1);
      await cache.set('a', '1');
      await cache.set('b', '2'); // evict 'a'
      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
    });

    it('should throw for maxSize <= 0', () => {
      expect(() => new InMemoryCache<string>(0)).toThrow();
      expect(() => new InMemoryCache<string>(-1)).toThrow();
    });
  });
});