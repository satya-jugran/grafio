#!/usr/bin/env node
/**
 * grafio  ·  In-Memory Performance Test Runner
 *
 * Run with:
 *   npm run perf
 *   npm run perf:gc   (with accurate heap measurements)
 */

import { buildGraph, runScenario, printReport, printScaleHeader, printSectionTitle, buildCommonScenarios, buildCommonScenariosCypher } from '../../src/shared/testing/perf';

// ─── Scale Definitions ────────────────────────────────────────────────────────
// In-memory provider is fast — we can benchmark at significant scales.

interface ScaleConfig {
  label: string;
  nodeCount: number;
  edgesPerNode: number;
}

const SCALES: ScaleConfig[] = [
  { label: 'Small  (10k nodes)',  nodeCount: 10_000,  edgesPerNode: 3 },
  { label: 'Medium (50k nodes)',  nodeCount: 50_000,  edgesPerNode: 3 },
  { label: 'Large  (100k nodes)', nodeCount: 100_000, edgesPerNode: 3 },
];

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          grafio  ·  In-Memory Performance Test Suite                         ║');
  console.log('║          Benchmarks: Write · Read · Navigation · Traversal · Analysis        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  if (typeof global.gc !== 'function') {
    console.log('\n  ⚠  TIP: Run with --expose-gc for more accurate heap measurements.');
    console.log('     e.g.: npm run perf:gc\n');
  } else {
    console.log('\n  ✓  GC available — heap measurements will be accurate.\n');
  }

  for (const scale of SCALES) {
    printScaleHeader(scale.label);

    // ── 1. Build the baseline graph (timed) ───────────────────────────────
    printSectionTitle(`Building graph: ${scale.nodeCount.toLocaleString()} nodes @ ${scale.edgesPerNode} edges/node`);
    const buildStart = process.hrtime.bigint();
    const meta = await buildGraph(scale.nodeCount, scale.edgesPerNode);
    const buildMs = Number(process.hrtime.bigint() - buildStart) / 1_000_000;

    console.log(`  ✓  Built: ${meta.nodeCount.toLocaleString()} nodes, ${meta.edgeCount.toLocaleString()} edges in ${buildMs.toFixed(0)} ms`);
    console.log(`  ✓  DAG subgraph: ${meta.dagNodeIds.length.toLocaleString()} nodes`);
    console.log(`  ✓  Heap footprint: ${formatBytes(meta.heapFootprintBytes)}`);

    // ── 2. Run all benchmark scenarios ────────────────────────────────────
    printSectionTitle('Running benchmark scenarios');

    const scenarios = buildCommonScenariosCypher(scale.nodeCount, 0.1);
    const results = [];

    for (const scenario of scenarios) {
      process.stdout.write(`     ${scenario.category.padEnd(16)} ${scenario.name.padEnd(30)} `);
      const result = await runScenario(scenario, meta);
      results.push(result);
      console.log(`✓  ${result.meanMs < 1 ? result.meanMs.toFixed(3) + ' ms/op' : result.meanMs.toFixed(2) + ' ms/op'}`);
    }

    // ── 3. Print results table ────────────────────────────────────────────
    console.log();
    printReport(results, meta.nodeCount, meta.edgeCount, meta.heapFootprintBytes, scale.label);

    // ── 4. Free memory before next scale ──────────────────────────────────
    if (typeof global.gc === 'function') global.gc();
  }

  console.log('  Done.\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch(err => {
  console.error('\n  ✗  Fatal error:', err);
  process.exit(1);
});