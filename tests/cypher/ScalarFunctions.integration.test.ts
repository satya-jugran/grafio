/**
 * Integration tests for standard openCypher scalar functions in {@link CypherEngine}.
 *
 * Covers both synchronous (`executeSync`) and async (`execute`) execution paths,
 * aggregate composition, scalar GROUP BY keys, PlanCache behavior, and error cases.
 *
 * @module tests/cypher/ScalarFunctions.integration.test
 */
import { describe, expect, it } from '@jest/globals';
import { Graph } from '../../src/Graph';
import { CypherEngine, CypherRuntimeError } from '../../src/cypher';

function buildTestGraph(): { graph: Graph; engine: CypherEngine } {
  const graph = new Graph();
  const engine = new CypherEngine(graph);
  engine.executeSync(`
    CREATE
      (a:Person { name: '  Alice  ', city: 'NYC', age: 28, score: 12.345, active: true }),
      (b:Person { name: 'Bob', city: 'nyc', age: 25, score: -4.7, active: false }),
      (c:Person { name: 'Charlie', city: 'LA', age: 32 }),
      (a)-[:KNOWS { weight: 1.5, tag: 'close' }]->(b),
      (b)-[:KNOWS { weight: 2.0 }]->(c)
  `);
  return { graph, engine };
}

