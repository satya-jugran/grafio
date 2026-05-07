# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.4.1] - 2026-05-07

### 🐛 Bug Fixes

1. **Added exports field to package.json**
   - Added proper `exports` field for Node.js module resolution
   - Exports main entry point (`grafio`) and testing utilities (`grafio/testing`)
   - Ensures TypeScript and bundlers can correctly resolve package subpaths

## [5.4.0] - 2026-05-05

### ✨ New Features

1. **Transaction-Aware Query Methods**
   - All public Graph methods now accept an optional `transaction` parameter
   - Query methods (`getNode`, `getNodes`, `hasNode`, `hasEdge`, `getEdges`, `getNodesByProperty`, `getEdgesByType`, `getEdgesByProperty`) support transactions
   - Navigation methods (`getParents`, `getChildren`, `getEdgesFrom`, `getEdgesTo`, `getDirectEdgesBetween`) support transactions
   - Traversal method (`traverse`) supports transactions
   - Allows reading uncommitted changes within a transaction context

2. **GraphOptions API for Improved Ergonomics**
   - Added `GraphOptions<T>` type to consolidate filter options and transaction in a single parameter
   - Query methods (`getNodesByProperty`, `getEdgesByProperty`, `getParents`, `getChildren`) now accept `options?: GraphOptions<{...}>` instead of separate `options` and `transaction` parameters
   - Navigation methods (`getEdgesFrom`, `getEdgesTo`, `getDirectEdgesBetween`) also updated to use GraphOptions
   - Allows cleaner API usage: `{ transaction: tx }` or `{ filter: { edgeType: 'KNOWS' } }`
   - Exported `GraphOptions` type from the library for external use

### 🐛 Bug Fixes

1. **Tombstone Fallback Bug in InMemoryStorageProvider**
   - Fixed `addProperty`, `updateProperty`, `deleteProperty`, `clearProperties` methods
   - When a node/edge was deleted within a transaction, the overlay stored `null` as tombstone
   - Previously, property mutations on deleted records would fall back to live store (resurrecting them)
   - Now throws `NodeNotFoundError`/`EdgeNotFoundError` when overlay tombstone is detected

2. **getParents Performance Optimization**
   - `getParents` now passes `edgeType` filter directly to `getEdgesByTarget()` storage method
   - Enables storage implementations (e.g., MongoDB with adjacency indexes) to filter at storage level
   - Previously always passed `undefined` and filtered in JavaScript

## [5.3.0] - 2026-05-04

### ✨ New Features

1. **Transaction Support**
   - Added `GraphTransaction` class for managing multi-operation atomic updates
   - `begin()`, `commit()`, `rollback()` lifecycle methods
   - `isActive()`, `isFailed()` state tracking
   - `TransactionNotActiveError` and `TransactionFailedError` error classes

2. **Storage Provider Transaction Interface**
   - Extended `IStorageProvider` with `ITransactionHandle` interface and transaction methods
   - `supportsTransactions()`, `beginTransaction()`, `commitTransaction()`, `rollbackTransaction()`
   - All mutation and query methods now accept optional transaction handle

3. **MongoDB Transaction Implementation**
   - MongoDB transactions using `ClientSession` with replica set support
   - All operations pass session to MongoDB for proper transaction isolation
   - Requires MongoDB 4.0+ with replica set or sharded cluster

4. **InMemory Transaction Implementation**
   - Copy-on-write snapshot approach for transaction isolation
   - Snapshots stored by transaction ID for concurrent transaction support
   - On commit: snapshot cleared, live state retains changes
   - On rollback: live state restored from snapshot

5. **Graph API Updates**
   - Added `createTransaction()` method to `Graph` class
   - Added `supportsTransactions()` method to check provider capability
   - All mutation methods (`addNode`, `addEdge`, `removeNode`, `removeEdge`) accept optional transaction parameter
   - All property methods (`addNodeProperty`, `updateNodeProperty`, `deleteNodeProperty`, `clearNodeProperties`, `addEdgeProperty`, `updateEdgeProperty`, `deleteEdgeProperty`, `clearEdgeProperties`) accept optional transaction parameter
   - Transaction handle passed through to storage provider operations

## [5.2.0] - 2026-05-03

### ✨ New Features

