# Cypher Functions

Reference for supported Cypher aggregation functions.

## COUNT

Count rows or values.

### COUNT(*)

```cypher
MATCH (p:Person) RETURN COUNT(*)
```

### COUNT(expression)

```cypher
MATCH (p:Person) RETURN COUNT(p.age)
```

### COUNT(DISTINCT)

```cypher
MATCH (p:Person) RETURN COUNT(DISTINCT p.city)
```

## AVG

Average of numeric values.

```cypher
MATCH (p:Person) RETURN AVG(p.age)
```

### AVG with DISTINCT

```cypher
MATCH (o:Order) RETURN AVG(DISTINCT o.discount)
```

## SUM

Sum of numeric values.

```cypher
MATCH (o:Order) RETURN SUM(o.amount)
```

## MIN

Minimum value.

```cypher
MATCH (p:Person) RETURN MIN(p.age)
```

## MAX

Maximum value.

```cypher
MATCH (p:Person) RETURN MAX(p.age)
```

## COLLECT

Collect values into an array.

```cypher
MATCH (p:Person) RETURN COLLECT(p.name)
```

### With DISTINCT

```cypher
MATCH (p:Person) RETURN COLLECT(DISTINCT p.city)
```

## ID

Returns the internal UUID of a node or relationship.

```cypher
MATCH (p:Person {name: 'Alice'})
RETURN ID(p)
```

### With Relationships

```cypher
MATCH (a)-[r:KNOWS]->(b)
RETURN ID(r)
```

## Path Functions

These functions extract nodes or relationships from a path variable obtained via variable-length matches.

### nodes(path)

Extracts all nodes from a path. When you use a named path in a `MATCH` clause (e.g., `MATCH p = (a)-[:R]->(b)`), the path variable `p` contains an alternating sequence of nodes and edges: `[node₀, edge₀, node₁, edge₁, ..., nodeₙ]`. The `nodes()` function returns only the node elements.

```cypher
MATCH p = (start:Person)-[:KNOWS*1..2]->(end:Person)
WHERE start.name = 'Alice'
RETURN nodes(p) AS pathNodes
```

**Example:** Given a path `Alice --[KNOWS]--> Bob --[KNOWS]--> Carol`, `nodes(p)` returns `[Alice, Bob, Carol]`.

### relationships(path)

Extracts all relationships/edges from a path. Similar to `nodes()`, but returns only the edge elements from the alternating sequence.

```cypher
MATCH p = (a:Person)-[:KNOWS*2]->(b:Person)
WHERE a.name = 'Alice'
RETURN relationships(p) AS pathEdges
```

**Example:** Given a path `Alice --[KNOWS]--> Bob --[KNOWS]--> Carol`, `relationships(p)` returns `[[KNOWS], [KNOWS]]`.

### Combined Usage

Often used together to inspect both the nodes and edges of a path:

```cypher
MATCH p = (a)-[r]->(b)-[r2]->(c)
RETURN nodes(p) AS allNodes,
       relationships(p) AS allRelationships
```

This is useful for debugging path-based queries and for applications that need to analyze the full structure of traversed paths.

## Using Aliases

Combine with aliases for cleaner output:

```cypher
MATCH (p:Person) 
RETURN p.city, 
       COUNT(*) AS total,
       AVG(p.age) AS avgAge,
       MIN(p.age) AS minAge,
       MAX(p.age) AS maxAge
ORDER BY total DESC