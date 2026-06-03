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
- `RETURN`
- `UNWIND`

## Additionally supported
- `CREATE INDEX`
- `DROP INDEX`
- `SHOW INDEXES`

## Not supported

- `CALL`
- `YIELD`

## openCypher Compliance

Grafio aims to comply strictly with the official openCypher grammar. You can refer to the official specification here:
[openCypher](https://opencypher.org/)

## Coverage

Grafio currently covers **89%** of standard openCypher clauses (17 out of 19 core standard clauses are fully supported).

<CoverageChart />