1. **Property Constraints**
   - Added `isPrimitive()` validation ensuring property values are only supported primitive types (string, number, boolean, null, undefined)
   - Properties must be flat structure with supported primitive-only values (no nested objects, no arrays)
   - `InvalidPropertyError` thrown for non-supported primitive values

2. **createIndex() Method**
   - Added `createIndex(target, propertyKey, type?)` method to both `InMemoryStorageProvider` and `MongoStorageProvider`
   - Supports compound indexes when type is specified: `createIndex('node', 'email', 'Person')` creates index on (type, propertyKey)
   - Simple indexes created when type is '*' or not specified

3. **Property CRUD Methods**
   - Unified methods at `IStorageProvider` level: `addProperty`, `updateProperty`, `deleteProperty`, `clearProperties`
   - Separate convenience methods at `Graph` level for better developer experience:
     - `addNodeProperty`, `updateNodeProperty`, `deleteNodeProperty`, `clearNodeProperties`
     - `addEdgeProperty`, `updateEdgeProperty`, `deleteEdgeProperty`, `clearEdgeProperties`
   - `PropertyAlreadyExistsError` and `PropertyNotFoundError` error classes added

4. **Validation at Public API Boundary**
   - Property validation moved from internal `Node`/`Edge` constructors to public API boundary (`GraphIndex.addNode`/`addEdge`)
   - Validation occurs in `addNodeProperty`/`updateNodeProperty` methods

## [5.1.0] - 2026-05-02

### ✨ New Features

1. **MongoDB Performance Test Suite** — `perf/mongodb/`
   - Added `entryPoint.ts` for MongoDB-backed graph benchmarks.
   - Added `scenarios.ts` with Write, Read, Navigation, and Traversal benchmarks.
   - Uses `MongoGraphFactory.fromGraphData()` for efficient data import.

2. **MongoDB Performance Improvements**
   - Batched cursor streaming in `getAllNodes()` / `getAllEdges()` with configurable `batchSize`.
   - Replaced `countDocuments()` with `findOne()` in `hasNode()` / `hasEdge()`.
   - Added optional `type` parameter to `getEdgesBySource()` / `getEdgesByTarget()` for compound index usage.
   - Parallel duplicate checks + batched inserts in `importJSON()`.
   - Type-aware wildcard expansion in `_normalizeToNodeIds()` using `nodeTypes` filter.
   - Wildcard traversal normalization now enforces a 100-node expansion limit to prevent unbounded traversals.
   - `traverse()` hardcodes `maxResults=10` when both `sourceId` and `targetId` are wildcards.
   - `TraversalLimitExceededError` thrown when wildcard expansion exceeds limit.

3. **`MongoGraphFactory.fromGraphData()`**
   - Convenience method combining `forGraph()` + `importJSON()`.
   - Filters incoming data by `graphId` partition for multi-graph data scenarios.

### 🐛 Bug Fixes

- `buildGraph()` now uses `InMemoryStorageProvider` with correct `graphId` instead of default provider.

## [5.0.0] - 2026-05-01

### 🚨 Breaking Changes

1. **All `Graph` methods are now `async`** (return `Promise<T>`)
   - Every public method on `Graph` — `addNode()`, `addEdge()`, `getNodes()`, `traverse()`, `isDAG()`, `topologicalSort()`, `exportJSON()`, `importJSON()`, `clear()`, etc. — now returns a `Promise`.
   - Callers must `await` every call: `const node = await graph.addNode('Person', { name: 'Alice' })`
   - This is required to support async backends (MongoDB, future SQL adapters) without a separate `AsyncGraph` class.

2. **`GraphToMermaid` no longer accepts a `Graph` instance in its constructor**
   - Old: `new GraphToMermaid(graph, options)`
   - New: `await GraphToMermaid.fromGraph(graph, options)` — static async factory method
   - Constructor still accepts `GraphData | string` for synchronous construction from serialized data.

3. **`IStorageProvider` interface is fully async**
   - All methods now return `Promise<T>`. Any custom `IStorageProvider` implementation must be updated.

### ✨ New Features

