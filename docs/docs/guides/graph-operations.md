# Graph Operations

Create, read, update, and delete nodes and edges.

## Node Operations

### Add a Node

```typescript
const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
```

### Get a Node

```typescript
const node = await graph.getNode(nodeId);
// Returns Node | undefined
```

### Check if Node Exists

```typescript
const exists = await graph.hasNode(nodeId); // boolean
```

### Get All Nodes

```typescript
const allNodes = await graph.getNodes();
// Returns readonly Node[]
```

### Get Nodes by Filter

```typescript
// Filter by node type using GraphQueryOptions
const people = await graph.getNodes({ filter: { nodeType: 'Person' } });
```

### Remove a Node

```typescript
// Remove node only (fails if edges exist)
await graph.removeNode(nodeId);

// Remove node and all incident edges
await graph.removeNode(nodeId, true);
```

## Edge Operations

### Add an Edge

```typescript
const edge = await graph.addEdge(sourceId, targetId, 'KNOWS', { since: 2020 });
```

### Get an Edge

```typescript
const edge = await graph.getEdge(edgeId);
// Returns Edge | undefined
```

### Get All Edges

```typescript
const allEdges = await graph.getEdges();
// Returns readonly Edge[]
```

### Get Edges by Filter

```typescript
// Filter by edge type
const knowsEdges = await graph.getEdges({ filter: { edgeType: 'KNOWS' } });
```

### Remove an Edge

```typescript
await graph.removeEdge(edgeId);
```

## Property Operations

### Node Properties

```typescript
// Add a property
await graph.addNodeProperty(nodeId, 'city', 'New York');

// Update a property
await graph.updateNodeProperty(nodeId, 'city', 'Boston');

// Delete a property
await graph.deleteNodeProperty(nodeId, 'city');

// Clear all properties
await graph.clearNodeProperties(nodeId);
```

### Edge Properties

```typescript
await graph.addEdgeProperty(edgeId, 'weight', 1.5);
await graph.updateEdgeProperty(edgeId, 'weight', 2.0);
await graph.deleteEdgeProperty(edgeId, 'weight');
```

## Navigation

Use Cypher for querying relationships between nodes.

### Get Outgoing Edges (from a node)

```typescript
const result = await engine.query(`
  MATCH (source {id: $nodeId})-[r]->(target)
  RETURN type(r) AS edgeType, target.id AS targetId
`, { nodeId });

// Or filter by specific edge type
const knowsResult = await engine.query(`
  MATCH (source {id: $nodeId})-[r:KNOWS]->(target)
  RETURN target.id AS targetId
`, { nodeId });
```

### Get Incoming Edges (to a node)

```typescript
const result = await engine.query(`
  MATCH (source)-[r]->(target {id: $nodeId})
  RETURN type(r) AS edgeType, source.id AS sourceId
`, { nodeId });
```

### Get Edges Between Two Nodes

```typescript
const result = await engine.query(`
  MATCH (source {id: $sourceId})-[r]->(target {id: $targetId})
  RETURN r.id AS edgeId, type(r) AS edgeType
`, { sourceId, targetId });
```

## Indexes

Create indexes for fast property lookups:

```typescript
// Create an index on node properties
await graph.createIndex('node', 'email');

// Create an index on edge properties  
await graph.createIndex('edge', 'since');
```

## Important Note

For pattern matching and traversals, use Cypher queries.

## Next Steps

- [Traversal](./traversal) — navigate relationships
- [Filtering](./filtering) — filter by type and properties
- [API Reference](../api-reference/graph)