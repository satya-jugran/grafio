# Node Class

Represents a node entity in the graph.

## Import

```typescript
import { Node } from 'grafio';
```

## Properties

### id

```typescript
readonly id: string
```

Unique identifier (auto-generated UUID).

### type

```typescript
readonly type: string
```

The node type label (e.g., 'Person', 'Course').

### properties

```typescript
readonly properties: Readonly<Record<string, Primitive>>
```

The node's key-value properties. Properties are deep-frozen for immutability.

## Methods

### toJSON()

```typescript
toJSON(): NodeData
```

Converts the node to a JSON-serializable object.

**Returns:** `NodeData`

```typescript
interface NodeData {
  id: string;
  type: string;
  properties: Record<string, Primitive>;
}
```

## Example

```typescript
const node = await graph.addNode('Person', { name: 'Alice', age: 30 });

console.log(node.id);         // 'uuid-xxxx-xxxx'
console.log(node.type);       // 'Person'
console.log(node.properties); // { name: 'Alice', age: 30 }

// Serialize
const json = node.toJSON();
/*
{
  id: 'uuid-xxxx-xxxx',
  type: 'Person',
  properties: { name: 'Alice', age: 30 }
}
*/
```

## Immutability

Node properties are **deep-frozen** to prevent accidental mutation:

```typescript
const node = await graph.addNode('Person', { name: 'Alice' });
node.properties.name = 'Bob'; // TypeError: Cannot assign to read only property
```

To modify, use Graph's property update methods:

```typescript
await graph.updateNodeProperty(node.id, 'name', 'Bob');