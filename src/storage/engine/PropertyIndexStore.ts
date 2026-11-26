/**
 * Opt-in, label/type-scoped property index store combining O(1) hash buckets
 * with lazily-rebuilt sorted key directories for O(log U + K) range queries
 * (`>`, `>=`, `<`, `<=`, `STARTS WITH`) and index-ordered top-K scans.
 *
 * @module storage/engine/PropertyIndexStore
 */

import type { IndexMetadata } from '../IStorageProvider';
import { Uint32SlotSet } from './Uint32SlotSet';
import type { SlotArena } from './SlotArena';

export type RangeOperator = '>' | '>=' | '<' | '<=' | 'STARTS_WITH';

class PropertyIndexEntry {
  readonly name: string;
  readonly target: 'node' | 'edge';
  readonly labelOrType: string | undefined;
  readonly labelOrTypeId: number | undefined;
  readonly propertyKeys: string[];
  readonly sortedKeys: string[];
  readonly compoundKeySig: string;
  readonly isCompound: boolean;

  // Hash buckets: primitive value (single) or canonical encoded tuple (compound) -> slots
  readonly buckets = new Map<unknown, Uint32SlotSet>();

  // Sorted range directories for single-property indexes (lazily refreshed when dirty)
  private _numKeysDirty = false;
  private _sortedNumbers: Float64Array = new Float64Array(0);
  private _strKeysDirty = false;
  private _sortedStrings: string[] = [];

  constructor(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
    labelOrTypeId?: number,
  ) {
    this.name = name;
    this.target = target;
    this.labelOrType = labelOrType;
    this.labelOrTypeId = labelOrTypeId;
    this.propertyKeys = [...propertyKeys];
    this.sortedKeys = [...propertyKeys].sort();
    this.compoundKeySig = this.sortedKeys.join('|');
    this.isCompound = propertyKeys.length > 1;
  }

  addSlot(slot: number, props: Readonly<Record<string, unknown>>): void {
    const bucketKey = this._extractKey(props);
    if (bucketKey === ABSENT_SENTINEL) return;

    let set = this.buckets.get(bucketKey);
    if (!set) {
      set = new Uint32SlotSet();
      this.buckets.set(bucketKey, set);
      if (!this.isCompound) {
        if (typeof bucketKey === 'number' && !Number.isNaN(bucketKey)) {
          this._numKeysDirty = true;
        } else if (typeof bucketKey === 'string') {
          this._strKeysDirty = true;
        }
      }
    }
    set.add(slot);
  }

  addSlotValue(slot: number, value: unknown): void {
    if (value === undefined) return;
    let set = this.buckets.get(value);
    if (!set) {
      set = new Uint32SlotSet();
      this.buckets.set(value, set);
      if (typeof value === 'number' && !Number.isNaN(value)) {
        this._numKeysDirty = true;
      } else if (typeof value === 'string') {
        this._strKeysDirty = true;
      }
    }
    set.add(slot);
  }

  removeSlotValue(slot: number, value: unknown): void {
    if (value === undefined) return;
    const set = this.buckets.get(value);
    if (!set) return;
    set.delete(slot);
    if (set.size === 0) {
      this.buckets.delete(value);
      if (typeof value === 'number') this._numKeysDirty = true;
      else if (typeof value === 'string') this._strKeysDirty = true;
    }
  }

  removeSlot(slot: number, props: Readonly<Record<string, unknown>>): void {
    const bucketKey = this._extractKey(props);
    if (bucketKey === ABSENT_SENTINEL) return;
    const set = this.buckets.get(bucketKey);
    if (!set) return;
    set.delete(slot);
    if (set.size === 0) {
      this.buckets.delete(bucketKey);
      if (!this.isCompound) {
        if (typeof bucketKey === 'number') this._numKeysDirty = true;
        else if (typeof bucketKey === 'string') this._strKeysDirty = true;
      }
    }
  }

  lookupExact(value: unknown): Uint32SlotSet | undefined {
    return this.buckets.get(value);
  }

