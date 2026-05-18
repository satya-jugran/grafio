---
title: "Announcing Grafio: A High-Performance Graph Database"
description: "Introducing Grafio - TypeScript graph database with native Cypher support"
slug: welcome-grafio
authors: [satya-jugran]
tags: [announcement, release, grafio]
date: 2026-05-18
---

We're thrilled to announce the release of **Grafio** - a high-performance, TypeScript-native graph database built for modern applications.

<!-- truncate -->

## What is Grafio?

Grafio is a lightweight, embeddable graph database that brings the power of graph data structures to JavaScript/TypeScript applications. With native Cypher query language support and pluggable storage backends, Grafio makes working with connected data simple and efficient.

## Key Features

- **Native Cypher Support** - Write queries in Cypher, the same language used by Neo4j
- **TypeScript First** - Full type safety and excellent IDE support
- **Pluggable Storage** - Use in-memory for speed, or plug in Redis/MongoDB for persistence
- **Powerful Traversals** - Built-in graph traversal and path finding algorithms
- **Lightweight** - Zero dependencies, tree-shakable, works in Node.js and browsers

## Getting Started

```typescript
import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

// Create graph via factory
const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('social-network');
const cypher = new CypherEngine(graph);

// Add social network data
graph.addNode({ id: 'alice', label: 'Person', properties: { name: 'Alice', age: 30 } });
graph.addNode({ id: 'bob', label: 'Person', properties: { name: 'Bob', age: 25 } });
graph.addNode({ id: 'charlie', label: 'Person', properties: { name: 'Charlie', age: 35 } });
graph.addEdge({ from: 'alice', to: 'bob', label: 'KNOWS', properties: { since: 2020 } });
graph.addEdge({ from: 'bob', to: 'charlie', label: 'KNOWS', properties: { since: 2019 } });

// Query with Cypher
const friends = cypher.execute('MATCH (p:Person)-[:KNOWS]->(friend:Person) RETURN p.name as name, friend.name as friend');
// Returns: [{"name":"Alice","friend":"Bob"},{"name":"Bob","friend":"Charlie"}]
```

## What's Next?

- Redis and MongoDB storage providers
- Advanced query optimization
- Graph visualization tools
- Community contributions welcome!

Check out the [documentation](/docs/getting-started/installation) to get started.

Welcome to Grafio!