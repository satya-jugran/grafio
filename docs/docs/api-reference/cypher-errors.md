# Cypher Errors

Error types thrown by the Cypher query engine.

## Import

```typescript
import { 
  CypherError,
  CypherSyntaxError,
  CypherNotSupportedError,
  CypherSemanticError,
  CypherRuntimeError,
  UnboundParameterError,
  TypeMismatchError 
} from 'grafio/cypher';
```

## Error Hierarchy

```
CypherError (base)
├── CypherSyntaxError      — Lexer/Parser errors with line:column
├── CypherNotSupportedError — Unsupported syntax (CREATE, WITH, etc.)
├── CypherSemanticError     — Unresolved variables, duplicate bindings
└── CypherRuntimeError
    ├── UnboundParameterError — $param not provided in params map
    └── TypeMismatchError     — Wrong type for operator
```

## CypherSyntaxError

Thrown when the query string has syntax errors.

```typescript
try {
  const result = await engine.query('MATCH (p) RETURN p.');
} catch (error) {
  if (error instanceof CypherSyntaxError) {
    console.log(`Line ${error.line}, Column ${error.column}`);
    console.log(error.message);
  }
}
```

## CypherNotSupportedError

Thrown when using unsupported Cypher features.

```typescript
try {
  const result = await engine.query('CREATE (p:Person)');
} catch (error) {
  if (error instanceof CypherNotSupportedError) {
    console.log(`Unsupported: ${error.message}`);
  }
}
```

**Common unsupported features:**
- `CREATE` / `DELETE` / `SET` / `REMOVE` / `MERGE`
- `WITH` / `UNWIND`

## CypherSemanticError

Thrown when the query has valid syntax but invalid semantics.

```typescript
try {
  const result = await engine.query('MATCH (p:NonExistent) RETURN x.y.z');
} catch (error) {
  if (error instanceof CypherSemanticError) {
    console.log(`Semantic error: ${error.message}`);
  }
}
```

**Common semantic errors:**
- Unresolved variable references
- Duplicate variable bindings
- Invalid property access

## CypherRuntimeError

Base class for runtime errors.

### UnboundParameterError

Thrown when a `$parameter` is not provided in the params object.

```typescript
try {
  const result = await engine.query(
    'MATCH (p:Person {name: $name}) RETURN p',
    {}  // missing 'name' parameter
  );
} catch (error) {
  if (error instanceof UnboundParameterError) {
    console.log(`Missing parameter: ${error.parameterName}`);
  }
}
```

### TypeMismatchError

Thrown when an operator receives the wrong type.

```typescript
try {
  const result = await engine.query(
    "MATCH (p:Person) WHERE p.age IN 'not an array' RETURN p"
  );
} catch (error) {
  if (error instanceof TypeMismatchError) {
    console.log(`Type error: ${error.message}`);
  }
}
```

**Common type errors:**
- Using `IN` with a non-array value
- Arithmetic on non-numeric types
- Property access on non-map types

## Generic Error Handling

```typescript
import { CypherError } from 'grafio/cypher';

try {
  const result = await engine.query('INVALID QUERY');
} catch (error) {
  if (error instanceof CypherError) {
    console.log(`Cypher error: ${error.message}`);
    // All Cypher errors inherit from CypherError
  } else {
    throw error; // Not a Cypher error
  }
}