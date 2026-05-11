import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { Planner } from '../../src/cypher/Planner';

/** Helper: lex + parse + semantic + plan. */
function plan(query: string) {
  const tokens = new Lexer(query).tokenise();
  const ast = new Parser(tokens).parse();
  new Semantic().analyse(ast);
  return new Planner().plan(ast);
}

describe('Planner', () => {
  // ── Node scan ──────────────────────────────────────────────────
  describe('NodeScanStep', () => {
    it('produces NodeScanStep for typed node', () => {
      const p = plan('MATCH (n:Person) RETURN n');
      expect(p.steps).toHaveLength(2); // scan + project
      expect(p.steps[0].kind).toBe('NodeScanStep');
      expect((p.steps[0] as any).label).toBe('Person');
      expect((p.steps[0] as any).variable).toBe('n');
    });

    it('produces NodeScanStep with empty label for untyped node', () => {
      const p = plan('MATCH (n) RETURN n');
      expect(p.steps[0].kind).toBe('NodeScanStep');
      expect((p.steps[0] as any).label).toBe('');
    });
  });

  // ── Edge expansion ─────────────────────────────────────────────
  describe('EdgeExpandStep', () => {
    it('produces EdgeExpandStep for single-hop edge', () => {
      const p = plan('MATCH (a)-[:KNOWS]->(b) RETURN b');
      expect(p.steps[0].kind).toBe('NodeScanStep');
      expect(p.steps[1].kind).toBe('EdgeExpandStep');

      const expand = p.steps[1] as any;
      expect(expand.types).toEqual(['KNOWS']);
      expect(expand.direction).toBe('out');
      expect(expand.strategy).toBe('single-hop');
    });

    it('produces multi-hop-bfs for variable-length edge', () => {
      const p = plan('MATCH (a)-[*1..3]->(b) RETURN b');
      const expand = p.steps[1] as any;
      expect(expand.strategy).toBe('multi-hop-bfs');
      expect(expand.minHops).toBe(1);
      expect(expand.maxHops).toBe(3);
    });
  });

  // ── Filter ─────────────────────────────────────────────────────
  describe('FilterStep', () => {
    it('produces FilterStep when WHERE present', () => {
      const p = plan("MATCH (p:Person) WHERE p.name = 'Alice' RETURN p");
      const hasFilter = p.steps.some((s) => s.kind === 'FilterStep');
      expect(hasFilter).toBe(true);
    });

    it('filter appears before projection', () => {
      const p = plan("MATCH (p:Person) WHERE p.name = 'Alice' RETURN p");
      const filterIdx = p.steps.findIndex((s) => s.kind === 'FilterStep');
      const projectIdx = p.steps.findIndex((s) => s.kind === 'ProjectStep');
      expect(filterIdx).toBeLessThan(projectIdx);
    });

    it('generates FilterStep from node inline properties', () => {
      const p = plan('MATCH (s:Student {year: 2024}) RETURN s');
      // Should have: NodeScanStep, FilterStep (for year=2024), ProjectStep
      const filters = p.steps.filter((s) => s.kind === 'FilterStep');
      expect(filters.length).toBeGreaterThanOrEqual(1);
      const filter = filters[0] as any;
      expect(filter.predicate.kind).toBe('Binary');
      expect(filter.predicate.op).toBe('=');
    });

    it('generates FilterStep from edge inline properties', () => {
      const p = plan('MATCH (a:Person)-[:KNOWS {since: 2020}]->(b:Person) RETURN b');
      const filters = p.steps.filter((s) => s.kind === 'FilterStep');
      // At least one filter for the edge property
      expect(filters.length).toBeGreaterThanOrEqual(1);
    });

    it('generates FilterStep from target node inline properties', () => {
      const p = plan('MATCH (a:Person)-[:KNOWS]->(b:Person {active: true}) RETURN b');
      const filters = p.steps.filter((s) => s.kind === 'FilterStep');
      expect(filters.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Projection ─────────────────────────────────────────────────
  describe('ProjectStep', () => {
    it('produces ProjectStep with columns', () => {
      const p = plan('MATCH (n) RETURN n.name AS name');
      const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
      expect(proj.columns).toHaveLength(1);
      expect(proj.columns[0].alias).toBe('name');
    });

    it('derives alias from PropertyAccess (no AS)', () => {
      const p = plan('MATCH (n) RETURN n.name');
      const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
      expect(proj.columns[0].alias).toBe('n_name');
    });

    it('derives alias from Literal (no AS)', () => {
      const p = plan('MATCH (n) RETURN 42');
      const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
      expect(proj.columns[0].alias).toBe('42');
    });

    it('derives alias from Parameter (no AS)', () => {
      const p = plan('MATCH (n) RETURN $name');
      const proj = p.steps.find((s) => s.kind === 'ProjectStep') as any;
      expect(proj.columns[0].alias).toBe('name');
    });

    it('derives alias from FunctionCall (no AS)', () => {
      const planner = new Planner();
      const fnExpr = { kind: 'FunctionCall' as const, name: 'COUNT', args: [] };
      expect((planner as any)._deriveAlias(fnExpr)).toBe('count');
    });

    it('derives alias from unknown expression (default)', () => {
      const planner = new Planner();
      const unknownExpr = { kind: 'Binary' as const, op: '+' as const, left: {} as any, right: {} as any };
      expect((planner as any)._deriveAlias(unknownExpr)).toBe('expr');
    });
  });

  // ── Sort ───────────────────────────────────────────────────────
  describe('SortStep', () => {
    it('produces SortStep for ORDER BY', () => {
      const p = plan('MATCH (n) RETURN n ORDER BY n.name ASC');
      expect(p.steps.some((s) => s.kind === 'SortStep')).toBe(true);
    });
  });

  // ── Limit ──────────────────────────────────────────────────────
  describe('LimitStep', () => {
    it('produces LimitStep for SKIP and LIMIT', () => {
      const p = plan('MATCH (n) RETURN n SKIP 5 LIMIT 10');
      expect(p.steps.some((s) => s.kind === 'LimitStep')).toBe(true);
    });
  });
});
