import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { InMemoryStorageProvider } from '../../src/storage/InMemoryStorageProvider';
import { CachedStorageProvider } from '../../src/storage/CachedStorageProvider';
import { CacheManager } from '../../src/storage/cache/CacheManager';
import type { CacheConfig } from '../../src/storage/cache/CacheConfig';
import type {
  GroupedAggregateRequest,
  GroupedAggregateRow,
  IStorageProvider,
  StorageQueryOptions,
} from '../../src/storage/IStorageProvider';
import type { ReadonlyEdgeData } from '../../src/types';
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

  it('deduplicates self-loop edges on removeNode without cascade overcounting', async () => {
    const a = await graph.addNode('Person', { name: 'Self' });
    const b = await graph.addNode('Person', { name: 'Other' });
    await graph.addEdge(a.id, a.id, 'LOOP');

    await expect(graph.removeNode(a.id, false)).rejects.toMatchObject({
      name: 'NodeHasEdgesError',
      message: expect.stringContaining('1 incident edge(s)'),
    });
    const deletedOnlyLoop = await graph.removeNode(a.id, true);
    expect(deletedOnlyLoop).toEqual({ result: true, cascadeDeletedEdgesCount: 1 });

    const c = await graph.addNode('Person', { name: 'Mix' });
    await graph.addEdge(c.id, c.id, 'LOOP');
    await graph.addEdge(c.id, b.id, 'KNOWS');
    const deletedMix = await graph.removeNode(c.id, true);
    expect(deletedMix).toEqual({ result: true, cascadeDeletedEdgesCount: 2 });
  });

  it('batches async EdgeExpandStep single-hop & multi-hop traversals while preserving trail semantics', async () => {
    const nA = await graph.addNode(['City', 'Hub'], { name: 'A' });
    const nB = await graph.addNode(['City', 'Hub'], { name: 'B' });
    const nC = await graph.addNode(['City', 'Hub'], { name: 'C' });
    const nD = await graph.addNode(['City', 'Dest'], { name: 'D' });
    const nE = await graph.addNode(['City', 'Dest'], { name: 'E' });
    // Two routes A->B->D and A->C->D, plus parallel B->D edge -> 3 trails total to D; plus B->E for disjoint targets
    await graph.addEdge(nA.id, nB.id, 'ROAD');
    await graph.addEdge(nA.id, nC.id, 'ROAD');
    await graph.addEdge(nB.id, nD.id, 'ROAD');
    await graph.addEdge(nB.id, nD.id, 'ROAD');
    await graph.addEdge(nC.id, nD.id, 'ROAD');
    await graph.addEdge(nB.id, nE.id, 'ROAD');

    const bySourcesSpy = jest.spyOn(cached, 'getEdgesBySources');
    const nodesByIdsSpy = jest.spyOn(cached, 'getNodesByIds');

    // Disjoint-target single-hop expansion batches edges AND missing target nodes in 1 call each
    const disjointHop = await graph.query(`
      MATCH (s:Hub)-[:ROAD]->(t:Dest)
      RETURN s.name AS s, t.name AS t
      ORDER BY s ASC, t ASC
    `);
    expect(disjointHop.rows).toHaveLength(4);
    expect(bySourcesSpy).toHaveBeenCalledTimes(1);
    expect(nodesByIdsSpy).toHaveBeenCalledTimes(1);

    bySourcesSpy.mockClear();
    nodesByIdsSpy.mockClear();

    // Multi-hop *1..3 must preserve all distinct edge trails to D (both with and without path variable)
    const multiHopWithPath = await graph.query(`
      MATCH p = (a:City { name: 'A' })-[:ROAD*1..3]->(d:City { name: 'D' })
      RETURN p, d.name AS name
    `);
    expect(multiHopWithPath.rows).toHaveLength(3);
    // 2 hops => [Node, Edge, Node, Edge, Node] (length 5)
    expect(multiHopWithPath.rows.every((r) => Array.isArray(r.p) && r.p.length === 5 && r.name === 'D')).toBe(true);
    // Hop 0 fetches [A] via getEdgesBySource; hop 1 batches [B, C] via getEdgesBySources (<= 1 batch call)
    expect(bySourcesSpy.mock.calls.length).toBeLessThanOrEqual(2);

    const multiHopNoPath = await graph.query(`
      MATCH (a:City { name: 'A' })-[:ROAD*1..3]->(d:City { name: 'D' })
      RETURN d.name AS name
    `);
    expect(multiHopNoPath.rows).toEqual([{ name: 'D' }, { name: 'D' }, { name: 'D' }]);
  });

  it('fuses async NodeScanStep -> AggregateStep for filtered COUNT, grouped pushdown, and shortest path delegation', async () => {
    await graph.addNode('Person', { name: 'Alice', city: 'NYC', age: 30, score: 10 });
    await graph.addNode('Person', { name: 'Bob', city: 'NYC', age: 20, score: 20 });
    await graph.addNode('Person', { name: 'Carol', city: 'SF', age: 40 }); // score undefined

    const countSpy = jest.spyOn(cached, 'getNodeCount');
    const getNodesSpy = jest.spyOn(cached, 'getNodes');

    const filteredCount = await graph.query(
      'MATCH (p:Person) WHERE p.age >= $minAge RETURN count(p) AS cnt',
      { minAge: 25 },
    );
    expect(filteredCount.rows).toEqual([{ cnt: 2 }]);
    expect(countSpy).toHaveBeenCalledTimes(1);
    expect(getNodesSpy).not.toHaveBeenCalled();

    // Build custom async provider supporting aggregateGrouped and traverseShortestPath
    const base = new InMemoryStorageProvider();
    const gA = await base.insertNode({ id: 'nA', labels: ['Person'], properties: { city: 'NYC', age: 30, score: 10 } });
    void gA;
    await base.insertNode({ id: 'nB', labels: ['Person', 'Vip'], properties: { city: 'NYC', age: 25, score: 30 } });
    await base.insertNode({ id: 'nC', labels: ['Person'], properties: { city: 'SF', age: 40 } });
    await base.insertEdge({ id: 'eAB', sourceId: 'nA', targetId: 'nB', type: 'KNOWS', properties: {} });
    await base.insertEdge({ id: 'eBC', sourceId: 'nB', targetId: 'nC', type: 'KNOWS', properties: {} });

    const aggregateGroupedSpy = jest.fn(
      async (req: GroupedAggregateRequest): Promise<GroupedAggregateRow[] | null> => {
        if (req.options?.filter?.properties?.[0]?.value === 'FORCE_FALLBACK') {
          return null;
        }
        const nodes = await base.getNodes(req.options);
        const groups = new Map<string, { groupValues: unknown[]; items: typeof nodes }>();
        for (const n of nodes) {
          const vals = req.groupByKeys.map((k) => n.properties[k]);
          const key = JSON.stringify(vals.map((v) => (v === undefined ? '__UNDEF__' : v)));
          let entry = groups.get(key);
          if (!entry) {
            entry = { groupValues: vals, items: [] };
            groups.set(key, entry);
          }
          entry.items.push(n);
        }
        const out: GroupedAggregateRow[] = [];
        for (const entry of groups.values()) {
          const aggValues: Record<string, unknown> = {};
          for (const spec of req.aggregates) {
            const nums = spec.propertyKey
              ? entry.items
                  .map((it) => it.properties[spec.propertyKey!])
                  .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))
              : [];
            if (spec.fn === 'COUNT') {
              aggValues[spec.alias] = spec.propertyKey
                ? entry.items.filter((it) => it.properties[spec.propertyKey!] != null).length
                : entry.items.length;
            } else if (spec.fn === 'SUM') {
              aggValues[spec.alias] = nums.reduce((a, b) => a + b, 0);
            } else if (spec.fn === 'AVG') {
              aggValues[spec.alias] = nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
            } else if (spec.fn === 'MIN') {
              aggValues[spec.alias] = nums.length === 0 ? null : Math.min(...nums);
            } else if (spec.fn === 'MAX') {
              aggValues[spec.alias] = nums.length === 0 ? null : Math.max(...nums);
            }
          }
          out.push({ groupValues: entry.groupValues, aggValues });
        }
        return out;
      },
    );

    const traverseShortestPathSpy = jest.fn(
      async (sourceId: string, targetId: string, _edgeTypes?: readonly string[]) => {
        if (sourceId === 'nB' && targetId === 'nC') return undefined; // Exercise fallback
        if (sourceId === 'nA' && targetId === 'nC') return ['nA', 'nB', 'nC'];
        return null;
      },
    );

    const customStore: IStorageProvider = {
      get indexEpoch() { return base.indexEpoch; },
      clear: () => base.clear(),
      insertNode: (n, tx) => base.insertNode(n, tx),
      insertNodes: (n, tx) => base.insertNodes(n, tx),
      deleteNode: (id, tx) => base.deleteNode(id, tx),
      hasNode: (id, tx) => base.hasNode(id, tx),
      getNode: (id, tx) => base.getNode(id, tx),
      getNodesByIds: (ids, tx) => base.getNodesByIds(ids, tx),
      getNodeCount: (opts) => base.getNodeCount(opts),
      aggregateNodeProperty: (k, opts) => base.aggregateNodeProperty(k, opts),
      getNodes: (opts) => base.getNodes(opts),
      insertEdge: (e, tx) => base.insertEdge(e, tx),
      insertEdges: (e, tx) => base.insertEdges(e, tx),
      deleteEdge: (id, tx) => base.deleteEdge(id, tx),
      hasEdge: (id, tx) => base.hasEdge(id, tx),
      getEdge: (id, tx) => base.getEdge(id, tx),
      getEdgeCount: (opts) => base.getEdgeCount(opts),
      aggregateEdgeProperty: (k, opts) => base.aggregateEdgeProperty(k, opts),
      getEdges: (opts) => base.getEdges(opts),
      getEdgesBySource: (id, opts) => base.getEdgesBySource(id, opts),
      getEdgesByTarget: (id, opts) => base.getEdgesByTarget(id, opts),
      getEdgesBySources: async (ids: readonly string[], opts?: StorageQueryOptions) => {
        const m = new Map<string, ReadonlyEdgeData[]>();
        for (const id of ids) m.set(id, await base.getEdgesBySource(id, opts));
        return m;
      },
      removeNodeLabels: (id, labels, tx) => base.removeNodeLabels(id, labels, tx),
      patchProperties: (t, id, p, tx) => base.patchProperties(t, id, p, tx),
      createIndex: (n, t, k, o) => base.createIndex(n, t, k, o),
      hasIndex: (t, k, l) => base.hasIndex(t, k, l),
      getIndex: (n) => base.getIndex(n),
      deleteIndex: (n) => base.deleteIndex(n),
      getIndexes: () => base.getIndexes(),
      exportJSON: () => base.exportJSON(),
      importJSON: (d) => base.importJSON(d),
      supportsTransactions: () => base.supportsTransactions(),
      beginTransaction: () => base.beginTransaction(),
      commitTransaction: (h) => base.commitTransaction(h),
      rollbackTransaction: (h) => base.rollbackTransaction(h),
      aggregateGrouped: aggregateGroupedSpy,
      traverseShortestPath: traverseShortestPathSpy,
    };

    const customGraph = new Graph(customStore);
    const baseGetNodesSpy = jest.spyOn(base, 'getNodes');

    const grouped = await customGraph.query(`
      MATCH (p:Person)
      RETURN p.city AS city, count(p) AS cnt, count(p.score) AS scoreCnt,
             sum(p.score) AS total, avg(p.score) AS mean, min(p.score) AS mn, max(p.score) AS mx
      ORDER BY city ASC
    `);
    expect(grouped.rows).toEqual([
      { city: 'NYC', cnt: 2, scoreCnt: 2, total: 40, mean: 20, mn: 10, mx: 30 },
      { city: 'SF', cnt: 1, scoreCnt: 0, total: 0, mean: 0, mn: null, mx: null },
    ]);
    expect(aggregateGroupedSpy).toHaveBeenCalledTimes(1);

    // Filtered empty ungrouped aggregate returns 1 openCypher default row
    const emptyUngrouped = await customGraph.query(`
      MATCH (p:Person)
      WHERE p.age > 999
      RETURN sum(p.score) AS s, avg(p.score) AS a, min(p.score) AS mn, max(p.score) AS mx
    `);
    expect(emptyUngrouped.rows).toEqual([{ s: 0, a: 0, mn: null, mx: null }]);

    // Filtered empty grouped aggregate returns 0 rows
    const emptyGrouped = await customGraph.query(`
      MATCH (p:Person)
      WHERE p.age > 999
      RETURN p.city AS city, count(p) AS c
    `);
    expect(emptyGrouped.rows).toEqual([]);

    // Returns null -> gracefully falls back to base.getNodes
    baseGetNodesSpy.mockClear();
    const fallbackRes = await customGraph.query(`
      MATCH (p:Person)
      WHERE p.city = 'FORCE_FALLBACK'
      RETURN p.city AS city, sum(p.score) AS s
    `);
    expect(fallbackRes.rows).toEqual([]);
    expect(baseGetNodesSpy).toHaveBeenCalled();

    // Shortest path pushdown + undefined fallback + nodeTypes label filtering
    expect(await customGraph.traverse('nA', 'nC', { method: 'bfs' })).toEqual([['nA', 'nB', 'nC']]);
    expect(traverseShortestPathSpy).toHaveBeenCalledTimes(1);

    expect(await customGraph.traverse('nB', 'nC', { method: 'bfs' })).toEqual([['nB', 'nC']]);
    expect(traverseShortestPathSpy).toHaveBeenCalledTimes(2);

    // nodeTypes restricts labels -> bypasses wildcard traverseShortestPath
    expect(await customGraph.traverse('nA', 'nC', { method: 'bfs', nodeTypes: ['Vip'] })).toBeNull();
    expect(traverseShortestPathSpy).toHaveBeenCalledTimes(2);
  });

  it('executes postfix node label and edge type predicates over async storage', async () => {
    await graph.addNode(['Preference'], { name: 'prefA' });
    await graph.addNode(['Invariant'], { name: 'invA' });
    const arch = await graph.addNode(['Preference', 'Archived'], { name: 'archA' });
    const tgt = await graph.addNode(['Target'], { name: 'tgtA' });
    await graph.addEdge(arch.id, tgt.id, 'REL_A', { w: 1 });

    const nodeRes = await graph.query(`
      MATCH (n)
      WHERE (n:Preference OR n:Invariant) AND NOT n:Archived
      RETURN n.name AS name
      ORDER BY name ASC
    `);
    expect(nodeRes.rows).toEqual([{ name: 'invA' }, { name: 'prefA' }]);

    const edgeRes = await graph.query(`
      MATCH (a)-[r]->(b)
      WHERE r:REL_A|REL_B AND NOT b:Archived
      RETURN a.name AS src, type(r) AS relType, b.name AS dst
    `);
    expect(edgeRes.rows).toEqual([{ src: 'archA', relType: 'REL_A', dst: 'tgtA' }]);
  });
});
