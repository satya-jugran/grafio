import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { Planner } from '../../src/cypher/Planner';
import { FilterStep } from '../../src/cypher/plan/QueryPlan';
import { IsNullExpr } from '../../src/cypher/ast/AstNode';

/** Helper: lex + parse + semantic + plan. */
async function plan(query: string) {
  const tokens = new Lexer(query).tokenise();
  const ast = new Parser(tokens).parse();
  new Semantic().analyseStatement(ast);
  return new Planner().plan(ast);
}

describe('Planner', () => {
  // ── Node scan ──────────────────────────────────────────────────
  describe('NodeScanStep', () => {
    it('produces NodeScanStep for typed node', async () => {
      const p = await plan('MATCH (n:Person) RETURN n');
      expect(p.steps).toHaveLength(2); // scan + project
      expect(p.steps[0].kind).toBe('NodeScanStep');
      expect((p.steps[0] as any).label).toBe('Person');
      expect((p.steps[0] as any).variable).toBe('n');
    });

    it('produces NodeScanStep with empty label for untyped node', async () => {
      const p = await plan('MATCH (n) RETURN n');
      expect(p.steps[0].kind).toBe('NodeScanStep');
      expect((p.steps[0] as any).label).toBe('');
    });
  });

  // ── Edge expansion ─────────────────────────────────────────────
  describe('EdgeExpandStep', () => {
    it('produces EdgeExpandStep for single-hop edge', async () => {
      const p = await plan('MATCH (a)-[:KNOWS]->(b) RETURN b');
      expect(p.steps[0].kind).toBe('NodeScanStep');
      expect(p.steps[1].kind).toBe('EdgeExpandStep');

      const expand = p.steps[1] as any;
      expect(expand.types).toEqual(['KNOWS']);
      expect(expand.direction).toBe('out');
      expect(expand.strategy).toBe('single-hop');
    });

    it('produces multi-hop-bfs for variable-length edge without LIMIT', async () => {
      const p = await plan('MATCH (a)-[*1..3]->(b) RETURN b');
      const expand = p.steps[1] as any;
      expect(expand.strategy).toBe('multi-hop-bfs');
    });

    it('produces multi-hop-dfs when LIMIT is present', async () => {
      const p = await plan('MATCH (a)-[*1..3]->(b) RETURN b LIMIT 5');
      const expand = p.steps[1] as any;
      expect(expand.strategy).toBe('multi-hop-dfs');
      expect(expand.minHops).toBe(1);
      expect(expand.maxHops).toBe(3);
    });
  });

  // ── Filter ─────────────────────────────────────────────────────
  it('pushes single-variable WHERE predicates into NodeScanStep propertyFilters', async () => {
    const p = await plan("MATCH (p:Person) WHERE p.name = 'Alice' RETURN p");
    // Phase 2: single-variable WHERE predicate is pushed into
    // NodeScanStep.propertyFilters — no separate FilterStep.
    const scan = p.steps.find((s) => s.kind === 'NodeScanStep') as any;
    expect(scan).toBeDefined();
    expect(scan.propertyFilters).toBeDefined();
    expect(scan.propertyFilters).toHaveLength(1);
    expect(scan.propertyFilters[0].key).toBe('name');
    expect(scan.propertyFilters[0].value).toBe('Alice');
    expect(scan.propertyFilters[0].op).toBe('=');
    // No FilterStep remains
    const filters = p.steps.filter((s) => s.kind === 'FilterStep');
    expect(filters.length).toBe(0);
  });

  it('keeps cross-variable WHERE predicates as FilterStep', async () => {
    const p = await plan("MATCH (a:Person), (b:Person) WHERE a.city = b.city RETURN a, b");
    // Cross-variable comparison cannot be pushed → remains as FilterStep.
    const filters = p.steps.filter((s) => s.kind === 'FilterStep');
    expect(filters.length).toBe(1);
    const filter = filters[0] as any;
    expect(filter.predicate.kind).toBe('Binary');
    expect(filter.predicate.op).toBe('=');
  });

  it('pushes node inline properties into NodeScanStep propertyFilters', async () => {
    const p = await plan('MATCH (s:Student {year: 2024}) RETURN s');
    // Phase 1: inline properties are pushed into NodeScanStep.propertyFilters,
    // not emitted as separate FilterSteps.
    const scan = p.steps.find((s) => s.kind === 'NodeScanStep') as any;
    expect(scan).toBeDefined();
    expect(scan.propertyFilters).toBeDefined();
    expect(scan.propertyFilters).toHaveLength(1);
    expect(scan.propertyFilters[0].key).toBe('year');
    expect(scan.propertyFilters[0].value).toBe(2024);
    expect(scan.propertyFilters[0].op).toBe('=');
    // types should be set from node labels
    expect(scan.types).toEqual(['Student']);
    // No separate FilterStep for inline properties
    const filters = p.steps.filter((s) => s.kind === 'FilterStep');
    expect(filters.length).toBe(0);
  });

  it('generates FilterStep from edge inline properties', async () => {
    const p = await plan('MATCH (a:Person)-[:KNOWS {since: 2020}]->(b:Person) RETURN b');
    const filters = p.steps.filter((s) => s.kind === 'FilterStep');
    // At least one filter for the edge property
    expect(filters.length).toBeGreaterThanOrEqual(1);
  });

  it('generates FilterStep from target node inline properties', async () => {
    const p = await plan('MATCH (a:Person)-[:KNOWS]->(b:Person {active: true}) RETURN b');
    const filters = p.steps.filter((s) => s.kind === 'FilterStep');
    expect(filters.length).toBeGreaterThanOrEqual(1);
  });
});

