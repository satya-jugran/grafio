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
import { Graph } from 'grafio';

const graph = new Graph();
graph.addNode({ id: '1', label: 'Person', properties: { name: 'Alice' } });
graph.addNode({ id: '2', label: 'Person', properties: { name: 'Bob' } });
graph.addEdge({ from: '1', to: '2', label: 'KNOWS' });

const results = graph.traverse('1').relationships('KNOWS').depth(1..3).execute();
```

## What's Next?

- Redis and MongoDB storage providers
- Advanced query optimization
- Graph visualization tools
- Community contributions welcome!

Check out the [documentation](/docs/getting-started/installation) to get started.

Welcome to Grafio!