1. **`MongoStorageProvider`** — `src/storage/MongoStorageProvider.ts`
   - Full `IStorageProvider` implementation backed by MongoDB.
   - Uses two collections: `sgdb_nodes` and `sgdb_edges` (configurable).
   - `ensureIndexes()` creates unique compound indexes on `(graphId, id)`, type indexes, and adjacency indexes for efficient queries.
   - `importJSON()` uses `insertMany` for efficient bulk loading with ordered inserts for deterministic ordering.
   - `exportJSON()` uses `Promise.all` for parallel node + edge fetching.
   - `mongodb` is an **optional** peer dependency (`>= 5.0.0`). Install it only when using `MongoStorageProvider`.

2. **`GraphToMermaid.fromGraph()` static async factory**
   - `static async fromGraph(graph: Graph, options?: MermaidOptions): Promise<GraphToMermaid>`
   - Replaces the removed `Graph` constructor overload.

3. **`InMemoryStorageProvider` is now fully async**
   - All methods are `async` returning `Promise<T>`.
   - No real async overhead — resolved immediately via the microtask queue.
   - Enables zero-code migration to an async backend by swapping the provider.

4. **Multi-Graph Support via `graphId` Partitioning**
   - All providers now support a `graphId` option (default: `"default"`) to partition data.
   - `MongoStorageProvider` scopes all queries with `graphId` filter using compound `(graphId, id)` unique indexes.
   - `InMemoryStorageProvider` uses `Map<graphId, ...>` internally for partitioning.
   - `GraphData` interface now accepts optional `graphId` field for import/export scoping.

5. **Graph Factory Pattern**
   - `IGraphFactory` interface: `createGraph(options?): Promise<Graph>`
   - `MongoGraphFactory`: async factory that manages MongoDB client lifecycle and provider creation.
   - `InMemoryGraphFactory`: simple factory for in-memory graphs.
   - Both factories accept optional `graphId` parameter for multi-graph scenarios.

### 📦 New Exports

- `MongoStorageProvider` — MongoDB storage backend
- `MongoStorageProviderOptions` — configuration type for `MongoStorageProvider`
- `IGraphFactory` — factory interface for creating Graph instances
- `MongoGraphFactory` — MongoDB-backed Graph factory
- `InMemoryGraphFactory` — in-memory Graph factory
- `InMemoryStorageProviderOptions` — configuration type for `InMemoryStorageProvider`

### 🔧 Internal Changes

- `GraphIndex`, `GraphTraversal`, `GraphAdminOps` all async-native internally.
- `perf/` benchmark system updated to async (`buildGraph`, `runScenario`, all scenario setup/run functions).
- `MongoStorageProvider` document schema: `id` field (user-facing node/edge id) is now separate from MongoDB `_id` (internal ObjectId), with `graphId` field for partitioning.
- Tests split into `*.inmemory.test.ts` and `*.mongo.test.ts` variants running against both backends — 313 tests across 16 suites.

---

## [4.0.0] - 2026-04-30

### 🚨 Breaking Changes

1. **`Graph` constructor signature changed**
   - Old: `new Graph()`
   - New: `new Graph(storageProvider?: IStorageProvider)`
   - Default behaviour is unchanged — omitting the argument uses `InMemoryStorageProvider` internally
   - Passing a custom provider enables pluggable backends (SQLite, LMDB, etc.)

2. **`GraphSerializer` deleted**
   - `GraphSerializer` class is removed entirely
   - Replaced by `GraphAdminOps` + provider-owned `exportJSON`/`importJSON`

### ✨ New Features

1. **`IStorageProvider` — Pluggable Storage Abstraction**
   - New `IStorageProvider` interface in `src/storage/IStorageProvider.ts`
   - Defines the full contract for node/edge CRUD, type indexes, property index, adjacency index, `exportJSON()`, `importJSON()`, and `clear()`
   - Any future backend (SQLite, LMDB, MongoDB) implements this interface; no Graph logic changes

2. **`InMemoryStorageProvider` — Default Implementation**
   - New `InMemoryStorageProvider` class in `src/storage/InMemoryStorageProvider.ts`
   - All Map/Set logic moved here from the old `GraphIndex`
   - Implements provider-owned `exportJSON()` (full iteration) and `importJSON()` (with full validation)
   - Used automatically when no provider is passed to `new Graph()`

