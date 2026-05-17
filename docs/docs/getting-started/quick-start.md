# Quick Start

Get up and running with Grafio in under 5 minutes.

## Installation

```bash
npm install grafio
```

## Your First Graph

```typescript
import { Graph } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

// Create a graph (uses InMemoryStorageProvider by default)
const graph = new Graph();

// Create Cypher engine
const engine = new CypherEngine(graph);

// Add nodes with types and properties
const pythonCourse = await graph.addNode('Course', { name: 'Python', duration: 40 });
const chapter1 = await graph.addNode('Chapter', { name: 'Basics', order: 1 });
const author = await graph.addNode('Author', { name: 'John Doe' });

// Connect nodes with directed edges
await graph.addEdge(pythonCourse.id, chapter1.id, 'CONTAINS');
await graph.addEdge(author.id, pythonCourse.id, 'AUTHOR_OF');

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
- [Cypher Queries](../guides/cypher-queries) — learn the query language
- [API Reference](../api-reference/graph) — complete method reference