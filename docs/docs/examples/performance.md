# Performance Examples

Benchmark and optimization examples for measuring and improving Grafio performance.

## Run Benchmarks

```bash
npm run perf
```

For accurate heap measurements:

```bash
npm run perf:gc
```

## Customizing the Performance Test Suite

The performance test suite is located at `tests/perf/entryPoint.ts`. You can customize it to test different scales and scenarios.

### 1. Modify Scale Configurations

Edit the `SCALES` array to change test sizes:

```typescript
const SCALES: ScaleConfig[] = [
  { label: 'Small  (10k nodes)',  nodeCount: 10_000,  edgesPerNode: 3 },
  { label: 'Medium (50k nodes)',  nodeCount: 50_000,  edgesPerNode: 3 },
  { label: 'Large  (100k nodes)', nodeCount: 100_000, edgesPerNode: 3 },
];
```

### 2. Choose Scenario Builder

Use either `buildCommonScenarios` (for native API) or `buildCommonScenariosCypher` (for Cypher queries):

```typescript
// For Cypher-based benchmarks
const scenarios = buildCommonScenariosCypher(scale.nodeCount, 0.1);

// For native API benchmarks
const scenarios = buildCommonScenarios(scale.nodeCount, 0.1);
```

### 3. Custom Scenario Structure

Scenarios have this structure:

```typescript
interface BenchmarkScenario {
  name: string;
  category: string;  // 'Write' | 'Read' | 'Navigation' | 'Traversal' | 'Aggregation'
  fn: (meta: GraphMeta) => Promise<unknown>;
}
```

### 4. Run Custom Benchmarks

```typescript
import { buildGraph, runScenario } from 'grafio/testing/perf';

async function customBenchmark() {
  // Build graph with custom parameters
  const meta = await buildGraph(50_000, 3);
  
  // Create and run a custom scenario
  const scenario = {
    name: 'Custom Query',
    category: 'Traversal',
    fn: async (meta) => {
      return meta.graph.traverse(meta.sampleNodeId, meta.targetNodeId);
    }
  };
  
  const result = await runScenario(scenario, meta);
  console.log(`Mean: ${result.meanMs}ms, Ops/sec: ${result.opsPerSec}`);
}
```

## Performance Tips

1. **Compact CSR storage** — call `graph.compact()` after incremental writes/deletes
2. **Use `querySync()` in memory** — zero-microtask synchronous Cypher execution
3. **Use indexes** — `createIndex()` for O(1) equality and sorted range lookups
4. **Limit results** — use `maxResults` in traversal options or Cypher `LIMIT`
5. **Use typed traversals** — specify relationship types and node labels for faster queries

See the [Caching Guide](../guides/caching) for remote storage provider caching.