it('retains id() FilterStep for deep node in multi-hop path', async () => {
  // For MATCH (a)-[]->(b)-[]->(c) WHERE id(c) = 5, 'c' is at
  // segments[4] — beyond the first-edge-target (segments[2]).
  // planPath cannot consume this id-lookup as NodeSeekStep
  // (only root and first-edge-target are consumable), so the
  // predicate MUST remain in crossVar as a FilterStep.
  const p = await plan('MATCH (a)-[:KNOWS]->(b)-[:KNOWS]->(c) WHERE id(c) = 5 RETURN a, b, c');

  // No NodeSeekStep for c
  const seeks = p.steps.filter((s) => s.kind === 'NodeSeekStep');
  expect(seeks.length).toBe(0);

  // A FilterStep must exist for id(c) = 5
  const filters = p.steps.filter((s) => s.kind === 'FilterStep');
  expect(filters.length).toBeGreaterThanOrEqual(1);

  // Verify the filter predicate looks like id(c) = 5
  const idFilter = filters.find((s) => {
    const pred = (s as any).predicate;
    return pred?.kind === 'Binary' && pred?.op === '=';
  });
  expect(idFilter).toBeDefined();
});

it('emits NodeSeekStep for root id-lookup and does NOT leave stray FilterStep', async () => {
  // id(a) consumed → NodeSeekStep, removed from crossVar.
  const p = await plan('MATCH (a:Person)-[:KNOWS]->(b:Person) WHERE id(a) = 42 RETURN a, b');

  const seeks = p.steps.filter((s) => s.kind === 'NodeSeekStep') as any[];
  expect(seeks.length).toBe(1);
  expect(seeks[0].index).toBe('id');
  expect(seeks[0].value).toBe(42);

  // No FilterStep for id(a) = 42 — it was consumed and removed.
  const filters = p.steps.filter((s) => s.kind === 'FilterStep');
  // May have edge/target inline-property filters, but NOT an id() filter.
  const idFilters = filters.filter((s) => {
    const pred = (s as any).predicate;
    return pred?.kind === 'FunctionCall' ||
      (pred?.kind === 'Binary' && pred?.left?.kind === 'FunctionCall');
  });
  expect(idFilters.length).toBe(0);
});