3. **`GraphAdminOps` — Replaces `GraphSerializer`**
   - New `GraphAdminOps` class in `src/Graph/GraphAdminOps.ts`
   - `constructor(store: IStorageProvider)`
   - `exportJSON(): GraphData` — delegates to `store.exportJSON()`
   - `importJSON(data: GraphData): void` — delegates to `store.importJSON(data)`
   - Each storage provider owns its own import/export strategy (e.g. batching for DB backends)

4. **`Graph.exportJSON()` and `Graph.importJSON()` (new primary API)**
   - `graph.exportJSON(): GraphData` — serialize the graph to a JSON-compatible object
   - `Graph.importJSON(data: GraphData, storageProvider?: IStorageProvider): Graph` — reconstruct a graph from data, with optional custom provider

5. **`GraphTraversal` decoupled from `GraphIndex`**
   - `GraphTraversal` now takes `IStorageProvider` directly instead of `GraphIndex`
   - Enables traversal over any storage backend without a `GraphIndex` wrapper

### 🗑️ Deprecated (kept for backward compatibility)

- `graph.toJSON()` — use `graph.exportJSON()` instead
- `Graph.fromJSON(data)` — use `Graph.importJSON(data)` instead

### 🆕 New Exports

- `IStorageProvider` (type) — storage provider interface
- `InMemoryStorageProvider` — default in-memory implementation
- `GraphAdminOps` — admin operations class

### 🔒 Internal Improvements

- `GraphIndex` is now a pure CRUD orchestrator: all Map/Set storage moved to `InMemoryStorageProvider`
- All `@internal` accessor methods (`_getNodeMap`, `_getEdgeMap`, `_getEdgesBySource`, `_getEdgesByTarget`, `_insertNode`, `_insertEdge`, `_removeEdgeInternal`) removed from `GraphIndex`
- `GraphIndex._getStore()` is the only remaining internal accessor, used once in `Graph.ts`

---

## [3.2.0] - 2026-04-29

### 🔒 Internal Improvements

> These are internal correctness, safety, and performance fixes with no changes to the public API.

1. **Encapsulation — `GraphIndex` internal maps made private**
   - All internal `Map` fields (`_nodes`, `_edges`, `_nodesByType`, etc.) are now `private`
   - Controlled package-internal accessors (`_getNodeMap()`, `_getEdgeMap()`, `_getEdgesBySource()`, `_getEdgesByTarget()`, `_insertNode()`, `_insertEdge()`) expose only what `GraphTraversal` and `GraphSerializer` need
   - Prevents external code from bypassing validation and corrupting graph state

2. **Correctness — `removeNode(cascade: false)` now throws instead of leaving dangling edges**
   - Previously, calling `removeNode(id)` on a node with incident edges silently removed the node but left orphaned edges in `_edges`
   - Now throws `NodeHasEdgesError` (newly exported) if the node has any incident edges
   - Use `removeNode(id, true)` to cascade-remove all incident edges along with the node

3. **Correctness — DFS traversal fixed**
   - `_traverseSingle()` previously populated both a `queue` and a `stack` on every call, causing DFS to behave identically to BFS
   - Now uses a single `frontier` array operated as a queue (BFS) or stack (DFS) based on `method`

4. **Performance — O(1) `getNodesByProperty()` via property value index**
   - Added `_nodesByProperty: Map<key, Map<serializedValue, Set<nodeId>>>` index maintained on every `addNode`, `removeNode`, and `_insertNode`
   - `getNodesByProperty()` is now O(1) instead of O(n)

5. **Correctness — Deep-freeze on `Node` and `Edge` properties**
   - Previously `Object.freeze()` was applied only at the top level of properties, leaving nested objects mutable
   - New `deepFreeze()` utility recursively freezes all nested plain-object and array values

6. **Correctness — `fromJSON()` no longer bypasses index validation**
   - `GraphSerializer.fromJSON()` previously wrote directly into private maps, skipping source/target existence checks
   - Now validates source/target node existence before inserting each edge

7. **Performance — `toJSON()` no longer runs `topologicalSort()` unconditionally**
   - Previously every `toJSON()` call triggered a full O(V+E) topological sort just to order the output
   - Nodes are now serialized in stable insertion order; `_traversal` dependency removed from `GraphSerializer`

### 🆕 New Exports

- `NodeHasEdgesError` — thrown when `removeNode(id)` is called without `cascade` on a node that still has incident edges

---

## [3.1.0] - 2026-04-18

