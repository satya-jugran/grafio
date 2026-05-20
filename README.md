# Grafio

High-performance graph database with **native Cypher support** and **pluggable storage**.

**Full documentation**: [https://satya-jugran.github.io/grafio](https://satya-jugran.github.io/grafio)

> **MongoDB Storage**: For MongoDB-backed persistence, see the separate [`grafio-mongo`](https://www.npmjs.com/package/grafio-mongo) package.

## Features

- **Cypher Queries** - OpenCypher-compatible query language with aggregations and variable-length paths
- **Pluggable Storage** - In-memory built-in, MongoDB available separately
- **Multi-Hop Traversal** - BFS/DFS with type and property filtering
- **Transactions** - Atomic multi-operation updates with automatic rollback
- **Smart Caching** - LRU/LFU/FIFO with budget enforcement
- **Graph Analysis** - DAG validation, topological sort, Mermaid export

## Installation

```bash
npm install grafio
```

## Quick Start

```typescript
import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

// Create graph via factory
const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('social-network');
const cypher = new CypherEngine(graph);

// Adding social network
cypher.execute(`
    CREATE (a:Person {id: 'alice', name: 'Alice', age: 30}),
    CREATE (b:Person {id: 'bob', name: 'Bob', age: 25}),
    CREATE (c:Person {id: 'charlie', name: 'Charlie', age: 35})
`);
// Adding relationships
cypher.execute(`
  MATCH (a:Person {id: 'alice'}), (b:Person {id: 'bob'})
  CREATE (a)-[:KNOWS {since: 2020}]->(b)
`);
cypher.execute(`
  MATCH (b:Person {id: 'bob'}), (c:Person {id: 'charlie'})
  CREATE (b)-[:KNOWS {since: 2019}]->(c)
`);

// Querying the network
const friends = cypher.execute('MATCH (p:Person)-[:KNOWS]->(friend:Person) RETURN p.name as name, friend.name as friend');

/* Returns: 
    [
        {"name":"Alice","friend":"Bob"},
        {"name":"Bob","friend":"Charlie"}
    ]
*/
```

## License

GPL 3.0