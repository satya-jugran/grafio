# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.15.1] - 2026-06-03

### Bug Fix

1. Node reference validation while import
   - Not to validate node references before inserting to avoid unnecessary performance hit

## [7.15.0] - 2026-06-03

### ✨ New Features

1. **UNWIND Clause Support**
   - Added full openCypher support for the `UNWIND` clause.
   - Allows transforming lists into individual rows for further processing.
   - Integrated semantic validation and query planning for `UNWIND`.

## [7.14.0] - 2026-06-01

### ✨ New Features

1. **Full `RETURN` Clause Expression Support**
   - Added support for `CASE WHEN` conditional expressions.
   - Added support for `XOR`, `%` (modulo), and `^` (exponentiation) operators.
   - Added support for string matching operators: `STARTS WITH`, `ENDS WITH`, and `CONTAINS`.
   - Added support for list predicates: `ALL`, `ANY`, `NONE`, and `SINGLE`.
   - The `RETURN` clause now fully supports all standard openCypher expressions.

### 🐛 Bug Fixes

1. **Syntax & Semantic Fixes**
   - Hardened `Parser._isIdentifier()` to correctly exclude literal tokens (e.g. `STRING`, `BOOLEAN`, `NULL`), preventing them from masking syntax errors.
   - Fixed `CASE WHEN` logic in `ExpressionEvaluator` so that an explicit base expression evaluating to `undefined` no longer incorrectly falls back to boolean CASE semantics.
   - Fixed `Semantic._containsAggregate()` to properly traverse and validate aggregates inside `WHERE` and projection sub-clauses of list/pattern comprehensions.

## [7.13.0] - 2026-05-31

### ✨ New Features

1. **Pattern Comprehensions and Paths as Expressions**
   - Added support for openCypher pattern comprehensions (`[(a)-[:R]->(b) | b.name]`), allowing inline pattern matching that returns a list of projected values.
   - Added support for path expressions used directly inside `RETURN`, `WITH`, and expression contexts without requiring a named `MATCH` clause.
   - Integrated semantic validation and query planning for both constructs.
   - Pattern comprehensions support optional `WHERE` filtering: `[(a)-[:R]->(b) WHERE b.age > 30 | b.name]`.

## [7.12.0] - 2026-05-29

### ✨ New Features

1. **REMOVE Label Support**
   - Added full openCypher support for removing node labels (`REMOVE n:Label1:Label2`).
   - Integrated semantic validation to restrict label removals to nodes only (edges reject label removal).
   - Storage providers now natively update label arrays and cleanup reverse indexes upon label removal.

## [7.11.0] - 2026-05-29

### ✨ New Features

1. **Regular Expression Matching (`=~`) and List Comprehensions**
   - Added support for openCypher regular expression matching using `=~`.
   - Added support for openCypher list comprehensions (`[var IN list WHERE cond | proj]`).
   - Integrated semantic validation and query planning for both features.

## [7.10.0] - 2026-05-28

### ✨ New Features

1. **EXISTS Subquery Clause Support**
   - Added support for openCypher `EXISTS { MATCH ... }` subqueries.
   - Evaluates to true if the subquery returns at least one row, executing natively within the planner pipeline.
   - Integrates natively with `WHERE`, `RETURN`, `ORDER BY`, `SET` and all logical boolean expressions.
   - Features robust semantic scoping to prevent unintended variable leakage while retaining subquery functionality.

## [7.9.0] - 2026-05-28

### ✨ New Features

1. **UNION and UNION ALL Clause Support**
   - Added support for openCypher `UNION` and `UNION ALL` clauses.
   - Allows combining results of multiple queries into a single result set.
   - Enforces strict semantic analysis matching the exact number of columns and identical column aliases across all unioned queries.
   - `UNION ALL` retains all results including duplicates.
   - `UNION` implicitly performs hash-based deduplication on the combined row set.
   - Supports global `ORDER BY`, `SKIP`, and `LIMIT` appended to the final query of the union chain.

## [7.8.0] - 2026-05-27

### ✨ New Features

1. **OPTIONAL MATCH Clause Support**
   - Added support for the openCypher `OPTIONAL MATCH` clause, enabling left-outer-join semantics.
   - Preserves rows and null-fills variables when patterns don't match.
   - Fully supports nested `WHERE` clauses within `OPTIONAL MATCH`.
   - Supports Named Paths (`path = (a)-->(b)`) which are correctly null-filled when missing.

### 🐛 Bug Fixes

