# Cypher Clauses

Reference for supported Cypher clauses.

## MATCH

Pattern matching clause.

### Basic Node Pattern

```cypher
MATCH (p:Person)
```

### Typed Node Pattern

```cypher
MATCH (p:Person:Student)
```

### Node with Properties

```cypher
MATCH (p:Person {name: 'Alice', age: 30})
```

### Relationship Pattern

```cypher
MATCH (a:Person)-[:KNOWS]->(b:Person)
```

### Variable-Length Relationships

```cypher
MATCH (a:Person)-[:KNOWS*1..3]->(b:Person)
```

## WHERE

Filter clause with expressions.

### Comparison Operators

```cypher
MATCH (p:Person) WHERE p.age > 25
MATCH (p:Person) WHERE p.name = 'Alice'
MATCH (p:Person) WHERE p.age <> 30
```

### String Operators

```cypher
WHERE p.name CONTAINS 'John'
WHERE p.name STARTS WITH 'A'
WHERE p.name ENDS WITH 'n'
```

### IN / NOT IN

```cypher
WHERE p.city IN ['NYC', 'LA', 'SF']
WHERE p.status NOT IN ['archived', 'deleted']
```

### NULL Checks

```cypher
WHERE p.email IS NULL
WHERE p.email IS NOT NULL
```

### Logical Operators

```cypher
WHERE p.age > 25 AND p.status = 'active'
WHERE p.city = 'NYC' OR p.city = 'LA'
WHERE NOT p.archived
WHERE (p.age > 18 AND p.city = 'NYC')
```

## RETURN

Specify return columns.

### Basic Return

```cypher
MATCH (p:Person) RETURN p.name, p.age
```

### DISTINCT

```cypher
MATCH (p:Person) RETURN DISTINCT p.city
```

### Aliases with AS

```cypher
MATCH (p:Person) RETURN p.name AS fullName, p.age AS years
```

## ORDER BY

Sort results.

### Ascending (Default)

```cypher
RETURN p.name ORDER BY p.age
```

### Descending

```cypher
RETURN p.name ORDER BY p.age DESC
```

### Multiple Columns

```cypher
RETURN p.city, p.name ORDER BY p.city, p.name DESC
```

## SKIP / LIMIT

Pagination.

### Skip Rows

```cypher
MATCH (p:Person) RETURN p.name ORDER BY p.age SKIP 10
```

### Limit Results

```cypher
MATCH (p:Person) RETURN p.name LIMIT 10
```

### Combined Pagination

```cypher
MATCH (p:Person) 
RETURN p.name 
ORDER BY p.age 
SKIP 0 
LIMIT 10
```

### With Parameters

```cypher
MATCH (p:Person) RETURN p.name LIMIT $limit
```

## Aggregation with GROUP BY

Group and aggregate results.

### Basic Aggregation

```cypher
MATCH (p:Person) RETURN p.city, COUNT(*) AS count
```

### Multiple Aggregates

```cypher
MATCH (p:Person) 
RETURN p.city, MIN(p.age), MAX(p.age), AVG(p.age)
```

### HAVING Clause

```cypher
MATCH (p:Person) 
RETURN p.city, COUNT(*) AS cnt 
HAVING cnt > 1
```

## Named Paths

Capture traversal paths as variables.

```cypher
MATCH p = (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person) RETURN p
```

## Unsupported Clauses

The following clauses are not yet fully supported by the engine:

| Clause | Reason |
|--------|--------|
| `UNWIND` | Complex queries not supported |
| `CALL` | Procedures not supported |
| `YIELD` | Procedures not supported |
| `FOREACH` | Complex queries not supported |