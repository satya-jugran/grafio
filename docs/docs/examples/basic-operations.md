# Basic Operations Examples

Minimal code examples for common graph operations.

## Create a Graph

```typescript
import { Graph } from 'grafio';

const graph = new Graph();
```

## Add Nodes

```typescript
const alice = await graph.addNode('Person', { name: 'Alice' });
const bob = await graph.addNode('Person', { name: 'Bob' });
```

## Connect Nodes

```typescript
await graph.addEdge(alice.id, bob.id, 'KNOWS');
```

## Query Nodes

```typescript
// Get all nodes
const allNodes = await graph.getNodes();

// Get by type using filter options
const people = await graph.getNodes({ filter: { types: ['Person'] } });

// Get outgoing edges
const outgoingEdges = await graph.getEdgesFrom(alice.id);
const friends = outgoingEdges
  .filter(e => e.type === 'KNOWS')
  .map(e => e.targetId);
```

## More Examples

See the [Quick Start](../getting-started/quick-start) guide for a complete introductory example.