1. **WHERE Clause Semantic Scoping**
   - Fixed scope leakage where a `WHERE` clause could reference variables introduced in a subsequent `MATCH` or `OPTIONAL MATCH` clause. Variable validation now uses an incremental scope to strictly enforce linear declaration order.

## [7.7.0] - 2026-05-26

### ✨ New Features

1. **SET Map Assignment and Mutation**
   - Added support for the openCypher `SET n = {map}` syntax to replace all properties on a node or edge.
   - Added support for the openCypher `SET n += {map}` syntax to mutate (merge) properties onto a node or edge.
   - Enforces strict semantic type checking to ensure map property values are primitive data types.
   - Features robust runtime safety by guaranteeing plain-object structures for parameterized `$map` values and deeply pre-validating primitive types prior to modifying the underlying graph indexes.

## [7.6.0] - 2026-05-25

### ✨ New Features

1. **WITH Clause Support**
   - Added support for the openCypher `WITH` clause, enabling multi-segment query pipelining.
   - Supports query projection, aggregation, and implicit pass-through (`WITH *`).
   - Supports `WITH ... WHERE` for post-projection filtering.
   - Allows ordering (`ORDER BY`) and pagination (`SKIP`, `LIMIT`) within `WITH` clauses.
   - Enables Join Anchoring: multiple `MATCH` blocks can be chained sequentially via `WITH` without triggering duplicate binding errors.

## [7.5.0] - 2026-05-25

### ✨ New Features

1. **MERGE Clause Support**
   - Added support for the openCypher `MERGE` clause.
   - Enables matching a pattern and falling back to creating it if no match is found.
   - Supports `ON CREATE SET` and `ON MATCH SET` for conditional property updates.

## [7.4.0] - 2026-05-23

### 💥 Breaking Changes

1. **Multi-label support for nodes — `Node.type` replaced with `Node.labels`**
   - `Node.type` (singular `string`) removed in favor of `Node.labels` (plural `readonly string[]`)
   - `new Node(labels, properties)` now accepts `string | readonly string[]` for labels
   - `Graph.addNode(labels, properties)` now accepts `string | string[]` for labels
   - `NodeData.type` replaced with `NodeData.labels: string[]`
   - Storage filter semantics: `filter.types` matches if ANY node label matches ANY filter type (openCypher OR semantics)
   - All storage providers index each label separately for efficient label-based filtering
   - `GraphToMermaid` renders multi-label nodes as `Label1:Label2`
   - Cypher `labels(n)` function already returns `string[]`; `CREATE (n:Person|Employee)` now stores both labels

### ✨ New Features

1. **Multi-label nodes**
   - Nodes can now have multiple labels: `await graph.addNode(['Person', 'Employee'], { name: 'Alice' })`
   - Filtering supports multi-label matching: `graph.getNodes({ filter: { types: ['Person'] } })` matches nodes with ANY of their labels in the filter
2. **labels() and type() functions**
   - Two new functions node labels() and edge type() are now supported.

## [7.3.0] - 2026-05-22

### ✨ New Features

1. **Cypher Path Functions: `nodes()` and `relationships()`**
   - `nodes(path)` — returns all nodes from a path expression as a list
   - `relationships(path)` — returns all relationships (edges) from a path expression as a list
   - Both functions operate on named path variables (e.g. `MATCH p = (a)-[:R]->(b) RETURN nodes(p)`)
   - Paths are represented internally as `[node₀, edge₀, node₁, edge₁, ..., nodeₙ]`, where `nodes()` extracts even-index elements and `relationships()` extracts odd-index elements

2. **Parallel Execution via `maxDegreeOfParallelism`**
   - Introduced [`CypherEngineOptions.maxDegreeOfParallelism`](src/cypher/CypherEngine.ts:48) to control concurrent row processing
   - Defaults to `1` (serial execution); values greater than `1` enable parallel execution for NodeScan, NodeSeek, EdgeExpand, Filter, and Project steps
   - Enables non-serial computation to improve query performance on multi-core systems

## [7.2.0] - 2026-05-19

### ✨ New Features

1. **Cypher Data Modification Queries**
   - Cypher now supports data modification queries including:
     - `CREATE` — create nodes and relationships
     - `SET` — update node and relationship properties
     - `DELETE` — delete nodes and relationships
     - `DETACH DELETE` — delete nodes and their connected relationships

2. **Compound Indexes**
   - Indexes can now be created as compound indexes with multiple properties

3. **Cypher Index creation and deletion queries**
   - Cypher now supports `CREATE INDEX`, `DROP INDEX`, `SHOW INDEXES`

