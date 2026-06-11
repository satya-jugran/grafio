---
slug: grafio-browser-and-visualizer
title: "Bringing Grafio to the Edge"
authors: [satya-jugran]
tags: [grafio, cypher, browser, visualization, release]
---

We are incredibly excited to announce the simultaneous release of two powerful new packages that will change how you think about building graph applications: `@grafio/browser` and `@grafio/visualizer`!

Historically, leveraging the power of a graph database meant spinning up heavy backend infrastructure, managing network latency, and writing complex bridging code just to get the data onto a user's screen. 

We believe you shouldn't need a heavy backend just to run and visualize complex graph relationships. Today, we are bringing the full power of Grafio's Cypher engine directly to the edge.

<!--truncate-->

## The Engine: `@grafio/browser`

[**`@grafio/browser`**](/docs/supporting-libraries/grafio-browser) is the official client-side bundle of the Grafio database. We have taken the heavy lifting of the Cypher execution engine, the query planner, and the core graph data structures, and packaged them into a lightweight, ESM-ready bundle optimized specifically for the browser.

### Full ACID Transactions... in the Browser?

Yes! When running `@grafio/browser`, you utilize the `InMemoryStorageProvider`. Because our in-memory engine was built with the exact same transactional rigor as our persistent engines, developers get full ACID transaction support right out of the box. 

You can `BEGIN`, `COMMIT`, and `ROLLBACK` transactions natively on the client without ever sending a single byte over the network.

## The Canvas: `@grafio/visualizer`

Having a powerful graph engine in your browser is great, but graphs are inherently visual. That's why we are also releasing [**`@grafio/visualizer`**](/docs/supporting-libraries/grafio-visualizer)—an aesthetic, highly interactive 2D and 3D graph renderer. 

Built as a sleek wrapper around WebGL force-directed graphs, this library is designed specifically to consume Cypher execution results. No manual data-munging or complex mapping required; simply pipe your query results into the visualizer and watch your data come to life.

## Putting it Together: The Magic

These two packages are designed to work in perfect harmony. With just a few lines of code, you can initialize a local database, create some data, query it, and render it in stunning 3D.

Take a look at how incredibly simple this flow is:

```typescript
import { CypherEngine, InMemoryStorageProvider } from '@grafio/browser';
import { CypherVisualizer } from '@grafio/visualizer';

async function launchApp() {
  // 1. Initialize the engine completely locally
  const storage = new InMemoryStorageProvider();
  const engine = new CypherEngine({ storage });

  // 2. Initialize the visualizer on your DOM container
  const container = document.getElementById('graph-container');
  const visualizer = new CypherVisualizer(container, { mode: '3d' });

  // 3. Create some data and query it!
  await engine.execute(`
    CREATE (a:User {name: 'Alice'})-[:KNOWS]->(b:User {name: 'Bob'})
  `);
  
  const result = await engine.execute(`MATCH (n)-[r]->(m) RETURN n, r, m`);

  // 4. The Magic: Pipe the Cypher result directly into the visualizer!
  visualizer.render(result);
}

launchApp();
```

## Data Persistence Across Sessions

Even though the engine runs in-memory, you don't have to lose your data when the user refreshes the page. The `InMemoryStorageProvider` exposes handy `.exportJSON()` and `.importJSON()` methods that allow you to take a snapshot of the entire graph state.

You can easily persist this snapshot to the browser's `localStorage` or `IndexedDB`, or even send it back to your server for long-term storage!

```typescript
// Export the entire graph as a JSON object
const snapshot = await storage.exportJSON();

// Save it to browser Local Storage
localStorage.setItem('myGrafioSnapshot', JSON.stringify(snapshot));

// ... Later, on page reload:
const savedData = JSON.parse(localStorage.getItem('myGrafioSnapshot'));
const restoredStorage = new InMemoryStorageProvider();
await restoredStorage.importJSON(savedData);
```

## Try it Live!

The best way to experience the synergy between these two libraries is to use them! In fact, we dogfooded these exact packages to build our new interactive documentation sandbox.

Head over to the new **[Grafio Playground](/playground)** right now to write your own Cypher queries and watch the visualizer render them in real-time—all happening locally in your browser!

---
<small><i>* Authored with AI assistance to keep my typos off the internet.</i></small>