it('emits FilterStep for root perVar predicates in reversal branch', async () => {
  // id(b) triggers reversal (seek b, expand backwards to a).
  // a.name = 'Alice' is in perVar['a'] and must be emitted as
  // FilterStep after the reversed expand.
  // NOTE: Uses two different variables (a and b) so that
  // _classify splits the AND correctly into multi-var path.
  const p = await plan(
    "MATCH (a:Person)-[:KNOWS]->(b:Person) WHERE id(b) = 42 AND a.name = 'Alice' RETURN a, b",
  );

  const seeks = p.steps.filter((s) => s.kind === 'NodeSeekStep') as any[];
  expect(seeks.length).toBe(1);
  expect(seeks[0].index).toBe('id');
  expect(seeks[0].value).toBe(42);

  // Must have a FilterStep for a.name = 'Alice' from perVar
  const filters = p.steps.filter((s) => s.kind === 'FilterStep') as any[];
  const nameFilter = filters.find(
    (s) =>
      s.predicate?.kind === 'Binary' &&
      s.predicate?.left?.kind === 'PropertyAccess' &&
      s.predicate?.left?.property === 'name',
  );
  expect(nameFilter).toBeDefined();
});

it('correctly splits id(a)=42 AND a.name=Alice on the same variable', async () => {
  // Before the _classify AND-split fix, _classify would pass the
  // entire AND to _toPropertyFilter, which dropped the id() side.
  // Now id(a)=42 → crossVar → idLookups → consumed as
  // NodeSeekStep, and a.name='Alice' → perVar['a'] → FilterStep.
  const p = await plan(
    "MATCH (a:Person)-[:KNOWS]->(b:Person) WHERE id(a) = 42 AND a.name = 'Alice' RETURN a, b",
  );

  // NodeSeekStep for id(a) = 42
  const seeks = p.steps.filter((s) => s.kind === 'NodeSeekStep') as any[];
  expect(seeks.length).toBe(1);
  expect(seeks[0].index).toBe('id');
  expect(seeks[0].value).toBe(42);

  // FilterStep for a.name = 'Alice' from perVar
  const filters = p.steps.filter((s) => s.kind === 'FilterStep') as any[];
  const nameFilter = filters.find(
    (s) =>
      s.predicate?.kind === 'Binary' &&
      s.predicate?.left?.kind === 'PropertyAccess' &&
      s.predicate?.left?.property === 'name',
  );
  expect(nameFilter).toBeDefined();
});

it('emits FilterStep for root perVar predicates alongside NodeSeekStep', async () => {
  // Root id(a)=42 consumed as NodeSeekStep.
  // a.name='Alice' decomposed to perVar['a'] → emitted as
  // FilterStep after _planTrailingSegments (no NodeScanStep for root).
  const p = await plan(
    "MATCH (a:Person)-[:KNOWS]->(b:Person) WHERE id(a) = 42 AND a.name = 'Alice' RETURN a, b",
  );

  const seeks = p.steps.filter((s) => s.kind === 'NodeSeekStep') as any[];
  expect(seeks.length).toBe(1);
  expect(seeks[0].index).toBe('id');
  expect(seeks[0].value).toBe(42);

  // Must have a FilterStep for a.name = 'Alice' from perVar
  const filters = p.steps.filter((s) => s.kind === 'FilterStep') as any[];
  const nameFilter = filters.find(
    (s) =>
      s.predicate?.kind === 'Binary' &&
      s.predicate?.left?.kind === 'PropertyAccess' &&
      s.predicate?.left?.property === 'name',
  );
  expect(nameFilter).toBeDefined();
});

