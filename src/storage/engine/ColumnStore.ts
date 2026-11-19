/**
 * Columnar TypedArray property store indexed by dense entity slot.
 *
 * Each property key is backed by an adaptive typed column:
 *  - `'untyped'` : `tags: Uint8Array` only (`0=absent`, `2=null`, `3=undefined`)
 *  - `'number'`  : `tags: Uint8Array` (`0=absent`, `1=value`, `2=null`, `3=undefined`) + `Float64Array`
 *  - `'boolean'` : `tags: Uint8Array` (`0=absent`, `1=false`, `2=true`, `3=null`, `4=undefined`)
 *  - `'string'`  : `tags: Uint8Array` + `string[]`
 *  - `'mixed'`   : `tags: Uint8Array` + `unknown[]` (auto-promoted when a key stores multiple value types)
 *
 * Per-slot property presence masks (`slotMaskLo`, `slotMaskHi` + sparse overflow list
 * for keyId >= 64) allow O(keys on slot) record materialization without scanning all columns.
 *
 * @module storage/engine/ColumnStore
 */

import { StringDictionary } from './StringDictionary';

export const TAG_ABSENT = 0;
export const TAG_VALUE = 1;
export const TAG_NULL = 2;
export const TAG_UNDEF = 3;

// Boolean column tag encoding
export const BOOL_ABSENT = 0;
export const BOOL_FALSE = 1;
export const BOOL_TRUE = 2;
export const BOOL_NULL = 3;
export const BOOL_UNDEF = 4;

export type ColumnKind = 'untyped' | 'number' | 'boolean' | 'string' | 'mixed';

const EMPTY_RECORD: Readonly<Record<string, unknown>> = Object.freeze({});

export class PropertyColumn {
  kind: ColumnKind = 'untyped';
  tags: Uint8Array;
  numValues: Float64Array | null = null;
  strValues: (string | undefined)[] | null = null;
  mixedValues: unknown[] | null = null;

  constructor(capacity: number) {
    this.tags = new Uint8Array(capacity);
  }

  grow(newCapacity: number): void {
    const nextTags = new Uint8Array(newCapacity);
    nextTags.set(this.tags);
    this.tags = nextTags;

    if (this.numValues !== null) {
      const nextNum = new Float64Array(newCapacity);
      nextNum.set(this.numValues);
      this.numValues = nextNum;
    }
    if (this.strValues !== null) {
      this.strValues.length = newCapacity;
    }
    if (this.mixedValues !== null) {
      this.mixedValues.length = newCapacity;
    }
  }

  set(slot: number, value: unknown): void {
    const capacity = this.tags.length;

    if (value === null) {
      this.tags[slot] = this.kind === 'boolean' ? BOOL_NULL : TAG_NULL;
      return;
    }
    if (value === undefined) {
      this.tags[slot] = this.kind === 'boolean' ? BOOL_UNDEF : TAG_UNDEF;
      return;
    }

    const vtype = typeof value;

    if (this.kind === 'untyped') {
      if (vtype === 'number') {
        this.kind = 'number';
        this.numValues = new Float64Array(capacity);
        this.tags[slot] = TAG_VALUE;
        this.numValues[slot] = value as number;
        return;
      }
      if (vtype === 'boolean') {
        this._convertUntypedToBoolean();
        this.tags[slot] = (value as boolean) ? BOOL_TRUE : BOOL_FALSE;
        return;
      }
      if (vtype === 'string') {
        this.kind = 'string';
        this.strValues = new Array<string | undefined>(capacity);
        this.tags[slot] = TAG_VALUE;
        this.strValues[slot] = value as string;
        return;
      }
      this.kind = 'mixed';
      this.mixedValues = new Array<unknown>(capacity);
      this.tags[slot] = TAG_VALUE;
      this.mixedValues[slot] = value;
      return;
    }

    if (this.kind === 'number') {
      if (vtype === 'number') {
        this.tags[slot] = TAG_VALUE;
        this.numValues![slot] = value as number;
        return;
      }
      this._promoteToMixed();
      this.tags[slot] = TAG_VALUE;
      this.mixedValues![slot] = value;
      return;
    }

    if (this.kind === 'boolean') {
      if (vtype === 'boolean') {
        this.tags[slot] = (value as boolean) ? BOOL_TRUE : BOOL_FALSE;
        return;
      }
      this._promoteBooleanToMixed();
      this.tags[slot] = TAG_VALUE;
      this.mixedValues![slot] = value;
      return;
    }

    if (this.kind === 'string') {
      if (vtype === 'string') {
        this.tags[slot] = TAG_VALUE;
        this.strValues![slot] = value as string;
        return;
      }
      this._promoteToMixed();
      this.tags[slot] = TAG_VALUE;
      this.mixedValues![slot] = value;
      return;
    }

    // mixed
    this.tags[slot] = TAG_VALUE;
    this.mixedValues![slot] = value;
  }