  lookupCompound(values: Readonly<Record<string, unknown>>): Uint32SlotSet | undefined {
    const key = encodeCompoundTuple(this.sortedKeys, values);
    if (key === ABSENT_SENTINEL) return undefined;
    return this.buckets.get(key);
  }

  /**
   * Executes a range lookup over distinct sorted keys using binary search.
   */
  lookupRange(op: RangeOperator, value: unknown, limit?: number, desc = false): Uint32Array {
    if (this.isCompound) return new Uint32Array(0);

    if (op === 'STARTS_WITH') {
      if (typeof value !== 'string') return new Uint32Array(0);
      this._ensureSortedStrings();
      const strs = this._sortedStrings;
      if (strs.length === 0) return new Uint32Array(0);

      const lo = lowerBoundStr(strs, value);
      const out: number[] = [];
      for (let i = lo; i < strs.length; i++) {
        if (!strs[i].startsWith(value)) break;
        const set = this.buckets.get(strs[i]);
        if (set) {
          const slice = set.rawSlice();
          for (let j = 0; j < slice.length; j++) {
            out.push(slice[j]);
            if (limit !== undefined && out.length >= limit) return Uint32Array.from(out);
          }
        }
      }
      return Uint32Array.from(out);
    }

    if (typeof value === 'number' && !Number.isNaN(value)) {
      this._ensureSortedNumbers();
      const nums = this._sortedNumbers;
      if (nums.length === 0) return new Uint32Array(0);

      let startIdx = 0;
      let endIdx = nums.length;
      switch (op) {
        case '>': startIdx = upperBoundNum(nums, value); break;
        case '>=': startIdx = lowerBoundNum(nums, value); break;
        case '<': endIdx = lowerBoundNum(nums, value); break;
        case '<=': endIdx = upperBoundNum(nums, value); break;
      }
      if (startIdx >= endIdx) return new Uint32Array(0);

      const out: number[] = [];
      if (!desc) {
        for (let i = startIdx; i < endIdx; i++) {
          const set = this.buckets.get(nums[i]);
          if (set) {
            const slice = set.rawSlice();
            for (let j = 0; j < slice.length; j++) {
              out.push(slice[j]);
              if (limit !== undefined && out.length >= limit) return Uint32Array.from(out);
            }
          }
        }
      } else {
        for (let i = endIdx - 1; i >= startIdx; i--) {
          const set = this.buckets.get(nums[i]);
          if (set) {
            const slice = set.rawSlice();
            for (let j = 0; j < slice.length; j++) {
              out.push(slice[j]);
              if (limit !== undefined && out.length >= limit) return Uint32Array.from(out);
            }
          }
        }
      }
      return Uint32Array.from(out);
    }

    if (typeof value === 'string') {
      this._ensureSortedStrings();
      const strs = this._sortedStrings;
      if (strs.length === 0) return new Uint32Array(0);

      let startIdx = 0;
      let endIdx = strs.length;
      switch (op) {
        case '>': startIdx = upperBoundStr(strs, value); break;
        case '>=': startIdx = lowerBoundStr(strs, value); break;
        case '<': endIdx = lowerBoundStr(strs, value); break;
        case '<=': endIdx = upperBoundStr(strs, value); break;
      }
      if (startIdx >= endIdx) return new Uint32Array(0);

      const out: number[] = [];
      if (!desc) {
        for (let i = startIdx; i < endIdx; i++) {
          const set = this.buckets.get(strs[i]);
          if (set) {
            const slice = set.rawSlice();
            for (let j = 0; j < slice.length; j++) {
              out.push(slice[j]);
              if (limit !== undefined && out.length >= limit) return Uint32Array.from(out);
            }
          }
        }
      } else {
        for (let i = endIdx - 1; i >= startIdx; i--) {
          const set = this.buckets.get(strs[i]);
          if (set) {
            const slice = set.rawSlice();
            for (let j = 0; j < slice.length; j++) {
              out.push(slice[j]);
              if (limit !== undefined && out.length >= limit) return Uint32Array.from(out);
            }
          }
        }
      }
      return Uint32Array.from(out);
    }

    return new Uint32Array(0);
  }

