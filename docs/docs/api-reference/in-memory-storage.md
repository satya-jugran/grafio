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
import { InMemoryGraphFactory } from 'grafio';

// Default - uses InMemoryStorageProvider internally
const factory = new InMemoryGraphFactory();
const graph1 = factory.forGraph('default');

// Multiple isolated graphs
const graphA = factory.forGraph('graph-a');
const graphB = factory.forGraph('graph-b');
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
- [Caching](../guides/caching) — add caching layer
- [API Reference](./storage-provider) — interface details