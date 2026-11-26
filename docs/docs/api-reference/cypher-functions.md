# Cypher Functions

Reference for supported Cypher aggregation, scalar, path, string, conversion, list, and math functions.

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
       relationships(p) AS allRelationships,
       length(p) AS hops
```

This is useful for debugging path-based queries and for applications that need to analyze the full structure of traversed paths.

### length(path)

Returns the number of relationships in a path (`(pathElements - 1) / 2`).

## Entity, Map & Null Functions

| Signature | Input Types | Return Type | Null / Edge-Case Behavior |
|----------|-------------|-------------|---------------------------|
| `id(entity)` | `Node \| Edge` | `string \| null` | `null` → `null` |
| `labels(node)` | `Node` | `string[] \| null` | `null` → `null` |
| `type(rel)` | `Edge` | `string \| null` | `null` → `null` |
| `keys(entityOrMap)` | `Node \| Edge \| Map` | `string[] \| null` | `null` → `null`; omits `undefined` map keys |
| `properties(entityOrMap)` | `Node \| Edge \| Map` | `Map \| null` | `null` → `null`; returns shallow property copy |
| `coalesce(expr1, ...)` | `any...` | `any \| null` | Lazily evaluated; returns `null` if all args are nullish |

## String Functions

| Signature | Input Types | Return Type | Null / Edge-Case Behavior |
|----------|-------------|-------------|---------------------------|
| `toLower(s)` / `lower(s)` | `string` | `string \| null` | `null` → `null` |
| `toUpper(s)` / `upper(s)` | `string` | `string \| null` | `null` → `null` |
| `trim(s)` / `lTrim(s)` / `rTrim(s)` | `string` | `string \| null` | `null` → `null` |
| `substring(s, start[, length])` | `string, int[, int]` | `string \| null` | `null` on any arg → `null`; `start < 0` or `length < 0` throws |
| `replace(s, search, rep)` | `string, string, string` | `string \| null` | Replaces all occurrences; `null` on any arg → `null` |
| `split(s, delimiter)` | `string, string` | `string[] \| null` | `null` on any arg → `null` |
| `size(s)` | `string \| any[]` | `number \| null` | `null` → `null` |

## Type Conversion Functions

| Signature | Input Types | Return Type | Null / Edge-Case Behavior |
|----------|-------------|-------------|---------------------------|
| `toString(v)` | `string \| number \| boolean` | `string \| null` | `null` → `null`; objects/lists throw |
| `toInteger(v)` / `toInt(v)` | `number \| string \| boolean` | `number \| null` | Unparseable/empty strings → `null`; non-finite/objects throw |
| `toFloat(v)` | `number \| string` | `number \| null` | Unparseable/empty strings → `null`; booleans/objects throw |
| `toBoolean(v)` | `boolean \| string \| int` | `boolean \| null` | Unparseable strings → `null`; floats/objects throw |

## List Functions

| Signature | Input Types | Return Type | Null / Edge-Case Behavior |
|----------|-------------|-------------|---------------------------|
| `size(list)` | `any[] \| string` | `number \| null` | `null` → `null` |
| `head(list)` | `any[]` | `any \| null` | Empty list → `null` |
| `last(list)` | `any[]` | `any \| null` | Empty list → `null` |
| `tail(list)` | `any[]` | `any[] \| null` | Empty list → `[]` |
| `range(start, end[, step])` | `int, int[, int]` | `number[]` | Inclusive; `step = 0` or `null` bounds throw |

## Mathematical & Temporal Functions

| Signature | Input Types | Return Type | Null / Edge-Case Behavior |
|----------|-------------|-------------|---------------------------|
| `abs(x)` | `number` | `number \| null` | `null` → `null` |
| `ceil(x)` | `number` | `number \| null` | `null` → `null` |
| `floor(x)` | `number` | `number \| null` | `null` → `null` |
| `round(x[, precision])` | `number[, int]` | `number \| null` | `precision >= 0`; `null` → `null` |
| `sqrt(x)` | `number` | `number \| null` | `x < 0` → `null` |
| `timestamp()` | none | `number` | Evaluated at execution time (epoch ms) |

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