# Storage Provider

Interface for implementing custom storage backends.

## Import

```typescript
import { IStorageProvider, NodeData, EdgeData } from 'grafio';
```

## Interface

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

## Data Types

### NodeData

```typescript
interface NodeData {
  id: string;
  type: string;
  properties: Record<string, Primitive>;
}
```

### EdgeData

```typescript
interface EdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, Primitive>;
}
```

## StorageQueryOptions

```typescript
interface StorageQueryOptions {
  nodeType?: string;
  edgeType?: string;
  limit?: number;
  offset?: number;
}
```

## Example Implementation

```typescript
class MyStorageProvider implements IStorageProvider {
  private nodes: Map<string, Node> = new Map();
  private edges: Map<string, Edge> = new Map();

  async addNode(nodeData: NodeData): Promise<Node> {
    const node = new Node(nodeData.id, nodeData.type, nodeData.properties);
    this.nodes.set(node.id, node);
    return node;
  }

  async getNode(id: string): Promise<Node | undefined> {
    return this.nodes.get(id);
  }

  async hasNode(id: string): Promise<boolean> {
    return this.nodes.has(id);
  }

  async getNodes(options?: StorageQueryOptions): Promise<readonly Node[]> {
    const nodes = Array.from(this.nodes.values());
    return this.filterNodes(nodes, options);
  }

  // ... implement remaining methods ...

  private filterNodes(nodes: Node[], options?: StorageQueryOptions): Node[] {
    if (!options?.nodeType) return nodes;
    return nodes.filter(n => n.type === options.nodeType);
  }
}
```

## Using Custom Provider

```typescript
import { Graph } from 'grafio';
import type { IStorageProvider } from 'grafio';

const myProvider: IStorageProvider = new MyStorageProvider();
const graph = new Graph(myProvider);