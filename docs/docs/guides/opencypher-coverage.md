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

## Partially supported

| Clause | Notes |
|--------|-------|
| `MATCH` | Missing `shortestPath()` |
| `RETURN` | Missing `CASE WHEN` and list/map projections |
| `REMOVE` | Missing label removal (`REMOVE n:Label`) |
| `CREATE INDEX` | Missing index uniqueness constraints |

## Not supported

- `UNWIND`
- `CALL`
- `YIELD`
- `FOREACH`

## Coverage

Grafio currently covers **83%** of standard openCypher clauses (20 out of 24 core clauses are either fully or partially supported).

<CoverageChart />
