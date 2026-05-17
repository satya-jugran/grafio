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
import { Graph, InMemoryStorageProvider } from 'grafio';

const provider = new InMemoryStorageProvider();
const graph = new Graph(provider);
```

### Options

```typescript
interface InMemoryStorageProviderOptions {
  graphId?: string;  // default: 'default'
}
```

```typescript
// Multiple isolated graphs
const graph1 = new Graph(new InMemoryStorageProvider({ graphId: 'graph1' }));
const graph2 = new Graph(new InMemoryStorageProvider({ graphId: 'graph2' }));
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

See the [`grafio-mongo`](https://www.npmjs.com/package/grafio-mongo) package for MongoDB-backed persistence.

```typescript
import { Graph } from 'grafio';
import { MongoStorageProvider } from 'grafio-mongo';

const provider = new MongoStorageProvider({
  connectionString: 'mongodb://localhost:27017',
  database: 'grafio'
});

const graph = new Graph(provider);
```

## GraphManager Integration

```typescript
import { GraphManager, InMemoryStorageProvider } from 'grafio';

GraphManager.init({
  cache: {
    cacheStore: 'in-memory',
    maxNodesCount: 10000,
    maxEdgesCount: 20000,
  }
});

// Graph instances automatically use caching when GraphManager is initialized
const graph = new Graph(new InMemoryStorageProvider());
```

## Next Steps

- [Caching](./caching) — cache configuration
- [Serialization](./serialization) — JSON import/export
- [API Reference](../api-reference/storage-provider) — interface details