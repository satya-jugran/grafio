# @grafio/browser

Browser-optimized bundle of [Grafio](https://www.npmjs.com/package/grafio) — a high-performance graph database with native Cypher support.

This package bundles the entire Grafio core (Graph engine, Cypher query language, InMemoryStorageProvider) into self-contained JavaScript files that run directly in the browser. No Node.js required.

> **This is the browser distribution of [grafio](https://www.npmjs.com/package/grafio).** For the full Node.js package with all features (caching, MongoDB storage, etc.), use [`grafio`](https://www.npmjs.com/package/grafio).

## Features

- **Cypher Queries** — Full OpenCypher-compatible query language (MATCH, CREATE, DELETE, MERGE, WHERE, ORDER BY, aggregations, variable-length paths)
- **Execution Plans** — Inspect query plans in text, JSON, or Mermaid format
- **Zero Dependencies** — Entire library bundled into a single file, no runtime dependencies
- **Lightweight** — ~156KB minified, ~45KB gzipped
- **ESM + UMD** — Works with `<script>` tags, `<script type="module">`, and modern bundlers

## Installation

### npm

```bash
npm install @grafio/browser
```

### CDN

```html
<!-- unpkg -->
<script src="https://unpkg.com/@grafio/browser/dist/grafio.browser.min.js"></script>

<!-- jsdelivr -->
<script src="https://cdn.jsdelivr.net/npm/@grafio/browser/dist/grafio.browser.min.js"></script>
```

## Usage

### Script Tag (UMD)

```html
<script src="https://unpkg.com/@grafio/browser/dist/grafio.browser.min.js"></script>
<script>
  const { Graph, CypherEngine } = Grafio;

  const graph = new Graph();
  const engine = new CypherEngine(graph);

  // Create data
  await engine.execute("CREATE (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})");
  await engine.execute("MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'}) CREATE (a)-[:KNOWS]->(b)");

  // Query
  const result = await engine.execute("MATCH (p:Person)-[:KNOWS]->(friend) RETURN p.name, friend.name");
  console.log(result.rows);
</script>
```

### ES Module

```html
<script type="module">
  import { Graph, CypherEngine } from 'https://unpkg.com/@grafio/browser/dist/grafio.browser.mjs';

  const graph = new Graph();
  const engine = new CypherEngine(graph);

  await engine.execute("CREATE (n:Person {name: 'Alice'})");
  const result = await engine.execute("MATCH (p:Person) RETURN p");
  console.log(result.rows);
</script>
```

### npm + Bundler

```javascript
import { Graph, CypherEngine } from '@grafio/browser';

const graph = new Graph();
const engine = new CypherEngine(graph);

await engine.execute("CREATE (n:Person {name: 'Alice'})");
const result = await engine.execute("MATCH (p:Person) RETURN p");
```

## Query Examples

```javascript
const engine = new CypherEngine(graph);

// Parameterized queries
await engine.execute("CREATE (n:Person {name: $name, age: $age})", { name: 'Alice', age: 30 });

// MATCH with WHERE
const result = await engine.execute("MATCH (p:Person) WHERE p.age > $minAge RETURN p", { minAge: 25 });

// Aggregations
const stats = await engine.execute("MATCH (p:Person) RETURN COUNT(p) AS total, AVG(p.age) AS avgAge");

// Variable-length paths
const paths = await engine.execute("MATCH path = (a)-[:KNOWS*1..3]->(b) RETURN path");

// Execution plan inspection
const plan = await engine.getQueryPlan("MATCH (p:Person) WHERE p.name = $name RETURN p", { name: 'Alice' }, 'text');
console.log(plan);
```

## Exported API

| Export | Description |
|--------|-------------|
| `Graph` | Graph database instance |
| `CypherEngine` | Cypher query executor |
| `InMemoryStorageProvider` | In-memory storage backend |
| `GraphToMermaid` | Convert graph to Mermaid diagram |
| `PlanFormatter` | Format execution plans |
| `Node`, `Edge` | Graph entity classes |
| Error classes | `CypherSyntaxError`, `CypherSemanticError`, `CypherRuntimeError`, etc. |

## Browser Support

Requires `crypto.randomUUID()` support (all modern browsers):

- Chrome 92+
- Firefox 95+
- Safari 15.4+
- Edge 92+

## Relationship to Grafio

| | [`grafio`](https://www.npmjs.com/package/grafio) | [`@grafio/browser`](https://www.npmjs.com/package/@grafio/browser) |
|---|---|---|
| **Environment** | Node.js | Browser |
| **Storage** | In-memory, MongoDB, Redis cache | In-memory only |
| **Caching** | LRU/LFU/FIFO with Redis support | Not included |
| **Cypher Engine** | ✅ Full | ✅ Full |
| **Graph Core** | ✅ Full | ✅ Full |
| **Package Size** | ~500KB (with all deps) | ~156KB minified |

The Cypher engine and graph core are identical between both packages. The browser bundle excludes server-only features (Redis cache, MongoDB storage, GraphManager) and packages everything into a single self-contained file.

## License

GPL-3.0 — same as [grafio](https://github.com/satya-jugran/grafio).

## Links

- [Grafio Documentation](https://satya-jugran.github.io/grafio)
- [Grafio GitHub](https://github.com/satya-jugran/grafio)
- [npm](https://www.npmjs.com/package/grafio)
- [Ko-fi](https://ko-fi.com/satyajugran)