### ✨ New Features

1. **GraphToMermaid - Mermaid Diagram Generation**
   - New `GraphToMermaid` class to convert graph data to Mermaid flowchart syntax
   - Supports both `Graph` instances and JSON serialized data
   - Configurable options: `showProperties`, `includeEdgeLabels`, `direction`
   - Generates `flowchart TD` or `flowchart LR` directed graphs
   - Node labels show type and id; edges show relationship types
   - Example usage:
     ```typescript
     import { Graph, GraphToMermaid } from 'grafio';
     
     const graph = new Graph();
     const alice = graph.addNode('Person', { name: 'Alice' });
     const bob = graph.addNode('Person', { name: 'Bob' });
     graph.addEdge(alice.id, bob.id, 'KNOWS');
     
     const mermaid = new GraphToMermaid(graph);
     console.log(mermaid.toString());
     // flowchart TD
     //     abc123["Person | abc123"]
     //     def456["Person | def456"]
     //     abc123 -->|"KNOWS"| def456
     ```
### 🧪 Test Coverage

- **SocialGraph.test.ts** - 75 tests (Facebook-style social graph with People, Posts, Photos, Comments)

---

## [3.0.0] - 2026-04-14

### 🚨 Breaking Changes

1. **TraversalOptions API Updated**
   - `nodeType` renamed to `nodeTypes` (array instead of single string)
   - `edgeType` renamed to `edgeTypes` (array instead of single string)
   - Default value changed from `'*'` to `['*']` (wildcard array means include all)

2. **traverse() Return Type Changed**
   - Old: `string[] | null` (single path)
   - New: `string[][] | null` (array of paths)
   - Source and target now accept wildcards: `string | string[]`

### ✨ New Features

1. **Wildcard Traversal**
   - `traverse('*', target)` - find one path for each matching source to target
   - `traverse(source, '*')` - find one path from source to each matching target
   - `traverse('*', '*')` - find one path for each matching source/target combination
   - `traverse(['a', 'b'], ['x', 'y'])` - find one path for each matching source/target pair between the provided node sets

2. **Multi-Type Filtering**
   - `nodeTypes: ['TypeA', 'TypeB']` - match nodes of type A OR B
   - `edgeTypes: ['EDGE1', 'EDGE2']` - match edges of type 1 OR 2
   - Wildcard `'*'` in array means include all types

3. **maxResults Option**
   - `maxResults: number` - limit number of paths returned during wildcard traversal (default: 100)
   - Useful for large graphs where only first N paths are needed
   - Paths are returned in source→target order until limit is reached

---

## [2.1.0] - 2026-04-12

### 🚀 Performance Improvements

1. **Adjacency Maps for O(1) Lookups**
   - Added `_edgesBySource` and `_edgesByTarget` adjacency maps for constant-time edge lookups
   - Added `_nodesByType` and `_edgesByType` type index maps for fast type-based queries
   - `getParents()`, `getChildren()`, `getEdgesFrom()`, `getEdgesTo()`, `getDirectEdgesBetween()` now use adjacency maps instead of O(n) array iteration
   - `getNodesByType()`, `getEdgesByType()` now use type index maps
   - `isDAG()` uses adjacency map for cycle detection
   - `removeNode(cascade)` uses adjacency maps for efficient incident edge cleanup

### ✨ New Features

1. **Type-Filtered Traversal**
   - `traverse()` now accepts `TraversalOptions` with `nodeType` and `edgeType` filters
   - `getParents()`, `getChildren()` now accept optional `nodeType` and `edgeType` filters
   - `getEdgesFrom()`, `getEdgesTo()`, `getDirectEdgesBetween()` now accept optional `edgeType` filter
   - `getNodesByProperty()` now accepts optional `nodeType` filter

2. **Topological Sort**
   - New `topologicalSort()` method using Kahn's algorithm
   - Returns `string[]` (node IDs in dependency order) for DAGs
   - Returns `null` if graph contains cycles
   - Used by `toJSON()` to serialize DAG nodes in topological order

3. **API Renaming**
   - `getEdgesBetween()` renamed to `getDirectEdgesBetween()` for clarity (only finds direct edges, not multi-hop paths)

### 📦 Exported Types

- `TraversalOptions` interface now exported from main module

---

## [2.0.0] - 2026-04-11

