# InMemoryStorageProvider

Built-in zero-dependency in-memory Structure-of-Arrays (SoA) and Hybrid CSR + Delta storage engine.

## Import

```typescript
import { InMemoryStorageProvider } from 'grafio';
```

## Constructor

```typescript
new InMemoryStorageProvider(options?: InMemoryStorageProviderOptions)
```

### Options

```typescript
interface InMemoryStorageProviderOptions {
  /** Optional partition identifier returned in exportJSON(). Defaults to 'default'. */
  graphId?: string;
  /**
   * Auto-generated ID strategy when callers omit `id`:
   * - 'compact' (default): zero-CSPRNG `@n<slot>:<gen>` / `@e<slot>:<gen>` IDs
   * - 'uuid': RFC-4122 v4 UUIDs via CSPRNG
   */
  idStrategy?: 'compact' | 'uuid';
}
```

## Usage

```typescript
import { Graph, InMemoryGraphFactory, InMemoryStorageProvider } from 'grafio';

// Default — compact SoA IDs (`@n0:1`, `@e0:1`)
const graph = new Graph();

// With UUID auto-generation
const uuidGraph = new Graph(new InMemoryStorageProvider({ idStrategy: 'uuid' }));

// Multiple isolated graphs via factory
const factory = new InMemoryGraphFactory();
const graphA = factory.forGraph('graph-a');
const graphB = factory.forGraph('graph-b');
```

## Features

- **Zero dependencies** — pure TypeScript TypedArray engine (`SlotArena`, `ColumnStore`, `AdjacencyStore`, `PropertyIndexStore`)
- **Hybrid CSR + Delta Adjacency** — batch inserts build Compressed Sparse Row (CSR) buffers immediately, while `graph.compact()` folds incremental delta edges and reclaims retired slots
- **Typed Property Columns** — adaptive `Float64Array`, bit-packed boolean, and string columns with automatic `mixed` promotion and lazy Copy-on-Write entity wrappers
- **Scoped Property Indexes** — opt-in single-key and compound hash/sorted range indexes scoped by `labelOrType`
- **Property-Level Delta Transactions** — conflict-checked `TransactionManager` with `TransactionConflictError` detection and lightweight undo checkpoints
- **Synchronous Kernel (`ISyncGraphKernel`)** — powers zero-microtask `graph.querySync()` / `engine.executeSync()`

## Limitations

- Not persistent (data exists only in process memory unless exported via `exportJSON()`)
- Not shared across processes

## Use Cases

```typescript
import { InMemoryGraphFactory } from 'grafio';

const factory = new InMemoryGraphFactory();

// Development and testing
const devGraph = factory.forGraph('dev');

// Unit tests
const testGraph = factory.forGraph('test');

// Scripting / CLI tools
const scriptGraph = factory.forGraph('script');

// Temporary data processing
const tempGraph = factory.forGraph('temp');
```

## Next Steps

- [Storage Providers](../guides/storage-providers) — compare providers
- [Caching](../guides/caching) — caching for remote backends
- [API Reference](./storage-provider) — interface details
