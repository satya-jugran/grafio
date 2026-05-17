# Edge Class

Represents a directed relationship between two nodes.

## Import

```typescript
import { Edge } from 'grafio';
```

## Properties

### id

```typescript
readonly id: string
```

Unique identifier (auto-generated UUID).

### sourceId

```typescript
readonly sourceId: string
```

The source node ID (where the edge starts).

### targetId

```typescript
readonly targetId: string
```

The target node ID (where the edge ends).

### type

```typescript
readonly type: string
```

The edge type (e.g., 'KNOWS', 'CONTAINS', 'AUTHOR_OF').

### properties

```typescript
readonly properties: Readonly<Record<string, Primitive>>
```

The edge's key-value properties. Properties are deep-frozen for immutability.

## Methods

### toJSON()

```typescript
toJSON(): EdgeData
```

Converts the edge to a JSON-serializable object.

**Returns:** `EdgeData`

```typescript
interface EdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, Primitive>;
}
```

## Example

```typescript
const edge = await graph.addEdge(sourceId, targetId, 'KNOWS', { since: 2020 });

console.log(edge.id);        // 'uuid-xxxx-xxxx'
console.log(edge.sourceId);  // 'source-node-id'
console.log(edge.targetId);  // 'target-node-id'
console.log(edge.type);       // 'KNOWS'
console.log(edge.properties); // { since: 2020 }

// Serialize
const json = edge.toJSON();
/*
{
  id: 'uuid-xxxx-xxxx',
  sourceId: 'source-node-id',
  targetId: 'target-node-id',
  type: 'KNOWS',
  properties: { since: 2020 }
}
*/
```

## Immutability

Like Node properties, Edge properties are **deep-frozen**:

```typescript
edge.properties.since = 2021; // TypeError: Cannot assign to read only property
```

Use Graph's edge property methods to modify:

```typescript
await graph.updateEdgeProperty(edge.id, 'since', 2021);