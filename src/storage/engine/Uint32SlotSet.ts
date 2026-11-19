/**
 * Compact dynamic `uint32` slot set with adaptive small/large representation,
 * O(1) swap-remove deletion, and zero-boxing typed-array slice iteration.
 *
 * @module storage/engine/Uint32SlotSet
 */

const SMALL_THRESHOLD = 32;

export class Uint32SlotSet {
  private _items: Uint32Array;
  private _size = 0;
  private _indexMap: Map<number, number> | null = null;

  constructor(initialCapacity = 4) {
    this._items = new Uint32Array(Math.max(4, initialCapacity));
  }

  get size(): number {
    return this._size;
  }

  /**
   * Returns a view of the active elements (`0 .. size - 1`).
   * Do not retain across mutations to this set.
   */
  rawSlice(): Uint32Array {
    return this._items.subarray(0, this._size);
  }

  has(slot: number): boolean {
    if (this._indexMap !== null) {
      return this._indexMap.has(slot);
    }
    const items = this._items;
    const len = this._size;
    for (let i = 0; i < len; i++) {
      if (items[i] === slot) return true;
    }
    return false;
  }

  add(slot: number): boolean {
    if (this._indexMap !== null) {
      if (this._indexMap.has(slot)) return false;
      const pos = this._size;
      if (pos >= this._items.length) {
        this._grow();
      }
      this._items[pos] = slot;
      this._indexMap.set(slot, pos);
      this._size = pos + 1;
      return true;
    }

    const len = this._size;
    const items = this._items;
    for (let i = 0; i < len; i++) {
      if (items[i] === slot) return false;
    }

    if (len >= SMALL_THRESHOLD) {
      this._promoteToIndexed();
      return this.add(slot);
    }

    if (len >= items.length) {
      this._grow();
    }
    this._items[len] = slot;
    this._size = len + 1;
    return true;
  }

  delete(slot: number): boolean {
    if (this._indexMap !== null) {
      const pos = this._indexMap.get(slot);
      if (pos === undefined) return false;
      const lastIdx = --this._size;
      if (pos !== lastIdx) {
        const lastSlot = this._items[lastIdx];
        this._items[pos] = lastSlot;
        this._indexMap.set(lastSlot, pos);
      }
      this._indexMap.delete(slot);
      return true;
    }

    const len = this._size;
    const items = this._items;
    for (let i = 0; i < len; i++) {
      if (items[i] === slot) {
        const lastIdx = --this._size;
        if (i !== lastIdx) {
          items[i] = items[lastIdx];
        }
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this._size = 0;
    this._indexMap = null;
  }

  toArray(): number[] {
    const out = new Array<number>(this._size);
    const items = this._items;
    for (let i = 0; i < this._size; i++) {
      out[i] = items[i];
    }
    return out;
  }

  private _promoteToIndexed(): void {
    const map = new Map<number, number>();
    const items = this._items;
    for (let i = 0; i < this._size; i++) {
      map.set(items[i], i);
    }
    this._indexMap = map;
  }

  private _grow(): void {
    const next = new Uint32Array(this._items.length << 1);
    next.set(this._items);
    this._items = next;
  }

  /**
   * Intersects multiple `Uint32SlotSet`s smallest-set-first, returning matching slots.
   */
  static intersect(sets: readonly Uint32SlotSet[]): Uint32Array {
    if (sets.length === 0) return new Uint32Array(0);
    if (sets.length === 1) return sets[0].rawSlice();

    // Sort by size ascending so we iterate the smallest set
    const sorted = [...sets].sort((a, b) => a.size - b.size);
    const smallest = sorted[0];
    if (smallest.size === 0) return new Uint32Array(0);

    const out = new Uint32Array(smallest.size);
    let outLen = 0;
    const slice = smallest.rawSlice();

    for (let i = 0; i < slice.length; i++) {
      const slot = slice[i];
      let allMatch = true;
      for (let s = 1; s < sorted.length; s++) {
        if (!sorted[s].has(slot)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        out[outLen++] = slot;
      }
    }
    return out.subarray(0, outLen);
  }
}
