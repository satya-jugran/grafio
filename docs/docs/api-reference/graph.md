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
| `storageProvider` | `IStorageProvider` | `new InMemoryStorageProvider()` | The storage backend |

## Cypher Query Operations

### query()

```typescript
async query(
  cypher: string,
  options?: CypherQueryOptions
): Promise<CypherResult & { executionPlan?: string }>

async query(
  cypher: string,
  params: Record<string, unknown> | undefined,
  options?: CypherQueryOptions
): Promise<CypherResult & { executionPlan?: string }>
```

Executes an openCypher query using the internal `CypherEngine` (with `PlanCache` reuse across calls).

### querySync()

```typescript
querySync(
  cypher: string,
  options?: CypherQueryOptions
): CypherResult & { executionPlan?: string }

querySync(
  cypher: string,
  params: Record<string, unknown> | undefined,
  options?: CypherQueryOptions
): CypherResult & { executionPlan?: string }
```

Synchronous fast path for `InMemoryStorageProvider` (and any custom `ISyncGraphKernel` provider). Throws if the backing storage provider is asynchronous-only.

### getQueryPlan()

```typescript
async getQueryPlan(
  cypher: string,
  params?: Record<string, unknown>,
  format?: PlanFormat
): Promise<string>
```

Returns the logical query plan (`'json'`, `'text'`, or `'mermaid'`) without executing the query.

## Node Operations

### addNode()

```typescript
async addNode(
  labels: string | string[],
  properties?: Record<string, unknown>,
  transaction?: GraphTransaction,
  id?: string
): Promise<Node>
```

Adds a new node to the graph.

### addNodes()

```typescript
async addNodes(
  items: ReadonlyArray<{
    labels: string | string[];
    properties?: Record<string, unknown>;
    id?: string;
  }>,
  transaction?: GraphTransaction
): Promise<Node[]>
```

Batch-inserts multiple nodes.

### getNode()

```typescript
async getNode(id: string, transaction?: GraphTransaction): Promise<Node | undefined>
```

### getNodesByIds()

```typescript
async getNodesByIds(
  ids: string[],
  transaction?: GraphTransaction
): Promise<Map<string, Node>>
```

### hasNode()

```typescript
async hasNode(id: string, transaction?: GraphTransaction): Promise<boolean>
```

### getNodes()

```typescript
async getNodes(options?: GraphQueryOptions): Promise<readonly Node[]>
```

### getNodeCount()

```typescript
async getNodeCount(options?: GraphQueryOptions): Promise<number>
```

### removeNode()

```typescript
async removeNode(
  id: string,
  cascade?: boolean,
  transaction?: GraphTransaction
): Promise<{ result: boolean; cascadeDeletedEdgesCount?: number }>
```

## Edge Operations

### addEdge()

```typescript
async addEdge(
  sourceId: string,
  targetId: string,
  type: string,
  properties?: Record<string, unknown>,
  transaction?: GraphTransaction,
  id?: string
): Promise<Edge>
```

### addEdges()

```typescript
async addEdges(
  items: ReadonlyArray<{
    sourceId: string;
    targetId: string;
    type: string;
    properties?: Record<string, unknown>;
    id?: string;
  }>,
  transaction?: GraphTransaction
): Promise<Edge[]>
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

### getEdgeCount()

```typescript
async getEdgeCount(options?: GraphQueryOptions): Promise<number>
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

### compact()

```typescript
compact(): void
```

Compacts adjacency delta buffers and dead tombstones into flat Global CSR arrays and reclaims retired CSR slots (when supported by the backing storage provider).

### warmCache()

```typescript
async warmCache(): Promise<void>
```

Warms caches on `CacheWarmableStorageProvider` backends (such as `CachedStorageProvider`). No-op for `InMemoryStorageProvider`.

## Serialization

### exportJSON()

```typescript
async exportJSON(): Promise<GraphData>
```

### importJSON()

```typescript
static async importJSON(data: GraphData, storageProvider?: IStorageProvider): Promise<Graph>
```

Rebuilds a graph from serialized `GraphData`. Raw `importJSON` preserves dangling edges cleanly if referenced endpoint nodes appear later or are inserted subsequently.

## Property & Label Operations

### setNodeProperties()

```typescript
async setNodeProperties(
  nodeId: string,
  properties: Record<string, unknown>,
  options?: { merge?: boolean; transaction?: GraphTransaction }
): Promise<void>
```

Upserts properties onto a node (`merge: true` by default). Pass `{ merge: false }` to replace all properties atomically.

### unsetNodeProperties()

```typescript
async unsetNodeProperties(
  nodeId: string,
  keys: string[],
  transaction?: GraphTransaction
): Promise<void>
```

Removes specified property keys from a node.

### removeNodeLabels()

```typescript
async removeNodeLabels(
  nodeId: string,
  labels: string[],
  transaction?: GraphTransaction
): Promise<void>
```

Removes one or more labels from a node.

### setEdgeProperties()

```typescript
async setEdgeProperties(
  edgeId: string,
  properties: Record<string, unknown>,
  options?: { merge?: boolean; transaction?: GraphTransaction }
): Promise<void>
```

Upserts (`merge: true`) or replaces (`merge: false`) properties on an edge.

### unsetEdgeProperties()

```typescript
async unsetEdgeProperties(
  edgeId: string,
  keys: string[],
  transaction?: GraphTransaction
): Promise<void>
```

Removes specified property keys from an edge.

## Index & Aggregation Operations

### createIndex()

```typescript
async createIndex(
  name: string,
  target: 'node' | 'edge',
  propertyKeys: string[],
  options?: CreateIndexOptions
): Promise<void>
```

Creates an explicit single-key or compound property index (optionally scoped by `{ labelOrType }`).

### hasIndex()

```typescript
async hasIndex(
  target: 'node' | 'edge',
  propertyKeys: string[],
  labelOrType?: string
): Promise<boolean>
```

### getIndex() / getIndexes() / deleteIndex()

```typescript
async getIndex(name: string): Promise<IndexMetadata | undefined>
async getIndexes(): Promise<IndexMetadata[]>
async deleteIndex(name: string): Promise<void>
```

### aggregateNodeProperty() / aggregateEdgeProperty()

```typescript
async aggregateNodeProperty(
  key: string,
  options?: GraphQueryOptions
): Promise<AggregateResult>

async aggregateEdgeProperty(
  key: string,
  options?: GraphQueryOptions
): Promise<AggregateResult>
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
    types?: string[];
    properties?: QueryOptionsFilterProperty[];
  };
  orderBy?: IOrderBy;
  limit?: number;
  distinct?: boolean;
  transaction?: GraphTransaction;
}
```
