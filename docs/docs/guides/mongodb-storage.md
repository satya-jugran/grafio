# MongoDB Storage

MongoDB-backed persistent storage for Grafio using the `grafio-mongo` package.

## Installation

```bash
npm install grafio grafio-mongo
```

## Import

```typescript
import { MongoGraphFactory } from 'grafio-mongo';
```

## Quick Start

```typescript
import { MongoGraphFactory } from 'grafio-mongo';

const factory = new MongoGraphFactory(db);
await factory.ensureIndexes();

const graph = factory.forGraph('my-graph');
```

## ensureIndexes()

```typescript
async ensureIndexes(): Promise<void>
```

Creates MongoDB indexes for optimal query performance on node and edge collections.

**Call this once after creating your factory:**

```typescript
const factory = new MongoGraphFactory(db);
await factory.ensureIndexes();
```

## forGraph()

```typescript
forGraph(graphId: string = 'default'): Graph
```

Creates a Graph instance backed by MongoDB.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `graphId` | `string` | `'default'` | Unique identifier for the graph |

```typescript
// Default graph
const graph = factory.forGraph();

// Named graph
const graph = factory.forGraph('users');
```

## forGraph() with Options

```typescript
forGraph(graphId: string, options?: MongoGraphFactoryOptions): Graph
```

**Options:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `nodesCollection` | `string` | `'sgdb_nodes'` | MongoDB collection for nodes |
| `edgesCollection` | `string` | `'sgdb_edges'` | MongoDB collection for edges |

```typescript
const factory = new MongoGraphFactory(db);

// Custom collection names
const graph = factory.forGraph('custom-graph', {
  nodesCollection: 'my_nodes',
  edgesCollection: 'my_edges',
});
```

## Complete Example

```typescript
import { MongoClient } from 'mongodb';
import { MongoGraphFactory } from 'grafio-mongo';

async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('grafio');

  // Create factory with optional MongoDB database
  const factory = new MongoGraphFactory(db);
  
  // Ensure indexes are created for optimal performance
  await factory.ensureIndexes();

  // Create graph instance
  const graph = factory.forGraph('courses');

  // Add nodes
  const course = await graph.addNode('Course', { 
    name: 'Python 101', 
    duration: 40 
  });
  const chapter = await graph.addNode('Chapter', { 
    name: 'Getting Started', 
    order: 1 
  });

  // Create relationship
  await graph.addEdge(course.id, chapter.id, 'CONTAINS');

  console.log(`Created: ${course.type} "${course.properties.name}"`);
  
  await client.close();
}

main();
```

## GraphManager Integration

You can combine MongoDB storage with Grafio's caching layer:

```typescript
import { GraphManager } from 'grafio';
import { MongoGraphFactory } from 'grafio-mongo';

GraphManager.init({
  cache: {
    cacheStore: 'in-memory',
    maxNodesCount: 10000,
    maxEdgesCount: 20000,
  }
});

const factory = new MongoGraphFactory(db);
await factory.ensureIndexes();

const graph = factory.forGraph('cached-graph');
// Graph instances automatically use caching when GraphManager is initialized
```

## Next Steps

- [Storage Providers](./storage-providers) — other storage options
- [Caching](./caching) — configure caching layer
- [Serialization](./serialization) — import/export graph data