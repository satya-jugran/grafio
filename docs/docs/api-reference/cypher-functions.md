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