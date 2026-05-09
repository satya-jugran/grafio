import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { GraphManager } from '../src/GraphManager';
import { CacheConfig } from '../src/storage/cache/CacheConfig';

describe('GraphManager', () => {
  const defaultCacheConfig: CacheConfig = {
    maxNodesCount: 100,
    maxEdgesCount: 200,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  };

  beforeEach(() => {
    // Always reset before each test to ensure clean singleton state
    GraphManager.reset();
  });

  afterEach(() => {
    GraphManager.reset();
  });

  describe('init() and getInstance()', () => {
    it('should create singleton on init()', () => {
      expect(GraphManager.isInitialized()).toBe(false);

      GraphManager.init({});
      expect(GraphManager.isInitialized()).toBe(true);
    });

    it('should return same instance on multiple getInstance() calls', () => {
      GraphManager.init({});
      const instance1 = GraphManager.getInstance();
      const instance2 = GraphManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should throw on getInstance() before init()', () => {
      expect(() => GraphManager.getInstance()).toThrow('[GraphManager] getInstance() called before init()');
    });

    it('should warn on init() after already initialized', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      GraphManager.init({});
      GraphManager.init({});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GraphManager] init() called after already initialized')
      );

      warnSpy.mockRestore();
    });

    it('should retain first instance on subsequent init() calls', () => {
      GraphManager.init({ cache: defaultCacheConfig });
      const firstInstance = GraphManager.getInstance();

      GraphManager.init({});
      const secondInstance = GraphManager.getInstance();

      expect(firstInstance).toBe(secondInstance);
    });
  });

  describe('reset()', () => {
    it('should allow re-initialization after reset()', () => {
      GraphManager.init({});
      GraphManager.reset();

      expect(GraphManager.isInitialized()).toBe(false);

      GraphManager.init({});
      expect(GraphManager.isInitialized()).toBe(true);
    });

    it('should throw on getInstance() after reset() without re-init', () => {
      GraphManager.init({});
      GraphManager.reset();

      expect(() => GraphManager.getInstance()).toThrow();
    });
  });

  describe('cache integration', () => {
    it('should create CacheManager when cache config is provided', () => {
      GraphManager.init({ cache: defaultCacheConfig });

      const manager = GraphManager.getInstance();
      expect(manager.isCachingEnabled()).toBe(true);
      expect(manager.getCacheManager()).not.toBeNull();
    });

    it('should not create CacheManager when cache config is omitted', () => {
      GraphManager.init({});

      const manager = GraphManager.getInstance();
      expect(manager.isCachingEnabled()).toBe(false);
      expect(manager.getCacheManager()).toBeNull();
    });

    it('should return config via getConfig()', () => {
      GraphManager.init({ cache: defaultCacheConfig });

      const manager = GraphManager.getInstance();
      expect(manager.getConfig()).toEqual({ cache: defaultCacheConfig });
    });

    it('should return empty config when no cache provided', () => {
      GraphManager.init({});

      const manager = GraphManager.getInstance();
      expect(manager.getConfig()).toEqual({});
    });
  });

  describe('isInitialized()', () => {
    it('should return false before init()', () => {
      expect(GraphManager.isInitialized()).toBe(false);
    });

    it('should return true after init()', () => {
      GraphManager.init({});
      expect(GraphManager.isInitialized()).toBe(true);
    });

    it('should return false after reset()', () => {
      GraphManager.init({});
      GraphManager.reset();
      expect(GraphManager.isInitialized()).toBe(false);
    });
  });
});