# Traversal

Find paths between nodes using BFS or DFS algorithms.

## Basic Traversal

```typescript
const paths = await graph.traverse(sourceId, targetId);
// Returns string[][] — array of node ID arrays
```

## Traversal Options

```typescript
interface TraversalOptions {
  method?: 'bfs' | 'dfs';    // default: 'bfs'
  nodeTypes?: string[];        // filter by node types
  edgeTypes?: string[];        // filter by edge types
  maxResults?: number;         // limit results (default: 100)
}
```

## Examples

### Find Direct Path

```typescript
const paths = await graph.traverse(authorId, chapterId, { method: 'bfs' });
// [['authorId', 'courseId', 'chapterId']]
```

### Find Multi-Hop Path

```typescript
const paths = await graph.traverse(aliceId, bobId, { 
  method: 'dfs',
  maxResults: 5 
});
```

### Filter by Node Types

```typescript
const paths = await graph.traverse(authorId, courseId, {
  nodeTypes: ['Author', 'Course', 'Chapter']
});
```

### Filter by Edge Types

```typescript
const paths = await graph.traverse(authorId, courseId, {
  edgeTypes: ['AUTHOR_OF']
});
```

## Wildcard Traversal

Use `'*'` to match any node:

```typescript
// Find path from any node to target
await graph.traverse('*', targetId);

// Find path from source to any reachable node
await graph.traverse(sourceId, '*');

// Find all paths between all nodes
await graph.traverse('*', '*');

// Multiple sources to multiple targets
await graph.traverse(['a', 'b'], ['x', 'y']);
```

## Algorithm Choice

| Algorithm | Best For | Behavior |
|-----------|----------|----------|
| **BFS** | Shortest path | Explores layer by layer |
| **DFS** | Deep exploration | Explores as far as possible first |

### Automatic Selection

When `LIMIT` is used in Cypher queries, DFS is automatically selected for better early-result performance.

## Topological Sort

For DAGs, get the dependency order:

```typescript
const order = await graph.topologicalSort();
// Returns ['authorId', 'courseId', 'chapterId'] or null if cycles exist
```

## DAG Detection

Check if your graph is acyclic:

```typescript
const isDag = await graph.isDAG();
// true if no cycles, false otherwise
```

## Next Steps

- [Cypher Language](./cypher-language) — query with pattern matching
- [Graph Analysis](./graph-analysis) — DAG and topological sort details
- [API Reference](../api-reference/graph)