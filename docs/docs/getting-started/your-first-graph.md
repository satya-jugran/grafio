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
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

async function main() {
  // 1. Create graph via factory
  const factory = new InMemoryGraphFactory();
  const graph = factory.forGraph('default');
  const engine = new CypherEngine(graph);

  // 2. Build graph
  await engine.execute(`
    CREATE (author:Author {name: 'Jane Smith'}),
           (course:Course {title: 'TypeScript Fundamentals', duration: 60}),
           (chapter1:Chapter {title: 'Introduction', order: 1}),
           (chapter2:Chapter {title: 'Advanced Types', order: 2})
  `);

  // 3. Connect nodes with Cypher
  await engine.execute(`
    MATCH (author:Author), (course:Course)
    CREATE (author)-[:AUTHOR_OF]->(course)
  `);

  await engine.execute(`
    MATCH (course:Course), (chapter1:Chapter {title: 'Introduction'}), (chapter2:Chapter {title: 'Advanced Types'})
    CREATE (course)-[:CONTAINS]->(chapter1)
    CREATE (course)-[:CONTAINS]->(chapter2)
  `);

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
- [Cypher Language](../guides/cypher-language) — syntax tutorial
- [Transactions](../guides/transactions) — batch multiple operations