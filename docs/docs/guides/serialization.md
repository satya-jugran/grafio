# Serialization

Export and import your graph data as JSON.

## Export to JSON

```typescript
const data = await graph.exportJSON();
// Returns GraphData object
```

### GraphData Structure

```typescript
interface GraphData {
  graphId: string;
  nodes: NodeData[];
  edges: EdgeData[];
}

interface NodeData {
  id: string;
  labels: string[];
  createdOn?: number;
  updatedOn?: number;
  properties: Record<string, unknown>;
}

interface EdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  createdOn?: number;
  updatedOn?: number;
  properties: Record<string, unknown>;
}
```

## Import from JSON

### Static Factory Method

```typescript
const graph = await Graph.importJSON(data);
```

### With Custom Storage Provider

```typescript
const provider = new InMemoryStorageProvider({ graphId: 'backup' });
const graph = await Graph.importJSON(data, provider);
```

## Use Cases

### Backup and Restore

```typescript
// Backup
const backup = await graph.exportJSON();
saveToFile(backup);

// Restore
const restored = await Graph.importJSON(backup);
```

### Data Migration

```typescript
// Export from one storage
const data = await oldGraph.exportJSON();

// Import to different storage
const newGraph = await Graph.importJSON(data, new MongoStorageProvider(config));
```

### Testing

```typescript
const testData = require('./test-graph.json');
const graph = await Graph.importJSON(testData);
// Fresh graph for each test
```

## Complete Example

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);

// Build graph using Cypher
await engine.execute(`CREATE (a:Person {name: 'Alice'})`);
await engine.execute(`CREATE (b:Person {name: 'Bob'})`);
await engine.execute(`
  MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
  CREATE (a)-[:KNOWS]->(b)
`);

// Export
const json = await graph.exportJSON();
console.log(JSON.stringify(json, null, 2));
/*
{
  "graphId": "default",
  "nodes": [
    { "id": "@n0:1", "labels": ["Person"], "properties": { "name": "Alice" } },
    { "id": "@n1:1", "labels": ["Person"], "properties": { "name": "Bob" } }
  ],
  "edges": [
    { "id": "@e0:1", "sourceId": "@n0:1", "targetId": "@n1:1", "type": "KNOWS", "properties": {} }
  ]
}
*/

// Import to new graph
const newGraph = await Graph.importJSON(json);
const result = await newGraph.query(`MATCH (p:Person) RETURN count(p) AS count`);
const count = result.rows[0].count;
console.log(count); // 2
```

## GraphToMermaid Export

Export as Mermaid flowchart syntax:

```typescript
import { GraphToMermaid } from 'grafio';

const mermaid = await GraphToMermaid.fromGraph(graph);
console.log(mermaid.toString());
/*
flowchart TD
    abc123["Person | abc123"]
    def456["Person | def456"]
    abc123 -->|"KNOWS"| def456
*/
```

### Mermaid Options

```typescript
const mermaid = await GraphToMermaid.fromGraph(graph, {
  showProperties: true,     // Include property values
  includeEdgeLabels: true,  // Show edge types (default: true)
  direction: 'LR'          // 'TD' (top-down) or 'LR' (left-right)
});
```

## Next Steps

- [Visualization](./visualization) — graph diagram generation
- [API Reference](../api-reference/graph) — export/import methods
- [API Reference](../api-reference/graph-to-mermaid) — Mermaid API
