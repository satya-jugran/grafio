import { describe, expect, it } from '@jest/globals';
import { deepClone, isFlatRecord, isPrimitive, safeStringify } from '../src/utils';

describe('utility helpers', () => {
  it('deep clones nested data without sharing references', () => {
    const source = { nested: { values: [1, 2, 3] } };
    const clone = deepClone(source);

    expect(clone).toEqual(source);
    expect(clone).not.toBe(source);
    expect(clone.nested).not.toBe(source.nested);
  });

  it('recognizes supported primitive property values', () => {
    expect(isPrimitive(null)).toBe(true);
    expect(isPrimitive(undefined)).toBe(true);
    expect(isPrimitive('value')).toBe(true);
    expect(isPrimitive(1)).toBe(true);
    expect(isPrimitive(false)).toBe(true);
    expect(isPrimitive(1n)).toBe(false);
    expect(isPrimitive({})).toBe(false);
  });

  it('validates flat records', () => {
    expect(isFlatRecord({ name: 'Alice', age: 30, active: true })).toBe(true);
    expect(isFlatRecord({ tags: ['graph'] })).toBe(false);
  });

  it('safely stringifies special values', () => {
    expect(safeStringify(null)).toBe('null');
    expect(safeStringify(undefined)).toBe('undefined');
    expect(safeStringify(1n)).toBe('BigInt');
    expect(safeStringify(Symbol('id'))).toBe('Symbol');
    expect(safeStringify(() => undefined)).toBe('Function');
    expect(safeStringify({ name: 'Alice' })).toBe('{"name":"Alice"}');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeStringify(circular)).toBe('[object Object]');
  });
});
