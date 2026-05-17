# Performance Examples

Benchmark and optimization examples.

## Run Benchmarks

```bash
npm run perf
```

## Benchmark Traversal

```typescript
import { runBenchmarks } from 'grafio/testing/perf';

const results = await runBenchmarks({
  nodeCount: 10000,
  edgeCount: 50000,
  traversals: 1000
});
```

## Performance Tips

1. **Use indexes** — `createIndex()` for O(1) property lookups
2. **Enable caching** — `GraphManager.init()` with appropriate cache config
3. **Limit results** — use `maxResults` in traversal options
4. **Use Cypher LIMIT** — for large result sets

See the [Caching Guide](../guides/caching) for cache configuration.