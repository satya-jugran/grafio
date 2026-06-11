---
sidebar_position: 1
title: "@grafio/browser"
description: Pure client-side ESM bundle of Grafio
---

# @grafio/browser

`@grafio/browser` is the official client-side bundle of the Grafio database. It packages the entire Cypher execution engine, query planner, and core graph data structures into a lightweight, ESM-ready package that requires absolutely zero Node.js or backend dependencies.

This is perfect for building offline-first web applications, client-side sandboxes (like the Grafio Playground), or anywhere you want powerful graph database features natively in the browser.

## Installation

You can install it directly via NPM or import it from a CDN:

```bash
npm install @grafio/browser
```

Or using an ESM CDN in your browser:
```html
<script type="module">
  import { CypherEngine } from 'https://esm.sh/@grafio/browser';
</script>
```

## Available Exports

Because this package is optimized for the browser, it purposely excludes filesystem and Redis caching capabilities. The following core features are fully supported and exported:

- **Core Structures**: `Graph`, `Node`, `Edge`
- **Engine**: `CypherEngine`, `PlanFormatter`
- **Storage**: `InMemoryStorageProvider`
- **Utilities**: `GraphToMermaid`, `GraphTransaction`
- **Errors & Types**: All standard Cypher and Graph execution errors.

## Complete Usage Example

When running Grafio in the browser, you will always use the `InMemoryStorageProvider`. The brilliant part about this is that the `InMemoryStorageProvider` natively supports full ACID transactions, meaning `COMMIT` and `ROLLBACK` work perfectly on the client side!

Here is a complete, standalone example of initializing the engine and executing Cypher directly in the browser:

```typescript
import { CypherEngine, InMemoryStorageProvider, PlanFormatter } from '@grafio/browser';

async function runBrowserGraph() {
  // 1. Initialize the purely client-side storage
  const storage = new InMemoryStorageProvider();
  
  // 2. Attach the storage to a new Cypher Engine instance
  const engine = new CypherEngine({ storage });

  console.log("Graph initialized in the browser!");

  // 3. Create some data
  await engine.execute(`
    CREATE (a:User {name: 'Alice', age: 28})-[:KNOWS {since: 2021}]->(b:User {name: 'Bob'})
  `);

  // 4. Query the data
  const result = await engine.execute(`
    MATCH (u:User)-[r:KNOWS]->(friend)
    RETURN u.name AS userName, r.since AS knownSince, friend.name AS friendName
  `);

  console.log("Query Results:", result.rows);
  /* Output:
   * [
   *   { userName: "Alice", knownSince: 2021, friendName: "Bob" }
   * ]
   */

  // 5. View the execution plan (great for debugging!)
  const formattedPlan = PlanFormatter.format(result.summary.plan);
  console.log("Execution Plan:\n", formattedPlan);
}

runBrowserGraph();
```

## Exporting and Persisting Data

Even though `InMemoryStorageProvider` is volatile (data is lost on page refresh), it comes with a handy `.exportJSON()` method. You can use this to take a snapshot of the graph and persist it to `localStorage` or `IndexedDB`, then reload it later using `.importJSON()`!

```typescript
// Export the entire graph as a JSON object
const snapshot = await storage.exportJSON();

// Save it to browser Local Storage
localStorage.setItem('myGrafioSnapshot', JSON.stringify(snapshot));

// ... Later, to restore it:
const savedData = JSON.parse(localStorage.getItem('myGrafioSnapshot'));
const restoredStorage = new InMemoryStorageProvider();
await restoredStorage.importJSON(savedData);
const newEngine = new CypherEngine({ storage: restoredStorage });
```
