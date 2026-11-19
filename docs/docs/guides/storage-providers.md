# Storage Providers

Grafio's pluggable storage architecture lets you swap backends without changing application code.

## Built-in Providers

| Provider | Description | Package |
|----------|-------------|---------|
| `InMemoryStorageProvider` | Zero-dependency, in-memory SoA + CSR | Built-in |
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
  graphId?: string;               // default: 'default'
  idStrategy?: 'compact' | 'uuid'; // default: 'compact'
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
  readonly indexEpoch: number;

  // Lifecycle
  clear(): Promise<void>;
  compact?(): void;

  // Node mutations
  insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void>;
  insertNodes(nodes: readonly NodeData[], transaction?: ITransactionHandle): Promise<void>;
  deleteNode(id: string, transaction?: ITransactionHandle): Promise<void>;

  // Node queries
  hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean>;
  getNode(id: string, transaction?: ITransactionHandle): Promise<ReadonlyNodeData | undefined>;
  getNodesByIds(ids: string[], transaction?: ITransactionHandle): Promise<Map<string, ReadonlyNodeData>>;
  getNodeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateNodeProperty(key: string, options?: StorageQueryOptions): Promise<AggregateResult>;
  getNodes(options?: StorageQueryOptions): Promise<ReadonlyNodeData[]>;

  // Edge mutations
  insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void>;
  insertEdges(edges: readonly EdgeData[], transaction?: ITransactionHandle): Promise<void>;
  deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void>;

  // Edge queries
  hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean>;
  getEdge(id: string, transaction?: ITransactionHandle): Promise<ReadonlyEdgeData | undefined>;
  getEdgeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateEdgeProperty(key: string, options?: StorageQueryOptions): Promise<AggregateResult>;
  getEdges(options?: StorageQueryOptions): Promise<ReadonlyEdgeData[]>;
  getEdgesBySource(nodeId: string, options?: StorageQueryOptions): Promise<ReadonlyEdgeData[]>;
  getEdgesByTarget(nodeId: string, options?: StorageQueryOptions): Promise<ReadonlyEdgeData[]>;

  // Property and label mutations
  removeNodeLabels(nodeId: string, labels: string[], transaction?: ITransactionHandle): Promise<void>;
  patchProperties(target: 'node' | 'edge', id: string, patch: PropertyPatch, transaction?: ITransactionHandle): Promise<void>;

  // Index management
  createIndex(name: string, target: 'node' | 'edge', propertyKeys: string[], options?: CreateIndexOptions): Promise<void>;
  hasIndex(target: 'node' | 'edge', propertyKeys: string[], labelOrType?: string): Promise<boolean>;
  getIndex(name: string): Promise<IndexMetadata | undefined>;
  deleteIndex(name: string): Promise<void>;
  getIndexes(): Promise<IndexMetadata[]>;

  // Serialization & transactions
  exportJSON(): Promise<GraphData>;
  importJSON(data: GraphData): Promise<void>;
  supportsTransactions(): boolean;
  beginTransaction(): Promise<ITransactionHandle>;
  commitTransaction(handle: ITransactionHandle): Promise<void>;
  rollbackTransaction(handle: ITransactionHandle): Promise<void>;
}
```

## MongoDB Storage

For MongoDB-backed persistence, see the dedicated [MongoDB Storage](./mongodb-storage) guide.

The [`grafio-mongo`](https://www.npmjs.com/package/grafio-mongo) package provides `MongoGraphFactory` with full support for:
- Automatic index creation (`ensureIndexes()`)
- Custom collection names
- GraphManager caching integration

## GraphManager & Remote Caching

`GraphManager` coordinates caching for remote/async storage providers (like `grafio-mongo`) via `CachedStorageProvider`. In-memory instances created via `InMemoryGraphFactory` run directly on `InMemoryStorageProvider` with zero caching overhead.

```typescript
import { GraphManager } from 'grafio';
// Plus a remote factory/provider such as `MongoGraphFactory` from `grafio-mongo`

GraphManager.init({
  cache: {
    cacheStore: 'in-memory',
    maxNodesCount: 10000,
    maxEdgesCount: 20000,
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  },
});
```

## Next Steps

- [Caching](./caching) — cache configuration
- [Serialization](./serialization) — JSON import/export
- [API Reference](../api-reference/storage-provider) — interface details