### 🚨 Breaking Changes

1. **Indexes Now Created by Name**
   - Indexes are now created and referenced by their assigned name
   - Previous behavior used auto-generated identifiers

## [7.1.0] - 2026-05-17

### 🐛 Bug Fixes

1. **Cypher Transaction Support**
   - Added `transaction` field to `CypherEngineOptions` interface
   - `CypherEngine.execute()` now accepts optional `transaction: GraphTransaction` parameter
   - `Executor.execute()` threads transaction through all graph method calls (NodeScan, NodeSeek, EdgeExpand, Aggregate)
   - All graph reads within a Cypher query can now use a transaction for consistent reads

### ✨ New Features
1. **Aggregation and multi-hop performance improvements**
   - While traversing the underlying storage can now query in batches which was single node fetch earlier.

### 📝 Documentation

1. **Complete Documentation Website**
   - Added Docusaurus documentation under `/docs` directory
   - Includes Getting Started, Guides, API Reference, and Tutorials sections
   - All documentation updated to use Cypher queries for read operations
   - Mermaid diagrams for visual representations
   - Documentation aligned with actual source code API

## [7.0.0] - 2026-05-13

### 🚨 Breaking Changes

1. **`IStorageProvider` Interface Refactoring**
   - Replaced discrete query methods (`getNodesByType`, `getNodesByProperty`, `getAllNodes`, etc.) with a unified `StorageQueryOptions`-based API
   - **Node queries**: `getNodesByType(type)` → `getNodes({ filter: { types: [type] } })`
   - **Node queries**: `getAllNodes(limit, orderBy)` → `getNodes({ limit, orderBy })`
   - **Node queries**: `getNodesByProperty(key, value, type?)` → `getNodes({ filter: { properties: [...] } })`
   - **Node count**: `getTotalNodeCount()` → `getNodeCount(options?)`
   - **Edge queries**: `getEdgesByType(type)` → `getEdges({ filter: { types: [type] } })`
   - **Edge queries**: `getAllEdges(limit, orderBy)` → `getEdges({ limit, orderBy })`
   - **Edge queries**: `getEdgesByProperty(key, value, type?)` → `getEdges({ filter: { properties: [...] } })`
   - **Edge count**: `getTotalEdgeCount()` → `getEdgeCount(options?)`
   - **Adjacency**: `getEdgesBySource(nodeId, type?)` → `getEdgesBySource(nodeId, { filter: { types: [...] } })`
   - **Adjacency**: `getEdgesByTarget(nodeId, type?)` → `getEdgesByTarget(nodeId, { filter: { types: [...] } })`
   - **`ITransactionHandle` and `IOrderBy` interfaces** moved from `IStorageProvider.ts` to `types.ts` (re-exported from `IStorageProvider` for backward compatibility)
   - **`createIndex` method removed the optional type argument and it will create both indexes with type and without type.

### ✨ New Features

1. **Cypher Aggregation Functions**
   - `COUNT(*)` — count all matched rows
   - `COUNT(expr)` — count non-null expression values
   - `COUNT(DISTINCT expr)` — count distinct values
   - `AVG(expr)` — average of numeric values
   - `AVG(DISTINCT expr)` — average of distinct values
   - `SUM(expr)` — sum of numeric values
   - `MIN(expr)` — minimum value
   - `MAX(expr)` — maximum value
   - `COLLECT(expr)` — collect values into array

2. **HAVING Clause**
   - Post-aggregation filtering with `HAVING` clause
   - Supports aggregate aliases: `HAVING cnt > 5`
   - Supports raw aggregate expressions: `HAVING COUNT(*) > 1`

3. **ORDER BY with Aggregate Aliases**
   - Can now sort by aggregate aliases: `ORDER BY cnt DESC`
   - Can sort by group-by key aliases: `ORDER BY p_city ASC`
   - Can use raw aggregates in ORDER BY: `ORDER BY COUNT(*) DESC`

4. **RETURN DISTINCT**
   - Deduplicate result rows with `RETURN DISTINCT`

5. **Aggregate Expressions**
   - Arithmetic expressions with aggregates: `COUNT(*) + 1`, `SUM(age) / COUNT(*)`

6. **Named Path Variables**
   - Support for path variables in MATCH patterns: `MATCH p = (a)-[:KNOWS]->(b)-[:KNOWS]->(c) RETURN p`
   - Path returned as array: `[Node, Edge, Node, Edge, Node]`

