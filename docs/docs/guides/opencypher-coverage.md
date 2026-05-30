# Open Cypher Coverage

import CoverageChart from '@site/src/components/CoverageChart';

Grafio's Cypher engine supports a comprehensive subset of openCypher.

## Fully supported

- `ORDER BY`
- `SKIP`
- `LIMIT`
- `CREATE`
- `DELETE`
- `DETACH DELETE`
- `DROP INDEX`
- `SHOW INDEXES`
- `WITH`
- `MERGE`
- `SET`
- `OPTIONAL MATCH`
- `UNION`
- `UNION ALL`
- `EXISTS`
- `WHERE`
- `REMOVE`

## Partially supported

| Clause | Notes |
|--------|-------|
| `MATCH` | Missing pattern comprehensions and paths as expressions |
| `RETURN` | Missing `CASE WHEN`, `XOR`, `%`, `^`, string matching (`STARTS WITH`, `ENDS WITH`, `CONTAINS`), and list predicates (`ALL`, `ANY`, `NONE`, `SINGLE`) |
| `CREATE INDEX` | *Note: Index DDL is actually a Grafio extension, not in standard openCypher!* |

## Not supported

- `UNWIND`
- `CALL`
- `YIELD`

## Source of Truth

Grafio aims to comply strictly with the official openCypher grammar. You can refer to the official specification here:
[openCypher](https://opencypher.org/)

## Coverage

Grafio currently covers **85%** of standard openCypher clauses (17 out of 20 core standard clauses are either fully or partially supported).

<CoverageChart />
