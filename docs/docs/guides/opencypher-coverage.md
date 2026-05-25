# Open Cypher Coverage

import CoverageChart from '@site/src/components/CoverageChart';

Grafio's Cypher engine supports a comprehensive subset of openCypher.

## Fully supported

- `ORDER BY`
- `SKIP`
- `LIMIT`
- `WITH`
- `CREATE`
- `DELETE`
- `DETACH DELETE`
- `DROP INDEX`
- `SHOW INDEXES`

## Partially supported

| Clause | Notes |
|--------|-------|
| `MATCH` | Missing `OPTIONAL MATCH` and `shortestPath()` |
| `WHERE` | Missing regex matching (`=~`), `exists()`, and list comprehensions |
| `RETURN` | Missing `CASE WHEN` and list/map projections |
| `MERGE` | Missing multiple comma-separated patterns in a single clause |
| `SET` | Missing replacing/mutating all properties with a map (`SET n = {map}`) |
| `REMOVE` | Missing label removal (`REMOVE n:Label`) |
| `CREATE INDEX` | Missing index uniqueness constraints |

## Not supported

- `OPTIONAL MATCH`
- `UNWIND`
- `CALL`
- `YIELD`
- `UNION`
- `UNION ALL`
- `LOAD CSV`
- `FOREACH`

## Coverage

Grafio currently covers approximately **66%** of standard openCypher clauses (16 out of 24 core clauses are either fully or partially supported).

<CoverageChart />