  private _ensureSortedNumbers(): void {
    if (!this._numKeysDirty) return;
    const nums: number[] = [];
    for (const key of this.buckets.keys()) {
      if (typeof key === 'number' && !Number.isNaN(key)) nums.push(key);
    }
    const arr = Float64Array.from(nums);
    arr.sort();
    this._sortedNumbers = arr;
    this._numKeysDirty = false;
  }

  private _ensureSortedStrings(): void {
    if (!this._strKeysDirty) return;
    const strs: string[] = [];
    for (const key of this.buckets.keys()) {
      if (typeof key === 'string') strs.push(key);
    }
    strs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    this._sortedStrings = strs;
    this._strKeysDirty = false;
  }

  private _extractKey(props: Readonly<Record<string, unknown>>): unknown {
    if (!this.isCompound) {
      const key = this.propertyKeys[0];
      if (!Object.prototype.hasOwnProperty.call(props, key)) return ABSENT_SENTINEL;
      const val = props[key];
      return val === undefined ? ABSENT_SENTINEL : val;
    }
    return encodeCompoundTuple(this.sortedKeys, props);
  }
}

const ABSENT_SENTINEL = Symbol('ABSENT');

function encodeCompoundTuple(
  sortedKeys: readonly string[],
  props: Readonly<Record<string, unknown>>,
): string | typeof ABSENT_SENTINEL {
  let encoded = '';
  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    if (!Object.prototype.hasOwnProperty.call(props, key)) return ABSENT_SENTINEL;
    const val = props[key];
    if (val === undefined) return ABSENT_SENTINEL;
    if (i > 0) encoded += '|';
    if (val === null) encoded += 'z';
    else if (typeof val === 'boolean') encoded += val ? 'b1' : 'b0';
    else if (typeof val === 'number') encoded += 'n' + String(val);
    else if (typeof val === 'string') encoded += 's' + val.length + ':' + val;
    else encoded += 'o' + String(val);
  }
  return encoded;
}

