# Errors

Error types exported by Grafio.

## Import

```typescript
import { 
  TransactionNotActiveError,
  TransactionFailedError 
} from 'grafio';
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

## Next Steps

- [Transactions](../guides/transactions) — transaction guide
- [Cypher Errors](./cypher-errors) — Cypher error types