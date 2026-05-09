import type { ICacheProvider } from './ICacheProvider';

/**
 * Redis-backed cache implementation.
 *
 * Uses Redis data structures as follows:
 * - Individual entries: `grafio:{type}:{graphId}:{id}` → JSON serialized value
 * - GraphId LRU tracking: `grafio:meta:graphids` (sorted set, score = lastAccessed ms)
 * - TTL: propagated via `PEXPIRE` on each key
 *
 * The `ioredis` package is a peer dependency. It is loaded dynamically only when
 * `cacheStore: 'redis'` is configured, so consumers not using Redis are not affected.
 *
 * @example
 * ```typescript
 * const cache = new RedisCache('redis://localhost:6379', 10000, 'nodes');
 * await cache.set('tenant-a:node-1', { id: 'node-1', type: 'Person', properties: {} });
 * ```
 */
export class RedisCache<T> implements ICacheProvider<T> {
  private readonly _redisUrl: string;
  private readonly _maxSize: number;
  private readonly _type: 'nodes' | 'edges';
  private readonly _ttlMs: number | undefined;

  // Dynamically loaded Redis client - typed as any to avoid compile-time dependency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _redis: any = null;
  private _redisReady = false;

  // In-memory size tracking (Redis doesn't expose key count efficiently)
  private _size = 0;

  constructor(
    redisUrl: string,
    maxSize: number,
    type: 'nodes' | 'edges' = 'nodes',
    ttlMs?: number
  ) {
    this._redisUrl = redisUrl;
    this._maxSize = maxSize;
    this._type = type;
    this._ttlMs = ttlMs;
  }

  // ─── Lazy initialization ───────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _ensureRedis(): Promise<any> {
    if (this._redis && this._redisReady) {
      return this._redis;
    }

    // Dynamically import ioredis (peer dependency) using require to avoid
    // TypeScript module resolution issues with optional peer dependencies
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    this._redis = new Redis(this._redisUrl);

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      if (!this._redis) return reject(new Error('Redis client not initialized'));

      this._redis.once('ready', () => {
        this._redisReady = true;
        resolve();
      });

