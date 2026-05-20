# Hierarchical Data Tutorial

Model hierarchical data structures like organization charts, file systems, and course prerequisites.

## What You'll Build

A course hierarchy with authors, courses, chapters, and lessons.

## Step 1: Create the Graph

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Step 2: Add Nodes

```typescript
await engine.execute(`
  CREATE (author1:Author {name: 'Jane Smith'}),
         (author2:Author {name: 'John Doe'}),
         (course1:Course {title: 'TypeScript Fundamentals', duration: 600}),
         (course2:Course {title: 'Advanced TypeScript', duration: 480}),
         (ch1:Chapter {title: 'Introduction', order: 1}),
         (ch2:Chapter {title: 'Types', order: 2}),
         (ch3:Chapter {title: 'Generics', order: 3})
`);
```

## Step 3: Link the Hierarchy

```typescript
await engine.execute(`
  MATCH (a1:Author {name: 'Jane Smith'}), (c1:Course {title: 'TypeScript Fundamentals'})
  MATCH (a2:Author {name: 'John Doe'}), (c2:Course {title: 'Advanced TypeScript'})
  CREATE (a1)-[:AUTHOR_OF]->(c1)
  CREATE (a2)-[:AUTHOR_OF]->(c2)
`);

await engine.execute(`
  MATCH (c1:Course {title: 'TypeScript Fundamentals'}), (ch1:Chapter {title: 'Introduction'}), (ch2:Chapter {title: 'Types'})
  MATCH (c2:Course {title: 'Advanced TypeScript'}), (ch3:Chapter {title: 'Generics'})
  CREATE (c1)-[:CONTAINS]->(ch1)
  CREATE (c1)-[:CONTAINS]->(ch2)
  CREATE (c2)-[:CONTAINS]->(ch2)
  CREATE (c2)-[:CONTAINS]->(ch3)
`);
```

## Step 4: Query the Hierarchy

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

## Step 5: Check for Cycles (DAG Validation)

```typescript
const isDag = await graph.isDAG();
console.log(isDag); // true (course hierarchy should be acyclic)
```

## Step 6: Topological Sort (Build Order)

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

  // Build graph
  await engine.execute(`
    CREATE (author:Author {name: 'Jane Smith'}),
           (course:Course {title: 'TypeScript Fundamentals'}),
           (ch1:Chapter {title: 'Introduction', order: 1}),
           (ch2:Chapter {title: 'Types', order: 2})
  `);

  await engine.execute(`
    MATCH (a:Author), (c:Course)
    MATCH (c2:Course), (c1:Chapter), (c2b:Chapter)
    CREATE (a)-[:AUTHOR_OF]->(c)
    CREATE (c)-[:CONTAINS]->(ch1)
    CREATE (c)-[:CONTAINS]->(ch2)
  `);

  // Query
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