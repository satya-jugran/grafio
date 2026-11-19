/**
 * Returns a deep clone of a value.
 * Uses the native `structuredClone` API when available (Node 17+, modern
 * browsers) and falls back to a JSON round-trip for older runtimes.
 * Graph node/edge properties must be JSON-serialisable by contract, so the
 * fallback is always safe for NodeData / EdgeData objects.
 * @param obj - The value to clone
 * @returns A structurally identical but fully independent copy
 */
interface RuntimeGlobals {
  structuredClone?: <T>(value: T) => T;
  crypto?: { getRandomValues(buffer: Uint8Array): Uint8Array };
}

export function deepClone<T>(obj: T): T {
  const cloneFn = (globalThis as unknown as RuntimeGlobals).structuredClone;
  if (typeof cloneFn === 'function') {
    return cloneFn(obj);
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Recursively freezes an object and all nested plain-object/array values.
 * Primitives and already-frozen values are returned as-is.
 * @param obj - The object to deep-freeze
 * @returns The same object, fully frozen
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }

  // Freeze nested values first (depth-first)
  for (const value of Object.values(obj as object)) {
    deepFreeze(value);
  }

  return Object.freeze(obj);
}

/**
 * Checks if a value is a supported primitive property type
 * (string, number, boolean, null, undefined).
 * Excludes `bigint` and `symbol`, which are primitive in JavaScript but are
 * not supported by the current JSON-based storage/indexing implementation.
 * @param value - The value to check
 * @returns true if the value is a supported primitive property type
 */
export function isPrimitive(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean';
}

/**
 * Validates that all property values in a record are supported primitive types.
 * This enforces a flat structure for efficient indexing.
 * @param properties - The properties record to validate
 * @returns true if all values are supported primitives
 */
export function isFlatRecord(properties: Record<string, unknown>): boolean {
  for (const key in properties) {
    if (Object.prototype.hasOwnProperty.call(properties, key) && !isPrimitive(properties[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Finds the first invalid non-primitive entry in a property record, if any.
 */
export function findInvalidPropertyEntry(
  properties: Readonly<Record<string, unknown>>
): [string, unknown] | undefined {
  for (const key in properties) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      const value = properties[key];
      if (!isPrimitive(value)) {
        return [key, value];
      }
    }
  }
  return undefined;
}

/**
 * Safely serializes a value to a string for error messages.
 * Never throws — returns a fallback description for problematic values.
 * @param value - The value to serialize
 * @returns A string representation of the value
 */
export function safeStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return 'BigInt';
  if (typeof value === 'symbol') return 'Symbol';
  if (typeof value === 'function') return 'Function';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  // Primitives (string, number, boolean)
  return String(value);
}

// ── Pooled CSPRNG UUIDv4 Generator ────────────────────────────────────────────

const HEX_TABLE: string[] = new Array(256);
for (let i = 0; i < 256; i++) {
  HEX_TABLE[i] = (i + 0x100).toString(16).slice(1);
}

const UUID_POOL_BYTES = 4096;
const uuidPool = new Uint8Array(UUID_POOL_BYTES);
let uuidPoolOffset = UUID_POOL_BYTES;

function refillUuidPool(): void {
  const cryptoApi = (globalThis as unknown as RuntimeGlobals).crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(uuidPool);
  } else {
    for (let i = 0; i < UUID_POOL_BYTES; i++) {
      uuidPool[i] = (Math.random() * 256) | 0;
    }
  }
  uuidPoolOffset = 0;
}

/**
 * Generates an RFC-4122 v4 UUID using a 4 KB pooled CSPRNG byte buffer.
 * Works identically in Node.js and modern browsers with ~8–10x lower per-call
 * overhead than calling `crypto.randomUUID()` on every allocation.
 */
export function fastUUID(): string {
  if (uuidPoolOffset + 16 > UUID_POOL_BYTES) {
    refillUuidPool();
  }
  const o = uuidPoolOffset;
  uuidPoolOffset = o + 16;

  const b0 = uuidPool[o];
  const b1 = uuidPool[o + 1];
  const b2 = uuidPool[o + 2];
  const b3 = uuidPool[o + 3];
  const b4 = uuidPool[o + 4];
  const b5 = uuidPool[o + 5];
  const b6 = (uuidPool[o + 6] & 0x0f) | 0x40;
  const b7 = uuidPool[o + 7];
  const b8 = (uuidPool[o + 8] & 0x3f) | 0x80;
  const b9 = uuidPool[o + 9];
  const b10 = uuidPool[o + 10];
  const b11 = uuidPool[o + 11];
  const b12 = uuidPool[o + 12];
  const b13 = uuidPool[o + 13];
  const b14 = uuidPool[o + 14];
  const b15 = uuidPool[o + 15];

  return (
    HEX_TABLE[b0] + HEX_TABLE[b1] + HEX_TABLE[b2] + HEX_TABLE[b3] + '-' +
    HEX_TABLE[b4] + HEX_TABLE[b5] + '-' +
    HEX_TABLE[b6] + HEX_TABLE[b7] + '-' +
    HEX_TABLE[b8] + HEX_TABLE[b9] + '-' +
    HEX_TABLE[b10] + HEX_TABLE[b11] + HEX_TABLE[b12] + HEX_TABLE[b13] + HEX_TABLE[b14] + HEX_TABLE[b15]
  );
}
