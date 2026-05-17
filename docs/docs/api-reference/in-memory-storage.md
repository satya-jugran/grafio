# InMemoryStorageProvider

Built-in zero-dependency in-memory storage provider.

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
  graphId?: string;  // default: 'default'
}
```

## Usage

```typescript
import { Graph, InMemoryStorageProvider } from 'grafio';

// Default (uses InMemoryStorageProvider internally)
const graph1 = new Graph();

// Explicit
const provider = new InMemoryStorageProvider();
const graph2 = new Graph(provider);

// Multiple isolated graphs
const graphA = new Graph(new InMemoryStorageProvider({ graphId: 'graph-a' }));
const graphB = new Graph(new InMemoryStorageProvider({ graphId: 'graph-b' }));
```

## Features

- **Zero dependencies** — no external packages required
- **In-memory** — data lost on process restart
- **Isolation** — each provider instance is independent
- **Copy-on-write transactions** — isolation without blocking

## Limitations

- Not persistent (data exists only in memory)
- Not shared across processes
- No query language (use CypherEngine for queries)

## Use Cases

```typescript
// Development and testing
const devGraph = new Graph();

// Unit tests
const testGraph = new Graph(new InMemoryStorageProvider());

// Scripting / CLI tools
const scriptGraph = new Graph();

// Temporary data processing
const tempGraph = new Graph(new InMemoryStorageProvider({ graphId: 'temp' }));
```

## Next Steps

- [Storage Providers](../guides/storage-providers) — compare providers
- [Caching](../guides/caching) — add caching layer
- [API Reference](./storage-provider) — interface details