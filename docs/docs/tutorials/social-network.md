# Social Network Tutorial

Build a social network graph step by step.

## What You'll Build

A simple social network with users, friendships, and followers.

## Step 1: Create the Graph

```typescript
import { Graph } from 'grafio';

const graph = new Graph();
```

## Step 2: Add Users

```typescript
const alice = await graph.addNode('User', { name: 'Alice', age: 30, city: 'NYC' });
const bob = await graph.addNode('User', { name: 'Bob', age: 25, city: 'LA' });
const carol = await graph.addNode('User', { name: 'Carol', age: 35, city: 'NYC' });
const david = await graph.addNode('User', { name: 'David', age: 28, city: 'SF' });
```

## Step 3: Create Relationships

```typescript
// Alice and Bob are friends
await graph.addEdge(alice.id, bob.id, 'KNOWS');
await graph.addEdge(bob.id, alice.id, 'KNOWS');

// Carol follows Alice
await graph.addEdge(carol.id, alice.id, 'FOLLOWS');

// David is friends with Carol
await graph.addEdge(david.id, carol.id, 'KNOWS');
await graph.addEdge(carol.id, david.id, 'KNOWS');
```

## Step 4: Query the Network

### Find All Friends of Alice

```typescript
const result = await engine.query(`
  MATCH (alice:User {name: 'Alice'})-[:KNOWS]->(friend:User)
  RETURN friend.name AS friendName
`);

console.log(`Alice's friends: ${result.rows.map(r => r.friendName)}`);
```

### Find Alice's Followers

```typescript
const result = await engine.query(`
  MATCH (follower:User)-[:FOLLOWS]->(alice:User {name: 'Alice'})
  RETURN follower.name AS followerName
`);

console.log(`Alice's followers: ${result.rows.map(r => r.followerName)}`);
```

## Step 5: Filter Users

### Find Users in NYC using Cypher

```typescript
const result = await engine.query(`
  MATCH (u:User) WHERE u.city = 'NYC' RETURN u.name, u.age
`);
```

### Find Users Over 30

```typescript
const result = await engine.query(`
  MATCH (u:User) WHERE u.age > 30 RETURN u.name, u.age
`);
```

## Step 6: Analyze the Network

### Check Connectivity with Traverse

```typescript
// Is there a path from David to Alice?
const paths = await graph.traverse(david.id, alice.id);
console.log(paths); // [['davidId', 'carolId', 'aliceId']] or null
```

## Complete Code

```typescript
import { Graph } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

async function main() {
  const graph = new Graph();
  const engine = new CypherEngine(graph);

  // Create users
  const alice = await graph.addNode('User', { name: 'Alice', age: 30, city: 'NYC' });
  const bob = await graph.addNode('User', { name: 'Bob', age: 25, city: 'LA' });
  const carol = await graph.addNode('User', { name: 'Carol', age: 35, city: 'NYC' });
  const david = await graph.addNode('User', { name: 'David', age: 28, city: 'SF' });

  // Create relationships
  await graph.addEdge(alice.id, bob.id, 'KNOWS');
  await graph.addEdge(bob.id, alice.id, 'KNOWS');
  await graph.addEdge(carol.id, alice.id, 'FOLLOWS');
  await graph.addEdge(david.id, carol.id, 'KNOWS');
  await graph.addEdge(carol.id, david.id, 'KNOWS');

  // Find Alice's friends
  const friends = await engine.query(`
    MATCH (alice:User {name: 'Alice'})-[:KNOWS]->(friend:User)
    RETURN friend.name AS friendName
  `);
  console.log(`Alice's friends: ${friends.rows.map(r => r.friendName)}`);

  // Find users in NYC
  const nycUsers = await engine.query(`
    MATCH (u:User {city: 'NYC'}) RETURN u.name AS name
  `);
  console.log(`NYC users: ${nycUsers.rows.map(r => r.name)}`);

  // Check for path
  const path = await graph.traverse(david.id, alice.id);
  console.log(`Path from David to Alice: ${path}`);
}

main();
```

## Next Steps

- [Multi-Hop Queries Tutorial](../tutorials/multi-hop-queries) — more traversal patterns
- [Cypher Queries Guide](../guides/cypher-queries) — learn the query language
- [Real-Time Filtering Tutorial](../tutorials/real-time-filtering) — dynamic filtering