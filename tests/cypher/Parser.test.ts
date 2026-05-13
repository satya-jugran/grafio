import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Lexer } from '../../src/cypher/Lexer';
import { Parser } from '../../src/cypher/Parser';
import { CypherSyntaxError } from '../../src/cypher/errors';
import { TokenKind } from '../../src/cypher/Token';

/** Helper: lex + parse in one call. */
function parse(query: string) {
  const tokens = new Lexer(query).tokenise();
  return new Parser(tokens).parse();
}

describe('Parser', () => {
  // ── Simple queries ─────────────────────────────────────────────
  describe('simple queries', () => {
    it('parses MATCH (n) RETURN n', () => {
      const ast = parse('MATCH (n) RETURN n');

      expect(ast.kind).toBe('Query');
      expect(ast.match.kind).toBe('Match');
      expect(ast.match.patterns).toHaveLength(1);

      const path = ast.match.patterns[0];
      expect(path.segments).toHaveLength(1);
      expect(path.segments[0].kind).toBe('NodePattern');
      expect((path.segments[0] as any).variable).toBe('n');

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
      const node = ast.match.patterns[0].segments[0];
      expect(node.kind).toBe('NodePattern');
      expect((node as any).labels).toEqual(['Person']);
    });

    it('parses (n:Person|Employee) multi-label', () => {
      const ast = parse('MATCH (n:Person|Employee) RETURN n');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).labels).toEqual(['Person', 'Employee']);
    });

    it('parses anonymous node (:Person)', () => {
      const ast = parse('MATCH (:Person) RETURN 1');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).variable).toBeUndefined();
      expect((node as any).labels).toEqual(['Person']);
    });
  });

  // ── Inline properties ──────────────────────────────────────────
  describe('inline properties', () => {
    it('parses node with inline properties', () => {
      const ast = parse("MATCH (n:Person {name: 'Alice', age: 30}) RETURN n");
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).properties).toEqual({ name: 'Alice', age: 30 });
    });

    it('parses inline properties with param', () => {
      const ast = parse('MATCH (n {name: $name}) RETURN n');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).properties.name).toEqual({ kind: 'Parameter', name: 'name' });
    });

    it('parses float property value', () => {
      const ast = parse('MATCH (n {score: 3.14}) RETURN n');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).properties.score).toBe(3.14);
    });

    it('parses boolean property value (true)', () => {
      const ast = parse('MATCH (n {active: true}) RETURN n');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).properties.active).toBe(true);
    });

    it('parses boolean property value (false)', () => {
      const ast = parse('MATCH (n {active: false}) RETURN n');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).properties.active).toBe(false);
    });

    it('parses null property value', () => {
      const ast = parse('MATCH (n {email: null}) RETURN n');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).properties.email).toBeNull();
    });

    it('parses negative integer property value', () => {
      const ast = parse('MATCH (n {score: -5}) RETURN n');
      const node = ast.match.patterns[0].segments[0];
      expect((node as any).properties.score).toBe(-5);
    });

    it('parses negative float property value', () => {
      const ast = parse('MATCH (n {score: -3.14}) RETURN n');
      const node = ast.match.patterns[0].segments[0];
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
      const path = ast.match.patterns[0];
      expect(path.segments).toHaveLength(3);

      const edge = path.segments[1];
      expect(edge.kind).toBe('EdgePattern');
      expect((edge as any).types).toEqual(['KNOWS']);
      expect((edge as any).direction).toBe('out');
    });

    it('parses reverse edge <--', () => {
      const ast = parse('MATCH (a)<-[:KNOWS]-(b) RETURN b');
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).direction).toBe('in');
    });

    it('parses edge with variable', () => {
      const ast = parse('MATCH (a)-[r:KNOWS]->(b) RETURN r');
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).variable).toBe('r');
    });

    it('parses edge without type', () => {
      const ast = parse('MATCH (a)-[]->(b) RETURN b');
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).types).toEqual([]);
    });

    it('parses edge with inline properties', () => {
      const ast = parse("MATCH (a)-[:KNOWS {since: 2020}]->(b) RETURN b");
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).properties).toEqual({ since: 2020 });
    });
  });

  // ── Variable-length edges ──────────────────────────────────────
  describe('variable-length edges', () => {
    it('parses [*] (unbounded)', () => {
      const ast = parse('MATCH (a)-[*]->(b) RETURN b');
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).minHops).toBe(1);
      expect((edge as any).maxHops).toBe(Infinity);
    });

    it('parses [*1..3]', () => {
      const ast = parse('MATCH (a)-[*1..3]->(b) RETURN b');
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).minHops).toBe(1);
      expect((edge as any).maxHops).toBe(3);
    });

    it('parses [*3] (exact)', () => {
      const ast = parse('MATCH (a)-[*3]->(b) RETURN b');
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).minHops).toBe(3);
      expect((edge as any).maxHops).toBe(3);
    });

    it('parses [*..5]', () => {
      const ast = parse('MATCH (a)-[*..5]->(b) RETURN b');
      const edge = ast.match.patterns[0].segments[1];
      expect((edge as any).minHops).toBe(1);
      expect((edge as any).maxHops).toBe(5);
    });
  });

  // ── WHERE clause ───────────────────────────────────────────────
  describe('WHERE clause', () => {
    it('parses WHERE with comparison', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name = 'Alice' RETURN p");
      expect(ast.where).toBeDefined();
      expect(ast.where!.expression.kind).toBe('Binary');
    });

    it('parses WHERE with AND', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name = 'Alice' AND p.age > 18 RETURN p");
      expect(ast.where!.expression.kind).toBe('Binary');
      expect((ast.where!.expression as any).op).toBe('AND');
    });

    it('parses WHERE with OR', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name = 'Alice' OR p.name = 'Bob' RETURN p");
      expect((ast.where!.expression as any).op).toBe('OR');
    });

    it('parses WHERE with NOT', () => {
      const ast = parse("MATCH (p:Person) WHERE NOT p.active RETURN p");
      expect(ast.where!.expression.kind).toBe('Unary');
    });

    it('parses WHERE with IS NULL', () => {
      const ast = parse('MATCH (p:Person) WHERE p.email IS NULL RETURN p');
      expect(ast.where!.expression.kind).toBe('IsNull');
    });

    it('parses WHERE with IS NOT NULL', () => {
      const ast = parse('MATCH (p:Person) WHERE p.email IS NOT NULL RETURN p');
      const expr = ast.where!.expression;
      expect(expr.kind).toBe('IsNull');
      expect((expr as any).not).toBe(true);
    });

    it('parses WHERE with IN', () => {
      const ast = parse("MATCH (p:Person) WHERE p.role IN ['admin', 'mod'] RETURN p");
      expect(ast.where!.expression.kind).toBe('In');
    });

    it('parses WHERE with NOT IN', () => {
      const ast = parse("MATCH (p:Person) WHERE p.name NOT IN ['Alice', 'Bob'] RETURN p");
      const expr = ast.where!.expression;
      expect(expr.kind).toBe('In');
      expect((expr as any).not).toBe(true);
    });

    it('parses WHERE with param', () => {
      const ast = parse('MATCH (p:Person) WHERE p.name = $name RETURN p');
      const bin = ast.where!.expression;
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
      expect(ast.match.patterns).toHaveLength(2);
    });

    it('parses multi-hop path', () => {
      const ast = parse('MATCH (a:Person)-[:KNOWS]->(b:Person)-[:WORKS_AT]->(c:Company) RETURN c');
      const path = ast.match.patterns[0];
      expect(path.segments).toHaveLength(5); // N-E-N-E-N
    });
  });

  // ── Syntax errors ──────────────────────────────────────────────
  describe('syntax errors', () => {
    it('throws on empty query', () => {
      expect(() => parse('')).toThrow(CypherSyntaxError);
    });

    it('throws on missing MATCH', () => {
      expect(() => parse('RETURN n')).toThrow(CypherSyntaxError);
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
      const expr = ast.where!.expression;
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
});