function lowerBoundNum(arr: Float64Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundNum(arr: Float64Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lowerBoundStr(arr: string[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundStr(arr: string[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class PropertyIndexStore {
  private readonly _namedIndexes = new Map<string, PropertyIndexEntry>();
  private readonly _nodeIndexesByPropKey = new Map<string, PropertyIndexEntry[]>();
  private readonly _edgeIndexesByPropKey = new Map<string, PropertyIndexEntry[]>();
  private _indexEpoch = 0;

  get indexEpoch(): number {
    return this._indexEpoch;
  }

  get hasAnyNodeIndexes(): boolean {
    return this._nodeIndexesByPropKey.size > 0;
  }

  get hasAnyEdgeIndexes(): boolean {
    return this._edgeIndexesByPropKey.size > 0;
  }

  createIndex(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    arena: SlotArena,
    labelOrType?: string,
  ): void {
    if (propertyKeys.length === 0) return;

    if (this._namedIndexes.has(name)) {
      throw new Error(`Index with name '${name}' already exists`);
    }

    const sortedKeys = [...propertyKeys].sort();
    const compoundSig = sortedKeys.join('|');

    for (const existing of this._namedIndexes.values()) {
      if (
        existing.target === target &&
        existing.compoundKeySig === compoundSig &&
        existing.labelOrType === labelOrType
      ) {
        throw new Error(
          `Index on ${target}${labelOrType ? `:${labelOrType}` : ''} property [${sortedKeys.join(', ')}] already exists`,
        );
      }
    }

    let labelOrTypeId: number | undefined;
    if (labelOrType !== undefined) {
      labelOrTypeId = target === 'node'
        ? arena.labelDict.intern(labelOrType)
        : arena.edgeTypeDict.intern(labelOrType);
    }

    const entry = new PropertyIndexEntry(name, target, propertyKeys, labelOrType, labelOrTypeId);
    this._namedIndexes.set(name, entry);

    const byKeyMap = target === 'node' ? this._nodeIndexesByPropKey : this._edgeIndexesByPropKey;
    for (const k of propertyKeys) {
      let list = byKeyMap.get(k);
      if (!list) {
        list = [];
        byKeyMap.set(k, list);
      }
      list.push(entry);
    }

    // Backfill existing alive entities
    if (target === 'node') {
      const high = arena.nodeHighWater;
      for (let slot = 0; slot < high; slot++) {
        if (arena.nodeAlive[slot] === 0) continue;
        if (labelOrTypeId !== undefined && !arena.nodeLabelIds[slot].includes(labelOrTypeId)) {
          continue;
        }
        const props = arena.nodeColumns.materializeRecord(slot);
        entry.addSlot(slot, props);
      }
    } else {
      const high = arena.edgeHighWater;
      for (let slot = 0; slot < high; slot++) {
        if (arena.edgeAlive[slot] === 0) continue;
        if (labelOrTypeId !== undefined && arena.edgeTypeId[slot] !== labelOrTypeId) {
          continue;
        }
        const props = arena.edgeColumns.materializeRecord(slot);
        entry.addSlot(slot, props);
      }
    }

    this._indexEpoch++;
  }

  deleteIndex(name: string): void {
    const entry = this._namedIndexes.get(name);
    if (!entry) {
      throw new Error(`Index with name '${name}' does not exist`);
    }

    this._namedIndexes.delete(name);
    const byKeyMap = entry.target === 'node' ? this._nodeIndexesByPropKey : this._edgeIndexesByPropKey;
    for (const k of entry.propertyKeys) {
      const list = byKeyMap.get(k);
      if (list) {
        const idx = list.indexOf(entry);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) byKeyMap.delete(k);
      }
    }
    entry.buckets.clear();
    this._indexEpoch++;
  }

  hasIndex(target: 'node' | 'edge', propertyKeys: string[], labelOrType?: string): boolean {
    if (propertyKeys.length === 0) return false;
    const sortedQuery = [...propertyKeys].sort().join('|');
    for (const idx of this._namedIndexes.values()) {
      if (idx.target !== target) continue;
      if (idx.labelOrType !== undefined && idx.labelOrType !== labelOrType) continue;
      if (idx.compoundKeySig === sortedQuery) return true;
    }
    return false;
  }

  getIndex(name: string): IndexMetadata | undefined {
    const entry = this._namedIndexes.get(name);
    if (!entry) return undefined;
    return {
      name: entry.name,
      target: entry.target,
      propertyKeys: [...entry.sortedKeys],
      ...(entry.labelOrType !== undefined ? { labelOrType: entry.labelOrType } : {}),
    };
  }

  getIndexes(): IndexMetadata[] {
    const out: IndexMetadata[] = [];
    for (const entry of this._namedIndexes.values()) {
      out.push({
        name: entry.name,
        target: entry.target,
        propertyKeys: [...entry.sortedKeys],
        ...(entry.labelOrType !== undefined ? { labelOrType: entry.labelOrType } : {}),
      });
    }
    return out;
  }

  // ── Index Maintenance Hooks ───────────────────────────────────────────────

  onNodeInserted(slot: number, labelIds: readonly number[], props: Readonly<Record<string, unknown>>): void {
    if (this._nodeIndexesByPropKey.size === 0) return;
    const visited = new Set<PropertyIndexEntry>();
    for (const key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      const list = this._nodeIndexesByPropKey.get(key);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        if (visited.has(idx)) continue;
        visited.add(idx);
        if (idx.labelOrTypeId !== undefined && !labelIds.includes(idx.labelOrTypeId)) {
          continue;
        }
        idx.addSlot(slot, props);
      }
    }
  }

  onNodeDeleted(slot: number, labelIds: readonly number[], props: Readonly<Record<string, unknown>>): void {
    if (this._nodeIndexesByPropKey.size === 0) return;
    const visited = new Set<PropertyIndexEntry>();
    for (const key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      const list = this._nodeIndexesByPropKey.get(key);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        if (visited.has(idx)) continue;
        visited.add(idx);
        if (idx.labelOrTypeId !== undefined && !labelIds.includes(idx.labelOrTypeId)) {
          continue;
        }
        idx.removeSlot(slot, props);
      }
    }
  }

  onNodeLabelsRemoved(slot: number, removedLabelIds: readonly number[], props: Readonly<Record<string, unknown>>): void {
    if (this._nodeIndexesByPropKey.size === 0 || removedLabelIds.length === 0) return;
    for (const idx of this._namedIndexes.values()) {
      if (idx.target !== 'node' || idx.labelOrTypeId === undefined) continue;
      if (removedLabelIds.includes(idx.labelOrTypeId)) {
        idx.removeSlot(slot, props);
      }
    }
  }

  onNodeLabelsAdded(slot: number, addedLabelIds: readonly number[], props: Readonly<Record<string, unknown>>): void {
    if (this._nodeIndexesByPropKey.size === 0 || addedLabelIds.length === 0) return;
    for (const idx of this._namedIndexes.values()) {
      if (idx.target !== 'node' || idx.labelOrTypeId === undefined) continue;
      if (addedLabelIds.includes(idx.labelOrTypeId)) {
        idx.addSlot(slot, props);
      }
    }
  }

  onNodePropertiesUpdated(
    slot: number,
    labelIds: readonly number[],
    oldProps: Readonly<Record<string, unknown>>,
    newProps: Readonly<Record<string, unknown>>,
    changedKeys?: readonly string[],
  ): void {
    if (this._nodeIndexesByPropKey.size === 0) return;
    const visited = new Set<PropertyIndexEntry>();
    const keys = changedKeys ?? Object.keys({ ...oldProps, ...newProps });
    for (let k = 0; k < keys.length; k++) {
      const list = this._nodeIndexesByPropKey.get(keys[k]);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        if (visited.has(idx)) continue;
        visited.add(idx);
        if (idx.labelOrTypeId !== undefined && !labelIds.includes(idx.labelOrTypeId)) {
          continue;
        }
        if (!idx.isCompound) {
          const pk = idx.propertyKeys[0];
          const hadOld = Object.prototype.hasOwnProperty.call(oldProps, pk);
          const hasNew = Object.prototype.hasOwnProperty.call(newProps, pk);
          const oldVal = hadOld ? oldProps[pk] : undefined;
          const newVal = hasNew ? newProps[pk] : undefined;
          if (oldVal !== newVal || hadOld !== hasNew) {
            if (hadOld) idx.removeSlotValue(slot, oldVal);
            if (hasNew) idx.addSlotValue(slot, newVal);
          }
        } else {
          idx.removeSlot(slot, oldProps);
          idx.addSlot(slot, newProps);
        }
      }
    }
  }

  onEdgeInserted(slot: number, typeId: number, props: Readonly<Record<string, unknown>>): void {
    if (this._edgeIndexesByPropKey.size === 0) return;
    const visited = new Set<PropertyIndexEntry>();
    for (const key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      const list = this._edgeIndexesByPropKey.get(key);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        if (visited.has(idx)) continue;
        visited.add(idx);
        if (idx.labelOrTypeId !== undefined && idx.labelOrTypeId !== typeId) continue;
        idx.addSlot(slot, props);
      }
    }
  }

  onEdgeDeleted(slot: number, typeId: number, props: Readonly<Record<string, unknown>>): void {
    if (this._edgeIndexesByPropKey.size === 0) return;
    const visited = new Set<PropertyIndexEntry>();
    for (const key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      const list = this._edgeIndexesByPropKey.get(key);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        if (visited.has(idx)) continue;
        visited.add(idx);
        if (idx.labelOrTypeId !== undefined && idx.labelOrTypeId !== typeId) continue;
        idx.removeSlot(slot, props);
      }
    }
  }

  onEdgePropertiesUpdated(
    slot: number,
    typeId: number,
    oldProps: Readonly<Record<string, unknown>>,
    newProps: Readonly<Record<string, unknown>>,
    changedKeys?: readonly string[],
  ): void {
    if (this._edgeIndexesByPropKey.size === 0) return;
    const visited = new Set<PropertyIndexEntry>();
    const keys = changedKeys ?? Object.keys({ ...oldProps, ...newProps });
    for (let k = 0; k < keys.length; k++) {
      const list = this._edgeIndexesByPropKey.get(keys[k]);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const idx = list[i];
        if (visited.has(idx)) continue;
        visited.add(idx);
        if (idx.labelOrTypeId !== undefined && idx.labelOrTypeId !== typeId) continue;
        if (!idx.isCompound) {
          const pk = idx.propertyKeys[0];
          const hadOld = Object.prototype.hasOwnProperty.call(oldProps, pk);
          const hasNew = Object.prototype.hasOwnProperty.call(newProps, pk);
          const oldVal = hadOld ? oldProps[pk] : undefined;
          const newVal = hasNew ? newProps[pk] : undefined;
          if (oldVal !== newVal || hadOld !== hasNew) {
            if (hadOld) idx.removeSlotValue(slot, oldVal);
            if (hasNew) idx.addSlotValue(slot, newVal);
          }
        } else {
          idx.removeSlot(slot, oldProps);
          idx.addSlot(slot, newProps);
        }
      }
    }
  }

  // ── Index Lookup Helpers ──────────────────────────────────────────────────

  findSingleIndex(
    target: 'node' | 'edge',
    propertyKey: string,
    typesFilter?: readonly string[],
  ): PropertyIndexEntry | undefined {
    const byKeyMap = target === 'node' ? this._nodeIndexesByPropKey : this._edgeIndexesByPropKey;
    const list = byKeyMap.get(propertyKey);
    if (!list || list.length === 0) return undefined;

    const singleType = typesFilter && typesFilter.length === 1 ? typesFilter[0] : undefined;
    let fallbackUnscoped: PropertyIndexEntry | undefined;

    for (let i = 0; i < list.length; i++) {
      const idx = list[i];
      if (idx.isCompound) continue;
      if (idx.labelOrType !== undefined) {
        if (singleType !== undefined && idx.labelOrType === singleType) {
          return idx; // Prefer exact scoped index match
        }
      } else {
        fallbackUnscoped = idx;
      }
    }
    return fallbackUnscoped;
  }

  findCompoundIndex(
    target: 'node' | 'edge',
    eqKeys: readonly string[],
    typesFilter?: readonly string[],
  ): PropertyIndexEntry | undefined {
    if (eqKeys.length < 2) return undefined;
    const singleType = typesFilter && typesFilter.length === 1 ? typesFilter[0] : undefined;
    let best: PropertyIndexEntry | undefined;

    for (const idx of this._namedIndexes.values()) {
      if (idx.target !== target || !idx.isCompound) continue;
      if (idx.labelOrType !== undefined && idx.labelOrType !== singleType) continue;
      if (idx.propertyKeys.every((k) => eqKeys.includes(k))) {
        const isBetter =
          !best ||
          idx.propertyKeys.length > best.propertyKeys.length ||
          (idx.propertyKeys.length === best.propertyKeys.length &&
            idx.labelOrType !== undefined &&
            best.labelOrType === undefined);
        if (isBetter) {
          best = idx;
        }
      }
    }
    return best;
  }

  clear(): void {
    for (const entry of this._namedIndexes.values()) {
      entry.buckets.clear();
    }
    this._namedIndexes.clear();
    this._nodeIndexesByPropKey.clear();
    this._edgeIndexesByPropKey.clear();
    this._indexEpoch++;
  }
}
