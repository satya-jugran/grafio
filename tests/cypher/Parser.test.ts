import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { CypherSyntaxError } from '../../src/cypher/errors';
import { TokenKind } from '../../src/cypher/Token';
import { getPatternSegments, type MatchPattern, type PatternSegment } from '../../src/cypher/ast/AstNode';

/** Helper: lex + parse in one call. */
function parse(query: string) {
  const tokens = new Lexer(query).tokenise();
  return new Parser(tokens).parse();
}

/** Helper: get segments from a MatchPattern (handles PatternPath | NamedPath) */
function getSegments(pattern: MatchPattern): PatternSegment[] {
  return getPatternSegments(pattern);
}

describe('Parser', () => {
  // ── Simple queries ─────────────────────────────────────────────
  describe('simple queries', () => {
    it('parses MATCH (n) RETURN n', () => {
      const ast = parse('MATCH (n) RETURN n');

      expect(ast.kind).toBe('Query');
      expect(ast.matches[0].kind).toBe('Match');
      expect(ast.matches[0].patterns).toHaveLength(1);

      const path = ast.matches[0].patterns[0];
      const segments = getSegments(path);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe('NodePattern');
      expect((segments[0] as any).variable).toBe('n');

      expect(ast.return.kind).toBe('Return');
      expect(ast.return.items).toHaveLength(1);
      expect(ast.return.items[0].expression.kind).toBe('Identifier');
    });

    it('parses MATCH (n) RETURN n, n.name', () => {
      const ast = parse('MATCH (n) RETURN n, n.name');
      expect(ast.return.items).toHaveLength(2);
      expect(ast.return.items[1].expression.kind).toBe('PropertyAccess');
    });
  });

  // ── Typed nodes ────────────────────────────────────────────────
  describe('typed nodes', () => {
    it('parses (n:Person)', () => {
      const ast = parse('MATCH (n:Person) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect(node.kind).toBe('NodePattern');
      expect((node as any).labels).toEqual(['Person']);
    });

    it('parses (n:Person|Employee) multi-label', () => {
      const ast = parse('MATCH (n:Person|Employee) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).labels).toEqual(['Person', 'Employee']);
    });

    it('parses anonymous node (:Person)', () => {
      const ast = parse('MATCH (:Person) RETURN 1');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).variable).toBeUndefined();
      expect((node as any).labels).toEqual(['Person']);
    });
  });

  // ── Inline properties ──────────────────────────────────────────
  describe('inline properties', () => {
    it('parses node with inline properties', () => {
      const ast = parse("MATCH (n:Person {name: 'Alice', age: 30}) RETURN n");
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties).toEqual({ name: 'Alice', age: 30 });
    });

    it('parses inline properties with param', () => {
      const ast = parse('MATCH (n {name: $name}) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties.name).toEqual({ kind: 'Parameter', name: 'name' });
    });

    it('parses float property value', () => {
      const ast = parse('MATCH (n {score: 3.14}) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties.score).toBe(3.14);
    });

    it('parses boolean property value (true)', () => {
      const ast = parse('MATCH (n {active: true}) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties.active).toBe(true);
    });

    it('parses boolean property value (false)', () => {
      const ast = parse('MATCH (n {active: false}) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties.active).toBe(false);
    });

    it('parses null property value', () => {
      const ast = parse('MATCH (n {email: null}) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties.email).toBeNull();
    });

    it('parses negative integer property value', () => {
      const ast = parse('MATCH (n {score: -5}) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties.score).toBe(-5);
    });

    it('parses negative float property value', () => {
      const ast = parse('MATCH (n {score: -3.14}) RETURN n');
      const node = getSegments(ast.matches[0].patterns[0])[0];
      expect((node as any).properties.score).toBe(-3.14);
    });

    it('throws on invalid property value', () => {
      expect(() => parse('MATCH (n {x: (1+2)}) RETURN n')).toThrow(CypherSyntaxError);
    });
  });

  // ── Edges ──────────────────────────────────────────────────────
  describe('edges', () => {
    it('parses directed edge -->', () => {
      const ast = parse('MATCH (a)-[:KNOWS]->(b) RETURN b');
      const path = ast.matches[0].patterns[0];
      expect(getSegments(path)).toHaveLength(3);

      const edge = getSegments(path)[1];
      expect(edge.kind).toBe('EdgePattern');
      expect((edge as any).types).toEqual(['KNOWS']);
      expect((edge as any).direction).toBe('out');
    });

    it('parses reverse edge <--', () => {
      const ast = parse('MATCH (a)<-[:KNOWS]-(b) RETURN b');
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).direction).toBe('in');
    });

    it('parses edge with variable', () => {
      const ast = parse('MATCH (a)-[r:KNOWS]->(b) RETURN r');
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).variable).toBe('r');
    });

    it('parses edge without type', () => {
      const ast = parse('MATCH (a)-[]->(b) RETURN b');
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).types).toEqual([]);
    });

    it('parses edge with inline properties', () => {
      const ast = parse("MATCH (a)-[:KNOWS {since: 2020}]->(b) RETURN b");
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).properties).toEqual({ since: 2020 });
    });
  });

  // ── Variable-length edges ──────────────────────────────────────
  describe('variable-length edges', () => {
    it('parses [*] (unbounded)', () => {
      const ast = parse('MATCH (a)-[*]->(b) RETURN b');
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).minHops).toBe(1);
      expect((edge as any).maxHops).toBe(Infinity);
    });

    it('parses [*1..3]', () => {
      const ast = parse('MATCH (a)-[*1..3]->(b) RETURN b');
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).minHops).toBe(1);
      expect((edge as any).maxHops).toBe(3);
    });

    it('parses [*3] (exact)', () => {
      const ast = parse('MATCH (a)-[*3]->(b) RETURN b');
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).minHops).toBe(3);
      expect((edge as any).maxHops).toBe(3);
    });

    it('parses [*..5]', () => {
      const ast = parse('MATCH (a)-[*..5]->(b) RETURN b');
      const edge = getSegments(ast.matches[0].patterns[0])[1];
      expect((edge as any).minHops).toBe(1);
      expect((edge as any).maxHops).toBe(5);
    });
  });

  // ── WHERE clause ───────────────────────────────────────────────
  describe('WHERE clause', () => {
    it('parses WHERE with comparison', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name = 'Alice' RETURN p");
      expect(ast.matches[0].where).toBeDefined();
      expect(ast.matches[0].where!.expression.kind).toBe('Binary');
    });

    it('parses WHERE with AND', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name = 'Alice' AND p.age > 18 RETURN p");
      expect(ast.matches[0].where!.expression.kind).toBe('Binary');
      expect((ast.matches[0].where!.expression as any).op).toBe('AND');
    });

    it('parses WHERE with OR', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name = 'Alice' OR p.name = 'Bob' RETURN p");
      expect((ast.matches[0].where!.expression as any).op).toBe('OR');
    });

    it('parses WHERE with NOT', () => {
      const ast = parse("MATCH (p:Person) WHERE NOT p.active RETURN p");
      expect(ast.matches[0].where!.expression.kind).toBe('Unary');
    });

    it('parses WHERE with IS NULL', () => {
      const ast = parse('MATCH (p:Person) WHERE p.email IS NULL RETURN p');
      expect(ast.matches[0].where!.expression.kind).toBe('IsNull');
    });

    it('parses WHERE with IS NOT NULL', () => {
      const ast = parse('MATCH (p:Person) WHERE p.email IS NOT NULL RETURN p');
      const expr = ast.matches[0].where!.expression;
      expect(expr.kind).toBe('IsNull');
      expect((expr as any).not).toBe(true);
    });

    it('parses WHERE with IN', () => {
      const ast = parse("MATCH (p:Person) WHERE p.role IN ['admin', 'mod'] RETURN p");
      expect(ast.matches[0].where!.expression.kind).toBe('In');
    });

    it('parses WHERE with NOT IN', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name NOT IN ['Alice', 'Bob'] RETURN p");
      const expr = ast.matches[0].where!.expression;
      expect(expr.kind).toBe('In');
      expect((expr as any).not).toBe(true);
    });

    it('parses WHERE with param', () => {
      const ast = parse('MATCH (p:Person) WHERE p.name = $name RETURN p');
      const bin = ast.matches[0].where!.expression;
      expect((bin as any).right.kind).toBe('Parameter');
    });
  });

  // ── RETURN clause ──────────────────────────────────────────────
  describe('RETURN clause', () => {
    it('parses RETURN with DISTINCT', () => {
      const ast = parse('MATCH (n) RETURN DISTINCT n');
      expect(ast.return.distinct).toBe(true);
    });

    it('parses RETURN with AS alias', () => {
      const ast = parse('MATCH (n:Person) RETURN n.name AS name');
      expect(ast.return.items[0].alias).toBe('name');
    });

    it('parses RETURN with property access', () => {
      const ast = parse('MATCH (n) RETURN n.name');
      expect(ast.return.items[0].expression.kind).toBe('PropertyAccess');
    });
  });

  // ── ORDER BY ───────────────────────────────────────────────────
  describe('ORDER BY', () => {
    it('parses ORDER BY with ASC', () => {
      const ast = parse('MATCH (n) RETURN n ORDER BY n.name ASC');
      expect(ast.orderBy).toBeDefined();
      expect(ast.orderBy!.items[0].direction).toBe('ASC');
    });

    it('parses ORDER BY with DESC', () => {
      const ast = parse('MATCH (n) RETURN n ORDER BY n.age DESC');
      expect(ast.orderBy!.items[0].direction).toBe('DESC');
    });

    it('parses ORDER BY with default ASC', () => {
      const ast = parse('MATCH (n) RETURN n ORDER BY n.name');
      expect(ast.orderBy!.items[0].direction).toBe('ASC');
    });
  });

  // ── SKIP / LIMIT ───────────────────────────────────────────────
  describe('SKIP / LIMIT', () => {
    it('parses SKIP', () => {
      const ast = parse('MATCH (n) RETURN n SKIP 10');
      expect(ast.skip).toBeDefined();
    });

    it('parses LIMIT', () => {
      const ast = parse('MATCH (n) RETURN n LIMIT 20');
      expect(ast.limit).toBeDefined();
    });

    it('parses SKIP and LIMIT together', () => {
      const ast = parse('MATCH (n) RETURN n SKIP 5 LIMIT 10');
      expect(ast.skip).toBeDefined();
      expect(ast.limit).toBeDefined();
    });
  });

  // ── Multi-path ─────────────────────────────────────────────────
  describe('multi-path MATCH', () => {
    it('parses comma-separated patterns', () => {
      const ast = parse('MATCH (a:Person), (b:Company) RETURN a, b');
      expect(ast.matches[0].patterns).toHaveLength(2);
    });

    it('parses multi-hop path', () => {
      const ast = parse('MATCH (a:Person)-[:KNOWS]->(b:Person)-[:WORKS_AT]->(c:Company) RETURN c');
      const path = ast.matches[0].patterns[0];
      expect(getSegments(path)).toHaveLength(5); // N-E-N-E-N
    });
  });

  // ── Syntax errors ──────────────────────────────────────────────
  describe('syntax errors', () => {
    it('throws on empty query', () => {
      expect(() => parse('')).toThrow(CypherSyntaxError);
    });

    it('parses standalone RETURN (no MATCH required)', () => {
      const ast = parse('RETURN n');
      expect(ast.kind).toBe('Query');
      expect(ast.matches).toHaveLength(0);
      expect(ast.return.kind).toBe('Return');
      expect(ast.return.items).toHaveLength(1);
      expect(ast.return.items[0].expression.kind).toBe('Identifier');
    });

    it('throws on unclosed paren', () => {
      expect(() => parse('MATCH (n RETURN n')).toThrow(CypherSyntaxError);
    });

    it('throws on unexpected tokens after query', () => {
      expect(() => parse('MATCH (n) RETURN n EXTRA')).toThrow(CypherSyntaxError);
    });
  });

  // ── Expression precedence ──────────────────────────────────────
  describe('expression precedence', () => {
    it('AND binds tighter than OR', () => {
      const ast = parse("MATCH (p) WHERE p.x = 1 OR p.y = 2 AND p.z = 3 RETURN p");
      const expr = ast.matches[0].where!.expression;
      // Should be: OR(=, AND(=))
      expect((expr as any).op).toBe('OR');
    });
  });

  // ── Function Calls / Aggregates ─────────────────────────────────
  describe('Function Calls / Aggregates', () => {
    it('parses COUNT(n) as FunctionCallExpr', () => {
      const ast = parse('MATCH (n) RETURN COUNT(n)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('COUNT');
      expect((expr as any).args).toHaveLength(1);
      expect((expr as any).args[0].kind).toBe('Identifier');
      expect((expr as any).args[0].name).toBe('n');
    });

    it('parses COUNT(*) as FunctionCallExpr with star literal', () => {
      const ast = parse('MATCH (n) RETURN COUNT(*)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('COUNT');
      expect((expr as any).args).toHaveLength(1);
      expect((expr as any).args[0].kind).toBe('Literal');
      expect((expr as any).args[0].value).toBe('*');
    });

    it('parses SUM(n.age) as FunctionCallExpr with PropertyAccess arg', () => {
      const ast = parse('MATCH (n) RETURN SUM(n.age)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('SUM');
      expect((expr as any).args).toHaveLength(1);
      expect((expr as any).args[0].kind).toBe('PropertyAccess');
    });

    it('parses AVG(n.age) as FunctionCallExpr', () => {
      const ast = parse('MATCH (n) RETURN AVG(n.age)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('AVG');
    });

    it('parses MIN(n.age) as FunctionCallExpr', () => {
      const ast = parse('MATCH (n) RETURN MIN(n.age)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('MIN');
    });

    it('parses MAX(n.age) as FunctionCallExpr', () => {
      const ast = parse('MATCH (n) RETURN MAX(n.age)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('MAX');
    });

    it('parses COLLECT(n.name) as FunctionCallExpr', () => {
      const ast = parse('MATCH (n) RETURN COLLECT(n.name)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('COLLECT');
    });

    it('parses COUNT(DISTINCT n.city) with distinct flag', () => {
      const ast = parse('MATCH (n) RETURN COUNT(DISTINCT n.city)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('COUNT');
      expect((expr as any).distinct).toBe(true);
      expect((expr as any).args).toHaveLength(1);
      expect((expr as any).args[0].kind).toBe('PropertyAccess');
    });

    it('parses SUM(DISTINCT n.salary) with distinct flag', () => {
      const ast = parse('MATCH (n) RETURN SUM(DISTINCT n.salary)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('SUM');
      expect((expr as any).distinct).toBe(true);
    });

    it('parses COUNT(p.age) within a full RETURN clause', () => {
      const ast = parse('MATCH (p:Person) RETURN COUNT(p.age)');
      expect(ast.return.items).toHaveLength(1);
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('COUNT');
      expect((expr as any).args[0].kind).toBe('PropertyAccess');
      expect((expr as any).args[0].object.name).toBe('p');
      expect((expr as any).args[0].property).toBe('age');
    });

    it('parses function call with no args', () => {
      const ast = parse('MATCH (n) RETURN myFunc()');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('MYFUNC');
      expect((expr as any).args).toHaveLength(0);
    });

    it('parses function call with multiple args', () => {
      const ast = parse('MATCH (n) RETURN coalesce(n.name, n.id)');
      const expr = ast.return.items[0].expression;
      expect(expr.kind).toBe('FunctionCall');
      expect((expr as any).name).toBe('COALESCE');
      expect((expr as any).args).toHaveLength(2);
      expect((expr as any).args[0].kind).toBe('PropertyAccess');
      expect((expr as any).args[1].kind).toBe('PropertyAccess');
    });

    it('parses nested function calls', () => {
      const ast = parse('MATCH (n) RETURN COUNT(COLLECT(n))');
      const outer = ast.return.items[0].expression;
      expect(outer.kind).toBe('FunctionCall');
      expect((outer as any).name).toBe('COUNT');
      expect((outer as any).args).toHaveLength(1);

      const inner = (outer as any).args[0];
      expect(inner.kind).toBe('FunctionCall');
      expect(inner.name).toBe('COLLECT');
      expect(inner.args).toHaveLength(1);
      expect(inner.args[0].kind).toBe('Identifier');
      expect(inner.args[0].name).toBe('n');
    });
  });

  // ── Write clause parsing ───────────────────────────────────────
  describe('write clause parsing', () => {
    it('parses CREATE node', () => {
      const ast = parse("CREATE (n:Person {name: 'Alice'}) RETURN n");

      expect(ast.create).toBeDefined();
      expect(ast.create!.patterns).toHaveLength(1);

      const segments = getSegments(ast.create!.patterns[0]);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe('NodePattern');

      const node = segments[0] as any;
      expect(node.variable).toBe('n');
      expect(node.labels).toEqual(['Person']);
      expect(node.properties).toEqual({ name: 'Alice' });

      expect(ast.return.kind).toBe('Return');
      expect(ast.return.items[0].expression.kind).toBe('Identifier');
    });

    it('parses CREATE edge between matched nodes', () => {
      const ast = parse(
        "MATCH (a:Person) CREATE (a)-[:KNOWS]->(b:Person {name: 'Bob'}) RETURN b",
      );

      expect(ast.matches[0].patterns).toHaveLength(1);

      expect(ast.create).toBeDefined();
      expect(ast.create!.patterns).toHaveLength(1);

      const createSegs = getSegments(ast.create!.patterns[0]);
      expect(createSegs).toHaveLength(3);

      expect(createSegs[1].kind).toBe('EdgePattern');
      expect((createSegs[1] as any).types).toEqual(['KNOWS']);
      expect((createSegs[1] as any).direction).toBe('out');

      const targetNode = createSegs[2] as any;
      expect(targetNode.labels).toEqual(['Person']);
      expect(targetNode.properties).toEqual({ name: 'Bob' });

      expect(ast.return.kind).toBe('Return');
    });

    it('parses SET property', () => {
      const ast = parse('MATCH (n:Person) SET n.age = 30 RETURN n');

      expect(ast.set).toBeDefined();
      expect(ast.set!.kind).toBe('Set');
      expect(ast.set!.items).toHaveLength(1);

      const item = ast.set!.items[0];
      expect(item.kind).toBe('SetItem');
      expect((item.variable as any).kind).toBe('Identifier');
      expect((item.variable as any).name).toBe('n');
      expect(item.property).toBe('age');
      expect((item.value as any).kind).toBe('Literal');
      expect((item.value as any).value).toBe(30);

      expect(ast.return.kind).toBe('Return');
    });

    it('parses SET map replace', () => {
      const ast = parse('MATCH (n:Person) SET n = { age: 30 } RETURN n');

      expect(ast.set).toBeDefined();
      expect(ast.set!.kind).toBe('Set');
      expect(ast.set!.items).toHaveLength(1);

      const item = ast.set!.items[0];
      expect(item.kind).toBe('SetItem');
      expect((item.variable as any).kind).toBe('Identifier');
      expect(item.property).toBeUndefined();
      expect(item.operator).toBe('=');
      expect(item.value.kind).toBe('Map');

      expect(ast.return.kind).toBe('Return');
    });

    it('parses SET map mutate', () => {
      const ast = parse('MATCH (n:Person) SET n += { age: 30 } RETURN n');

      expect(ast.set).toBeDefined();
      expect(ast.set!.kind).toBe('Set');
      expect(ast.set!.items).toHaveLength(1);

      const item = ast.set!.items[0];
      expect(item.kind).toBe('SetItem');
      expect((item.variable as any).kind).toBe('Identifier');
      expect(item.property).toBeUndefined();
      expect(item.operator).toBe('+=');
      expect(item.value.kind).toBe('Map');

      expect(ast.return.kind).toBe('Return');
    });

    it('parses DELETE node', () => {
      const ast = parse('MATCH (n:Person) DELETE n RETURN 1');

      expect(ast.delete).toBeDefined();
      expect(ast.delete!.kind).toBe('Delete');
      expect(ast.delete!.detach).toBe(false);
      expect(ast.delete!.variables).toEqual(['n']);
      expect(ast.return.kind).toBe('Return');
    });

    it('parses DETACH DELETE', () => {
      const ast = parse('MATCH (n:Person) DETACH DELETE n RETURN 1');

      expect(ast.delete).toBeDefined();
      expect(ast.delete!.kind).toBe('Delete');
      expect(ast.delete!.detach).toBe(true);
      expect(ast.delete!.variables).toEqual(['n']);
      expect(ast.return.kind).toBe('Return');
    });

    it('parses REMOVE property', () => {
      const ast = parse('MATCH (n:Person) REMOVE n.age RETURN n');

      expect(ast.remove).toBeDefined();
      expect(ast.remove!.kind).toBe('Remove');
      expect(ast.remove!.items).toHaveLength(1);

      const item = ast.remove!.items[0];
      expect(item.kind).toBe('RemoveItem');
      expect(item.variable.kind).toBe('Identifier');
      expect(item.variable.name).toBe('n');
      expect(item.property).toBe('age');

      expect(ast.return.kind).toBe('Return');
    });

    it('parses combined read-write query', () => {
      const ast = parse(
        'MATCH (a), (b) CREATE (a)-[:FRIEND]->(b) SET a.updated = true RETURN a, b',
      );

      expect(ast.matches[0].patterns).toHaveLength(2);
      expect(ast.create).toBeDefined();
      expect(ast.set).toBeDefined();
      expect(ast.set!.items[0].property).toBe('updated');
      expect((ast.set!.items[0].value as any).value).toBe(true);
      expect(ast.return.items).toHaveLength(2);
    });

    it('parses WHERE before SET (standard Cypher order)', () => {
      const ast = parse(
        "MATCH (n:Person) WHERE n.age > 30 SET n.age = 40 RETURN n",
      );

      expect(ast.matches[0].patterns).toHaveLength(1);
      expect(ast.matches[0].where).toBeDefined();
      expect(ast.matches[0].where!.kind).toBe('Where');
      expect(ast.matches[0].where!.expression.kind).toBe('Binary');

      expect(ast.set).toBeDefined();
      expect(ast.set!.kind).toBe('Set');
      expect(ast.set!.items).toHaveLength(1);
      expect(ast.set!.items[0].property).toBe('age');
      expect((ast.set!.items[0].value as any).value).toBe(40);

      expect(ast.return.items).toHaveLength(1);
    });

    it('parses standalone CREATE (no MATCH)', () => {
      const ast = parse('CREATE (n) RETURN n');

      expect(ast.matches).toHaveLength(0);
      expect(ast.create).toBeDefined();
      expect(ast.create!.patterns).toHaveLength(1);

      const segs = getSegments(ast.create!.patterns[0]);
      expect(segs).toHaveLength(1);
      expect(segs[0].kind).toBe('NodePattern');

      expect(ast.return.items).toHaveLength(1);
    });

    it('throws on DELETE with non-variable (integer)', () => {
      expect(() => parse('DELETE 42')).toThrow(CypherSyntaxError);
    });

    it('throws on SET with missing equals', () => {
      expect(() => parse('MATCH (n) SET n.prop')).toThrow(CypherSyntaxError);
    });
  });

  // ── HAVING clause ───────────────────────────────────────────────
  describe('HAVING clause', () => {
    it('parses HAVING with alias reference', () => {
      const ast = parse('MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt HAVING cnt > 5');
      expect(ast.having).toBeDefined();
      expect(ast.having!.kind).toBe('Having');
      expect(ast.having!.expression.kind).toBe('Binary');
      const bin = ast.having!.expression as any;
      expect(bin.op).toBe('>');
      expect(bin.left.kind).toBe('Identifier');
      expect(bin.left.name).toBe('cnt');
      expect(bin.right.kind).toBe('Literal');
      expect(bin.right.value).toBe(5);
    });

    it('parses HAVING with aggregate function', () => {
      const ast = parse('MATCH (p:Person) RETURN COUNT(*) AS cnt HAVING COUNT(*) > 5');
      expect(ast.having).toBeDefined();
      expect(ast.having!.kind).toBe('Having');
      expect(ast.having!.expression.kind).toBe('Binary');
      const bin = ast.having!.expression as any;
      expect(bin.left.kind).toBe('FunctionCall');
    });

    it('parses HAVING without aggregates (valid per spec)', () => {
      const ast = parse("MATCH (p:Person) RETURN p.name HAVING p.name = 'Alice'");
      expect(ast.having).toBeDefined();
      expect(ast.having!.expression.kind).toBe('Binary');
    });

    it('parses HAVING before ORDER BY', () => {
      const ast = parse('MATCH (p:Person) RETURN p.city, COUNT(*) AS cnt HAVING cnt > 5 ORDER BY cnt');
      expect(ast.having).toBeDefined();
      expect(ast.orderBy).toBeDefined();
    });
  });

  // ── Index DDL statements ──────────────────────────────────────────
  describe('index DDL statements', () => {
    it('parses CREATE INDEX for node with single property', () => {
      const ast = parse('CREATE INDEX email_idx FOR (n:Person) ON (n.email)');
      expect(ast.createIndex).toBeDefined();
      expect(ast.createIndex!.kind).toBe('CreateIndex');
      expect(ast.createIndex!.name).toBe('email_idx');
      expect(ast.createIndex!.variable).toBe('n');
      expect(ast.createIndex!.target).toBe('node');
      expect(ast.createIndex!.labelOrType).toBe('Person');
      expect(ast.createIndex!.propertyKeys).toEqual(['email']);
    });

    it('parses CREATE INDEX for node with compound properties', () => {
      const ast = parse('CREATE INDEX name_email_idx FOR (n:Person) ON (n.name, n.email)');
      expect(ast.createIndex).toBeDefined();
      expect(ast.createIndex!.name).toBe('name_email_idx');
      expect(ast.createIndex!.target).toBe('node');
      expect(ast.createIndex!.labelOrType).toBe('Person');
      expect(ast.createIndex!.propertyKeys).toEqual(['name', 'email']);
    });

    it('parses CREATE INDEX for edge', () => {
      const ast = parse('CREATE INDEX since_idx FOR ()-[r:KNOWS]-() ON (r.since)');
      expect(ast.createIndex).toBeDefined();
      expect(ast.createIndex!.kind).toBe('CreateIndex');
      expect(ast.createIndex!.name).toBe('since_idx');
      expect(ast.createIndex!.variable).toBe('r');
      expect(ast.createIndex!.target).toBe('edge');
      expect(ast.createIndex!.labelOrType).toBe('KNOWS');
      expect(ast.createIndex!.propertyKeys).toEqual(['since']);
    });

    it('parses DROP INDEX', () => {
      const ast = parse('DROP INDEX email_idx');
      expect(ast.dropIndex).toBeDefined();
      expect(ast.dropIndex!.kind).toBe('DropIndex');
      expect(ast.dropIndex!.name).toBe('email_idx');
    });

    it('parses SHOW INDEXES', () => {
      const ast = parse('SHOW INDEXES');
      expect(ast.showIndexes).toBeDefined();
      expect(ast.showIndexes!.kind).toBe('ShowIndexes');
      expect(ast.return.items).toHaveLength(3);
      expect(ast.return.items[0].alias).toBe('name');
      expect(ast.return.items[1].alias).toBe('target');
      expect(ast.return.items[2].alias).toBe('propertyKeys');
    });

    it('rejects CREATE INDEX with missing name', () => {
      expect(() => parse('CREATE INDEX FOR (n:P) ON (n.name)'))
        .toThrow(CypherSyntaxError);
    });

    it('rejects DROP INDEX with missing name', () => {
      expect(() => parse('DROP INDEX'))
        .toThrow(CypherSyntaxError);
    });

    it('rejects CREATE INDEX with missing ON clause', () => {
      expect(() => parse('CREATE INDEX idx FOR (n:P)'))
        .toThrow(CypherSyntaxError);
    });

    it('rejects CREATE INDEX with variable mismatch in ON', () => {
      expect(() => parse('CREATE INDEX idx FOR (n:P) ON (x.name)'))
        .toThrow(CypherSyntaxError);
    });

    it('rejects SHOW INDEXES with trailing tokens', () => {
      expect(() => parse('SHOW INDEXES extra'))
        .toThrow(CypherSyntaxError);
    });

    it('rejects CREATE INDEX with zero properties', () => {
      // The parser requires at least one property; () is an empty paren pair, not a property list
      expect(() => parse('CREATE INDEX idx FOR (n:P) ON ()'))
        .toThrow(CypherSyntaxError);
    });
  });

  // ── OPTIONAL MATCH ─────────────────────────────────────────────
  describe('OPTIONAL MATCH', () => {
    it('parses OPTIONAL MATCH as optional', () => {
      const ast = parse('MATCH (a:Person) OPTIONAL MATCH (a)-[:KNOWS]->(b) RETURN a, b');
      expect(ast.matches).toHaveLength(2);
      expect(ast.matches[0].optional).toBe(false);
      expect(ast.matches[0].patterns).toHaveLength(1);
      expect(ast.matches[1].optional).toBe(true);
      expect(ast.matches[1].patterns).toHaveLength(1);
    });

    it('parses OPTIONAL MATCH with WHERE', () => {
      const ast = parse('MATCH (a:Person) OPTIONAL MATCH (a)-[:KNOWS]->(b) WHERE b.age > 18 RETURN a, b');
      expect(ast.matches).toHaveLength(2);
      expect(ast.matches[0].optional).toBe(false);
      expect(ast.matches[0].where).toBeUndefined();
      expect(ast.matches[1].optional).toBe(true);
      expect(ast.matches[1].where).toBeDefined();
      expect(ast.matches[1].where!.expression.kind).toBe('Binary');
    });

    it('parses multiple OPTIONAL MATCH clauses', () => {
      const ast = parse(
        'MATCH (a:Person) OPTIONAL MATCH (a)-[:KNOWS]->(b) OPTIONAL MATCH (a)-[:LIVES_IN]->(c) RETURN a, b, c',
      );
      expect(ast.matches).toHaveLength(3);
      expect(ast.matches[0].optional).toBe(false);
      expect(ast.matches[1].optional).toBe(true);
      expect(ast.matches[2].optional).toBe(true);
    });

    it('parses regular MATCH with embedded WHERE', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name = 'Alice' RETURN p");
      expect(ast.matches).toHaveLength(1);
      expect(ast.matches[0].optional).toBe(false);
      expect(ast.matches[0].where).toBeDefined();
      expect(ast.matches[0].where!.expression.kind).toBe('Binary');
    });
  });
});
