# Grafio

High-performance graph database with **native Cypher support** and **pluggable storage**.

📖 **Full documentation**: [https://satya-jugran.github.io/grafio](https://satya-jugran.github.io/grafio)

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
import { Graph } from 'grafio';

const graph = new Graph();
graph.addNode('Person', { name: 'Alice', age: 30 });
graph.addNode('City', { name: 'New York' });
graph.addEdge('LIVES_IN', 'alice', 'nyc', { since: 2020 });

// Query with Cypher
const result = await graph.query('MATCH (p:Person)-[:LIVES_IN]->(c:City) RETURN p.name, c.name');
```

## License

GPL 3.0