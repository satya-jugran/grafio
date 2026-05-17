# GraphTransaction

Handle atomic multi-operation updates.

## Import

```typescript
import { GraphTransaction } from 'grafio';
```

## createTransaction()

Returns a new `GraphTransaction` instance for atomic multi-operation updates.

```typescript
import { InMemoryGraphFactory } from 'grafio';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const txn = graph.createTransaction();
```

## GraphTransaction Methods

### begin()

```typescript
begin(): Promise<void>
```

Start the transaction.

```typescript
await txn.begin();
```

### commit()

```typescript
commit(): Promise<void>
```

Apply all changes atomically.

```typescript
await txn.commit();
```

### rollback()

```typescript
rollback(): Promise<void>
```

Discard all changes.

```typescript
await txn.rollback();
```

### isActive()

```typescript
isActive(): boolean
```

Check if transaction is active.

```typescript
if (txn.isActive()) {
  // safe to continue
}
```

### isFailed()

```typescript
isFailed(): boolean
```

Check if transaction failed.

```typescript
if (txn.isFailed()) {
  // rollback needed
}
```

## Usage Pattern

```typescript
const txn = graph.createTransaction();
await txn.begin();

try {
  const alice = await graph.addNode('Person', { name: 'Alice' }, txn);
  const bob = await graph.addNode('Person', { name: 'Bob' }, txn);
  await graph.addEdge(alice.id, bob.id, 'KNOWS', {}, txn);
  
  await txn.commit();
} catch (error) {
  if (txn.isActive()) {
    await txn.rollback();
  }
  throw error;
}
```

## Error Handling

On `commit()` failure:
- Transaction is automatically marked as failed
- `isFailed()` returns `true`
- `isActive()` returns `false`
- Explicit rollback not required

```typescript
try {
  await txn.commit();
} catch (error) {
  // txn.isFailed() === true
  // txn.isActive() === false
  // No explicit rollback needed
}
```

## Next Steps

- [Transactions](../guides/transactions) — transaction guide
- [API Reference](./graph) — Graph methods