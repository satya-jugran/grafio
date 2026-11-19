/**
 * Power-of-two circular buffers providing O(1) push and shift without
 * array-head re-indexing overhead.
 *
 * @module cypher/executor/RingQueue
 */

export class RingQueue<T> {
  private _buf: (T | undefined)[];
  private _head = 0;
  private _tail = 0;
  private _size = 0;
  private _mask: number;

  constructor(initialCapacity = 64) {
    let cap = 16;
    while (cap < initialCapacity) cap <<= 1;
    this._buf = new Array<T | undefined>(cap);
    this._mask = cap - 1;
  }

  get length(): number {
    return this._size;
  }

  push(item: T): void {
    if (this._size === this._buf.length) {
      this._grow();
    }
    this._buf[this._tail] = item;
    this._tail = (this._tail + 1) & this._mask;
    this._size++;
  }

  shift(): T | undefined {
    if (this._size === 0) return undefined;
    const item = this._buf[this._head];
    this._buf[this._head] = undefined;
    this._head = (this._head + 1) & this._mask;
    this._size--;
    return item;
  }

  clear(): void {
    if (this._size > 0) {
      this._buf.fill(undefined);
    }
    this._head = 0;
    this._tail = 0;
    this._size = 0;
  }

  private _grow(): void {
    const oldLen = this._buf.length;
    const next = new Array<T | undefined>(oldLen << 1);
    for (let i = 0; i < this._size; i++) {
      next[i] = this._buf[(this._head + i) & this._mask];
    }
    this._buf = next;
    this._head = 0;
    this._tail = this._size;
    this._mask = next.length - 1;
  }
}

export class Uint32RingQueue {
  private _buf: Uint32Array;
  private _head = 0;
  private _tail = 0;
  private _size = 0;
  private _mask: number;

  constructor(initialCapacity = 128) {
    let cap = 32;
    while (cap < initialCapacity) cap <<= 1;
    this._buf = new Uint32Array(cap);
    this._mask = cap - 1;
  }

  get length(): number {
    return this._size;
  }

  push(value: number): void {
    if (this._size === this._buf.length) {
      this._grow();
    }
    this._buf[this._tail] = value;
    this._tail = (this._tail + 1) & this._mask;
    this._size++;
  }

  shift(): number {
    const val = this._buf[this._head];
    this._head = (this._head + 1) & this._mask;
    this._size--;
    return val;
  }

  clear(): void {
    this._head = 0;
    this._tail = 0;
    this._size = 0;
  }

  private _grow(): void {
    const oldLen = this._buf.length;
    const next = new Uint32Array(oldLen << 1);
    for (let i = 0; i < this._size; i++) {
      next[i] = this._buf[(this._head + i) & this._mask];
    }
    this._buf = next;
    this._head = 0;
    this._tail = this._size;
    this._mask = next.length - 1;
  }
}
