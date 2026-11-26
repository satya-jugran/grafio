# Functions

This guide covers the Cypher functions available in Grafio for querying and manipulating graph data.

## Scalar Functions

### ID

Returns the internal id of a node or relationship.

```cypher
MATCH (p:Person {name: 'Alice'})
RETURN ID(p)
```

**With Relationships:**

```cypher
MATCH (a)-[r:KNOWS]->(b)
RETURN ID(r)
```

### labels(node)

Returns the labels of a node as an array of strings. This corresponds to the node type(s) assigned when the node was created. A node can have multiple labels.

```cypher
MATCH (p:Person {name: 'Alice'})
RETURN labels(p) AS nodeLabels
```

**Example:**

A node created with `await graph.addNode('Person', { name: 'Alice' })` will have `labels(p)` return `['Person']`.

### type(relationship)

Returns the relationship type of an edge/relationship as a string.

```cypher
MATCH (a)-[r:KNOWS]->(b)
RETURN type(r) AS relationshipType
```

**Example:**

An edge created with `await graph.addEdge(from, to, 'KNOWS')` will have `type(r)` return `'KNOWS'`.

### keys(entityOrMap)

Returns the property key names of a node, relationship, or map as a list of strings.

```cypher
MATCH (p:Person {name: 'Alice'})
RETURN keys(p) AS propKeys
```

### properties(entityOrMap)

Returns a map containing all properties of a node, relationship, or map.

```cypher
MATCH (p:Person {name: 'Alice'})
RETURN properties(p) AS props
```

## Null Handling

### coalesce(expr1, expr2, ...)

Evaluates arguments lazily left-to-right and returns the first non-null value, or `null` if all arguments evaluate to `null`.

```cypher
MATCH (p:Person)
RETURN p.name, coalesce(p.nickname, p.name, 'Anonymous') AS displayName
```

## String Functions

| Function | Description | Example |
|----------|-------------|---------|
| `toLower(s)` / `lower(s)` | Lowercase string | `toLower('NYC')` → `'nyc'` |
| `toUpper(s)` / `upper(s)` | Uppercase string | `toUpper('nyc')` → `'NYC'` |
| `trim(s)` | Strip leading & trailing whitespace | `trim('  hi  ')` → `'hi'` |
| `lTrim(s)` | Strip leading whitespace | `lTrim('  hi')` → `'hi'` |
| `rTrim(s)` | Strip trailing whitespace | `rTrim('hi  ')` → `'hi'` |
| `substring(s, start[, length])` | Substring from `start` of optional `length` | `substring('grafio', 0, 4)` → `'graf'` |
| `replace(s, search, rep)` | Replace all occurrences of `search` | `replace('a-b-a', 'a', 'x')` → `'x-b-x'` |
| `split(s, delim)` | Split string into list by `delim` | `split('a,b,c', ',')` → `['a', 'b', 'c']` |
| `size(s)` | Character length of string | `size('grafio')` → `6` |

```cypher
MATCH (p:Person)
WHERE toLower(p.city) = 'nyc'
RETURN trim(p.name) AS name, split(p.tags, ',') AS tagList
```

## Type Conversion Functions

| Function | Description | Unparseable String |
|----------|-------------|--------------------|
| `toString(v)` | Convert string, number, or boolean to string | N/A |
| `toInteger(v)` / `toInt(v)` | Truncate number, parse integer string, or convert boolean (`1`/`0`) | `null` |
| `toFloat(v)` | Convert number or numeric string to float | `null` |
| `toBoolean(v)` | Convert boolean, `'true'`/`'false'` string, or integer (`0`/`non-zero`) | `null` |

```cypher
RETURN toInteger('42') AS num,
       toFloat('3.14') AS pi,
       toBoolean('true') AS flag,
       toString(100) AS label
```

## List Functions

| Function | Description | Example |
|----------|-------------|---------|
| `size(list)` | Number of elements in a list | `size([1, 2, 3])` → `3` |
| `head(list)` | First element, or `null` if empty | `head([10, 20])` → `10` |
| `last(list)` | Last element, or `null` if empty | `last([10, 20])` → `20` |
| `tail(list)` | All elements except the first | `tail([10, 20, 30])` → `[20, 30]` |
| `range(start, end[, step])` | Inclusive integer sequence | `range(1, 5, 2)` → `[1, 3, 5]` |

## Mathematical & Temporal Functions

| Function | Description | Example |
|----------|-------------|---------|
| `abs(n)` | Absolute value | `abs(-5)` → `5` |
| `round(n[, precision])` | Round to nearest integer or `precision` decimal places | `round(3.14159, 2)` → `3.14` |
| `ceil(n)` | Smallest integer greater than or equal to `n` | `ceil(2.1)` → `3` |
| `floor(n)` | Largest integer less than or equal to `n` | `floor(2.9)` → `2` |
| `sqrt(n)` | Square root (`null` for negative inputs) | `sqrt(16)` → `4` |
| `timestamp()` | Current epoch milliseconds | `timestamp()` |

## Path Functions

Path functions are used to extract nodes or relationships from a path variable obtained via variable-length matches. When you use a named path in a `MATCH` clause (e.g., `MATCH p = (a)-[:R]->(b)`), the path variable contains an alternating sequence:

```
[node₀, edge₀, node₁, edge₁, ..., nodeₙ]
```

### nodes(path)

Extracts all nodes from a path. Returns elements at even indices (0, 2, 4, ...).

```cypher
MATCH p = (start:Person)-[:KNOWS*1..2]->(end:Person)
WHERE start.name = 'Alice'
RETURN nodes(p) AS pathNodes
```

**How it works:**

Given a path `Alice --[KNOWS]--> Bob --[KNOWS]--> Carol`:

- Path array: `[Alice, KNOWS_edge, Bob, KNOWS_edge, Carol]`
- `nodes(p)` returns: `[Alice, Bob, Carol]`

### relationships(path)

Extracts all relationships/edges from a path. Returns elements at odd indices (1, 3, 5, ...).

```cypher
MATCH p = (a:Person)-[:KNOWS*2]->(b:Person)
WHERE a.name = 'Alice'
RETURN relationships(p) AS pathEdges
```

**How it works:**

Given a path `Alice --[KNOWS]--> Bob --[KNOWS]--> Carol`:

- Path array: `[Alice, KNOWS_edge, Bob, KNOWS_edge, Carol]`
- `relationships(p)` returns: `[KNOWS_edge, KNOWS_edge]`

### length(path)

Returns the number of relationships (hops) in a path.

```cypher
MATCH p = (a:Person)-[:KNOWS*1..3]->(b:Person)
RETURN length(p) AS hops
```

### Combined Usage

Often used together to inspect both the nodes and edges of a path:

```cypher
MATCH p = (a)-[r]->(b)-[r2]->(c)
RETURN nodes(p) AS allNodes, 
       relationships(p) AS allRelationships
```

**Use cases:**

- Debugging path-based queries
- Analyzing the full structure of traversed paths
- Extracting node sequences for further processing
- Building adjacency lists from paths