  delete(slot: number): void {
    this.tags[slot] = TAG_ABSENT;
    if (this.strValues !== null) this.strValues[slot] = undefined;
    if (this.mixedValues !== null) this.mixedValues[slot] = undefined;
  }

  has(slot: number): boolean {
    return this.tags[slot] !== TAG_ABSENT;
  }

  get(slot: number): unknown {
    const tag = this.tags[slot];
    if (tag === TAG_ABSENT) return undefined;

    if (this.kind === 'boolean') {
      if (tag === BOOL_FALSE) return false;
      if (tag === BOOL_TRUE) return true;
      if (tag === BOOL_NULL) return null;
      return undefined;
    }

    if (tag === TAG_NULL) return null;
    if (tag === TAG_UNDEF) return undefined;

    if (this.kind === 'number') return this.numValues![slot];
    if (this.kind === 'string') return this.strValues![slot];
    if (this.kind === 'mixed') return this.mixedValues![slot];
    return undefined;
  }

  private _convertUntypedToBoolean(): void {
    // Remap TAG_NULL(2) -> BOOL_NULL(3), TAG_UNDEF(3) -> BOOL_UNDEF(4)
    const tags = this.tags;
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      if (t === TAG_NULL) tags[i] = BOOL_NULL;
      else if (t === TAG_UNDEF) tags[i] = BOOL_UNDEF;
    }
    this.kind = 'boolean';
  }

  private _promoteBooleanToMixed(): void {
    const len = this.tags.length;
    const mixed = new Array<unknown>(len);
    const tags = this.tags;
    for (let i = 0; i < len; i++) {
      const t = tags[i];
      if (t === BOOL_FALSE) {
        tags[i] = TAG_VALUE;
        mixed[i] = false;
      } else if (t === BOOL_TRUE) {
        tags[i] = TAG_VALUE;
        mixed[i] = true;
      } else if (t === BOOL_NULL) {
        tags[i] = TAG_NULL;
      } else if (t === BOOL_UNDEF) {
        tags[i] = TAG_UNDEF;
      }
    }
    this.kind = 'mixed';
    this.mixedValues = mixed;
  }

  private _promoteToMixed(): void {
    const len = this.tags.length;
    const mixed = new Array<unknown>(len);
    const tags = this.tags;
    if (this.kind === 'number' && this.numValues) {
      const nums = this.numValues;
      for (let i = 0; i < len; i++) {
        if (tags[i] === TAG_VALUE) mixed[i] = nums[i];
      }
      this.numValues = null;
    } else if (this.kind === 'string' && this.strValues) {
      const strs = this.strValues;
      for (let i = 0; i < len; i++) {
        if (tags[i] === TAG_VALUE) mixed[i] = strs[i];
      }
      this.strValues = null;
    }
    this.kind = 'mixed';
    this.mixedValues = mixed;
  }
}

export class ColumnStore {
  private _capacity: number;
  private readonly _keyDict: StringDictionary;
  private readonly _columns: PropertyColumn[] = [];

  private _slotMaskLo: Uint32Array;
  private _slotMaskHi: Uint32Array;
  private _slotOverflowKeys: (number[] | undefined)[];

  constructor(keyDict: StringDictionary, initialCapacity = 256) {
    this._keyDict = keyDict;
    this._capacity = initialCapacity;
    this._slotMaskLo = new Uint32Array(initialCapacity);
    this._slotMaskHi = new Uint32Array(initialCapacity);
    this._slotOverflowKeys = new Array<number[] | undefined>(initialCapacity);
  }

  get keyDict(): StringDictionary {
    return this._keyDict;
  }

  grow(newCapacity: number): void {
    if (newCapacity <= this._capacity) return;
    const nextLo = new Uint32Array(newCapacity);
    nextLo.set(this._slotMaskLo);
    this._slotMaskLo = nextLo;

    const nextHi = new Uint32Array(newCapacity);
    nextHi.set(this._slotMaskHi);
    this._slotMaskHi = nextHi;

    this._slotOverflowKeys.length = newCapacity;

    for (let i = 0; i < this._columns.length; i++) {
      this._columns[i].grow(newCapacity);
    }
    this._capacity = newCapacity;
  }

  getColumnByKeyId(keyId: number): PropertyColumn | undefined {
    return this._columns[keyId];
  }

  getColumn(key: string): PropertyColumn | undefined {
    const keyId = this._keyDict.lookup(key);
    return keyId >= 0 ? this._columns[keyId] : undefined;
  }

  private _ensureColumn(keyId: number): PropertyColumn {
    let col = this._columns[keyId];
    if (!col) {
      while (this._columns.length <= keyId) {
        this._columns.push(new PropertyColumn(this._capacity));
      }
      col = this._columns[keyId];
    }
    return col;
  }

