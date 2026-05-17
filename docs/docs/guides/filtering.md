# Filtering

Filter nodes and edges by type and properties.

## Node Filtering

### Get Nodes with Type Filter

```typescript
const people = await graph.getNodes({ filter: { nodeType: 'Person' } });
```

### Property Filtering with Cypher

Use Cypher's WHERE clause for property-based filtering:

```cypher
MATCH (p:Person) 
WHERE p.city = 'NYC' 
RETURN p.name, p.age
```

### Property Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `=` | `p.age = 30` | Equality |
| `<>` | `p.age <> 30` | Not equal |
| `>` | `p.age > 25` | Greater than |
| `<` | `p.age < 60` | Less than |
| `>=` | `p.age >= 18` | Greater or equal |
| `<=` | `p.age <= 100` | Less or equal |
| `CONTAINS` | `p.name CONTAINS 'John'` | Substring match |
| `STARTS WITH` | `p.name STARTS WITH 'J'` | Prefix match |
| `ENDS WITH` | `p.name ENDS WITH 'n'` | Suffix match |
| `IN` | `p.city IN ['NYC', 'LA']` | In list |
| `NOT IN` | `p.city NOT IN ['SF']` | Not in list |
| `IS NULL` | `p.email IS NULL` | Null check |
| `IS NOT NULL` | `p.email IS NOT NULL` | Not null |

## Edge Filtering

### Get Edges by Type

```typescript
const knowsEdges = await graph.getEdges({ filter: { edgeType: 'KNOWS' } });
```

### Filter by Source/Target Node

```cypher
MATCH (a:Person)-[:KNOWS]->(b:Person) 
WHERE a.name = 'Alice'
RETURN b.name
```

## Logical Operators

```cypher
WHERE p.age > 25 AND p.status = 'active'
WHERE p.city = 'NYC' OR p.city = 'LA'
WHERE NOT p.archived
WHERE p.age > 18 AND (p.city = 'NYC' OR p.city = 'LA')
```

## GraphQueryOptions

```typescript
interface GraphQueryOptions {
  filter?: {
    nodeType?: string;         // filter nodes by type
    edgeType?: string;         // filter edges by type
  };
  orderBy?: IOrderBy[];        // sort results
  limit?: number;               // limit results
  offset?: number;              // skip results
  transaction?: GraphTransaction;  // transaction context
}
```

## Creating Indexes

For O(1) property lookups on large datasets:

```typescript
// Index on node property
await graph.createIndex('node', 'email');
await graph.createIndex('node', 'status');

// Index on edge property
await graph.createIndex('edge', 'since');
```

## Next Steps

- [Traversal](./traversal) — path finding
- [Cypher Queries](./cypher-queries) — WHERE clause details
- [API Reference](../api-reference/graph)