      this._redis.once('error', (err: Error) => {
        reject(err);
      });
    });

    return this._redis;
  }

  // ─── Key helpers ────────────────────────────────────────────────────────────

  private _key(graphId: string, id: string): string {
    return `grafio:${this._type}:${graphId}:${id}`;
  }

  private _metaKey(): string {
    return `grafio:meta:graphids`;
  }

  // ─── ICacheProvider implementation ─────────────────────────────────────────

  async get(id: string): Promise<T | undefined> {
    const redis = await this._ensureRedis();
    const raw = await redis.get(id);

    if (!raw) return undefined;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(id: string, value: T): Promise<void> {
    const redis = await this._ensureRedis();
    const serialized = JSON.stringify(value);

    // Check if this is a new key (for size tracking)
    const exists = await redis.exists(id);
    if (!exists) {
      // Enforce capacity
      if (this._size >= this._maxSize) {
        await this._evictOne();
      }
      this._size++;
    }

    // Set the value with optional TTL
    if (this._ttlMs) {
      await redis.set(id, serialized, 'PX', this._ttlMs);
    } else {
      await redis.set(id, serialized);
    }

    // Update graphId LRU score
    const graphId = this._extractGraphId(id);
    if (graphId) {
      await redis.zadd(this._metaKey(), Date.now(), graphId);
    }
  }

  async has(id: string): Promise<boolean> {
    const redis = await this._ensureRedis();
    const result = await redis.exists(id);
    return result === 1;
  }

  async invalidate(id: string): Promise<void> {
    const redis = await this._ensureRedis();
    const existed = await redis.exists(id);

    await redis.del(id);

    if (existed) {
      this._size = Math.max(0, this._size - 1);
    }
  }

  async invalidateAll(): Promise<void> {
    const redis = await this._ensureRedis();

    // Delete all keys matching our pattern
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `grafio:${this._type}:*`, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');

    this._size = 0;
  }

  async invalidateByPrefix(prefix: string): Promise<void> {
    const redis = await this._ensureRedis();

    // Convert CacheManager prefix (e.g., "graph-a:") to Redis pattern
    // Redis key format: grafio:{type}:{graphId}:{id}
    // CacheManager passes prefix like "graph-a:" which is the graphId portion
    // We need to match "grafio:{type}:graph-a:*"
    let pattern: string;
    if (prefix.includes('grafio:')) {
      // Already a full Redis key pattern
      pattern = prefix + '*';
    } else {
      // Assume it's just the graphId portion
      // Remove trailing colon if present
      const cleanPrefix = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix;
      pattern = `grafio:${this._type}:${cleanPrefix}:*`;
    }

    let cursor = '0';
    let deletedCount = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');

    this._size = Math.max(0, this._size - deletedCount);
  }

  async size(): Promise<number> {
    return this._size;
  }

  maxSize(): number {
    return this._maxSize;
  }

  async getAll(prefix: string, limit?: number): Promise<T[]> {
    const redis = await this._ensureRedis();
    const results: T[] = [];
    const limitNum = limit ?? Infinity;

    // prefix format: "graphId:" → need to translate to redis pattern "grafio:{type}:{graphId}:*"
    const redisPattern = this._prefixToRedisPattern(prefix);

    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', redisPattern, 'COUNT', 100);
      cursor = nextCursor;

      for (const key of keys) {
        if (results.length >= limitNum) break;
        const raw = await redis.get(key);
        if (raw) {
          try {
            results.push(JSON.parse(raw) as T);
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } while (cursor !== '0' && results.length < limitNum);

    return results;
  }

  async count(prefix: string): Promise<number> {
    const redis = await this._ensureRedis();
    const redisPattern = this._prefixToRedisPattern(prefix);

    let count = 0;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', redisPattern, 'COUNT', 100);
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');

    return count;
  }

  /**
   * Translates a cache prefix (e.g. "graph-a:") to a Redis key pattern.
   * Cache prefix: "{graphId}:"
   * Redis key: "grafio:{type}:{graphId}:*"
   */
  private _prefixToRedisPattern(prefix: string): string {
    // prefix is like "graph-a:" → extract graphId
    const graphId = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix;
    return `grafio:${this._type}:${graphId}:*`;
  }

  // ─── Adjacency index (for edge lookups by source/target) ──────────────────

  /**
   * Redis key for adjacency set.
   * Format: grafio:adj:{direction}:{graphId}:{nodeId}
   */
  private _adjKey(graphId: string, direction: 'source' | 'target', nodeId: string): string {
    return `grafio:adj:${direction}:${graphId}:${nodeId}`;
  }

  async addToAdjacencyIndex(graphId: string, direction: 'source' | 'target', nodeId: string, edgeId: string): Promise<void> {
    const redis = await this._ensureRedis();
    const key = this._adjKey(graphId, direction, nodeId);
    await redis.sadd(key, edgeId);
    if (this._ttlMs) {
      await redis.pexpire(key, this._ttlMs);
    }
  }

  async removeFromAdjacencyIndex(graphId: string, direction: 'source' | 'target', nodeId: string, edgeId: string): Promise<void> {
    const redis = await this._ensureRedis();
    const key = this._adjKey(graphId, direction, nodeId);
    await redis.srem(key, edgeId);
  }

  async getEdgesByAdjacencyIndex(graphId: string, direction: 'source' | 'target', nodeId: string): Promise<string[]> {
    const redis = await this._ensureRedis();
    const key = this._adjKey(graphId, direction, nodeId);
    return redis.smembers(key);
  }

  async invalidateAdjacencyIndex(graphId: string): Promise<void> {
    const redis = await this._ensureRedis();
    const pattern = `grafio:adj:*:${graphId}:*`;

    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Extracts the graphId from a cache key.
   * Key format: `grafio:{type}:{graphId}:{id}`
   */
  private _extractGraphId(key: string): string | null {
    const parts = key.split(':');
    // parts[0] = 'grafio', parts[1] = type, parts[2] = graphId
    if (parts.length >= 3 && parts[0] === 'grafio') {
      return parts[2];
    }
    return null;
  }

  /**
   * Evicts the least-recently-used graphId by finding the one with the oldest
   * lastAccessed timestamp in the sorted set, then deleting all its keys.
   */
  private async _evictOne(): Promise<void> {
    const redis = await this._ensureRedis();

    // Get the graphId with the oldest lastAccessed (lowest score)
    const [oldestGraphId] = await redis.zrange(this._metaKey(), 0, 0, 'WITHSCORES');

    if (!oldestGraphId) return;

    // Delete all keys for this graphId
    let cursor = '0';
    const pattern = `grafio:${this._type}:${oldestGraphId}:*`;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        this._size = Math.max(0, this._size - keys.length);
      }
    } while (cursor !== '0');

    // Remove from LRU tracking
    await redis.zrem(this._metaKey(), oldestGraphId);
  }
}