/**
 * Smoke test for the @grafio/browser bundle.
 * Runs in Node.js to verify the ESM bundle works correctly.
 * 
 * Usage: node browser/test/smoke-test.mjs
 */

import { Graph, CypherEngine, GraphToMermaid, GraphTransaction } from '../dist/grafio.browser.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

console.log('\n🧪 Grafio Browser Bundle — Smoke Test\n');

// ── Module exports ────────────────────────────────────────────
await test('Module exports exist', async () => {
  assert(typeof Graph === 'function', 'Graph not found');
  assert(typeof CypherEngine === 'function', 'CypherEngine not found');
  assert(typeof GraphToMermaid === 'function', 'GraphToMermaid not found');
});

// ── Basic graph operations ────────────────────────────────────
await test('Graph creation and node/edge operations', async () => {
  const graph = new Graph();
  const alice = await graph.addNode('Person', { name: 'Alice', age: 30 });
  const bob = await graph.addNode('Person', { name: 'Bob', age: 25 });
  assert(alice.id, 'Alice should have an id');
  assertEqual(alice.labels[0], 'Person');
  assertEqual(alice.properties.name, 'Alice');
  assertEqual(alice.properties.age, 30);

  const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });
  assert(edge.id, 'Edge should have an id');
  assertEqual(edge.type, 'KNOWS');
  assertEqual(edge.sourceId, alice.id);
  assertEqual(edge.targetId, bob.id);
  assertEqual(edge.properties.since, 2020);
});

// ── Cypher READ query ─────────────────────────────────────────
await test('Cypher MATCH query', async () => {
  const graph = new Graph();
  await graph.addNode('Person', { name: 'Alice' });
  await graph.addNode('Person', { name: 'Bob' });
  await graph.addNode('City', { name: 'London' });

  const engine = new CypherEngine(graph);
  const result = await engine.execute('MATCH (p:Person) RETURN p');

  assertEqual(result.columns.length, 1);
  assertEqual(result.rows.length, 2);
  assert(result.summary.queryTimeMs >= 0, 'Should have query time');
});

// ── Cypher parameterized query ────────────────────────────────
await test('Cypher parameterized query', async () => {
  const graph = new Graph();
  await graph.addNode('Person', { name: 'Alice' });
  await graph.addNode('Person', { name: 'Bob' });

  const engine = new CypherEngine(graph);
  const result = await engine.execute(
    'MATCH (p:Person) WHERE p.name = $name RETURN p',
    { name: 'Alice' }
  );

  assertEqual(result.rows.length, 1);
  assertEqual(result.rows[0].p.properties.name, 'Alice');
});

// ── Execution plan ────────────────────────────────────────────
await test('Query plan generation', async () => {
  const graph = new Graph();
  await graph.addNode('Person', { name: 'Alice' });

  const engine = new CypherEngine(graph);
  const plan = await engine.getQueryPlan('MATCH (p:Person) RETURN p', {}, 'text');

  assert(typeof plan === 'string', 'Plan should be a string');
  assert(plan.length > 0, 'Plan should not be empty');
});

// ── Cypher CREATE query (write) ───────────────────────────────
await test('Cypher CREATE query modifies graph', async () => {
  const graph = new Graph();
  const engine = new CypherEngine(graph);

  const result = await engine.execute('CREATE (n:City {name: "London", population: 9000000}) RETURN n');
  assertEqual(result.summary.nodesCreated, 1);

  const nodes = await graph.getNodes({ filter: { types: ['City'] } });
  assertEqual(nodes.length, 1);
  assertEqual(nodes[0].properties.name, 'London');
});

// ── Write query + JSON export sync ────────────────────────────
await test('Write query updates graph, exportJSON reflects changes', async () => {
  const graph = new Graph();
  await graph.addNode('Person', { name: 'Alice' });

  const json1 = await graph.exportJSON();
  assertEqual(json1.nodes.length, 1);

  const engine = new CypherEngine(graph);
  await engine.execute('CREATE (n:Person {name: "Bob"})');

  const json2 = await graph.exportJSON();
  assertEqual(json2.nodes.length, 2);

  const names = json2.nodes.map(n => n.properties.name).sort();
  assertEqual(names[0], 'Alice');
  assertEqual(names[1], 'Bob');
});

// ── Graph JSON round-trip ─────────────────────────────────────
await test('Graph JSON import/export round-trip', async () => {
  const graph1 = new Graph();
  await graph1.addNode('Person', { name: 'Alice' });
  await graph1.addNode('Person', { name: 'Bob' });
  const nodes = await graph1.getNodes();
  await graph1.addEdge(nodes[0].id, nodes[1].id, 'KNOWS');

  const json = await graph1.exportJSON();
  assertEqual(json.nodes.length, 2);
  assertEqual(json.edges.length, 1);

  const graph2 = await Graph.importJSON(json);
  const json2 = await graph2.exportJSON();
  assertEqual(json2.nodes.length, 2);
  assertEqual(json2.edges.length, 1);
});

// ── Error classes ─────────────────────────────────────────────
await test('Error classes work correctly', async () => {
  const graph = new Graph();
  const engine = new CypherEngine(graph);
  try {
    await engine.execute('INVALID SYNTAX ???');
    assert(false, 'Should have thrown');
  } catch (e) {
    // Use .name property (set in constructor) rather than constructor.name
    // which may be mangled by the bundler (e.g. _CypherSyntaxError).
    assert(e.name === 'CypherSyntaxError', `Expected CypherSyntaxError, got ${e.name}`);
    assert(typeof e.line === 'number', 'CypherSyntaxError should have line property');
    assert(typeof e.col === 'number', 'CypherSyntaxError should have col property');
  }
});

// ── GraphToMermaid ────────────────────────────────────────────
await test('GraphToMermaid conversion', async () => {
  const graph = new Graph();
  await graph.addNode('Person', { name: 'Alice' });
  await graph.addNode('Person', { name: 'Bob' });
  const nodes = await graph.getNodes();
  await graph.addEdge(nodes[0].id, nodes[1].id, 'KNOWS');

  const converter = await GraphToMermaid.fromGraph(graph);
  const mermaid = converter.toString();

  assert(typeof mermaid === 'string', 'Mermaid should be a string');
  assert(mermaid.includes('graph') || mermaid.includes('flowchart'), `Should contain graph/flowchart directive`);
});

// ── Summary ───────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`🎉 All ${passed} tests passed! Browser bundle works correctly.\n`);
} else {
  console.log(`⚠️  ${passed} passed, ${failed} failed out of ${passed + failed} tests.\n`);
  process.exit(1);
}
