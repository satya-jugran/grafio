# CypherEngine

Execute openCypher-compatible queries against your graph.

## Import

```typescript
import { CypherEngine } from 'grafio/cypher';
```

Note: The Cypher deep import path (`grafio/cypher`) is required separately from the main `grafio` import.

## Constructor

```typescript
new CypherEngine(graph: Graph, options?: CypherEngineOptions)
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `graph` | `Graph` | ✅ | The graph to query |
| `options` | `CypherEngineOptions` | ❌ | Engine configuration |

## query()

```typescript
async query(
  cypher: string,
  params?: Record<string, unknown>
): Promise<CypherResult>
```

Executes a Cypher query and returns the results.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `cypher` | `string` | ✅ | The Cypher query string |
| `params` | `Record<string, unknown>` | ❌ | Query parameters |

**Returns:** `Promise<CypherResult>`

### CypherResult Shape

```typescript
interface CypherResult {
  rows: CypherRow[];     // Array of row objects
  summary: CypherSummary; // Execution metadata
}

type CypherRow = Map<string, unknown>;  // Column name → value

interface CypherSummary {
  queryTimeMs: number;     // Execution duration
  nodesCreated: number;    // Always 0 (read-only)
  edgesCreated: number;    // Always 0 (read-only)
}
```

## execute()

```typescript
async execute(
  cypher: string,
  params?: Record<string, unknown>,
  options?: CypherEngineOptions
): Promise<CypherResult & { executionPlan: string }>
```

Executes a query with runtime statistics.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `cypher` | `string` | ✅ | The Cypher query string |
| `params` | `Record<string, unknown>` | ❌ | Query parameters |
| `options` | `CypherEngineOptions` | ❌ | Execution options |

**Returns:** `Promise<CypherResult & { executionPlan: string }>`

### executionPlan Option

```typescript
const result = await engine.execute(
  'MATCH (p:Person) RETURN p.name',
  {},
  { executionPlan: { format: 'json' | 'text' | 'mermaid' } }
);
```

## getQueryPlan()

```typescript
async getQueryPlan(
  cypher: string,
  params?: Record<string, unknown>,
  format?: PlanFormat
): Promise<string>
```

Returns the logical query plan without executing the query.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `cypher` | `string` | ✅ | The Cypher query |
| `params` | `Record<string, unknown>` | ❌ | Query parameters |
| `format` | `'json'` \| `'text'` \| `'mermaid'` | `'json'` | Plan output format |

**Returns:** `Promise<string>`

### JSON Format

```typescript
const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p.name');
// { plan: { steps: [...] } }
```

### Text Format

```typescript
const plan = await engine.getQueryPlan(query, undefined, 'text');
/*
NodeScanStep (Person)
  EdgeExpandStep (KNOWS, outgoing)
    ProjectStep [p.name]
*/
```

### Mermaid Format

```typescript
const plan = await engine.getQueryPlan(query, undefined, 'mermaid');
/*
flowchart TD
    Step1[NodeScanStep Person]
    Step2[EdgeExpandStep KNOWS, 1..2 hops, outgoing]
    Step1 --> Step2
*/
```

## Error Handling

```typescript
import { 
  CypherError,
  CypherSyntaxError,
  CypherNotSupportedError,
  CypherSemanticError 
} from 'grafio/cypher';

try {
  const result = await engine.query('MATCH (p) RETURN p');
} catch (error) {
  if (error instanceof CypherSyntaxError) {
    console.log(`Syntax error at line ${error.line}, column ${error.column}`);
  } else if (error instanceof CypherNotSupportedError) {
    console.log(`Unsupported feature: ${error.message}`);
  }
}
```

## Examples

### Basic Query

```typescript
const result = await engine.query('MATCH (p:Person) RETURN p.name, p.age');
// result.rows = [{ 'p.name': 'Alice', 'p.age': 30 }, ...]
```

### Parameterized Query

```typescript
const result = await engine.query(
  'MATCH (p:Person {name: $name}) RETURN p',
  { name: 'Alice' }
);
```

### Aggregation

```typescript
const result = await engine.query(`
  MATCH (p:Person) 
  RETURN p.city, COUNT(*) AS cnt 
  ORDER BY cnt DESC
`);
```

### Pattern Matching

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person) 
  RETURN DISTINCT a.name, c.name
`);