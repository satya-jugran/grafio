# Graph Analysis

Analyze graph structure with DAG detection and topological sorting.

## DAG Detection

A Directed Acyclic Graph (DAG) has no cycles. Use `isDAG()` to validate:

```typescript
const isDag = await graph.isDAG();
// Returns true if graph is acyclic, false if cycles exist
```

### When to Check

- Before topological sort
- When building dependency graphs
- Validating hierarchical data structures

## Topological Sort

Get nodes in dependency order using Kahn's algorithm:

```typescript
const order = await graph.topologicalSort();
// Returns string[] of node IDs in topological order
// Returns null if graph contains cycles
```

### Use Cases

- Build systems (compile order)
- Task scheduling
- Dependency resolution
- Course prerequisite ordering

## Examples

### Simple Dependency Graph

```typescript
const graph = new Graph();

// Create dependency chain: a -> b -> c
const a = await graph.addNode('Task', { name: 'a' });
const b = await graph.addNode('Task', { name: 'b' });
const c = await graph.addNode('Task', { name: 'c' });

await graph.addEdge(a.id, b.id, 'DEPENDS_ON');
await graph.addEdge(b.id, c.id, 'DEPENDS_ON');

// Get execution order
const order = await graph.topologicalSort();
// ['a', 'b', 'c'] or similar valid order
```

### Course Prerequisites

```typescript
const graph = new Graph();

const math101 = await graph.addNode('Course', { name: 'Math 101' });
const math201 = await graph.addNode('Course', { name: 'Math 201' });
const math301 = await graph.addNode('Course', { name: 'Math 301' });

await graph.addEdge(math101.id, math201.id, 'PREREQUISITE');
await graph.addEdge(math201.id, math301.id, 'PREREQUISITE');

// Get course order
const schedule = await graph.topologicalSort();
```

### Handling Cycles

```typescript
// Graph with cycle: a -> b -> c -> a
await graph.addEdge(c.id, a.id, 'DEPENDS_ON');

const order = await graph.topologicalSort();
// Returns null (cannot sort cyclic graph)

const dag = await graph.isDAG();
// Returns false
```

## Algorithm Details

### Kahn's Algorithm

1. Calculate in-degree for each node
2. Add all zero in-degree nodes to queue
3. Process queue, reducing in-degree of neighbors
4. Repeat until queue is empty or cycle detected

```typescript
// Implementation uses adjacency list internally
// Time complexity: O(V + E) where V = vertices, E = edges
```

## Visualization

Combine with Mermaid for visual analysis:

```typescript
import { GraphToMermaid } from 'grafio';

const mermaid = await GraphToMermaid.fromGraph(graph, {
  showProperties: true,
  direction: 'LR'
});

console.log(mermaid.toString());
// Render in Mermaid live editor to visualize
```

## Next Steps

- [Traversal](./traversal) — find paths between nodes
- [Visualization](./visualization) — export to Mermaid
- [API Reference](../api-reference/graph) — isDAG and topologicalSort