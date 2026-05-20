# Getting Started

Welcome to Grafio! This section will help you get up and running with your first graph database.

## Prerequisites

- Node.js >= 18.0
- npm or yarn

## Installation

Install Grafio from npm:

```bash
npm install grafio
```

## Quick Start

Create your first graph in just a few lines:

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);

// Build graph
await engine.execute(`
  CREATE (course:Course {name: 'Python 101', duration: 40}),
         (chapter:Chapter {name: 'Getting Started', order: 1})
`);

await engine.execute(`
  MATCH (course:Course), (chapter:Chapter)
  CREATE (course)-[:CONTAINS]->(chapter)
`);

// Query
const result = await engine.query(`
  MATCH (c:Course)-[:CONTAINS]->(ch:Chapter)
  RETURN c.name AS course, collect(ch.name) AS chapters
`);
console.log(result.rows);
```

## Next Steps

- Learn about [Core Concepts](../guides/core-concepts) — understand nodes, edges, and relationships
- Explore the [API Reference](../api-reference/graph) — complete method reference
- [MongoDB Storage](../guides/mongodb-storage) — persistent storage with MongoDB