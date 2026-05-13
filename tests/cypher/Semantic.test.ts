import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { CypherSemanticError } from '../../src/cypher/errors';

/** Helper: lex + parse + semantic analyse. */
function analyse(query: string) {
  const tokens = new Lexer(query).tokenise();
  const ast = new Parser(tokens).parse();
  const semantic = new Semantic();
  semantic.analyse(ast);
  return { ast, scope: semantic.scope };
}

describe('Semantic', () => {
  // ── Scope resolution ───────────────────────────────────────────
  describe('scope resolution', () => {
    it('collects node variables', () => {
      const { scope } = analyse('MATCH (n) RETURN n');
      expect(scope.has('n')).toBe(true);
      expect(scope.get('n')!.bindingKind).toBe('node');
    });

    it('collects edge variables', () => {
      const { scope } = analyse('MATCH (a)-[r:KNOWS]->(b) RETURN r');
      expect(scope.has('r')).toBe(true);
      expect(scope.get('r')!.bindingKind).toBe('edge');
    });

    it('collects variables from all patterns', () => {
      const { scope } = analyse('MATCH (a:Person), (b:Company) RETURN a, b');
      expect(scope.has('a')).toBe(true);
      expect(scope.has('b')).toBe(true);
    });
  });

  // ── Unresolved variables ───────────────────────────────────────
  describe('unresolved variables', () => {
    it('rejects undefined variable in RETURN', () => {
      expect(() => analyse('MATCH (n) RETURN undefinedVar'))
        .toThrow(CypherSemanticError);
    });

    it('rejects undefined variable in WHERE', () => {
      expect(() => analyse('MATCH (n) WHERE x.name = 1 RETURN n'))
        .toThrow(CypherSemanticError);
    });

    it('rejects undefined variable in ORDER BY', () => {
      expect(() => analyse('MATCH (n) RETURN n ORDER BY z.name'))
        .toThrow(CypherSemanticError);
    });

    it('allows property access on defined variables', () => {
      expect(() => analyse('MATCH (n) WHERE n.name = $name RETURN n'))
        .not.toThrow();
    });

    it('allows parameters without error', () => {
      expect(() => analyse('MATCH (n) WHERE n.name = $name RETURN n'))
        .not.toThrow();
    });
  });

  // ── Duplicate bindings ─────────────────────────────────────────
  describe('duplicate bindings', () => {
    it('rejects same variable bound twice', () => {
      expect(() => analyse('MATCH (n), (n) RETURN n'))
        .toThrow(CypherSemanticError);
    });
  });

  // ── Semantic Analysis for Aggregates ────────────────────────────
  describe('Semantic Analysis for Aggregates', () => {
    // -- Valid aggregate queries --

    it('allows COUNT(p) in RETURN', () => {
      expect(() => analyse('MATCH (p:Person) RETURN COUNT(p)'))
        .not.toThrow();
    });

    it('allows p.city as grouping key with COUNT(p)', () => {
      expect(() => analyse('MATCH (p:Person) RETURN p.city, COUNT(p)'))
        .not.toThrow();
    });

    it('allows p.name as grouping key with COUNT(p)', () => {
      expect(() => analyse('MATCH (p:Person) RETURN p.name, COUNT(p)'))
        .not.toThrow();
    });

    it('allows query with no aggregates at all', () => {
      expect(() => analyse('MATCH (p:Person) RETURN p.name, p.age'))
        .not.toThrow();
    });

    // -- Invalid: Aggregate in WHERE --

    it('rejects COUNT in WHERE clause', () => {
      expect(() => analyse('MATCH (p:Person) WHERE COUNT(p) > 5 RETURN p'))
        .toThrow(CypherSemanticError);
    });

    it('rejects AVG in WHERE clause', () => {
      expect(() => analyse('MATCH (p:Person) WHERE AVG(p.age) > 30 RETURN p'))
        .toThrow(CypherSemanticError);
    });

    // -- Invalid: Non-grouping-key expression with aggregates --

    it('rejects complex expression as grouping key', () => {
      expect(() => analyse('MATCH (p:Person) RETURN p.age + 1, COUNT(p)'))
        .toThrow(CypherSemanticError);
    });
  });
});
