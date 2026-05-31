import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { Semantic } from '../../src/cypher/Semantic';
import { CypherSemanticError, CypherSyntaxError } from '../../src/cypher/errors';

/** Helper: lex + parse + semantic analyse. */
function analyse(query: string) {
  const tokens = new Lexer(query).tokenise();
  const ast = new Parser(tokens).parse();
  const semantic = new Semantic();
  semantic.analyseStatement(ast);
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

    it('rejects variable in WHERE clause from a subsequent MATCH', () => {
      expect(() => analyse('MATCH (a) WHERE b.age > 18 MATCH (b) RETURN a, b'))
        .toThrow(CypherSemanticError);
    });

    it('rejects variable in WHERE clause from a subsequent OPTIONAL MATCH', () => {
      expect(() => analyse('MATCH (a) WHERE b.age > 18 OPTIONAL MATCH (a)-[:KNOWS]->(b) RETURN a, b'))
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

  // ── CREATE uniqueness ──────────────────────────────────────────
  describe('CREATE uniqueness', () => {
    it('allows MATCH-bound variables as references in CREATE patterns', () => {
      // MATCH (a) CREATE (a)-[:R]->(b) uses 'a' as a reference to
      // connect the new node 'b' — it does NOT re-bind 'a'.
      expect(() =>
        analyse('MATCH (a) CREATE (a)-[:R]->(b) RETURN a, b'),
      ).not.toThrow();
    });

    it('rejects a MATCH-bound variable used as a standalone CREATE node', () => {
      // CREATE (a) when 'a' is already bound in MATCH is true re-binding.
      expect(() => analyse('MATCH (a) CREATE (a) RETURN a')).toThrow(
        CypherSemanticError,
      );
    });
  });

  // ── SET clause validation ────────────────────────────────────────
  describe('SET clause validation', () => {
    it('allows primitive values in SET map replacement', () => {
      expect(() => analyse('MATCH (n) SET n = { age: 30, name: "Alice", active: true, score: null } RETURN n'))
        .not.toThrow();
    });

    it('allows primitive values in SET map mutation', () => {
      expect(() => analyse('MATCH (n) SET n += { age: 30, name: "Alice", active: true, score: null } RETURN n'))
        .not.toThrow();
    });

    it('rejects nested maps in SET map replacement', () => {
      expect(() => analyse('MATCH (n) SET n = { user: { name: "Alice" } } RETURN n'))
        .toThrow(CypherSemanticError);
    });

    it('rejects lists in SET map mutation', () => {
      expect(() => analyse('MATCH (n) SET n += { tags: ["a", "b"] } RETURN n'))
        .toThrow(CypherSemanticError);
    });
  });

  // ── Pattern Comprehensions and Expressions ─────────────────────
  describe('Pattern Comprehensions and Expressions', () => {
    it('allows pattern comprehension referencing outer scope', () => {
      expect(() => analyse('MATCH (a) RETURN [ (a)-[:KNOWS]->(b) WHERE b.age > 18 | b.name ] AS names'))
        .not.toThrow();
    });

    it('rejects pattern comprehension projection referencing undefined var', () => {
      expect(() => analyse('MATCH (a) RETURN [ (a)-[:KNOWS]->(b) | c.name ] AS names'))
        .toThrow(CypherSemanticError);
    });

    it('rejects outer scope referencing comprehension var', () => {
      expect(() => analyse('MATCH (a) RETURN [ (a)-[:KNOWS]->(b) | b.name ] AS names, b.age'))
        .toThrow(CypherSemanticError);
    });

    it('allows pattern expression referencing outer scope', () => {
      expect(() => analyse('MATCH (a) WHERE (a)-[:KNOWS]->(:Person) RETURN a'))
        .not.toThrow();
    });

    it('rejects outer scope referencing pattern expression var', () => {
      expect(() => analyse('MATCH (a) WHERE (a)-[:KNOWS]->(b:Person) RETURN b'))
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



  // ── ORDER BY with aggregate aliases ──────────────────────────────
  describe('ORDER BY with aggregate aliases', () => {
    it('allows ORDER BY with aggregate alias when aggregates present', () => {
      expect(() => analyse('MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY cnt DESC'))
        .not.toThrow();
    });

    it('allows ORDER BY with group-by key alias when aggregates present', () => {
      expect(() => analyse('MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY p_city DESC'))
        .not.toThrow();
    });

    it('rejects ORDER BY with undefined variable when aggregates present', () => {
      expect(() => analyse('MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt ORDER BY foo'))
        .toThrow(CypherSemanticError);
    });
  });

  // ── Index DDL validation ──────────────────────────────────────────
  describe('index DDL validation', () => {
    it('allows standalone CREATE INDEX', () => {
      expect(() => analyse('CREATE INDEX idx FOR (n:Person) ON (n.email)'))
        .not.toThrow();
    });

    it('allows standalone DROP INDEX', () => {
      expect(() => analyse('DROP INDEX idx'))
        .not.toThrow();
    });

    it('allows standalone SHOW INDEXES', () => {
      expect(() => analyse('SHOW INDEXES'))
        .not.toThrow();
    });

    it('allows CREATE INDEX for edge', () => {
      expect(() => analyse('CREATE INDEX since_idx FOR ()-[r:KNOWS]-() ON (r.since)'))
        .not.toThrow();
    });

    it('rejects DDL + DML in same query (parser-level syntax error)', () => {
      // Parser catches hybrid DDL + DML queries at the syntax level
      expect(() => analyse('MATCH (n) CREATE INDEX idx FOR (n:P) ON (n.name) RETURN n'))
        .toThrow(CypherSyntaxError);
    });

    it('rejects DDL with trailing tokens (parser-level)', () => {
      expect(() => analyse('CREATE INDEX idx FOR (n:P) ON (n.name) CREATE (m:Q) RETURN m'))
        .toThrow(CypherSyntaxError);
    });
  });

  // ── Comprehension Aggregates ──────────────────────────────────────────
  describe('comprehension aggregates', () => {
    it('rejects aggregates inside list comprehension projection', () => {
      expect(() => analyse('MATCH (n) RETURN [x IN [1,2,3] | COUNT(x)]'))
        .toThrow(CypherSemanticError);
    });

    it('rejects aggregates inside list comprehension WHERE clause', () => {
      expect(() => analyse('MATCH (n) RETURN [x IN [1,2,3] WHERE COUNT(x) > 0 | x]'))
        .toThrow(CypherSemanticError);
    });

    it('allows aggregates in the list part of list comprehension', () => {
      expect(() => analyse('MATCH (n) RETURN [x IN COUNT(n) | x]'))
        .not.toThrow();
    });

    it('rejects aggregates inside pattern comprehension projection', () => {
      expect(() => analyse('MATCH (a) RETURN [(a)-[r]->(b) | COUNT(b)]'))
        .toThrow(CypherSemanticError);
    });

    it('rejects aggregates inside pattern comprehension WHERE clause', () => {
      expect(() => analyse('MATCH (a) RETURN [(a)-[r]->(b) WHERE COUNT(b) > 0 | b]'))
        .toThrow(CypherSemanticError);
    });
  });

  // ── _checkDeleteSafety: single omnibus test covering all _expressionReferencesAny branches ──
  //
  // _checkDeleteSafety checks both item.variable AND item.value via
  // _expressionReferencesAny. To reach every switch branch, each SET item
  // value is a different expression kind. All of these are valid openCypher
  // SET value expressions. The deleted variable `r` does NOT appear in any
  // value expression → every branch returns false → no throw.
  //
  // Branches exercised via SET value expressions:
  //   FunctionCall      → SET a.label = toUpper(a.name)
  //   Binary            → SET a.score2 = a.score + 1
  //   Unary             → SET a.inactive = NOT a.active
  //   In                → SET a.isAdmin = a.role IN ["admin","user"]
  //   IsNull            → SET a.missing = a.tag IS NULL
  //   ListComprehension → SET a.names = [x IN ["p","q"] | x]
  //   ExistsSubquery    → SET a.known = EXISTS { MATCH (a)-[:FOLLOWS]->(:Person) }
  //   PatternComprehension → SET a.friends = [(a)-[:LIKES]->(c) | c.name]
  //   Identifier        → SET a.self = a
  //   Literal           → SET a.str = "safe"
  //   Parameter         → SET a.param = $val
  //   PropertyAccess    → covered by all property-valued SET items above
  //   Map               → SET a += { key: "v" }   (map-mutation form)
  //   PatternExpr       → covered via RETURN (not reachable as SET value)
  //   List              → covered via ListComprehension list source above
  describe('_checkDeleteSafety', () => {
    it('traverses every _expressionReferencesAny branch in SET and MERGE SET values without false-positive on unrelated deleted var', () => {
      // Parser clause order: MATCH → MERGE → SET → DELETE → RETURN
      // Covers ast.merge path: MERGE ON MATCH SET with safe value (a.count = a.count + 1).
      // Covers ast.set path: all expression kinds as SET values; deleted var r absent from all.
      expect(() =>
        analyse(
          'MATCH (a:Person)-[r:KNOWS]->(b:Person) ' +
          'MERGE (a)-[:FOLLOWS]->(b) ON MATCH SET a.visits = a.visits + 1 ' +
          'SET a.label    = toUpper(a.name), ' +
          '    a.score2   = a.score + 1, ' +
          '    a.inactive = NOT a.active, ' +
          '    a.isAdmin  = a.role IN ["admin", "user"], ' +
          '    a.missing  = a.tag IS NULL, ' +
          '    a.names    = [x IN ["p", "q"] | x], ' +
          '    a.known    = EXISTS { MATCH (a)-[:FOLLOWS]->(:Person) }, ' +
          '    a.friends  = [(a)-[:LIKES]->(c) | c.name], ' +
          '    a.self     = a, ' +
          '    a.str      = "safe", ' +
          '    a.param    = $val, ' +
          '    a         += { key: "v" } ' +
          'DELETE r ' +
          'RETURN (a)-[:BLOCKED]->(:Person)',
        ),
      ).not.toThrow();
    });

    it('throws CypherSemanticError when SET references a deleted variable (SET branch) and when MERGE SET references a deleted variable (MERGE branch)', () => {
      // SET branch throw: r is deleted, SET r.x = 1 references deleted r on LHS
      expect(() =>
        analyse(
          'MATCH (a:Person)-[r:KNOWS]->(b:Person) ' +
          'SET r.prop = "x" ' +
          'DELETE r ' +
          'RETURN a',
        ),
      ).toThrow(CypherSemanticError);

      // MERGE SET branch throw: r is deleted, MERGE ON MATCH SET r.prop = 1 references deleted r on LHS
      expect(() =>
        analyse(
          'MATCH (a:Person)-[r:KNOWS]->(b:Person) ' +
          'MERGE (a)-[:FOLLOWS]->(b) ON MATCH SET r.prop = 1 ' +
          'DELETE r ' +
          'RETURN a',
        ),
      ).toThrow(CypherSemanticError);
    });
  });

  // ── _checkAggregateGrouping: single omnibus test covering all _collectUnresolvedPostAggIdentifiers branches ──
  //
  // One ORDER BY + aggregate query whose ORDER BY expression tree packs every
  // Expression kind so _collectUnresolvedPostAggIdentifiers walks Identifier,
  // PropertyAccess, FunctionCall, ListComprehension, ExistsSubquery,
  // PatternComprehension, PatternExpr, Literal, Parameter, Binary branches.
  // All identifiers resolve to valid post-aggregation aliases → returns [] → no throw.
  describe('_checkAggregateGrouping', () => {
    it('traverses all _collectUnresolvedPostAggIdentifiers branches without error when ORDER BY uses valid post-agg aliases', () => {
      // Post-aggregation aliases: city (from p.city AS city), cnt (from COUNT(*) AS cnt).
      // ORDER BY expression tree exercises every branch of _collectUnresolvedPostAggIdentifiers:
      //   cnt                                        → Identifier (valid alias)
      //   cnt + 0                                    → Binary(Identifier, Literal)
      //   NOT (cnt IS NULL)                          → Unary(IsNull(Identifier))  covers Unary + IsNull
      //   cnt IN [1, 2]                              → In(Identifier, List([Literal, Literal]))  covers In + List
      //   {key: cnt}                                 → Map({key: Identifier})
      //   toUpper(city)                              → FunctionCall(Identifier)
      //   [x IN [cnt] | x]                           → ListComprehension(List([Identifier]), local x)
      //   EXISTS { MATCH (p)-[:KNOWS]->(:Person) }  → ExistsSubquery (no WHERE)
      //   [(p)-[:LIKES]->(q) | q.name]              → PatternComprehension (local q)
      //   (p)-[:BLOCKED]->(:Person)                 → PatternExpr
      //   1                                          → Literal
      //   $param                                     → Parameter
      expect(() =>
        analyse(
          'MATCH (p:Person) ' +
          'RETURN p.city AS city, COUNT(*) AS cnt ' +
          'ORDER BY cnt, cnt + 0, NOT (cnt IS NULL), cnt IN [1, 2], {key: cnt}, ' +
          'toUpper(city), [x IN [cnt] | x], ' +
          'EXISTS { MATCH (p)-[:KNOWS]->(:Person) }, ' +
          '[(p)-[:LIKES]->(q) | q.name], ' +
          '(p)-[:BLOCKED]->(:Person), ' +
          '1, $param',
        ),
      ).not.toThrow();
    });
  });
});
