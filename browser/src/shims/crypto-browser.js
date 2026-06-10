/**
 * Browser shim for Node.js 'crypto' module.
 *
 * Only randomUUID is used by Grafio (in Node.ts and Edge.ts).
 * globalThis.crypto.randomUUID() is available in all modern browsers:
 * Chrome 92+, Firefox 95+, Safari 15.4+, Edge 92+
 *
 * This shim is only used during the browser bundle build via esbuild alias.
 * The Node.js build (tsc) continues to use the real 'crypto' module.
 */
export function randomUUID() {
  return globalThis.crypto.randomUUID();
}
