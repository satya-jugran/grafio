# Storage Provider

Interface for implementing custom storage backends.

## Import

```typescript
import {
  IStorageProvider,
  ISyncGraphKernel,
  NodeData,
  EdgeData,
  PropertyPatch,
} from 'grafio';
```

## Interface

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
  getNodesByIds(
    ids: string[],
    transaction?: ITransactionHandle,
  ): Promise<Map<string, ReadonlyNodeData>>;
  getNodeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateNodeProperty(
    key: string,
    options?: StorageQueryOptions,
  ): Promise<AggregateResult>;
  getNodes(options?: StorageQueryOptions): Promise<ReadonlyNodeData[]>;

  // Edge mutations
  insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void>;
  insertEdges(edges: readonly EdgeData[], transaction?: ITransactionHandle): Promise<void>;
  deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void>;

  // Edge queries
  hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean>;
  getEdge(id: string, transaction?: ITransactionHandle): Promise<ReadonlyEdgeData | undefined>;
  getEdgeCount(options?: StorageQueryOptions): Promise<number>;
  aggregateEdgeProperty(
    key: string,
    options?: StorageQueryOptions,
  ): Promise<AggregateResult>;
  getEdges(options?: StorageQueryOptions): Promise<ReadonlyEdgeData[]>;
  getEdgesBySource(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]>;
  getEdgesByTarget(
    nodeId: string,
    options?: StorageQueryOptions,
  ): Promise<ReadonlyEdgeData[]>;

  // Property and label mutations
  removeNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: ITransactionHandle,
  ): Promise<void>;
  patchProperties(
    target: 'node' | 'edge',
    id: string,
    patch: PropertyPatch,
    transaction?: ITransactionHandle,
  ): Promise<void>;

  // Index management
  createIndex(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): Promise<void>;
  hasIndex(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): Promise<boolean>;
  getIndex(name: string): Promise<IndexMetadata | undefined>;
  deleteIndex(name: string): Promise<void>;
  getIndexes(): Promise<IndexMetadata[]>;

  // Data portability
  exportJSON(): Promise<GraphData>;
  importJSON(data: GraphData): Promise<void>;

  // Transaction support
  supportsTransactions(): boolean;
  beginTransaction(): Promise<ITransactionHandle>;
  commitTransaction(handle: ITransactionHandle): Promise<void>;
  rollbackTransaction(handle: ITransactionHandle): Promise<void>;
}
```

## Optional Capabilities

- **`ISyncGraphKernel`** (`isSyncGraphKernel(provider)`): Optional synchronous execution kernel implemented by `InMemoryStorageProvider` to power `graph.querySync()` and zero-allocation TypedArray traversal.
- **`CacheWarmableStorageProvider`** (`isCacheWarmableStorageProvider(provider)`): Optional `warmCache(): Promise<void>` hook implemented by `CachedStorageProvider`.

## Data Types

### NodeData

```typescript
interface NodeData {
  id: string;
  labels: string[];
  createdOn?: number;
  updatedOn?: number;
  properties: Record<string, unknown>;
}
```

### EdgeData

```typescript
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

### PropertyPatch

```typescript
interface PropertyPatch {
  set?: Readonly<Record<string, unknown>>;
  unset?: readonly string[];
  replace?: boolean;
}
```

## StorageQueryOptions

```typescript
interface StorageQueryOptions {
  filter?: {
    types?: string[];
    properties?: QueryOptionsFilterProperty[];
  };
  orderBy?: IOrderBy;
  limit?: number;
  distinct?: boolean;
  transaction?: ITransactionHandle;
}
```

## Using Custom Provider

```typescript
import { Graph } from 'grafio';
import type { IStorageProvider } from 'grafio';

class CustomStorageProvider implements IStorageProvider {
  // Implement IStorageProvider methods for your backend
  // ...
}

const provider: IStorageProvider = new CustomStorageProvider();
const graph = new Graph(provider);
```