it('converts nested AND/OR PropertyFilters to Expression AST via id-lookup path', async () => {
  const p = await plan(
    "MATCH (p:Person) WHERE id(p) = 'some-id' AND " +
    "((p.name = 'Alice' AND p.age = 30) OR (p.name = 'Bob' AND p.age = 25)) " +
    "RETURN p"
  );
  // The NodeSeekStep path means per-var filters go through _propertyFilterToExpr
  const filters = p.steps.filter(s => s.kind === 'FilterStep');
  expect(filters.length).toBeGreaterThanOrEqual(1);
  // Verify the predicate is an OR Binary with nested AND children
  const pred = (filters[0] as FilterStep).predicate;
  expect(pred.kind).toBe('Binary');
  expect((pred as any).op).toBe('OR');
  expect(((pred as any).left as any).op).toBe('AND');
  expect(((pred as any).right as any).op).toBe('AND');
});

it('converts STARTS WITH and ENDS WITH to Expression AST via id-lookup path', async () => {
  const p = await plan(
    "MATCH (p:Person) WHERE id(p) = 'some-id' AND p.name STARTS WITH 'A' AND p.lastName ENDS WITH 'Z' RETURN p"
  );
  const filters = p.steps.filter(s => s.kind === 'FilterStep');
  expect(filters.length).toBe(2);
  
  const pred1 = (filters[0] as FilterStep).predicate;
  expect(pred1.kind).toBe('Binary');
  expect((pred1 as any).op).toBe('STARTS WITH');

  const pred2 = (filters[1] as FilterStep).predicate;
  expect(pred2.kind).toBe('Binary');
  expect((pred2 as any).op).toBe('ENDS WITH');
});

it('converts IS NULL to IS NULL expression via id-lookup path', async () => {
  const p = await plan(
    "MATCH (p:Person) WHERE id(p) = 'some-id' AND p.name IS NULL RETURN p"
  );
  const filters = p.steps.filter(s => s.kind === 'FilterStep');
  expect(filters.length).toBeGreaterThanOrEqual(1);
  const pred = (filters[0] as FilterStep).predicate;
  expect(pred.kind).toBe('IsNull');
});

it('converts IS NOT NULL to IS NOT NULL expression via id-lookup path', async () => {
  const p = await plan(
    "MATCH (p:Person) WHERE id(p) = 'some-id' AND p.name IS NOT NULL RETURN p"
  );
  const filters = p.steps.filter(s => s.kind === 'FilterStep');
  expect(filters.length).toBeGreaterThanOrEqual(1);
  const pred = (filters[0] as FilterStep).predicate as IsNullExpr;
  expect(pred.kind).toBe('IsNull');
  expect(pred.not).toBe(true);
});

// ── Projection ─────────────────────────────────────────────────
describe('ProjectStep', () => {
  it('produces ProjectStep with columns', async () => {
    const p = await plan('MATCH (n) RETURN n.name AS name');
    const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
    expect(proj.columns).toHaveLength(1);
    expect(proj.columns[0].alias).toBe('name');
  });

  it('derives alias from PropertyAccess (no AS)', async () => {
    const p = await plan('MATCH (n) RETURN n.name');
    const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
    expect(proj.columns[0].alias).toBe('n_name');
  });

  it('derives alias from Literal (no AS)', async () => {
    const p = await plan('MATCH (n) RETURN 42');
    const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
    expect(proj.columns[0].alias).toBe('42');
  });

  it('derives alias from Parameter (no AS)', async () => {
    const p = await plan('MATCH (n) RETURN $name');
    const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
    expect(proj.columns[0].alias).toBe('name');
  });

});

// ── Sort ───────────────────────────────────────────────────────
describe('SortStep', () => {
  it('produces SortStep for ORDER BY', async () => {
    const p = await plan('MATCH (n) RETURN n ORDER BY n.name ASC');
    expect(p.steps.some((s) => s.kind === 'SortStep')).toBe(true);
  });
});

// ── Limit ──────────────────────────────────────────────────────
describe('LimitStep', () => {
  it('produces LimitStep for SKIP and LIMIT', async () => {
    const p = await plan('MATCH (n) RETURN n SKIP 5 LIMIT 10');
    expect(p.steps.some((s) => s.kind === 'LimitStep')).toBe(true);
  });
});

