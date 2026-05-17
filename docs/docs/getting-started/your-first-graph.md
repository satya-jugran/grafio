# Your First Graph

A step-by-step tutorial to build your first graph with Grafio.

## What You'll Build

A simple course hierarchy graph with authors, courses, and chapters.

## Step 1: Set Up Your Project

```bash
mkdir my-graph && cd my-graph
npm init -y
npm install grafio
```

## Step 2: Create the Graph

Create a file `index.ts`:

```typescript
import { Graph } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

async function main() {
  // 1. Create a graph instance
  const graph = new Graph();
  const engine = new CypherEngine(graph);

  // 2. Add nodes
  const author = await graph.addNode('Author', { name: 'Jane Smith' });
  const course = await graph.addNode('Course', {
    title: 'TypeScript Fundamentals',
    duration: 60
  });
  const chapter1 = await graph.addNode('Chapter', {
    title: 'Introduction',
    order: 1
  });
  const chapter2 = await graph.addNode('Chapter', {
    title: 'Advanced Types',
    order: 2
  });

  // 3. Connect nodes with edges
  await graph.addEdge(author.id, course.id, 'AUTHOR_OF');
  await graph.addEdge(course.id, chapter1.id, 'CONTAINS');
  await graph.addEdge(course.id, chapter2.id, 'CONTAINS');

  // 4. Query the graph using Cypher

  const result = await engine.query(`
    MATCH (author:Author)-[:AUTHOR_OF]->(course:Course)
    RETURN author.name AS authorName, course.title AS courseTitle
  `);

  for (const row of result.rows) {
    console.log(`${row.authorName} wrote ${row.courseTitle}`);
  }

  // Get all nodes
  const allNodes = await engine.query('MATCH (n) RETURN n');
  console.log(`Total nodes: ${allNodes.rows.length}`);
}

main();
```

## Step 3: Run It

```bash
npx ts-node index.ts
```

Output:
```
Jane Smith wrote TypeScript Fundamentals
Total nodes: 4
```

## Try It Yourself

Modify the code to:
1. Add a `Student` node and connect students to courses they enrolled in
2. Use Cypher queries to navigate the graph
3. Export the graph to JSON with `exportJSON()`

## Next Steps

- [Core Concepts](../guides/core-concepts) — deeper dive into the data model
- [Cypher Queries](../guides/cypher-queries) — more query examples
- [Transactions](../guides/transactions) — batch multiple operations