7. **Storage-Level Aggregation**
   - New methods `aggregateNodeProperty(key, options?)` and `aggregateEdgeProperty(key, options?)` on `IStorageProvider`
   - Enables push-down aggregation to storage backends for better performance

8. **New Types in `src/types.ts`**
   - `StorageQueryOptions` — unified query options interface
   - `AggregateOp` — aggregate operation types
   - `AggregateResult` — result of aggregation queries

9. **Property Filter Operators**
   - `QueryOptions.filter.properties` now supports `op` field for comparison operators
   - Supported operators: `=`, `<>`, `>`, `<`, `>=`, `<=`, `CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `IN`, `NOT_IN`, `IS_NULL`, `IS_NOT_NULL`
   - **AND/OR Chaining**: `QueryOptionsFilterProperty` now supports recursive `AND` and `OR` arrays for complex logical filtering
   - Example: `{ AND: [{ key: 'age', value: 25, op: '>' }, { key: 'city', value: 'NYC' }] }` matches nodes with age > 25 AND city = 'NYC'
   - Supported operators: `=`, `<>`, `>`, `<`, `>=`, `<=`, `CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `IN`, `NOT_IN`, `IS_NULL`, `IS_NOT_NULL`
   - Implemented in `InMemoryStorageProvider` and `CachedStorageProvider`
   - Shared test scenarios in `src/shared/testing/graphFilterScenarios.ts`

10. **Query Plan Inspection**
    - `CypherEngine.getQueryPlan(query, params?, format?)` method to inspect the logical execution plan
    - Returns the query plan showing all execution steps without running the query
    - Supported formats: `'json'` (default), `'text'`, `'mermaid'`
    - `PlanFormatter` class with `toJson()`, `toText()`, and `toMermaid()` methods

11. **Execution Plan with Runtime Statistics**
    - `CypherEngine.execute()` accepts optional `CypherEngineOptions` parameter with `executionPlan: { format: PlanFormat }`
    - Returns execution plan enriched with per-step timing and row counts
    - `PlanStepExecutionStats` interface: `stepKind`, `timeMs`, `percentageOfTotal`, `rowsOut`
    - `PlanExecutionStats` interface: `totalTimeMs`, `steps[]`
    - Extended `CypherSummary` with optional `planExecutionStats` field
    - Executor tracks per-step timing during query execution

### 📝 Documentation

1. **Updated README with Cypher aggregation features**
   - Documented `COUNT`, `AVG`, `SUM`, `MIN`, `MAX`, `COLLECT` functions
   - Documented `HAVING` clause
   - Documented `ORDER BY` with aggregates
   - Documented `RETURN DISTINCT`

2. **Updated README with Query Plan and Execution Plan features**
   - Documented `CypherEngine.getQueryPlan()` for inspecting execution steps
   - Documented `CypherEngineOptions` and `executionPlan` option for runtime statistics
   - Documented supported formats: `json`, `text`, `mermaid`
   - Documented `PlanStepExecutionStats` fields: `timeMs`, `percentageOfTotal`, `rowsOut`

## [6.3.0] - 2026-05-11

### ✨ New Features

1. **Read-Only Cypher Query Interface**
   - Added a read-only `CypherEngine` that executes openCypher-compatible queries against a `Graph` instance
   - Supports `MATCH`, `WHERE`, `RETURN` (with `DISTINCT`), `ORDER BY` (ASC/DESC), `SKIP`, and `LIMIT` clauses
   - **Pattern matching**: typed/untyped nodes (`(n:Person)`), directed edges (`-[:KNOWS]->`), multi-label alternation (`Person|Employee`), inline property maps (`{year: 2024}`)
   - **Variable-length edges**: `[*1..3]`, `[*2]`, `[*]` with BFS multi-hop traversal (DFS when `LIMIT` is present)
   - **Expressions**: `AND`/`OR`/`NOT`, comparisons (`=`, `<>`, `<`, `<=`, `>`, `>=`), arithmetic (`+`, `-`, `*`, `/`), `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`
   - **Parameterized queries**: `$name` placeholders resolved at execution time
   - **Deep import path**: `import { CypherEngine } from 'grafio/cypher'`
   - **Validation gate**: rejects `CREATE`, `DELETE`, `SET`, `REMOVE`, `MERGE`, `DETACH`, aggregations (`COUNT`, `SUM`, etc.), and `WITH`/`UNWIND`
   - **Architecture**: hand-written lexer, recursive-descent Pratt parser, chain-of-pass semantic analyser, query planner with filter-pushdown, row-based executor
   - 200 tests across 6 test suites (Lexer, Parser, Semantic, Planner, Executor, Integration)

