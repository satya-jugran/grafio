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

## Partially supported

| Clause | Notes |
|--------|-------|
| `MATCH` | Missing `shortestPath()` |
| `WHERE` | Missing regex matching (`=~`), `exists()`, and list comprehensions |
| `RETURN` | Missing `CASE WHEN` and list/map projections |
| `REMOVE` | Missing label removal (`REMOVE n:Label`) |
| `CREATE INDEX` | Missing index uniqueness constraints |

## Not supported

- `UNWIND`
- `CALL`
- `YIELD`
- `LOAD CSV`
- `FOREACH`

## Coverage

Grafio currently covers approximately **79%** of standard openCypher clauses (19 out of 24 core clauses are either fully or partially supported).

<CoverageChart />
