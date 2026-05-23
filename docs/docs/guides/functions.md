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
