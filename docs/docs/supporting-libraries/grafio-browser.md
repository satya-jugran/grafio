---
sidebar_position: 1
title: "@grafio/browser"
description: Pure client-side ESM and UMD bundle of Grafio
---

# @grafio/browser

`@grafio/browser` is the official client-side bundle of the Grafio database. It packages the entire Cypher execution engine, query planner, and Structure-of-Arrays (SoA) / Hybrid CSR graph engine into a lightweight browser package with zero Node.js or backend dependencies.

This is ideal for building offline-first web applications, client-side sandboxes (like the Grafio Playground), or anywhere you want powerful graph database features natively in the browser.

## Installation

You can install it directly via NPM or import it from a CDN:

```bash
npm install @grafio/browser
```

Or using an ESM CDN in your browser:
```html
<script type="module">
  import { Graph, CypherEngine } from 'https://esm.sh/@grafio/browser';
</script>
```

## Available Exports

Because this package is optimized for the browser, it purposely excludes filesystem and Redis caching capabilities. The following core features are fully supported and exported:

- **Core Structures**: `Graph`, `Node`, `Edge`
- **Engine**: `CypherEngine`, `PlanFormatter`
- **Storage**: `InMemoryStorageProvider`
- **Utilities**: `GraphToMermaid`, `GraphTransaction`
- **Errors & Types**: All standard Cypher and Graph execution errors (including `TransactionConflictError`)

## Complete Usage Example

When running Grafio in the browser, `new Graph()` uses `InMemoryStorageProvider` with compact SoA slot IDs (`@n0:1`, `@e0:1`) and full ACID delta transactions (`commit()`, `rollback()`, and concurrent conflict detection) natively on the client side:

```typescript
import { Graph, InMemoryStorageProvider } from '@grafio/browser';

async function runBrowserGraph() {
  // 1. Initialize purely client-side storage & graph (or simply `new Graph()`)
  const storage = new InMemoryStorageProvider();
  const graph = new Graph(storage);

  console.log("Graph initialized in the browser!");

  // 2. Create some data synchronously (or `await graph.query(...)`)
  graph.querySync(`
    CREATE (a:User { name: 'Alice', age: 28 })-[:KNOWS { since: 2021 }]->(b:User { name: 'Bob' })
  `);

  // 3. Query the data and include the formatted execution plan
  const result = await graph.query(
    `MATCH (u:User)-[r:KNOWS]->(friend)
     RETURN u.name AS userName, r.since AS knownSince, friend.name AS friendName`,
    undefined,
    { executionPlan: { format: 'text' } }
  );

  console.log("Query Results:", result.rows);
  /* Output:
   * [
   *   { userName: "Alice", knownSince: 2021, friendName: "Bob" }
   * ]
   */

  // 4. Inspect the execution plan
  console.log("Execution Plan:\n", result.executionPlan);
}

runBrowserGraph();
```

## Exporting and Persisting Data

Even though `InMemoryStorageProvider` is in-memory (data is lost on page refresh), you can export a JSON snapshot via `graph.exportJSON()` to persist in `localStorage` or `IndexedDB`, and reload it later with `Graph.importJSON()`:

```typescript
// Export the entire graph as a JSON object
const snapshot = await graph.exportJSON();

// Save it to browser Local Storage
localStorage.setItem('myGrafioSnapshot', JSON.stringify(snapshot));

// ... Later, to restore it:
const savedData = JSON.parse(localStorage.getItem('myGrafioSnapshot')!);
const restoredGraph = await Graph.importJSON(savedData);
```