// ── Aggregate Planning ──────────────────────────────────────────
describe('Aggregate Planning', () => {
  // -- Simple plan shapes (storage-level aggregation) --

  it('produces AggregateStep + ProjectStep for COUNT(p)', async () => {
    const p = await plan('MATCH (p:Person) RETURN COUNT(p)');
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0].kind).toBe('AggregateStep');
    expect(p.steps[1].kind).toBe('ProjectStep');

    const agg = p.steps[0] as any;
    expect(agg.aggregates).toHaveLength(1);
    expect(agg.aggregates[0].function).toBe('COUNT');
    expect(agg.aggregates[0].expression.kind).toBe('Identifier');
    expect(agg.aggregates[0].expression.name).toBe('p');
    expect(agg.sourceVariable).toBe('p');
    expect(agg.sourceTypes).toEqual(['Person']);

    // Simple plan: no NodeScanStep present
    expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(false);
  });

  it('produces AggregateStep + ProjectStep for AVG(p.age) AS avg_age', async () => {
    const p = await plan('MATCH (p:Person) RETURN AVG(p.age) AS avg_age');
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0].kind).toBe('AggregateStep');
    expect(p.steps[1].kind).toBe('ProjectStep');

    const agg = p.steps[0] as any;
    expect(agg.aggregates[0].function).toBe('AVG');
    expect(agg.aggregates[0].expression.kind).toBe('PropertyAccess');
    expect(agg.aggregates[0].alias).toBe('avg_age');
    expect(agg.sourceVariable).toBe('p');
    expect(agg.sourceTypes).toEqual(['Person']);

  });

  it('produces multiple AggregateSpecs for MIN, MAX, AVG', async () => {
    const p = await plan('MATCH (p:Person) RETURN MIN(p.age), MAX(p.age), AVG(p.age)');
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0].kind).toBe('AggregateStep');
    expect(p.steps[1].kind).toBe('ProjectStep');

    const agg = p.steps[0] as any;
    expect(agg.aggregates).toHaveLength(3);
    expect(agg.aggregates[0].function).toBe('MIN');
    expect(agg.aggregates[1].function).toBe('MAX');
    expect(agg.aggregates[2].function).toBe('AVG');
    expect(agg.sourceVariable).toBe('p');
    expect(agg.sourceTypes).toEqual(['Person']);
  });
  it('handles COUNT(*) with undefined sourceVariable', async () => {
    const p = await plan('MATCH (p:Person) RETURN COUNT(*)');

    // COUNT(*) has no variable → sourceVariable is undefined → complex plan
    const aggStep = p.steps.find((s) => s.kind === 'AggregateStep') as any;
    expect(aggStep).toBeDefined();
    expect(aggStep.aggregates).toHaveLength(1);
    expect(aggStep.aggregates[0].function).toBe('COUNT');
    expect(aggStep.aggregates[0].expression.kind).toBe('Literal');
    expect(aggStep.aggregates[0].expression.value).toBe('*');
    expect(aggStep.sourceVariable).toBeUndefined();
  });

  // -- Group-by plan shapes --

  it('produces groupBy for non-aggregate RETURN items', async () => {
    const p = await plan('MATCH (p:Person) RETURN p.city, COUNT(p)');
    // Group-by uses complex plan: NodeScanStep + AggregateStep + ProjectStep
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0].kind).toBe('NodeScanStep');
    expect(p.steps[1].kind).toBe('AggregateStep');
    expect(p.steps[2].kind).toBe('ProjectStep');

    const agg = p.steps[1] as any;
    expect(agg.groupBy).toHaveLength(1);
    expect(agg.groupBy[0].kind).toBe('PropertyAccess');
    expect(agg.groupBy[0].property).toBe('city');
    expect(agg.aggregates).toHaveLength(1);
    expect(agg.aggregates[0].function).toBe('COUNT');
  });

  it('produces multiple groupBy entries', async () => {
    const p = await plan('MATCH (p:Person) RETURN p.city, p.state, COUNT(p)');
    // Group-by uses complex plan: NodeScanStep + AggregateStep + ProjectStep
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0].kind).toBe('NodeScanStep');
    expect(p.steps[1].kind).toBe('AggregateStep');
    expect(p.steps[2].kind).toBe('ProjectStep');

    const agg = p.steps[1] as any;
    expect(agg.groupBy).toHaveLength(2);
    expect(agg.groupBy[0].property).toBe('city');
    expect(agg.groupBy[1].property).toBe('state');
  });

  // -- Complex plan shapes (joins — in-process) --

  it('keeps full pipeline for complex aggregate with edge expansion', async () => {
    const p = await plan('MATCH (p:Person)-[:KNOWS]->(f:Person) RETURN COUNT(f)');

    // Complex plan: NodeScanStep and EdgeExpandStep remain
    expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(true);
    expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(true);

    const aggStep = p.steps.find((s) => s.kind === 'AggregateStep') as any;
    expect(aggStep).toBeDefined();
    expect(aggStep.aggregates).toHaveLength(1);
    expect(aggStep.aggregates[0].function).toBe('COUNT');
    expect(aggStep.aggregates[0].expression.kind).toBe('Identifier');
    expect(aggStep.aggregates[0].expression.name).toBe('f');
  });

  // -- Non-aggregate queries (no regression) --

  it('produces no AggregateStep for MATCH (n) RETURN n', async () => {
    const p = await plan('MATCH (n) RETURN n');
    expect(p.steps[0].kind).toBe('NodeScanStep');
    expect(p.steps[1].kind).toBe('ProjectStep');
    expect(p.steps.some((s) => s.kind === 'AggregateStep')).toBe(false);
  });

  it('produces no AggregateStep for MATCH (n) RETURN n.name, n.age', async () => {
    const p = await plan('MATCH (n) RETURN n.name, n.age');
    expect(p.steps[0].kind).toBe('NodeScanStep');
    expect(p.steps[1].kind).toBe('ProjectStep');
    expect(p.steps.some((s) => s.kind === 'AggregateStep')).toBe(false);
  });

  // ── Edge aggregate storage-level guard ────────────────────────
  describe('Edge aggregate storage-level guard', () => {
    // Positive: should take storage-level path
    it('uses storage-level for edge aggregate with no constraints', async () => {
      const p = await plan('MATCH ()-[r:LIKES]->() RETURN count(r)');
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(true);
      expect(agg.sourceEntity).toBe('edge');
      expect(agg.edgeTypes).toEqual(['LIKES']);
      // Steps cleared for storage-level
      expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(false);
      expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(false);
    });

    it('uses storage-level for edge aggregate with no types at all', async () => {
      const p = await plan('MATCH ()-[r]->() RETURN count(r)');
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(true);
      expect(agg.sourceEntity).toBe('edge');
      expect(agg.edgeTypes).toBeUndefined();
      // Steps cleared
      expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(false);
      expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(false);
    });

    // Negative: source node type constraint blocks storage-level
    it('rejects storage-level when source node has type constraint', async () => {
      const p = await plan('MATCH (p:Person)-[r:LIKES]->() RETURN count(r)');
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(false);
      // Pipeline steps remain
      expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(true);
      expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(true);
    });

    // Negative: source node inline property blocks storage-level
    it('rejects storage-level when source node has inline properties', async () => {
      const p = await plan("MATCH (p {name: 'Alice'})-[r:LIKES]->() RETURN count(r)");
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(false);
      expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(true);
      expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(true);
    });

    // Negative: target node type constraint blocks storage-level
    it('rejects storage-level when target node has type constraint', async () => {
      const p = await plan('MATCH ()-[r:LIKES]->(t:Post) RETURN count(r)');
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(false);
      expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(true);
      expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(true);
    });

    // Negative: WHERE clause blocks storage-level
    it('rejects storage-level when WHERE clause is present', async () => {
      const p = await plan('MATCH ()-[r:LIKES]->() WHERE r.weight > 5 RETURN count(r)');
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(false);
      expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(true);
      expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(true);
    });

    // Negative: multi-hop edge expansion blocks storage-level
    it('rejects storage-level for multi-hop edge expansion', async () => {
      const p = await plan('MATCH ()-[r*2..3]->() RETURN count(r)');
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(false);
      expect(p.steps.some((s) => s.kind === 'NodeScanStep')).toBe(true);
      expect(p.steps.some((s) => s.kind === 'EdgeExpandStep')).toBe(true);
    });

    // Negative: target node inline property (produces FilterStep) blocks storage-level
    it('rejects storage-level when target node has inline properties', async () => {
      const p = await plan("MATCH ()-[r:LIKES]->(post {title: 'Hello'}) RETURN count(r)");
      const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
      expect(agg.useStorageLevel).toBe(false);
      // FilterStep present for inline target property
      expect(p.steps.some((s) => s.kind === 'FilterStep')).toBe(true);
    });
  });
});



