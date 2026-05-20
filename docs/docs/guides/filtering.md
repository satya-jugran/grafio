# Filtering

Filter nodes and edges by type and properties.

## Node Filtering

### Get Nodes with Type Filter

```cypher
MATCH (p:Person) RETURN p.name, p.age
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

## Creating Indexes

For O(1) property lookups on large datasets:

```cypher
-- Node index
CREATE INDEX email_idx FOR (n:Person) ON (n.email)

-- Compound index
CREATE INDEX name_status_idx FOR (n:Person) ON (n.name, n.status)

-- Edge index
CREATE INDEX since_idx FOR ()-[r:KNOWS]-() ON (r.since)
```

## Next Steps

- [Traversal](./traversal) — path finding
- [Cypher Language](./cypher-language) — WHERE clause details
- [API Reference](../api-reference/graph)