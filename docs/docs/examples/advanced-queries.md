# Advanced Query Examples

Complex Cypher query patterns.

## Variable-Length Paths

```typescript
const result = await engine.query(`
  MATCH (a:Person)-[:KNOWS*2..3]->(b:Person)
  RETURN DISTINCT a.name, b.name
`);
```

## Aggregations with GROUP BY

```typescript
const result = await engine.query(`
  MATCH (p:Person)
  RETURN p.city, COUNT(*) AS count, AVG(p.age) AS avgAge
  ORDER BY count DESC
`);
```

## Named Paths

```typescript
const result = await engine.query(`
  MATCH p = (a:Person)-[:KNOWS]->(b:Person)-[:KNOWS]->(c:Person)
  RETURN p
`);
```

## More Examples

See the [Multi-Hop Queries Tutorial](../tutorials/multi-hop-queries) for traversal patterns.