import { Graph } from '../src/index';
import type { GraphMeta } from './graphGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkScenario {
  name: string;
  category: string;
  /** Called once before timing starts. Graph mutations go here. NOT timed. */
  setup?: (meta: GraphMeta) => Graph | void | Promise<Graph | void>;
  /** The operation being benchmarked. Called `iterations` times. */
  run: (graph: Graph, meta: GraphMeta) => unknown | Promise<unknown>;
  iterations: number;
}

export interface BenchmarkResult {
  category: string;
  name: string;
  iterations: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  opsPerSec: number;
  heapDeltaBytes: number;
}

// ─── Core runner ─────────────────────────────────────────────────────────────

export async function runScenario(
  scenario: BenchmarkScenario,
  meta: GraphMeta,
): Promise<BenchmarkResult> {
  const { name, category, setup, run, iterations } = scenario;

  // Run setup (untimed)
  let workingGraph: Graph = meta.graph;
  if (setup) {
    const result = await setup(meta);
    if (result instanceof Graph) workingGraph = result;
  }

  // GC before measurement
  if (typeof global.gc === 'function') global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  // Warmup: 1 iteration (not counted)
  await run(workingGraph, meta);

  // Timed iterations
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    await run(workingGraph, meta);
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1_000_000); // ns → ms
  }

  // GC after measurement
  if (typeof global.gc === 'function') global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaBytes = heapAfter - heapBefore;

  // Stats
  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const meanMs = sum / times.length;
  const minMs = times[0];
  const maxMs = times[times.length - 1];
  const p95Ms = times[Math.floor(times.length * 0.95)];
  const opsPerSec = meanMs > 0 ? Math.round(1000 / meanMs) : Infinity;

  return { category, name, iterations, meanMs, minMs, maxMs, p95Ms, opsPerSec, heapDeltaBytes };
}

// ─── Table renderer ───────────────────────────────────────────────────────────

const COL_WIDTHS = {
  category:  14,
  name:      26,
  iters:      9,
  mean:      10,
  p95:        9,
  min:        9,
  opsPerSec: 13,
  heapDelta: 13,
};

// Inner width = sum of col widths + (2 spaces padding per col) + (num_cols - 1) inner dividers
const NUM_COLS = Object.keys(COL_WIDTHS).length;
const INNER_WIDTH =
  Object.values(COL_WIDTHS).reduce((a, b) => a + b, 0) + // column data widths
  NUM_COLS * 2 +                                          // 1 space padding each side per col
  (NUM_COLS - 1);                                         // inner ║ dividers between cols

function pad(s: string, width: number, right = false): string {
  if (right) return s.padStart(width);
  return s.padEnd(width);
}

function formatMs(ms: number): string {
  if (ms < 0.001) return '<0.001';
  if (ms < 1) return ms.toFixed(3);
  if (ms < 100) return ms.toFixed(2);
  return ms.toFixed(0);
}

function formatOps(ops: number): string {
  if (!isFinite(ops)) return '∞';
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(2)}M`;
  if (ops >= 1_000) return `${(ops / 1_000).toFixed(1)}K`;
  return ops.toString();
}

function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes < 0 ? '-' : '+';
  if (abs < 1024) return `${sign}${Math.round(abs)} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${(abs / 1024 / 1024).toFixed(1)} MB`;
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

function hLine(
  left: string, mid: string, join: string, right: string,
  widths: number[],
): string {
  return left + widths.map(w => mid.repeat(w + 2)).join(join) + right;
}

export function printReport(
  results: BenchmarkResult[],
  nodeCount: number,
  edgeCount: number,
  heapFootprintBytes: number,
  scaleLabel: string,
): void {
  const gcAvailable = typeof global.gc === 'function';
  const widths = Object.values(COL_WIDTHS);

  const innerWidth = INNER_WIDTH;

  const fitLine = (s: string): string => {
    if (s.length > innerWidth) return s.slice(0, innerWidth - 1) + '…';
    return s.padEnd(innerWidth);
  };

  const title = ` grafio  PERFORMANCE REPORT  [Scale: ${scaleLabel} | ${formatNum(nodeCount)} nodes / ${formatNum(edgeCount)} edges] `;
  const footprintLine = ` Heap footprint: ${formatBytes(heapFootprintBytes)}  |  RSS: ${formatBytes(process.memoryUsage().rss)}  |  GC: ${gcAvailable ? 'yes (--expose-gc)' : 'no — add --expose-gc for accuracy'} `;

  console.log('╔' + '═'.repeat(innerWidth) + '╗');
  console.log('║' + fitLine(title) + '║');
  console.log('║' + fitLine(footprintLine) + '║');
  console.log(hLine('╠', '═', '╦', '╣', widths));

  const headers = ['Category', 'Operation', 'Iters', 'Mean(ms)', 'p95(ms)', 'Min(ms)', 'ops/sec', 'Heap Δ/op'];
  const headerRow = '║ ' +
    pad(headers[0], widths[0]) + ' ║ ' +
    pad(headers[1], widths[1]) + ' ║ ' +
    pad(headers[2], widths[2], true) + ' ║ ' +
    pad(headers[3], widths[3], true) + ' ║ ' +
    pad(headers[4], widths[4], true) + ' ║ ' +
    pad(headers[5], widths[5], true) + ' ║ ' +
    pad(headers[6], widths[6], true) + ' ║ ' +
    pad(headers[7], widths[7], true) + ' ║';
  console.log(headerRow);
  console.log(hLine('╠', '═', '╬', '╣', widths));

  let prevCategory = '';
  for (const r of results) {
    if (prevCategory && prevCategory !== r.category) {
      console.log(hLine('╟', '─', '╫', '╢', widths));
    }
    prevCategory = r.category;

    const heapPerOp = r.heapDeltaBytes / r.iterations;
    const showHeap = Math.abs(heapPerOp) >= 512; // only show if ≥ 512 bytes

    const row = '║ ' +
      pad(r.category, widths[0]) + ' ║ ' +
      pad(r.name, widths[1]) + ' ║ ' +
      pad(formatNum(r.iterations), widths[2], true) + ' ║ ' +
      pad(formatMs(r.meanMs), widths[3], true) + ' ║ ' +
      pad(formatMs(r.p95Ms), widths[4], true) + ' ║ ' +
      pad(formatMs(r.minMs), widths[5], true) + ' ║ ' +
      pad(formatOps(r.opsPerSec), widths[6], true) + ' ║ ' +
      pad(showHeap ? formatBytes(heapPerOp) : '~0', widths[7], true) + ' ║';
    console.log(row);
  }

  console.log(hLine('╚', '═', '╩', '╝', widths));
  console.log();
}

export function printScaleHeader(label: string): void {
  const line = `  ▶  Running scale: ${label}`;
  console.log('\n' + '─'.repeat(80));
  console.log(line);
  console.log('─'.repeat(80));
}

export function printSectionTitle(title: string): void {
  console.log(`\n  ⏱  ${title}...`);
}
