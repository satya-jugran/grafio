# Social Network Tutorial

Build a social network graph step by step.

## What You'll Build

A simple social network with users, friendships, and followers.

## Step 1: Create the Graph

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);
```

## Step 2: Add Users

```typescript
await engine.execute(`
  CREATE (alice:User {name: 'Alice', age: 30, city: 'NYC'}),
         (bob:User {name: 'Bob', age: 25, city: 'LA'}),
         (carol:User {name: 'Carol', age: 35, city: 'NYC'}),
         (david:User {name: 'David', age: 28, city: 'SF'})
`);
```

## Step 3: Create Relationships

```typescript
await engine.execute(`
  MATCH (a:User {name: 'Alice'}), (b:User {name: 'Bob'})
  MATCH (c:User {name: 'Carol'}), (d:User {name: 'David'})
  CREATE (a)-[:KNOWS]->(b)
  CREATE (b)-[:KNOWS]->(a)
  CREATE (c)-[:FOLLOWS]->(a)
  CREATE (d)-[:KNOWS]->(c)
  CREATE (c)-[:KNOWS]->(d)
`);
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
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

async function main() {
  const factory = new InMemoryGraphFactory();
  const graph = factory.forGraph('default');
  const engine = new CypherEngine(graph);

  // Build graph
  await engine.execute(`
    CREATE (alice:User {name: 'Alice', age: 30, city: 'NYC'}),
           (bob:User {name: 'Bob', age: 25, city: 'LA'}),
           (carol:User {name: 'Carol', age: 35, city: 'NYC'}),
           (david:User {name: 'David', age: 28, city: 'SF'})
  `);

  await engine.execute(`
    MATCH (a:User {name: 'Alice'}), (b:User {name: 'Bob'})
    MATCH (c:User {name: 'Carol'}), (d:User {name: 'David'})
    CREATE (a)-[:KNOWS]->(b)
    CREATE (b)-[:KNOWS]->(a)
    CREATE (c)-[:FOLLOWS]->(a)
    CREATE (d)-[:KNOWS]->(c)
    CREATE (c)-[:KNOWS]->(d)
  `);

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
- [Cypher Language Guide](../guides/cypher-language) — learn the query language
- [Real-Time Filtering Tutorial](../tutorials/real-time-filtering) — dynamic filtering