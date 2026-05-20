# Real-Time Filtering Tutorial

Build dynamic filtering into your application.

## What You'll Build

A product catalog with real-time filtering by category, price, and availability.

## Step 1: Create Product Catalog

```typescript
import { InMemoryGraphFactory } from 'grafio';
import { CypherEngine } from 'grafio/cypher';

const factory = new InMemoryGraphFactory();
const graph = factory.forGraph('default');
const engine = new CypherEngine(graph);

// Build graph
await engine.execute(`
  CREATE (electronics:Category {name: 'Electronics'}),
         (clothing:Category {name: 'Clothing'}),
         (laptop:Product {name: 'Laptop', price: 999, inStock: true}),
         (phone:Product {name: 'Phone', price: 699, inStock: true}),
         (headphones:Product {name: 'Headphones', price: 149, inStock: false}),
         (tshirt:Product {name: 'T-Shirt', price: 29, inStock: true}),
         (jeans:Product {name: 'Jeans', price: 79, inStock: true})
`);

await engine.execute(`
  MATCH (e:Category {name: 'Electronics'}), (laptop:Product {name: 'Laptop'})
  MATCH (p:Product {name: 'Phone'}), (h:Product {name: 'Headphones'})
  MATCH (c:Category {name: 'Clothing'}), (t:Product {name: 'T-Shirt'}), (j:Product {name: 'Jeans'})
  CREATE (e)-[:CONTAINS]->(laptop)
  CREATE (e)-[:CONTAINS]->(p)
  CREATE (e)-[:CONTAINS]->(h)
  CREATE (c)-[:CONTAINS]->(t)
  CREATE (c)-[:CONTAINS]->(j)
`);
```

## Step 2: Filter by Single Condition

### Filter by Category

```typescript
const electronicsProducts = await engine.query(`
  MATCH (c:Category {name: 'Electronics'})-[:CONTAINS]->(p:Product)
  RETURN p.name, p.price
`);
```

### Filter by Price

```typescript
const affordableProducts = await engine.query(`
  MATCH (p:Product)
  WHERE p.price < 100
  RETURN p.name, p.price
`);
```

## Step 3: Filter by Multiple Conditions

### AND Conditions

```typescript
const cheapInStock = await engine.query(`
  MATCH (p:Product)
  WHERE p.price < 100 AND p.inStock = true
  RETURN p.name, p.price
`);
```

### OR Conditions

```typescript
const premiumOrInStock = await engine.query(`
  MATCH (p:Product)
  WHERE p.price > 500 OR p.inStock = true
  RETURN p.name, p.price, p.inStock
`);
```

### Complex Filters

```typescript
const electronicsUnder500 = await engine.query(`
  MATCH (c:Category {name: 'Electronics'})-[:CONTAINS]->(p:Product)
  WHERE p.price < 500 AND p.inStock = true
  RETURN p.name, p.price
  ORDER BY p.price
`);
```

## Step 4: String Filters

### CONTAINS

```typescript
const nameSearch = await engine.query(`
  MATCH (p:Product)
  WHERE p.name CONTAINS 'phone'
  RETURN p.name
`);
```

### STARTS WITH / ENDS WITH

```typescript
const tProducts = await engine.query(`
  MATCH (p:Product)
  WHERE p.name STARTS WITH 'T'
  RETURN p.name
`);
```

## Step 5: List Filters (IN / NOT IN)

```typescript
const specificProducts = await engine.query(`
  MATCH (p:Product)
  WHERE p.name IN ['Laptop', 'Jeans']
  RETURN p.name
`);
```

### NOT IN

```typescript
const excludeCategories = await engine.query(`
  MATCH (p:Product)
  WHERE p.name NOT IN ['T-Shirt']
  RETURN p.name
`);
```

## Step 6: NULL Handling

```typescript
// Products without discount
const noDiscount = await engine.query(`
  MATCH (p:Product)
  WHERE p.discount IS NULL
  RETURN p.name
`);

// Products with discount
const withDiscount = await engine.query(`
  MATCH (p:Product)
  WHERE p.discount IS NOT NULL
  RETURN p.name
`);
```

## Step 7: Pagination

```typescript
// First page
const page1 = await engine.query(`
  MATCH (p:Product)
  RETURN p.name, p.price
  ORDER BY p.price
  SKIP 0 LIMIT 3
`);

// Second page
const page2 = await engine.query(`
  MATCH (p:Product)
  RETURN p.name, p.price
  ORDER BY p.price
  SKIP 3 LIMIT 3
`);
```

## Step 8: Aggregation with Filters

```typescript
const stats = await engine.query(`
  MATCH (p:Product)
  WHERE p.inStock = true
  RETURN COUNT(*) AS total,
         AVG(p.price) AS avgPrice,
         MIN(p.price) AS minPrice,
         MAX(p.price) AS maxPrice
`);
```

### Group by Category

```typescript
const byCategory = await engine.query(`
  MATCH (c:Category)-[:CONTAINS]->(p:Product)
  WHERE p.inStock = true
  RETURN c.name AS category,
         COUNT(*) AS count,
         AVG(p.price) AS avgPrice
  ORDER BY avgPrice DESC
`);
```

## Complete Filter Function

```typescript
async function filterProducts(filters: {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  let query = `
    MATCH (c:Category)-[:CONTAINS]->(p:Product)
    WHERE 1=1
  `;

  if (filters.category) {
    query += ` AND c.name = '${filters.category}'`;
  }
  if (filters.minPrice !== undefined) {
    query += ` AND p.price >= ${filters.minPrice}`;
  }
  if (filters.maxPrice !== undefined) {
    query += ` AND p.price <= ${filters.maxPrice}`;
  }
  if (filters.inStock !== undefined) {
    query += ` AND p.inStock = ${filters.inStock}`;
  }
  if (filters.search) {
    query += ` AND p.name CONTAINS '${filters.search}'`;
  }

  query += ` RETURN p.name, p.price, p.inStock ORDER BY p.price`;

  if (filters.page !== undefined && filters.pageSize !== undefined) {
    query += ` SKIP ${filters.page * filters.pageSize} LIMIT ${filters.pageSize}`;
  }

  return engine.query(query);
}

// Usage
const results = await filterProducts({
  category: 'Electronics',
  maxPrice: 500,
  inStock: true,
  page: 0,
  pageSize: 10
});
```

## Next Steps

- [Filtering Guide](../guides/filtering) — full filtering reference
- [Cypher Language Guide](../guides/cypher-language) — WHERE clause details
- [Core Concepts Guide](../guides/core-concepts) — graph data model