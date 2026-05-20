# Exception Handling

Handle errors from the Cypher query engine.

## Setup

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine, CypherSyntaxError, CypherSemanticError, CypherNotSupportedError } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Error Types

### CypherSyntaxError

Thrown when the query has invalid syntax.

```typescript
try {
  await engine.execute('MACH (n) RETURN n');
} catch (e) {
  if (e instanceof CypherSyntaxError) {
    console.log(`Syntax error: ${e.message}`);
    console.log(`At position: ${e.position}`);
  }
}
```

### CypherSemanticError

Thrown when the query is syntactically valid but semantically incorrect.

```typescript
try {
  await engine.execute('MATCH (n) WHERE n.foo = n.bar RETURN n');
} catch (e) {
  if (e instanceof CypherSemanticError) {
    console.log(`Semantic error: ${e.message}`);
  }
}
```

### CypherNotSupportedError

Thrown when the query uses an unsupported Cypher feature.

```typescript
try {
  await engine.execute('MATCH (n) OPTIONAL MATCH (n)-[r]->() RETURN r');
} catch (e) {
  if (e instanceof CypherNotSupportedError) {
    console.log(`Not supported: ${e.message}`);
  }
}
```

## Generic Error Handling

```typescript
try {
  const result = await engine.execute(query);
  console.log(result.rows);
} catch (e) {
  if (e instanceof CypherSyntaxError) {
    console.error('Invalid query syntax:', e.message);
  } else if (e instanceof CypherSemanticError) {
    console.error('Query semantic error:', e.message);
  } else if (e instanceof CypherNotSupportedError) {
    console.error('Unsupported feature:', e.message);
  } else if (e instanceof Error) {
    console.error('Unexpected error:', e.message);
  }
}
```

## Error Properties

### CypherSyntaxError

| Property | Type | Description |
|----------|------|-------------|
| `message` | string | Human-readable error message |
| `position` | number | Token position where error occurred |

### CypherSemanticError

| Property | Type | Description |
|----------|------|-------------|
| `message` | string | Human-readable error message |
| `clause` | string | The clause causing the error |

## Best Practices

### Always Catch Errors

```typescript
async function safeQuery(query: string, params?: Record<string, unknown>) {
  try {
    return await engine.execute(query, params);
  } catch (e) {
    if (e instanceof CypherSyntaxError) {
      throw new Error(`Invalid query: ${e.message}`);
    }
    throw e;
  }
}
```

### Use Transactions In Data Operations

Combine error handling with transactions for atomic operations:

```typescript
import { CypherEngine, CypherSyntaxError } from 'grafio/cypher';

async function createUserWithRole(engine, graph, userData, roleData) {
  const txn = graph.createTransaction();
  await txn.begin();
  
  try {
    await engine.execute(
      `CREATE (u:User {name: $name, email: $email})`,
      { name: userData.name, email: userData.email },
      { transaction: txn }
    );
    
    await engine.execute(
      `CREATE (r:Role {name: $roleName})`,
      { roleName: roleData.name },
      { transaction: txn }
    );
    
    await txn.commit();
  } catch (e) {
    if (txn.isActive()) {
      await txn.rollback();
    }
    if (e instanceof CypherSyntaxError) {
      throw new Error(`Failed to create user: invalid query`);
    }
    throw e;
  }
}
```

## Next Steps

- [Query Plans](./query-plans) — analyze query execution
- [Cypher Language](./cypher-language) — syntax reference
- [API Reference: Cypher Errors](../api-reference/cypher-errors) — full error API