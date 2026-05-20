# Quick Start

Get up and running with Grafio in under 5 minutes.

## Installation

```bash
npm install grafio
```

## Your First Graph

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

// Create graph via factory (supports caching when GraphManager is initialized)
const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');

// Create Cypher engine
const engine = new CypherEngine(graph);

// Build graph
await engine.execute(`
  CREATE (pythonCourse:Course {name: 'Python', duration: 40}),
         (chapter1:Chapter {name: 'Basics', order: 1}),
         (author:Author {name: 'John Doe'})
`);

await engine.execute(`
  MATCH (course:Course), (chapter:Chapter)
  CREATE (course)-[:CONTAINS]->(chapter)
`);

await engine.execute(`
  MATCH (author:Author), (course:Course)
  CREATE (author)-[:AUTHOR_OF]->(course)
`);

// Find all authors and their courses
const result = await engine.query(`
  MATCH (author:Author)-[:AUTHOR_OF]->(course:Course)
  RETURN author.name AS authorName, course.name AS courseName
`);

for (const row of result.rows) {
  console.log(`${row.authorName} wrote ${row.courseName}`);
}

// Get all nodes using Cypher
const allNodes = await engine.query('MATCH (n) RETURN n');
```

## Key Concepts

- **All methods are async** — use `await` with every call
- **graphId partitioning** — multiple isolated graphs in one instance
- **Pluggable storage** — swap backends without changing code

## What's Next

- [Core Concepts](../guides/core-concepts) — understand nodes, edges, and relationships
- [Cypher Language](../guides/cypher-language) — learn the query language
- [API Reference](../api-reference/graph) — complete method reference