// ── ORDER BY with aggregates plan shape ──────────────────────────
describe('ORDER BY with aggregates plan shape', () => {
  it('places SortStep after AggregateStep when aggregates present', async () => {
    const p = await plan('MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY cnt DESC');
    const aggIdx = p.steps.findIndex((s) => s.kind === 'AggregateStep');
    const sortIdx = p.steps.findIndex((s) => s.kind === 'SortStep');
    expect(aggIdx).toBeGreaterThanOrEqual(0);
    expect(sortIdx).toBeGreaterThan(aggIdx);
  });

  it('places SortStep before ProjectStep when no aggregates', async () => {
    const p = await plan('MATCH (n) RETURN n ORDER BY n.name ASC');
    const sortIdx = p.steps.findIndex((s) => s.kind === 'SortStep');
    const projectIdx = p.steps.findIndex((s) => s.kind === 'ProjectStep');
    expect(sortIdx).toBeGreaterThanOrEqual(0);
    expect(sortIdx).toBeLessThan(projectIdx);
  });
});

// ── Aggregate expression plan shape ──────────────────────────────
describe('Aggregate expression plan shape', () => {
  it('extracts internal alias for COUNT(*) + 1', async () => {
    const p = await plan('MATCH (p:Person) RETURN COUNT(*) + 1 AS result');
    const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
    expect(agg).toBeDefined();
    expect(agg.aggregates).toHaveLength(1);
    expect(agg.aggregates[0].alias).toMatch(/^__agg_\d+$/);
    expect(agg.aggregates[0].function).toBe('COUNT');

    const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
    expect(proj.columns[0].alias).toBe('result');
    expect(proj.columns[0].expression.kind).toBe('Binary');
  });

  it('extracts two internal aliases for SUM(x) / COUNT(*)', async () => {
    const p = await plan('MATCH (p:Person) RETURN SUM(p.age) / COUNT(*) AS average');
    const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
    expect(agg).toBeDefined();
    expect(agg.aggregates).toHaveLength(2);
    expect(agg.aggregates[0].alias).toMatch(/^__agg_\d+$/);
    expect(agg.aggregates[1].alias).toMatch(/^__agg_\d+$/);
    expect(agg.aggregates[0].function).toBe('SUM');
    expect(agg.aggregates[1].function).toBe('COUNT');

    const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
    expect(proj.columns[0].alias).toBe('average');
    expect(proj.columns[0].expression.kind).toBe('Binary');
  });

  it('preserves simple aggregate COUNT(*) AS cnt without rewriting', async () => {
    const p = await plan('MATCH (p:Person) RETURN COUNT(*) AS cnt');
    const agg = p.steps.find((s) => s.kind === 'AggregateStep') as any;
    expect(agg.aggregates).toHaveLength(1);
    expect(agg.aggregates[0].alias).toBe('cnt');
    expect(agg.aggregates[0].function).toBe('COUNT');
  });
});
