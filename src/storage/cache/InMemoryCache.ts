import type { ICacheProvider } from './ICacheProvider';
import type { EvictionStrategy } from './CacheConfig';

/**
 * Internal node for the doubly linked list used in LRU/FIFO eviction.
 */
class CacheNode<T> {
  constructor(
    public key: string,
    public value: T,
    public prev: CacheNode<T> | null = null,
    public next: CacheNode<T> | null = null
  ) {}
}

/**
 * In-memory cache implementation with pluggable eviction strategy.
 *
 * Uses a doubly linked list + Map for O(1) get/set operations.
 * - LRU: Most recently accessed node is moved to head; tail is evicted.
 * - FIFO: Nodes are inserted at head; tail (oldest) is evicted.
 * - LFU: Tracks access count; node with lowest frequency is evicted.
 *
 * @example
 * ```typescript
 * const cache = new InMemoryCache<string>(3, 'LRU');
 * await cache.set('a', 'value-a');
 * await cache.set('b', 'value-b');
 * await cache.set('c', 'value-c');
 * await cache.set('d', 'value-d'); // 'a' is evicted (LRU)
 * ```
 */
export class InMemoryCache<T> implements ICacheProvider<T> {
  private readonly _maxSize: number;
  private readonly _strategy: EvictionStrategy;
  private readonly _map: Map<string, CacheNode<T>> = new Map();

  // Doubly linked list pointers for LRU/FIFO
  private _head: CacheNode<T> | null = null;
  private _tail: CacheNode<T> | null = null;

  // LFU tracking: key → access count
  private readonly _lfuCounts: Map<string, number> = new Map();

  constructor(maxSize: number, strategy: EvictionStrategy = 'LRU') {
    if (maxSize <= 0) {
      throw new Error(`maxSize must be a positive integer, got: ${maxSize}`);
    }
    this._maxSize = maxSize;
    this._strategy = strategy;
  }

  async get(id: string): Promise<T | undefined> {
    const node = this._map.get(id);
    if (!node) return undefined;

    // Update for LRU: move to head (most recently used)
    if (this._strategy === 'LRU') {
      this._moveToHead(node);
    }

    // Increment LFU counter
    if (this._strategy === 'LFU') {
      const count = (this._lfuCounts.get(id) ?? 0) + 1;
      this._lfuCounts.set(id, count);
    }

    return node.value;
  }

  async set(id: string, value: T): Promise<void> {
    // If key already exists, update value and move to head
    const existing = this._map.get(id);
    if (existing) {
      existing.value = value;
      if (this._strategy === 'LRU') {
        this._moveToHead(existing);
      }
      // LFU: increment on set as well
      if (this._strategy === 'LFU') {
        const count = (this._lfuCounts.get(id) ?? 0) + 1;
        this._lfuCounts.set(id, count);
      }
      return;
    }

    // Evict if at capacity
    if (this._map.size >= this._maxSize) {
      this._evict();
    }

    // Insert new node at head
    const node = new CacheNode(id, value);
    this._addToHead(node);
    this._map.set(id, node);
    this._lfuCounts.set(id, 1);
  }

  async has(id: string): Promise<boolean> {
    return this._map.has(id);
  }

  async invalidate(id: string): Promise<void> {
    const node = this._map.get(id);
    if (!node) return;

    this._removeNode(node);
    this._map.delete(id);
    this._lfuCounts.delete(id);
  }

  async invalidateAll(): Promise<void> {
    this._map.clear();
    this._head = null;
    this._tail = null;
    this._lfuCounts.clear();
  }

  async size(): Promise<number> {
    return this._map.size;
  }

  maxSize(): number {
    return this._maxSize;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Adds a node to the head of the doubly linked list.
   */
  private _addToHead(node: CacheNode<T>): void {
    node.next = this._head;
    node.prev = null;

    if (this._head) {
      this._head.prev = node;
    }
    this._head = node;

    if (!this._tail) {
      this._tail = node;
    }
  }

  /**
   * Moves an existing node to the head (most recently used).
   */
  private _moveToHead(node: CacheNode<T>): void {
    if (node === this._head) return;

    this._removeNode(node);
    node.next = this._head;
    node.prev = null;

    if (this._head) {
      this._head.prev = node;
    }
    this._head = node;

    if (!this._tail) {
      this._tail = node;
    }
  }

  /**
   * Removes a node from the doubly linked list.
   */
  private _removeNode(node: CacheNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      // node was head
      this._head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      // node was tail
      this._tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * Evicts one item based on the configured eviction strategy.
   */
  private _evict(): void {
    if (!this._tail || this._map.size === 0) return;

    switch (this._strategy) {
      case 'LRU':
      case 'FIFO': {
        // Both LRU and FIFO evict from the tail (oldest)
        const tailKey = this._tail.key;
        this._removeNode(this._tail);
        this._map.delete(tailKey);
        this._lfuCounts.delete(tailKey);
        break;
      }

      case 'LFU': {
        // Find the key with the lowest access count
        let minKey: string | null = null;
        let minCount = Infinity;

        for (const [key, count] of this._lfuCounts) {
          if (count < minCount) {
            minCount = count;
            minKey = key;
          }
        }

        if (minKey) {
          const node = this._map.get(minKey)!;
          this._removeNode(node);
          this._map.delete(minKey);
          this._lfuCounts.delete(minKey);
        }
        break;
      }
    }
  }
}