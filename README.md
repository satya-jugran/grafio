# Grafio

High-performance graph database with **native Cypher support** and **pluggable storage**.

**Full documentation**: [https://satya-jugran.github.io/grafio](https://satya-jugran.github.io/grafio)

> **MongoDB Storage**: For MongoDB-backed persistence, see the separate [`grafio-mongo`](https://www.npmjs.com/package/grafio-mongo) package.

## Features

- **In-Memory SoA & Hybrid CSR Engine** - Dense slot arenas, adaptive typed columns, `compact()` CSR adjacency lists, and synchronous `querySync()` execution
- **Cypher Queries** - OpenCypher-compatible query language with aggregations, variable-length paths, `PlanCache`, and `graph.query()` / `graph.querySync()`
- **Pluggable Storage** - Built-in zero-dependency `InMemoryStorageProvider`, with MongoDB available separately
- **Multi-Hop Traversal** - BFS/DFS with type and property filtering
- **Transactions** - Optimistic property-level conflict detection (`TransactionConflictError`) and atomic rollback
- **Smart Caching** - Optional LRU/LFU/FIFO caching (`CachedStorageProvider` / Redis) for remote or async storage providers
- **Graph Analysis** - DAG validation, topological sort, Mermaid export

## Installation

```bash
npm install grafio
```

## Quick Start

```typescript
import { Graph } from 'grafio';
// Or use InMemoryGraphFactory / CypherEngine when configuring planCacheSize or named partitions:
// import { InMemoryGraphFactory, CypherEngine } from 'grafio';

const graph = new Graph();

// Build a social network via Cypher
graph.querySync(`
  CREATE (a:Person { name: 'Alice', age: 30 }),
         (b:Person { name: 'Bob', age: 25 }),
         (c:Person { name: 'Charlie', age: 35 }),
         (a)-[:KNOWS { since: 2020 }]->(b),
         (b)-[:KNOWS { since: 2019 }]->(c)
`);

// Query the network (await graph.query(...) works for both in-memory and async providers)
const result = await graph.query(
  'MATCH (p:Person)-[:KNOWS]->(friend:Person) RETURN p.name AS name, friend.name AS friend',
);
console.log(result.rows);
/* Returns:
  [
    { name: 'Alice', friend: 'Bob' },
    { name: 'Bob', friend: 'Charlie' }
  ]
*/
```

## License

GPL 3.0
