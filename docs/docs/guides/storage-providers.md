# Storage Providers

Grafio's pluggable storage architecture lets you swap backends without changing application code.

## Built-in Providers

| Provider | Description | Package |
|----------|-------------|---------|
| `InMemoryStorageProvider` | Zero-dependency, in-memory | Built-in |
| `MongoStorageProvider` | MongoDB-backed persistence | `grafio-mongo` |

## InMemoryStorageProvider

The default storage provider — no dependencies required.

```typescript
import { InMemoryGraphFactory } from 'grafio';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph();
```

### Options

```typescript
interface InMemoryStorageProviderOptions {
  graphId?: string;  // default: 'default'
}
```

```typescript
// Multiple isolated graphs
const factory = new InMemoryGraphFactory();
const graph1 = factory.forGraph('graph1');
const graph2 = factory.forGraph('graph2');
```

## IStorageProvider Interface

Implement this interface to create custom storage backends:

```typescript
interface IStorageProvider {
  // Lifecycle
  clear(): Promise<void>;

  // Node mutations
  insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void>;
  deleteNode(id: string, transaction?: ITransactionHandle): Promise<void>;

  // Node queries
  hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean>;
  getNode(id: string, transaction?: ITransactionHandle): Promise<NodeData | undefined>;
  getNodesByIds(ids: string[], transaction?: ITransactionHandle): Promise<Map<string, NodeData>>;
  getNodeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateNodeProperty(key: string, options?: StorageQueryOptions): Promise<AggregateResult>;
  getNodes(options?: StorageQueryOptions): Promise<NodeData[]>;

  // Edge mutations
  insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void>;
  deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void>;

  // Edge queries
  hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean>;
  getEdge(id: string, transaction?: ITransactionHandle): Promise<EdgeData | undefined>;
  getEdgeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateEdgeProperty(key: string, options?: StorageQueryOptions): Promise<AggregateResult>;
  getEdges(options?: StorageQueryOptions): Promise<EdgeData[]>;

  // Adjacency queries
  getEdgesBySource(nodeId: string, options?: StorageQueryOptions): Promise<EdgeData[]>;
  getEdgesByTarget(nodeId: string, options?: StorageQueryOptions): Promise<EdgeData[]>;
  getDirectEdgesBetween(sourceId: string, targetId: string, options?: StorageQueryOptions): Promise<EdgeData[]>;

  // Property mutations
  addProperty(target: 'node' | 'edge', id: string, key: string, value: unknown, transaction?: ITransactionHandle): Promise<void>;
  updateProperty(target: 'node' | 'edge', id: string, key: string, value: unknown, transaction?: ITransactionHandle): Promise<void>;
  deleteProperty(target: 'node' | 'edge', id: string, key: string, transaction?: ITransactionHandle): Promise<void>;
  clearProperties(target: 'node' | 'edge', id: string, transaction?: ITransactionHandle): Promise<void>;

  // Index management
  createIndex(target: 'node' | 'edge', propertyKey: string, type?: string): Promise<void>;
  hasIndex(target: 'node' | 'edge', propertyKey: string): Promise<boolean>;

  // Serialization
  exportJSON(): Promise<GraphData>;
  importJSON(data: GraphData): Promise<void>;
}
```

## MongoDB Storage

For MongoDB-backed persistence, see the dedicated [MongoDB Storage](./mongodb-storage) guide.

The [`grafio-mongo`](https://www.npmjs.com/package/grafio-mongo) package provides `MongoGraphFactory` with full support for:
- Automatic index creation (`ensureIndexes()`)
- Custom collection names
- GraphManager caching integration

## GraphManager Integration

```typescript
import { GraphManager, InMemoryGraphFactory } from 'grafio';

GraphManager.init({
  cache: {
    cacheStore: 'in-memory',
    maxNodesCount: 10000,
    maxEdgesCount: 20000,
  }
});

// Graph instances from factory automatically use caching when GraphManager is initialized
const factory = new InMemoryGraphFactory();
const graph = factory.forGraph();
```

## Next Steps

- [Caching](./caching) — cache configuration
- [Serialization](./serialization) — JSON import/export
- [API Reference](../api-reference/storage-provider) — interface details