  private _markKeyPresent(slot: number, keyId: number): void {
    if (keyId < 32) {
      this._slotMaskLo[slot] = (this._slotMaskLo[slot] | (1 << keyId)) >>> 0;
    } else if (keyId < 64) {
      this._slotMaskHi[slot] = (this._slotMaskHi[slot] | (1 << (keyId - 32))) >>> 0;
    } else {
      let arr = this._slotOverflowKeys[slot];
      if (!arr) {
        arr = [keyId];
        this._slotOverflowKeys[slot] = arr;
      } else if (!arr.includes(keyId)) {
        arr.push(keyId);
      }
    }
  }

  private _unmarkKeyPresent(slot: number, keyId: number): void {
    if (keyId < 32) {
      this._slotMaskLo[slot] = (this._slotMaskLo[slot] & ~(1 << keyId)) >>> 0;
    } else if (keyId < 64) {
      this._slotMaskHi[slot] = (this._slotMaskHi[slot] & ~(1 << (keyId - 32))) >>> 0;
    } else {
      const arr = this._slotOverflowKeys[slot];
      if (arr) {
        const idx = arr.indexOf(keyId);
        if (idx >= 0) {
          arr.splice(idx, 1);
          if (arr.length === 0) this._slotOverflowKeys[slot] = undefined;
        }
      }
    }
  }

  hasKey(keyId: number, slot: number): boolean {
    const col = this._columns[keyId];
    return col !== undefined && col.has(slot);
  }

  getValueByKeyId(keyId: number, slot: number): unknown {
    const col = this._columns[keyId];
    return col !== undefined ? col.get(slot) : undefined;
  }

  setValue(key: string, slot: number, value: unknown): number {
    const keyId = this._keyDict.intern(key);
    const col = this._ensureColumn(keyId);
    col.set(slot, value);
    this._markKeyPresent(slot, keyId);
    return keyId;
  }

  setValueByKeyId(keyId: number, slot: number, value: unknown): void {
    const col = this._ensureColumn(keyId);
    col.set(slot, value);
    this._markKeyPresent(slot, keyId);
  }

  deleteValueByKeyId(keyId: number, slot: number): void {
    const col = this._columns[keyId];
    if (!col) return;
    col.delete(slot);
    this._unmarkKeyPresent(slot, keyId);
  }

  setRecord(slot: number, props: Readonly<Record<string, unknown>>): void {
    for (const key in props) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        this.setValue(key, slot, props[key]);
      }
    }
  }

  clearSlot(slot: number): void {
    let lo = this._slotMaskLo[slot];
    while (lo !== 0) {
      const lsb = lo & -lo;
      const bit = 31 - Math.clz32(lsb);
      this._columns[bit]?.delete(slot);
      lo = (lo ^ lsb) >>> 0;
    }
    this._slotMaskLo[slot] = 0;

    let hi = this._slotMaskHi[slot];
    while (hi !== 0) {
      const lsb = hi & -hi;
      const bit = 32 + (31 - Math.clz32(lsb));
      this._columns[bit]?.delete(slot);
      hi = (hi ^ lsb) >>> 0;
    }
    this._slotMaskHi[slot] = 0;

    const overflow = this._slotOverflowKeys[slot];
    if (overflow) {
      for (let i = 0; i < overflow.length; i++) {
        this._columns[overflow[i]]?.delete(slot);
      }
      this._slotOverflowKeys[slot] = undefined;
    }
  }

  materializeRecord(slot: number): Readonly<Record<string, unknown>> {
    let lo = this._slotMaskLo[slot];
    let hi = this._slotMaskHi[slot];
    const overflow = this._slotOverflowKeys[slot];
    if (lo === 0 && hi === 0 && !overflow) {
      return EMPTY_RECORD;
    }

    const out: Record<string, unknown> = {};
    while (lo !== 0) {
      const lsb = lo & -lo;
      const keyId = 31 - Math.clz32(lsb);
      out[this._keyDict.getString(keyId)] = this._columns[keyId].get(slot);
      lo = (lo ^ lsb) >>> 0;
    }
    while (hi !== 0) {
      const lsb = hi & -hi;
      const keyId = 32 + (31 - Math.clz32(lsb));
      out[this._keyDict.getString(keyId)] = this._columns[keyId].get(slot);
      hi = (hi ^ lsb) >>> 0;
    }
    if (overflow) {
      for (let i = 0; i < overflow.length; i++) {
        const keyId = overflow[i];
        out[this._keyDict.getString(keyId)] = this._columns[keyId].get(slot);
      }
    }
    return Object.freeze(out);
  }

  clearAll(): void {
    this._columns.length = 0;
    this._slotMaskLo.fill(0);
    this._slotMaskHi.fill(0);
    this._slotOverflowKeys.fill(undefined);
  }
}