describe('Cypher scalar functions', () => {
  describe('coalesce()', () => {
    it('returns the first non-null value and short-circuits lazily', async () => {
      const { engine } = buildTestGraph();

      const syncRes = engine.executeSync(
        "RETURN coalesce(null, null, 'ok', 1 / 0) AS v",
      );
      expect(syncRes.rows[0].v).toBe('ok');

      const asyncRes = await engine.execute(
        'MATCH (p:Person) RETURN p.name AS n, coalesce(p.score, 0) AS s ORDER BY n',
      );
      expect(asyncRes.rows.find((r) => r.n === 'Charlie')?.s).toBe(0);
    });

    it('returns null when all arguments are null', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync('RETURN coalesce(null, null) AS v');
      expect(res.rows[0].v).toBeNull();
    });

    it('throws on zero arguments', () => {
      const { engine } = buildTestGraph();
      expect(() => engine.executeSync('RETURN coalesce() AS v')).toThrow(CypherRuntimeError);
    });
  });

  describe('string functions and size(string)', () => {
    it('supports toLower, lower, toUpper, upper, trim, lTrim, rTrim', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          toLower('HeLLo') AS tl,
          lower('HeLLo') AS l,
          toUpper('HeLLo') AS tu,
          upper('HeLLo') AS u,
          trim('  hi  ') AS tr,
          lTrim('  hi  ') AS lt,
          rTrim('  hi  ') AS rt
      `);
      expect(res.rows[0]).toEqual({
        tl: 'hello',
        l: 'hello',
        tu: 'HELLO',
        u: 'HELLO',
        tr: 'hi',
        lt: 'hi  ',
        rt: '  hi',
      });
    });

    it('supports substring() with 2-arg and 3-arg length semantics', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          substring('hello world', 6) AS rest,
          substring('hello world', 2, 3) AS mid,
          substring('hello', 10, 5) AS oob
      `);
      expect(res.rows[0]).toEqual({
        rest: 'world',
        mid: 'llo',
        oob: '',
      });

      expect(() => engine.executeSync("RETURN substring('hello', -1) AS bad")).toThrow(
        CypherRuntimeError,
      );
    });

    it('supports replace() globally and split()', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          replace('foo-bar-foo', 'foo', 'baz') AS rep,
          split('a,b,c', ',') AS parts
      `);
      expect(res.rows[0]).toEqual({
        rep: 'baz-bar-baz',
        parts: ['a', 'b', 'c'],
      });
    });

    it('extends size() to strings alongside lists and null', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          size('grafio') AS strLen,
          size([1, 2, 3, 4]) AS listLen,
          size(null) AS nullLen
      `);
      expect(res.rows[0]).toEqual({
        strLen: 6,
        listLen: 4,
        nullLen: null,
      });
    });

    it('propagates null for string functions', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          toLower(null) AS a,
          replace(null, 'a', 'b') AS b,
          split('a,b', null) AS c,
          substring(null, 0, 2) AS d
      `);
      expect(res.rows[0]).toEqual({ a: null, b: null, c: null, d: null });
    });
  });

  describe('type cast functions', () => {
    it('supports toString()', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN toString(42) AS a, toString(true) AS b, toString('x') AS c, toString(null) AS d
      `);
      expect(res.rows[0]).toEqual({ a: '42', b: 'true', c: 'x', d: null });
      expect(() => engine.executeSync('RETURN toString([1, 2]) AS bad')).toThrow(
        CypherRuntimeError,
      );
    });

    it('supports toInteger() and toInt() with openCypher null-on-invalid-string', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          toInteger(3.9) AS a,
          toInt(-3.9) AS b,
          toInteger(' 42 ') AS c,
          toInteger('-0') AS d,
          toInteger(true) AS e,
          toInteger('') AS f,
          toInteger('abc') AS g,
          toInteger(null) AS h
      `);
      expect(res.rows[0]).toEqual({
        a: 3,
        b: -3,
        c: 42,
        d: 0,
        e: 1,
        f: null,
        g: null,
        h: null,
      });
      expect(Object.is(res.rows[0].d, -0)).toBe(false);
      expect(() => engine.executeSync('RETURN toInteger([1]) AS bad')).toThrow(
        CypherRuntimeError,
      );
    });

    it('supports toFloat()', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          toFloat(5) AS a,
          toFloat(' 3.14 ') AS b,
          toFloat('1e2') AS c,
          toFloat('') AS d,
          toFloat('nope') AS e,
          toFloat(null) AS f
      `);
      expect(res.rows[0]).toEqual({
        a: 5,
        b: 3.14,
        c: 100,
        d: null,
        e: null,
        f: null,
      });
      expect(() => engine.executeSync('RETURN toFloat(true) AS bad')).toThrow(
        CypherRuntimeError,
      );
    });

    it('supports toBoolean()', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          toBoolean(true) AS a,
          toBoolean(' TRUE ') AS b,
          toBoolean('false') AS c,
          toBoolean('maybe') AS d,
          toBoolean(0) AS e,
          toBoolean(5) AS f,
          toBoolean(null) AS g
      `);
      expect(res.rows[0]).toEqual({
        a: true,
        b: true,
        c: false,
        d: null,
        e: false,
        f: true,
        g: null,
      });
    });
  });

  describe('collections, maps, and path length()', () => {
    it('supports keys() and properties() on nodes, edges, and maps', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        MATCH (a:Person { city: 'LA' })<-[r:KNOWS]-(b:Person)
        RETURN
          keys(a) AS nodeKeys,
          properties(a) AS nodeProps,
          keys(r) AS edgeKeys,
          properties(r) AS edgeProps,
          keys({ x: 1, y: 2 }) AS mapKeys,
          properties({ x: 1, y: 2 }) AS mapProps
      `);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].nodeKeys).toEqual(expect.arrayContaining(['name', 'city', 'age']));
      expect(res.rows[0].nodeProps).toEqual({ name: 'Charlie', city: 'LA', age: 32 });
      expect(res.rows[0].edgeKeys).toEqual(['weight']);
      expect(res.rows[0].edgeProps).toEqual({ weight: 2.0 });
      expect(res.rows[0].mapKeys).toEqual(['x', 'y']);
      expect(res.rows[0].mapProps).toEqual({ x: 1, y: 2 });
    });

    it('supports head(), last(), and tail() including empty lists', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          head([10, 20, 30]) AS h,
          last([10, 20, 30]) AS l,
          tail([10, 20, 30]) AS t,
          head([]) AS eh,
          last([]) AS el,
          tail([]) AS et
      `);
      expect(res.rows[0]).toEqual({
        h: 10,
        l: 30,
        t: [20, 30],
        eh: null,
        el: null,
        et: [],
      });
    });

    it('supports range() ascending, descending, empty, and rejects step = 0', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          range(1, 5) AS asc1,
          range(0, 6, 2) AS asc2,
          range(5, 1, -2) AS desc1,
          range(5, 1) AS empty1
      `);
      expect(res.rows[0]).toEqual({
        asc1: [1, 2, 3, 4, 5],
        asc2: [0, 2, 4, 6],
        desc1: [5, 3, 1],
        empty1: [],
      });
      expect(() => engine.executeSync('RETURN range(1, 5, 0) AS bad')).toThrow(
        CypherRuntimeError,
      );
    });

    it('supports length(path) on 1-hop and multi-hop paths', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        MATCH p = (a:Person { city: 'NYC' })-[:KNOWS*1..2]->(b:Person)
        RETURN length(p) AS hops ORDER BY hops ASC
      `);
      expect(res.rows.map((r) => r.hops)).toEqual([1, 2]);
    });
  });

  describe('math functions and timestamp()', () => {
    it('supports abs, ceil, floor, round (1 & 2 args), and sqrt', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          abs(-7.5) AS a,
          ceil(2.1) AS c,
          floor(-2.1) AS f,
          round(3.6) AS r1,
          round(12.345, 2) AS r2,
          sqrt(16) AS s1,
          sqrt(-1) AS sNeg
      `);
      expect(res.rows[0]).toEqual({
        a: 7.5,
        c: 3,
        f: -3,
        r1: 4,
        r2: 12.35,
        s1: 4,
        sNeg: null,
      });
    });

    it('evaluates timestamp() freshly across PlanCache hits', async () => {
      const { engine } = buildTestGraph();
      const q = 'RETURN timestamp() AS ts';
      const first = engine.executeSync(q).rows[0].ts as number;
      await new Promise((resolve) => setTimeout(resolve, 15));
      const second = engine.executeSync(q).rows[0].ts as number;
      expect(typeof first).toBe('number');
      expect(second).toBeGreaterThan(first);
    });
  });

  describe('aggregate composition, grouping keys, and DISTINCT guard', () => {
    it('rewrites aggregates nested inside scalar functions', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        MATCH (p:Person)
        RETURN
          coalesce(SUM(p.missing), 0) AS fallbackSum,
          round(AVG(p.age), 1) AS avgAge
      `);
      expect(res.rows[0]).toEqual({
        fallbackSum: 0,
        avgAge: 28.3,
      });
    });

    it('supports scalar functions as GROUP BY keys', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        MATCH (p:Person)
        RETURN toLower(p.city) AS city, COUNT(p) AS cnt
        ORDER BY city ASC
      `);
      expect(res.rows).toEqual([
        { city: 'la', cnt: 1 },
        { city: 'nyc', cnt: 2 },
      ]);
    });

    it('rejects DISTINCT on scalar functions', () => {
      const { engine } = buildTestGraph();
      expect(() =>
        engine.executeSync('MATCH (p:Person) RETURN toLower(DISTINCT p.city) AS c'),
      ).toThrow(/DISTINCT is only supported on aggregate functions/);
    });
  });

  describe('regex =~ operator with inline flags and caching', () => {
    it('supports leading (?i), (?im), (?s), and repeated flag deduplication', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          'Alice' =~ '(?i)alice' AS ciExact,
          'ALICE' =~ '(?i).*lic.*' AS ciWildcard,
          'a\\nb' =~ '(?s)a.b' AS dotall,
          'a\\nB' =~ '(?i)(?s)a.b' AS combined,
          'Alice' =~ '(?ii)alice' AS dedupFlags
      `);
      expect(res.rows[0]).toEqual({
        ciExact: true,
        ciWildcard: true,
        dotall: true,
        combined: true,
        dedupFlags: true,
      });
    });

    it('anchors full string across top-level alternations', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          'Alice' =~ 'Alice|Bob' AS matchFirst,
          'Bob' =~ 'Alice|Bob' AS matchSecond,
          'AliceX' =~ 'Alice|Bob' AS partialPrefix,
          'XBob' =~ 'Alice|Bob' AS partialSuffix
      `);
      expect(res.rows[0]).toEqual({
        matchFirst: true,
        matchSecond: true,
        partialPrefix: false,
        partialSuffix: false,
      });
    });

    it('supports parameterized regex patterns with 1-slot caching', () => {
      const { engine } = buildTestGraph();
      const q = 'MATCH (p:Person) WHERE trim(p.name) =~ $pat RETURN trim(p.name) AS name ORDER BY name';

      const r1 = engine.executeSync(q, { pat: '(?i)alice|bob' });
      expect(r1.rows.map((r) => r.name)).toEqual(['Alice', 'Bob']);

      const r2 = engine.executeSync(q, { pat: '(?i)char.*' });
      expect(r2.rows.map((r) => r.name)).toEqual(['Charlie']);
    });

    it('preserves openCypher null semantics and throws on invalid regex', () => {
      const { engine } = buildTestGraph();
      const res = engine.executeSync(`
        RETURN
          null =~ '(?i)a' AS leftNull,
          'a' =~ null AS rightNull,
          null =~ '[' AS nullWithInvalid
      `);
      expect(res.rows[0]).toEqual({
        leftNull: null,
        rightNull: null,
        nullWithInvalid: null,
      });
      expect(() => engine.executeSync("RETURN 'a' =~ '[' AS bad")).toThrow(CypherRuntimeError);
    });
  });
});
