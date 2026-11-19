# Errors

Error types exported by Grafio.

## Import

```typescript
import {
  TransactionNotActiveError,
  TransactionFailedError,
  TransactionConflictError,
} from 'grafio';

// Full set of core storage/graph errors:
import {
  GraphError,
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  EdgeNotFoundError,
  NodeHasEdgesError,
  InvalidPropertyError,
  InvalidGraphDataError,
  TraversalLimitExceededError,
  TransactionConflictError,
} from 'grafio/errors';
```

## Transaction Errors

### TransactionNotActiveError

Thrown when attempting an operation on an inactive transaction.

```typescript
import { InMemoryGraphFactory, TransactionNotActiveError } from 'grafio';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const txn = graph.createTransaction();

// Transaction not started
try {
  await graph.addNode('Person', { name: 'Alice' }, txn);
} catch (error) {
  if (error instanceof TransactionNotActiveError) {
    console.log('Transaction not started - call txn.begin() first');
  }
}

// Transaction already committed
await txn.begin();
await txn.commit();
try {
  await graph.addNode('Person', { name: 'Bob' }, txn);
} catch (error) {
  if (error instanceof TransactionNotActiveError) {
    console.log('Transaction already committed');
  }
}
```

### TransactionFailedError

Thrown when a storage operation fails within a transaction.

```typescript
import { TransactionFailedError } from 'grafio';

const txn = graph.createTransaction();
await txn.begin();

try {
  // ... operations that might fail ...
  await txn.commit();
} catch (error) {
  if (error instanceof TransactionFailedError) {
    console.log(`Storage error: ${error.message}`);
    // txn.isFailed() === true
  }
}
```

### TransactionConflictError

Thrown during `commit()` when concurrent transactions modify overlapping property keys, labels, or entity deletions on the same node or edge.

```typescript
import { Graph, TransactionConflictError } from 'grafio';

const graph = new Graph();
const alice = await graph.addNode('Person', { name: 'Alice', age: 25 });

const tx1 = graph.createTransaction();
const tx2 = graph.createTransaction();
await tx1.begin();
await tx2.begin();

await graph.setNodeProperties(alice.id, { age: 26 }, { transaction: tx1 });
await graph.setNodeProperties(alice.id, { age: 27 }, { transaction: tx2 });

await tx1.commit();

try {
  await tx2.commit();
} catch (error) {
  if (error instanceof TransactionConflictError) {
    await tx2.rollback();
  }
}
```

Note: Disjoint writes on different property keys of the same node/edge merge cleanly without conflict.

## Entity & Validation Errors (`grafio/errors`)

| Error Class | When Thrown |
|---|---|
| `NodeAlreadyExistsError` | Inserting a node with an existing ID |
| `EdgeAlreadyExistsError` | Inserting an edge with an existing ID |
| `NodeNotFoundError` | Mutating a non-existent node or missing edge endpoint via Graph/Cypher |
| `EdgeNotFoundError` | Mutating a non-existent edge |
| `NodeHasEdgesError` | Removing a node with incident edges when `cascade` is `false` |
| `InvalidPropertyError` | Supplying non-primitive values (e.g., nested objects or functions) in properties |
| `InvalidGraphDataError` | Importing malformed `GraphData` in `Graph.importJSON()` |
| `TraversalLimitExceededError` | Wildcard traversal exceeds safety limit |

## Next Steps

- [Transactions](../guides/transactions) — transaction guide
- [Cypher Errors](./cypher-errors) — Cypher error types
