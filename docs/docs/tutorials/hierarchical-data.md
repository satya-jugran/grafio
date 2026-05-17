# Hierarchical Data Tutorial

Model hierarchical data structures like organization charts, file systems, and course prerequisites.

## What You'll Build

A course hierarchy with authors, courses, chapters, and lessons.

## Step 1: Create the Hierarchy

```typescript
import { InMemoryGraphFactory } from 'grafio';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');

// Authors
const author1 = await graph.addNode('Author', { name: 'Jane Smith' });
const author2 = await graph.addNode('Author', { name: 'John Doe' });

// Courses
const course1 = await graph.addNode('Course', { 
  title: 'TypeScript Fundamentals', 
  duration: 600 
});
const course2 = await graph.addNode('Course', { 
  title: 'Advanced TypeScript', 
  duration: 480 
});

// Chapters
const ch1 = await graph.addNode('Chapter', { title: 'Introduction', order: 1 });
const ch2 = await graph.addNode('Chapter', { title: 'Types', order: 2 });
const ch3 = await graph.addNode('Chapter', { title: 'Generics', order: 3 });
```

## Step 2: Link the Hierarchy

```typescript
// Authors create courses
await graph.addEdge(author1.id, course1.id, 'AUTHOR_OF');
await graph.addEdge(author2.id, course2.id, 'AUTHOR_OF');

// Courses contain chapters
await graph.addEdge(course1.id, ch1.id, 'CONTAINS');
await graph.addEdge(course1.id, ch2.id, 'CONTAINS');
await graph.addEdge(course2.id, ch2.id, 'CONTAINS');
await graph.addEdge(course2.id, ch3.id, 'CONTAINS');
```

## Step 3: Query the Hierarchy

### Get Chapters of a Course

```typescript
const { CypherEngine } = await import('grafio/cypher');
const engine = new CypherEngine(graph);

const result = await engine.query(`
  MATCH (course:Course {title: 'TypeScript Fundamentals'})-[:CONTAINS]->(chapter:Chapter)
  RETURN chapter.title AS title, chapter.order AS order
  ORDER BY chapter.order
`);

console.log(`Chapters: ${result.rows.map(r => r.title)}`);
```

### Get Author of a Course

```typescript
const result = await engine.query(`
  MATCH (author:Author)-[:AUTHOR_OF]->(course:Course {title: 'TypeScript Fundamentals'})
  RETURN author.name AS authorName
`);

console.log(`Author: ${result.rows[0]?.authorName}`);
```

### Get Full Course Structure with Cypher

```typescript
const result = await engine.query(`
  MATCH (author:Author)-[:AUTHOR_OF]->(course:Course)-[:CONTAINS]->(chapter:Chapter)
  RETURN author.name AS author, course.title AS course, chapter.title AS chapter, chapter.order AS order
  ORDER BY course, chapter.order
`);
```

## Step 4: Check for Cycles (DAG Validation)

```typescript
const isDag = await graph.isDAG();
console.log(isDag); // true (course hierarchy should be acyclic)
```

## Step 5: Topological Sort (Build Order)

For dependency resolution:

```typescript
const order = await graph.topologicalSort();
console.log(order);
// Valid execution order respecting dependencies
```

## Visualize the Structure

```typescript
import { GraphToMermaid } from 'grafio';

const mermaid = await GraphToMermaid.fromGraph(graph, {
  showProperties: true,
  direction: 'LR'
});

console.log(mermaid.toString());
```

## Complete Code

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

async function main() {
  const factory = new InMemoryGraphFactory();
  const graph = factory.forGraph();
  const engine = new CypherEngine(graph);

  // Create nodes
  const author = await graph.addNode('Author', { name: 'Jane Smith' });
  const course = await graph.addNode('Course', { title: 'TypeScript Fundamentals' });
  const ch1 = await graph.addNode('Chapter', { title: 'Introduction', order: 1 });
  const ch2 = await graph.addNode('Chapter', { title: 'Types', order: 2 });

  // Link hierarchy
  await graph.addEdge(author.id, course.id, 'AUTHOR_OF');
  await graph.addEdge(course.id, ch1.id, 'CONTAINS');
  await graph.addEdge(course.id, ch2.id, 'CONTAINS');

  // Query using Cypher
  const chapters = await engine.query(`
    MATCH (course:Course)-[:CONTAINS]->(chapter:Chapter)
    RETURN chapter.title AS title, chapter.order AS order
  `);
  console.log(`Chapters: ${chapters.rows.map(r => r.title)}`);

  // Validate
  console.log(`Is DAG: ${await graph.isDAG()}`);
}

main();
```

## Next Steps

- [Graph Analysis Guide](../guides/graph-analysis) — DAG and topological sort
- [Visualization Guide](../guides/visualization) — Mermaid export
- [Core Concepts Guide](../guides/core-concepts) — data model basics