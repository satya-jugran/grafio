import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { InMemoryStorageProvider } from '../../src/storage/InMemoryStorageProvider';
import { CachedStorageProvider } from '../../src/storage/CachedStorageProvider';
import { CacheManager } from '../../src/storage/cache/CacheManager';
import type { CacheConfig } from '../../src/storage/cache/CacheConfig';
import { CypherEngine } from '../../src/cypher';
import { NodeHasEdgesError } from '../../src/errors';

describe('Async Storage Provider Integration', () => {
  const cacheConfig: CacheConfig = {
    maxNodesCount: 200,
    maxEdgesCount: 400,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  };

  let backing: InMemoryStorageProvider;
  let cacheManager: CacheManager;
  let cached: CachedStorageProvider;
  let graph: Graph;

  beforeEach(() => {
    backing = new InMemoryStorageProvider();
    cacheManager = new CacheManager(cacheConfig);
    cached = new CachedStorageProvider(backing, 'async-storage-test', cacheManager, cacheConfig);
    graph = new Graph(cached);
  });

  afterEach(async () => {
    await cacheManager.invalidateAll();
  });

  it('routes Graph CRUD, property patches, indexes, aggregates, and traversal through async provider', async () => {
    expect(graph._getSyncKernel()).toBeNull();
    await graph.warmCache();

    const a = await graph.addNode(['Person', 'Vip'], { name: 'Alice', age: 30 });
    const batch = await graph.addNodes([
      { labels: 'Person', properties: { name: 'Bob', age: 25 } },
      { labels: 'Person', properties: { name: 'Carol', age: 35 } },
    ]);
    const [b, c] = batch;

    expect(await graph.hasNode(a.id)).toBe(true);
    expect((await graph.getNode(a.id))?.properties.name).toBe('Alice');
    expect((await graph.getNodesByIds([a.id, b.id])).size).toBe(2);
    expect(await graph.getNodeCount()).toBe(3);

    const e1 = await graph.addEdge(a.id, b.id, 'KNOWS', { weight: 2 });
    const eBatch = await graph.addEdges([
      { sourceId: b.id, targetId: c.id, type: 'KNOWS', properties: { weight: 4 } },
    ]);
    expect(await graph.hasEdge(e1.id)).toBe(true);
    expect((await graph.getEdge(e1.id))?.properties.weight).toBe(2);
    expect(await graph.getEdgeCount()).toBe(2);
    expect(await graph.getEdges()).toHaveLength(2);
    expect(await graph.getEdgesFrom(a.id)).toHaveLength(1);
    expect(await graph.getEdgesTo(b.id)).toHaveLength(1);
    expect(await graph.getDirectEdgesBetween(a.id, b.id)).toHaveLength(1);

    // Property & label mutations
    await graph.setNodeProperties(a.id, { role: 'Admin' });
    await graph.unsetNodeProperties(a.id, ['role']);
    await graph.setNodeProperties(b.id, { age: 26 }, { merge: false });
    await graph.removeNodeLabels(a.id, ['Vip']);
    expect((await graph.getNode(a.id))?.labels).toEqual(['Person']);
    expect((await graph.getNode(b.id))?.properties).toEqual({ age: 26 });

    await graph.setEdgeProperties(e1.id, { extra: true });
    await graph.unsetEdgeProperties(e1.id, ['extra']);
    expect((await graph.getEdge(e1.id))?.properties).toEqual({ weight: 2 });

    // Index management & aggregates
    await graph.createIndex('idx_p_name', 'node', ['name'], { labelOrType: 'Person' });
    expect(await graph.hasIndex('node', ['name'], 'Person')).toBe(true);
    expect((await graph.getIndex('idx_p_name'))?.name).toBe('idx_p_name');
    expect(await graph.getIndexes()).toHaveLength(1);
    expect((await graph.aggregateNodeProperty('age')).count).toBe(3);
    expect((await graph.aggregateEdgeProperty('weight')).sum).toBe(6);
    await graph.deleteIndex('idx_p_name');

    // GraphTraversal async paths (BFS, DFS, edgeTypes/nodeTypes, wildcard, maxResults, isDAG, topologicalSort)
    expect(await graph.traverse(a.id, c.id)).toEqual([[a.id, b.id, c.id]]);
    expect(await graph.traverse(a.id, c.id, { method: 'dfs', edgeTypes: ['KNOWS'], nodeTypes: ['Person'] })).toEqual([[a.id, b.id, c.id]]);
    expect(await graph.traverse(b.id, c.id)).toEqual([[b.id, c.id]]);
    expect(await graph.traverse('*', c.id, { maxResults: 5 })).toEqual(expect.arrayContaining([[a.id, b.id, c.id]]));
    expect(await graph.isDAG()).toBe(true);
    expect(await graph.topologicalSort()).toEqual([a.id, b.id, c.id]);

    // Cycle check for isDAG / topologicalSort
    const eCycle = await graph.addEdge(c.id, a.id, 'BACK');
    expect(await graph.isDAG()).toBe(false);
    expect(await graph.topologicalSort()).toBeNull();
    await graph.removeEdge(eCycle.id);

    // Non-cascade remove throws; cascade succeeds; remove eBatch edge
    await expect(graph.removeNode(b.id, false)).rejects.toThrow(NodeHasEdgesError);
    expect((await graph.removeNode(b.id, true)).cascadeDeletedEdgesCount).toBe(2);
    expect(await graph.removeEdge(eBatch[0].id)).toBe(false); // cascade already deleted it

    graph.compact();
    await graph.clear();
    expect(await graph.getNodeCount()).toBe(0);
  });

  it('executes full Cypher read/write/aggregate/subquery/union/index plans through async Executor', async () => {
    const engine = new CypherEngine(graph);

    // DDL via async Executor & async getQueryPlan
    const idxCreate = await engine.execute('CREATE INDEX idx_age FOR (n:Person) ON (n.age)');
    expect(idxCreate.summary.indexesCreated).toBe(1);
    expect(await engine.execute('SHOW INDEXES')).toMatchObject({
      rows: [{ name: 'idx_age', target: 'node', propertyKeys: ['age'] }],
    });

    const aVip = await graph.addNode(['Person', 'Vip'], { name: 'Alice', dept: 'Eng', age: 30 });
    const bbob = await graph.addNode('Person', { name: 'Bob', dept: 'Eng', age: 25 });
    const ccarol = await graph.addNode('Person', { name: 'Carol', dept: 'Sales', age: 35 });
    await graph.addEdge(aVip.id, bbob.id, 'KNOWS', { weight: 1 });
    await graph.addEdge(bbob.id, ccarol.id, 'KNOWS', { weight: 2 });

    const createRes = await graph.query(`
      CREATE (z:Temp { name: 'Zed' })-[r:TEMP_REL { k: 1 }]->(z2:Temp { name: 'Zed2' })
      RETURN z.name AS root
    `);
    expect(createRes.summary.nodesCreated).toBe(2);
    expect(createRes.summary.edgesCreated).toBe(1);
    expect(createRes.rows).toEqual([{ root: 'Zed' }]);
    await graph.query(`MATCH (z:Temp)-[r:TEMP_REL]->(z2:Temp) SET r.tag = 'e' REMOVE r.tag RETURN r`);
    await graph.query(`MATCH (z:Temp)-[r:TEMP_REL]->(z2:Temp) DELETE r`);
    await graph.query(`MATCH (z:Temp) DELETE z`);

    // Single-hop + Variable-length BFS & DFS + NodeSeek + VerifyNode + executionPlan
    const nodes = await graph.getNodes({ filter: { properties: [{ key: 'name', op: '=', value: 'Alice' }] } });
    const aliceId = nodes[0].id;

    const seekRes = await graph.query(
      `MATCH (a:Person) WHERE id(a) = $id
       MATCH (a)-[:KNOWS*1..2]->(b:Person)
       RETURN DISTINCT b.name AS friend ORDER BY friend ASC`,
      { id: aliceId },
      { executionPlan: { format: 'text' } },
    );
    expect(seekRes.rows).toEqual([{ friend: 'Bob' }, { friend: 'Carol' }]);
    expect(seekRes.executionPlan).toContain('NodeSeekStep');

    const dfsRes = await graph.query(`
      MATCH path = (a:Person { name: 'Alice' })-[:KNOWS*1..2]->(b:Person)
      RETURN nodes(path) AS ns
      LIMIT 1
    `);
    expect((dfsRes.rows[0].ns as unknown[]).length).toBeGreaterThanOrEqual(2);

    // Path A storage-level aggregates (node & edge) + Path B GROUP BY aggregate
    const nodeAgg = await graph.query(
      'MATCH (n:Person) RETURN count(n) AS cnt, sum(n.age) AS total, avg(n.age) AS avgAge, min(n.age) AS minAge, max(n.age) AS maxAge, collect(n.name) AS names',
    );
    expect(nodeAgg.rows[0].cnt).toBe(3);
    expect(nodeAgg.rows[0].total).toBe(90);

    const edgeAgg = await graph.query(
      'MATCH ()-[r:KNOWS]->() RETURN count(r) AS cnt, sum(r.weight) AS sumW',
    );
    expect(edgeAgg.rows[0]).toEqual({ cnt: 2, sumW: 3 });

    const groupAgg = await graph.query(`
      MATCH (n:Person)
      WHERE n.age >= 25
      RETURN n.dept AS dept, count(*) AS cnt
      ORDER BY dept ASC
    `);
    expect(groupAgg.rows).toEqual([
      { dept: 'Eng', cnt: 2 },
      { dept: 'Sales', cnt: 1 },
    ]);

    // WITH *, UNWIND, OPTIONAL MATCH, EXISTS, PatternComprehension, PatternExpr, MERGE, SET, REMOVE, DELETE, UNION
    const complexRes = await graph.query(`
      MATCH (a:Person { name: 'Alice' })
      WITH *, a.age AS aAge
      WHERE EXISTS { MATCH (a)-[:KNOWS]->(f) WHERE f.age < 30 }
        AND (a)-[:KNOWS]->(:Person)
      OPTIONAL MATCH (c:Person { name: 'Carol' })-[:KNOWS]->(noneNode:Person)
      RETURN a.name AS name,
             [(a)-[:KNOWS]->(b:Person) | b.name] AS friends,
             noneNode AS missing
    `);
    expect(complexRes.rows).toEqual([
      { name: 'Alice', friends: ['Bob'], missing: null },
    ]);

    const unwindRes = await graph.query('UNWIND [1, 2] AS x RETURN x ORDER BY x DESC SKIP 1 LIMIT 1');
    expect(unwindRes.rows).toEqual([{ x: 1 }]);

    await graph.query("MERGE (d:Person { name: 'Dave' }) ON CREATE SET d.age = 40 RETURN d.age AS age");
    await graph.query("MERGE (d:Person { name: 'Dave' }) ON MATCH SET d.age = 41 RETURN d.age AS age");
    await graph.query("MATCH (a:Person { name: 'Alice' }) SET a.tag = 'ok' REMOVE a:Vip, a.tag RETURN a.name AS n");

    const unionRes = await graph.query(`
      MATCH (p:Person { name: 'Alice' }) RETURN p.name AS name
      UNION
      MATCH (p:Person { name: 'Dave' }) RETURN p.name AS name
    `);
    expect(unionRes.rows.map((r) => r.name).sort()).toEqual(['Alice', 'Dave']);

    // Verify async getQueryPlan builds plan against async JoinReorderer
    const planText = await graph.getQueryPlan("MATCH (p:Person) WHERE p.age = 30 RETURN p.name AS name");
    expect(planText).toContain('NodeScanStep');

    // Verify implicit auto-transaction rollback on failing write in async Executor
    const countBefore = await graph.getNodeCount();
    await expect(
      graph.query(`
        CREATE (bad:Temp { x: 1 })
        WITH bad
        MATCH (p:Person { name: 'Alice' })
        SET p.age = p.age / 0
      `),
    ).rejects.toThrow(/Division by zero/);
    expect(await graph.getNodeCount()).toBe(countBefore);

    await graph.query('MATCH (d:Person { name: "Dave" }) DETACH DELETE d');
    await engine.execute('DROP INDEX idx_age');
    expect(await graph.hasIndex('node', ['age'], 'Person')).toBe(false);
  });

  it('executes WITH, UNWIND, MERGE, SET, VerifyNode, DISTINCT aggregates, and failed-transaction handling over async storage', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice', age: 30 });
    const bob = await graph.addNode('Person', { name: 'Bob', age: 25 });
    const carol = await graph.addNode('Person', { name: 'Carol', age: 30 });
    const relAB = await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 1 });
    await graph.addEdge(alice.id, carol.id, 'KNOWS', { weight: 3 });

    // Async VerifyNode with >=, AND, OR
    const verifyRes = await graph.query(`
      MATCH (a:Person { name: 'Alice' })-[:KNOWS]->(b:Person)
      WHERE b.age >= 25 AND (b.name = 'Bob' OR b.name = 'Carol')
      RETURN b.name AS name
      ORDER BY name ASC
    `);
    expect(verifyRes.rows).toEqual([{ name: 'Bob' }, { name: 'Carol' }]);

    // UNWIND + list comprehension + map literal
    const pipeRes = await graph.query(`
      UNWIND [x IN [1, 2, 3] WHERE x > 1 | x] AS v
      RETURN v, { k: 1, val: v } AS meta
      ORDER BY v ASC
    `);
    expect(pipeRes.rows).toEqual([
      { v: 2, meta: { k: 1, val: 2 } },
      { v: 3, meta: { k: 1, val: 3 } },
    ]);

    // Parameterized MERGE hitting ON CREATE + SET = and ON MATCH + SET +=
    const createMergeRes = await graph.query(
      `
        MERGE (t:Item { code: $code })
        ON CREATE SET t = { code: $code, origin: 'created' }
        ON MATCH SET t += { touched: true }
        RETURN t.code AS code, t.origin AS origin, t.touched AS touched
      `,
      { code: 2 },
    );
    expect(createMergeRes.rows).toEqual([{ code: 2, origin: 'created', touched: undefined }]);

    const matchMergeRes = await graph.query(
      `
        MERGE (t:Item { code: $code })
        ON CREATE SET t = { code: $code, origin: 'created' }
        ON MATCH SET t += { touched: true }
        RETURN t.code AS code, t.origin AS origin, t.touched AS touched
      `,
      { code: 2 },
    );
    expect(matchMergeRes.rows).toEqual([{ code: 2, origin: 'created', touched: true }]);

    // Async edge MERGE + edge SET = / += + REMOVE + DELETE (node & edge) + unscoped index DDL
    const edgeMergeRes = await graph.query(`
      MATCH (a:Person { name: 'Alice' }), (c:Person { name: 'Carol' })
      MERGE (a)-[r:MET]->(c)
      ON CREATE SET r.w = 7
      RETURN r.w AS w
    `);
    expect(edgeMergeRes.rows).toEqual([{ w: 7 }]);

    await graph.query(`
      MATCH (a:Person { name: 'Alice' })-[r:MET]->(c:Person { name: 'Carol' })
      SET r = { w: 8 }, r += { tmp: 'del' }
      REMOVE r.tmp
    `);
    await graph.query(`MATCH ()-[r:MET]->() DELETE r`);
    await graph.query(`CREATE (z:TmpIsolated { k: 1 })`);
    await graph.query(`MATCH (z:TmpIsolated) DELETE z`);

    await graph.query('CREATE INDEX idx_scoped FOR (n:Item) ON (n.code)');
    const showRes = await graph.query('SHOW INDEXES');
    expect(showRes.rows.length).toBeGreaterThanOrEqual(1);
    await graph.query('DROP INDEX idx_scoped');

    // Unfiltered NodeScan -> Aggregate with DISTINCT in async path
    const distinctAgg = await graph.query(`
      MATCH (p:Person)
      RETURN count(DISTINCT p.age) AS dc,
             sum(DISTINCT p.age) AS ds,
             avg(DISTINCT p.age) AS da,
             min(p.age) AS mn,
             max(p.age) AS mx,
             collect(DISTINCT p.age) AS ages
    `);
    expect(distinctAgg.rows[0].dc).toBe(2);
    expect(distinctAgg.rows[0].ds).toBe(55);
    expect(distinctAgg.rows[0].mn).toBe(25);
    expect(distinctAgg.rows[0].mx).toBe(30);

    const edgeCollectAgg = await graph.query(
      'MATCH ()-[r:KNOWS]->() RETURN collect(r.weight) AS ws, collect(DISTINCT r.weight) AS dws',
    );
    expect((edgeCollectAgg.rows[0].ws as number[]).length).toBe(2);
    expect((edgeCollectAgg.rows[0].dws as number[]).sort((a, b) => a - b)).toEqual([1, 3]);

    // Explicit GraphTransaction async Cypher execution
    const cypherTx = graph.createTransaction();
    await cypherTx.begin();
    await graph.query(
      `CREATE (n:Temp { name: 'T' }) SET n += { tag: 'x' } WITH n MATCH (x:Temp { name: 'T' }) DETACH DELETE x`,
      {},
      { transaction: cypherTx },
    );
    await cypherTx.commit();

    // Async transaction.markFailed() handling across mutating Graph APIs
    const expectFailedTx = async (
      op: (tx: ReturnType<Graph['createTransaction']>) => Promise<unknown>,
    ) => {
      const tx = graph.createTransaction();
      await tx.begin();
      await expect(op(tx)).rejects.toThrow();
      expect(tx.isFailed()).toBe(true);
      await tx.rollback();
    };

    await expectFailedTx((tx) => graph.addNode('Person', {}, tx, alice.id));
    await expectFailedTx((tx) => graph.addNodes([{ labels: 'Person', id: alice.id }], tx));
    await expectFailedTx((tx) => graph.removeNode(alice.id, false, tx));
    await expectFailedTx((tx) => graph.addEdge(alice.id, 'missing', 'KNOWS', {}, tx));
    await expectFailedTx((tx) =>
      graph.addEdges([{ sourceId: alice.id, targetId: bob.id, type: 'KNOWS', id: relAB.id }], tx),
    );
    await expectFailedTx((tx) => graph.setNodeProperties('missing', { a: 1 }, { transaction: tx }));
    await expectFailedTx((tx) => graph.unsetNodeProperties('missing', ['a'], tx));
    await expectFailedTx((tx) => graph.removeNodeLabels('missing', ['Person'], tx));
    await expectFailedTx((tx) => graph.setEdgeProperties('missing', { a: 1 }, { transaction: tx }));
    await expectFailedTx((tx) => graph.unsetEdgeProperties('missing', ['a'], tx));
  });
});