## [6.2.0] - 2026-05-09

### ✨ New Features

1. **Cache Optimization for getAllNodes/getAllEdges**
   - Added `getTotalNodeCount()` and `getTotalEdgeCount()` to `IStorageProvider` interface
   - Added `getAll(prefix, limit?)` and `count(prefix)` to `ICacheProvider` interface
   - `CachedStorageProvider.getAllNodes()` and `getAllEdges()` now serve from cache when `orderBy` is undefined
   - When `orderBy` is provided and cache is complete (`cachedCount === totalCount`), results are served from cache with in-memory sorting
   - Sorting handles `undefined` fields: undefined sorts to END in ascending, to START in descending

2. **Adjacency Index for Edge Lookups**
   - Added adjacency index methods to `ICacheProvider` for O(1) edge lookups by source/target
   - `InMemoryCache` uses `Map<string, Set<string>>` for adjacency tracking
   - `RedisCache` uses Redis `SET` data structure for distributed adjacency index
   - `CachedStorageProvider.getEdgesBySource()` and `getEdgesByTarget()` use adjacency index with individual `getEdge()` calls
   - Adjacency index is populated during `warmCache()` and invalidated on `clear()`

3. **Test Coverage Additions**
   - 172 tests covering CachedStorageProvider, CacheManager, InMemoryCache, and RedisCache
   - Tests for cache optimization branches (limit, sorting, undefined fields)
   - Tests for adjacency index operations (add, remove, retrieve, invalidate)

## [6.1.0] - 2026-05-08

### ✨ New Features

1. **Caching Layer Implementation**
   - Added `CacheConfig` for configuring cache behavior (maxNodesCount, maxEdgesCount, evictionStrategy, preloadStrategy)
   - Added `ICacheProvider` interface with `InMemoryCache` and `RedisCache` implementations
   - Added `CacheManager` for managing cache across multiple graphId partitions
   - Added `CachedStorageProvider` wrapper that adds caching to any IStorageProvider
   - Supports LRU, LFU, and FIFO eviction strategies
   - Supports 'none', 'all', 'recent', and 'first-n' preload strategies

2. **GraphManager Singleton**
   - Added `GraphManager` for application-scoped cache initialization
   - Provides `GraphManager.init()`, `GraphManager.isInitialized()`, `GraphManager.getInstance()`
   - Manages CacheManager lifecycle and budget enforcement across graphId partitions

3. **Graph.warmCache() Method**
   - Added `warmCache()` method to Graph class for explicit cache preloading
   - Delegates to CachedStorageProvider.warmCache() when available

4. **Redis Cache Support**
   - Added `RedisCache` implementation using ioredis (optional peer dependency)
   - Supports distributed caching across multiple application instances

5. **createdOn and updatedOn Timestamps**
   - Added `createdOn` and `updatedOn` as top-level properties on `NodeData` and `EdgeData` (not in properties)
   - `Node` and `Edge` classes now track creation and update timestamps
   - `Node.toJSON()` and `Edge.toJSON()` include timestamps in serialization
   - Storage providers set timestamps on insert and update `updatedOn` on property modifications
   - `CachedStorageProvider.warmCache()` 'recent' strategy uses `updatedOn` for ordering

## [6.0.0] - 2026-05-07

### Breaking Changes

1. **Extracted MongoDB Storage to Separate Package**
   - MongoDB storage implementation (`MongoStorageProvider`, `MongoGraphFactory`) has been moved to the [`grafio-mongo`](https://github.com/satya-jugran/grafio-mongo) package
   - `grafio` now ships only with `InMemoryStorageProvider` as the built-in storage backend
   - To use MongoDB storage, install `grafio-mongo` package: `npm install grafio-mongo`
   - Removed MongoDB-related exports from `grafio` package
   - Removed MongoDB peer dependency from `grafio` package

2. **Package.json Updates**
   - Removed `mongodb` and `mongodb-memory-server` devDependencies
   - Removed `perf:mongodb` and `perf:mongodb:gc` scripts
   - Removed `mongodb` keyword
   - Removed `peerDependencies.mongodb` and `peerDependenciesMeta.mongodb`

### Documentation

1. **README Updates**
   - Removed all MongoDB usage examples and documentation
   - Added reference to `grafio-mongo` package for MongoDB storage
   - Updated test section to reflect in-memory-only tests

## [5.4.2] - 2026-05-07

### Refactoring

1. **Refactored test cases with reusable scenarios
   - A new provider can re-use the testing scenarios without writing from scratch for that provider.

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