### 🚨 Breaking Changes

This release introduces significant API changes.

#### Core Design Changes

**`types.ts`**
- `NodeData` now has `id`, `type`, and `properties` (removed `name`)
- `EdgeData` now has `id`, `sourceId`, `targetId`, `type`, and `properties` (removed `name`, `sourceName`, `targetName`)

**`Node` class**
- `name` property removed - use `properties.name`
- Added `id` property (auto-generated UUID or provided)
- Added `type` property (node label)
- Constructor signature: `constructor(type: string, properties?: Record<string, unknown>, id?: string)`

**`Edge` class**
- `name` property removed
- `sourceName` renamed to `sourceId`
- `targetName` renamed to `targetId`
- Added `type` property (relationship type)
- Constructor signature: `constructor(sourceId: string, targetId: string, type: string, properties?: Record<string, unknown>, id?: string)`

**`Graph` class - Updated Methods**
| Old Signature | New Signature |
|--------------|---------------|
| `addNode(name: string, properties?)` | `addNode(type: string, properties?)` |
| `getNode(name: string)` | `getNode(id: string)` |
| `hasNode(name: string)` | `hasNode(id: string)` |
| `removeNode(name: string, cascade?)` | `removeNode(id: string, cascade?)` |
| `addEdge(name: string, sourceName: string, targetName: string, properties?)` | `addEdge(sourceId: string, targetId: string, type: string, properties?)` |
| `getEdge(name: string)` | `getEdge(id: string)` |
| `hasEdge(name: string)` | `hasEdge(id: string)` |
| `removeEdge(name: string)` | `removeEdge(id: string)` |
| `getChildren(nodeName: string)` | `getChildren(nodeId: string)` |
| `getParents(nodeName: string)` | `getParents(nodeId: string)` |
| `getEdgesFrom(sourceName: string)` | `getEdgesFrom(sourceId: string)` |
| `getEdgesTo(targetName: string)` | `getEdgesTo(targetId: string)` |
| `getEdgesBetween(sourceName: string, targetName: string)` | `getEdgesBetween(sourceId: string, targetId: string)` |

**`Graph` class - New Methods**
- `getNodesByType(type: string): Node[]` - Find all nodes of a given type
- `getNodesByProperty(key: string, value: unknown): Node[]` - Find nodes by property value
- `getEdgesByType(type: string): Edge[]` - Find all edges of a relationship type
- `traverse(sourceId: string, targetId: string, method?: 'bfs' | 'dfs'): string[] | null` - Find path between nodes
- `isDAG(): boolean` - Check if graph is a Directed Acyclic Graph

**`errors.ts`**
- Error messages updated to reference `id` instead of `name`

### ✨ New Features

1. **Node Types (Labels)**
   - Nodes now have a `type` property (e.g., "Course", "Chapter", "Author")
   - Enables filtering nodes by category

2. **Edge Relationship Types**
   - Edges now have a `type` property (e.g., "CONTAINS", "AUTHOR_OF")
   - Multiple edges can share the same type
   - Enables filtering edges by relationship type

3. **Auto-generated IDs**
   - Nodes and edges auto-generate UUIDs if not provided
   - Allows deterministic IDs for testing

4. **Graph Traversal**
   - `traverse()` method to find paths between nodes
   - Supports BFS (shortest path) and DFS

5. **DAG Validation**
   - `isDAG()` method to check for cycles

### 🧪 Test Data

- **`complex-graph.json`** - Updated to new format with 8 Person nodes and 10 edges
- **`education-graph.json`** - New test data with:
  - 2 Courses (Python, NodeJS)
  - 4 Authors (2 per course)
  - 1 Publisher (shared)
  - 13 Chapters (6 Python, 7 NodeJS)
  - 39 Sections
  - 4 Exams (2 per course)
  - 14 Tests
  - 4 Tags
  - Edge types: CONTAINS, AUTHOR_OF, PUBLISHED_BY, TAGGED_WITH

### 🧪 Test Coverage

- **Graph.test.ts** - 74 tests (added 7 new tests for `isDAG()`)
- **ComplexGraph.test.ts** - Updated for new API
- **EducationGraph.test.ts** - 37 new tests for education domain

---

## [1.0.0] - Previous

- Initial release with name-based node/edge identification
