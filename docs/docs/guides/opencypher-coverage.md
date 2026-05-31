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
- `WITH`
- `MERGE`
- `SET`
- `OPTIONAL MATCH`
- `UNION`
- `UNION ALL`
- `EXISTS`
- `WHERE`
- `REMOVE`
- `MATCH`

## Additionally supported
- `CREATE INDEX`
- `DROP INDEX`
- `SHOW INDEXES`

## Partially supported

| Clause | Notes |
|--------|-------|
| `RETURN` | Missing `CASE WHEN`, `XOR`, `%`, `^`, string matching (`STARTS WITH`, `ENDS WITH`, `CONTAINS`), and list predicates (`ALL`, `ANY`, `NONE`, `SINGLE`) |

## Not supported

- `UNWIND`
- `CALL`
- `YIELD`

## openCypher Compliance

Grafio aims to comply strictly with the official openCypher grammar. You can refer to the official specification here:
[openCypher](https://opencypher.org/)

## Coverage

Grafio currently covers **85%** of standard openCypher clauses (16 out of 19 core standard clauses are either fully or partially supported).

<CoverageChart />
