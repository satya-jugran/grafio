/**
 * Bidirectional string ↔ dense integer ID interning dictionary with 64-bit
 * bitmask support for fast label and edge-type matching.
 *
 * @module storage/engine/StringDictionary
 */

export interface Bitmask64Query {
  lo: number;
  hi: number;
  overflowIds?: number[];
}

export class StringDictionary {
  private readonly _strToId = new Map<string, number>();
  private readonly _idToStr: string[] = [];

  /** Returns the total number of interned strings. */
  get size(): number {
    return this._idToStr.length;
  }

  /** Interns `value` and returns its dense integer ID (`0, 1, ...`). */
  intern(value: string): number {
    const existing = this._strToId.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const id = this._idToStr.length;
    this._strToId.set(value, id);
    this._idToStr.push(value);
    return id;
  }

  /** Returns the dense integer ID for `value`, or `-1` if not yet interned. */
  lookup(value: string): number {
    const id = this._strToId.get(value);
    return id !== undefined ? id : -1;
  }

  /** Returns the string associated with `id`. */
  getString(id: number): string {
    return this._idToStr[id];
  }

  /** Clears all interned entries. */
  clear(): void {
    this._strToId.clear();
    this._idToStr.length = 0;
  }

  /**
   * Computes a 64-bit `[lo, hi]` bitmask across all IDs `< 64` in `ids`.
   */
  static computeMask64(ids: readonly number[]): [number, number] {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id < 32) {
        lo = (lo | (1 << id)) >>> 0;
      } else if (id < 64) {
        hi = (hi | (1 << (id - 32))) >>> 0;
      }
    }
    return [lo, hi];
  }

  /**
   * Builds a `Bitmask64Query` for matching ANY of the given label/type names.
   * Returns `null` if none of the names have ever been interned (guaranteed zero matches).
   */
  buildQueryMask(names: readonly string[]): Bitmask64Query | null {
    let lo = 0;
    let hi = 0;
    let overflowIds: number[] | undefined;
    let anyKnown = false;

    for (let i = 0; i < names.length; i++) {
      const id = this.lookup(names[i]);
      if (id < 0) continue;
      anyKnown = true;
      if (id < 32) {
        lo = (lo | (1 << id)) >>> 0;
      } else if (id < 64) {
        hi = (hi | (1 << (id - 32))) >>> 0;
      } else {
        if (!overflowIds) overflowIds = [];
        overflowIds.push(id);
      }
    }

    if (!anyKnown) return null;
    return { lo, hi, overflowIds };
  }

  /**
   * Checks whether an entity's 64-bit mask (and optional full ID list when overflow
   * IDs exist) satisfies a `Bitmask64Query` (OR semantics).
   */
  static matchesQuery(
    entityLo: number,
    entityHi: number,
    query: Bitmask64Query,
    entityIds?: readonly number[],
  ): boolean {
    if (((entityLo & query.lo) | (entityHi & query.hi)) !== 0) {
      return true;
    }
    if (query.overflowIds && entityIds) {
      const overflow = query.overflowIds;
      for (let i = 0; i < overflow.length; i++) {
        if (entityIds.includes(overflow[i])) {
          return true;
        }
      }
    }
    return false;
  }
}
