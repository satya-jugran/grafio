# Graph Class

The main entry point for working with Grafio graphs.

## Import

```typescript
import { Graph } from 'grafio';
```

## Constructor

```typescript
new Graph(storageProvider?: IStorageProvider)
```

Creates a new Graph instance. If no storage provider is provided, `InMemoryStorageProvider` is used by default.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `storageProvider` | `IStorageProvider` | `InMemoryStorageProvider` | The storage backend |

## Node Operations

### addNode()

```typescript
async addNode(
  type: string,
  properties?: Record<string, unknown>,
  transaction?: GraphTransaction
): Promise<Node>
```

Adds a new node to the graph.

### getNode()

```typescript
async getNode(id: string, transaction?: GraphTransaction): Promise<Node | undefined>
```

### hasNode()

```typescript
async hasNode(id: string, transaction?: GraphTransaction): Promise<boolean>
```

### getNodes()

```typescript
async getNodes(options?: GraphQueryOptions): Promise<readonly Node[]>
```

### removeNode()

```typescript
async removeNode(
  id: string,
  cascade?: boolean,
  transaction?: GraphTransaction
): Promise<boolean>
```

## Edge Operations

### addEdge()

```typescript
async addEdge(
  sourceId: string,
  targetId: string,
  type: string,
  properties?: Record<string, unknown>,
  transaction?: GraphTransaction
): Promise<Edge>
```

### getEdge()

```typescript
async getEdge(id: string, transaction?: GraphTransaction): Promise<Edge | undefined>
```

### hasEdge()

```typescript
async hasEdge(id: string, transaction?: GraphTransaction): Promise<boolean>
```

### getEdges()

```typescript
async getEdges(options?: GraphQueryOptions): Promise<readonly Edge[]>
```

### removeEdge()

```typescript
async removeEdge(id: string, transaction?: GraphTransaction): Promise<boolean>
```

## Navigation

### getEdgesFrom()

```typescript
async getEdgesFrom(sourceId: string, options?: GraphQueryOptions): Promise<Edge[]>
```

Gets all outgoing edges from a node.

### getEdgesTo()

```typescript
async getEdgesTo(targetId: string, options?: GraphQueryOptions): Promise<Edge[]>
```

Gets all incoming edges to a node.

### getDirectEdgesBetween()

```typescript
async getDirectEdgesBetween(
  sourceId: string,
  targetId: string,
  options?: GraphQueryOptions
): Promise<Edge[]>
```

Gets all edges between two nodes (in either direction).

## Traversal & Analysis

### traverse()

```typescript
async traverse(
  sourceId: string | string[],
  targetId: string | string[],
  options?: TraversalOptions
): Promise<string[][] | null>
```

### isDAG()

```typescript
async isDAG(): Promise<boolean>
```

### topologicalSort()

```typescript
async topologicalSort(): Promise<string[] | null>
```

### warmCache()

```typescript
async warmCache(): Promise<void>
```

## Serialization

### exportJSON()

```typescript
async exportJSON(): Promise<GraphData>
```

### importJSON()

```typescript
static async importJSON(data: GraphData, storageProvider?: IStorageProvider): Promise<Graph>
```

## Property Operations

### addNodeProperty()

```typescript
async addNodeProperty(
  nodeId: string,
  key: string,
  value: unknown,
  transaction?: GraphTransaction
): Promise<void>
```

### updateNodeProperty()

```typescript
async updateNodeProperty(
  nodeId: string,
  key: string,
  value: unknown,
  transaction?: GraphTransaction
): Promise<void>
```

### deleteNodeProperty()

```typescript
async deleteNodeProperty(
  nodeId: string,
  key: string,
  transaction?: GraphTransaction
): Promise<void>
```

### clearNodeProperties()

```typescript
async clearNodeProperties(nodeId: string, transaction?: GraphTransaction): Promise<void>
```

### addEdgeProperty()

```typescript
async addEdgeProperty(
  edgeId: string,
  key: string,
  value: unknown,
  transaction?: GraphTransaction
): Promise<void>
```

### updateEdgeProperty()

```typescript
async updateEdgeProperty(
  edgeId: string,
  key: string,
  value: unknown,
  transaction?: GraphTransaction
): Promise<void>
```

### deleteEdgeProperty()

```typescript
async deleteEdgeProperty(
  edgeId: string,
  key: string,
  transaction?: GraphTransaction
): Promise<void>
```

### clearEdgeProperties()

```typescript
async clearEdgeProperties(edgeId: string, transaction?: GraphTransaction): Promise<void>
```

## Admin Operations

### createIndex()

```typescript
async createIndex(entityType: 'node' | 'edge', propertyKey: string): Promise<void>
```

### clear()

```typescript
async clear(): Promise<void>
```

## Transactions

### createTransaction()

```typescript
createTransaction(): GraphTransaction
```

### supportsTransactions()

```typescript
supportsTransactions(): boolean
```

## GraphQueryOptions

```typescript
interface GraphQueryOptions {
  filter?: {
    nodeType?: string;
    edgeType?: string;
  };
  orderBy?: IOrderBy[];
  limit?: number;
  offset?: number;
  transaction?: GraphTransaction;
}
```