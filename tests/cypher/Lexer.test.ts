import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Lexer } from '../../src/cypher/Lexer';
import { TokenKind } from '../../src/cypher/Token';
import { CypherSyntaxError } from '../../src/cypher/errors';

describe('Lexer', () => {
  // ── Keywords ───────────────────────────────────────────────────
  describe('keywords (case-insensitive)', () => {
    it('tokenises MATCH', () => {
      const tokens = new Lexer('MATCH').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.MATCH);
    });

    it('tokenises match (lowercase)', () => {
      const tokens = new Lexer('match').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.MATCH);
    });

    it('tokenises Where (mixed case)', () => {
      const tokens = new Lexer('Where').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.WHERE);
    });

    it('tokenises RETURN', () => {
      const tokens = new Lexer('RETURN').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.RETURN);
    });

    it('tokenises ORDER BY', () => {
      const tokens = new Lexer('ORDER BY').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.ORDER);
      expect(tokens[1].kind).toBe(TokenKind.BY);
    });

    it('tokenises SKIP', () => {
      const tokens = new Lexer('SKIP').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.SKIP);
    });

    it('tokenises LIMIT', () => {
      const tokens = new Lexer('LIMIT').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.LIMIT);
    });

    it('tokenises AS', () => {
      const tokens = new Lexer('AS').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.AS);
    });

    it('tokenises DISTINCT', () => {
      const tokens = new Lexer('DISTINCT').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.DISTINCT);
    });

    it('tokenises AND', () => {
      const tokens = new Lexer('AND').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.AND);
    });

    it('tokenises OR', () => {
      const tokens = new Lexer('OR').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.OR);
    });

    it('tokenises NOT', () => {
      const tokens = new Lexer('NOT').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.NOT);
    });

    it('tokenises IS NULL', () => {
      const tokens = new Lexer('IS NULL').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.IS);
      expect(tokens[1].kind).toBe(TokenKind.NULL);
    });

    it('tokenises IN', () => {
      const tokens = new Lexer('IN').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.IN);
    });

    it('tokenises ASC', () => {
      const tokens = new Lexer('ASC').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.ASC);
    });

    it('tokenises DESC', () => {
      const tokens = new Lexer('DESC').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.DESC);
    });

    it('tokenises true / false as BOOLEAN', () => {
      const t = new Lexer('true false').tokenise();
      expect(t[0].kind).toBe(TokenKind.BOOLEAN);
      expect(t[0].value).toBe('true');
      expect(t[1].kind).toBe(TokenKind.BOOLEAN);
      expect(t[1].value).toBe('false');
    });
  });

  // ── Future keywords (tokenised but gated) ──────────────────────
  describe('future keywords', () => {
    it('tokenises CREATE', () => {
      const tokens = new Lexer('CREATE').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.CREATE);
    });

    it('tokenises COUNT', () => {
      const tokens = new Lexer('COUNT').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.COUNT);
    });

    it('tokenises WITH', () => {
      const tokens = new Lexer('WITH').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.WITH);
    });
  });

  // ── Literals ───────────────────────────────────────────────────
  describe('literals', () => {
    it('tokenises integer', () => {
      const t = new Lexer('42').tokenise();
      expect(t[0].kind).toBe(TokenKind.INTEGER);
      expect(t[0].value).toBe('42');
    });

    it('tokenises float', () => {
      const t = new Lexer('3.14').tokenise();
      expect(t[0].kind).toBe(TokenKind.FLOAT);
      expect(t[0].value).toBe('3.14');
    });

    it('tokenises double-quoted string', () => {
      const t = new Lexer('"hello world"').tokenise();
      expect(t[0].kind).toBe(TokenKind.STRING);
      expect(t[0].value).toBe('hello world');
    });

    it('tokenises single-quoted string', () => {
      const t = new Lexer("'hello'").tokenise();
      expect(t[0].kind).toBe(TokenKind.STRING);
      expect(t[0].value).toBe('hello');
    });

    it('handles string escape sequences', () => {
      const t = new Lexer('"line\\nline\\ttab\\\\back"').tokenise();
      expect(t[0].value).toBe('line\nline\ttab\\back');
    });

    it('throws on unterminated string', () => {
      expect(() => new Lexer('"unclosed').tokenise()).toThrow(CypherSyntaxError);
    });

    it('throws on newline in string', () => {
      expect(() => new Lexer('"line\nbreak"').tokenise()).toThrow(CypherSyntaxError);
    });
  });

  // ── Parameters ─────────────────────────────────────────────────
  describe('parameters', () => {
    it('tokenises $param', () => {
      const t = new Lexer('$name').tokenise();
      expect(t[0].kind).toBe(TokenKind.PARAM);
      expect(t[0].value).toBe('name');
    });

    it('tokenises $param with underscores', () => {
      const t = new Lexer('$my_param_1').tokenise();
      expect(t[0].kind).toBe(TokenKind.PARAM);
      expect(t[0].value).toBe('my_param_1');
    });

    it('throws on $ followed by non-alpha', () => {
      expect(() => new Lexer('$123').tokenise()).toThrow(CypherSyntaxError);
    });
  });

  // ── Identifiers ────────────────────────────────────────────────
  describe('identifiers', () => {
    it('tokenises simple identifier', () => {
      const t = new Lexer('person').tokenise();
      expect(t[0].kind).toBe(TokenKind.IDENT);
      expect(t[0].value).toBe('person');
    });

    it('tokenises snake_case identifier', () => {
      const t = new Lexer('node_id').tokenise();
      expect(t[0].kind).toBe(TokenKind.IDENT);
    });
  });

  // ── Punctuation ────────────────────────────────────────────────
  describe('punctuation', () => {
    it('tokenises parentheses', () => {
      const t = new Lexer('()').tokenise();
      expect(t[0].kind).toBe(TokenKind.LPAREN);
      expect(t[1].kind).toBe(TokenKind.RPAREN);
    });

    it('tokenises brackets', () => {
      const t = new Lexer('[]').tokenise();
      expect(t[0].kind).toBe(TokenKind.LBRACKET);
      expect(t[1].kind).toBe(TokenKind.RBRACKET);
    });

    it('tokenises braces', () => {
      const t = new Lexer('{}').tokenise();
      expect(t[0].kind).toBe(TokenKind.LBRACE);
      expect(t[1].kind).toBe(TokenKind.RBRACE);
    });

    it('tokenises colon', () => {
      const t = new Lexer(':').tokenise();
      expect(t[0].kind).toBe(TokenKind.COLON);
    });

    it('tokenises comma', () => {
      const t = new Lexer(',').tokenise();
      expect(t[0].kind).toBe(TokenKind.COMMA);
    });

    it('tokenises dot', () => {
      const t = new Lexer('.').tokenise();
      expect(t[0].kind).toBe(TokenKind.DOT);
    });

    it('tokenises pipe', () => {
      const t = new Lexer('|').tokenise();
      expect(t[0].kind).toBe(TokenKind.PIPE);
    });
  });

  // ── Operators ──────────────────────────────────────────────────
  describe('operators', () => {
    it('tokenises -> as ARROW_RIGHT', () => {
      const t = new Lexer('->').tokenise();
      expect(t[0].kind).toBe(TokenKind.ARROW_RIGHT);
    });

    it('tokenises <- as ARROW_LEFT', () => {
      const t = new Lexer('<-').tokenise();
      expect(t[0].kind).toBe(TokenKind.ARROW_LEFT);
    });

    it('tokenises --> as ARROW_RIGHT', () => {
      const t = new Lexer('-->').tokenise();
      expect(t[0].kind).toBe(TokenKind.ARROW_RIGHT);
    });

    it('tokenises <-- as ARROW_LEFT', () => {
      const t = new Lexer('<--').tokenise();
      expect(t[0].kind).toBe(TokenKind.ARROW_LEFT);
    });

    it('tokenises =', () => {
      const t = new Lexer('=').tokenise();
      expect(t[0].kind).toBe(TokenKind.EQ);
    });

    it('tokenises =~', () => {
      const t = new Lexer('=~').tokenise();
      expect(t[0].kind).toBe(TokenKind.REGEX_MATCH);
    });

    it('tokenises <>', () => {
      const t = new Lexer('<>').tokenise();
      expect(t[0].kind).toBe(TokenKind.NEQ);
    });

    it('tokenises !=', () => {
      const t = new Lexer('!=').tokenise();
      expect(t[0].kind).toBe(TokenKind.NEQ);
    });

    it('tokenises <=', () => {
      const t = new Lexer('<=').tokenise();
      expect(t[0].kind).toBe(TokenKind.LTE);
    });

    it('tokenises >=', () => {
      const t = new Lexer('>=').tokenise();
      expect(t[0].kind).toBe(TokenKind.GTE);
    });

    it('tokenises + - * /', () => {
      const t = new Lexer('+ - * /').tokenise();
      expect(t[0].kind).toBe(TokenKind.PLUS);
      expect(t[1].kind).toBe(TokenKind.MINUS);
      expect(t[2].kind).toBe(TokenKind.STAR);
      expect(t[3].kind).toBe(TokenKind.SLASH);
    });

    it('tokenises - as MINUS standalone', () => {
      const t = new Lexer('-').tokenise();
      expect(t[0].kind).toBe(TokenKind.MINUS);
    });
  });

  // ── Comments & whitespace ──────────────────────────────────────
  describe('comments and whitespace', () => {
    it('ignores // line comments', () => {
      const t = new Lexer('MATCH // this is a comment\nRETURN').tokenise();
      expect(t[0].kind).toBe(TokenKind.MATCH);
      expect(t[1].kind).toBe(TokenKind.RETURN);
    });

    it('handles multiline input with correct line numbers', () => {
      const t = new Lexer('MATCH\nRETURN').tokenise();
      expect(t[0].line).toBe(1);
      expect(t[1].line).toBe(2);
    });
  });

  // ── Full query ─────────────────────────────────────────────────
  describe('full query', () => {
    it('tokenises a complete Cypher query', () => {
      const query = `MATCH (p:Person)-[:KNOWS]->(f:Person)
WHERE p.name = $name
RETURN f.name AS friend
ORDER BY friend ASC
LIMIT 10`;

      const tokens = new Lexer(query).tokenise();
      expect(tokens[0].kind).toBe(TokenKind.MATCH);
      expect(tokens[tokens.length - 1].kind).toBe(TokenKind.EOF);
    });
  });

  // ── Index DDL keywords ─────────────────────────────────────────
  describe('index DDL keywords', () => {
    it('tokenises INDEX', () => {
      const tokens = new Lexer('INDEX').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.INDEX);
    });

    it('tokenises DROP', () => {
      const tokens = new Lexer('DROP').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.DROP);
    });

    it('tokenises FOR', () => {
      const tokens = new Lexer('FOR').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.FOR);
    });

    it('tokenises SHOW', () => {
      const tokens = new Lexer('SHOW').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.SHOW);
    });

    it('tokenises CREATE INDEX sequence', () => {
      const tokens = new Lexer('CREATE INDEX').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.CREATE);
      expect(tokens[1].kind).toBe(TokenKind.INDEX);
    });

    it('tokenises DROP INDEX sequence', () => {
      const tokens = new Lexer('DROP INDEX').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.DROP);
      expect(tokens[1].kind).toBe(TokenKind.INDEX);
    });

    it('tokenises SHOW INDEXES (INDEXES as IDENT)', () => {
      const tokens = new Lexer('SHOW INDEXES').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.SHOW);
      // 'INDEXES' is not a keyword, so it tokenizes as IDENT
      expect(tokens[1].kind).toBe(TokenKind.IDENT);
      expect(tokens[1].value.toLowerCase()).toBe('indexes');
    });

    it('tokenises full CREATE INDEX statement', () => {
      const tokens = new Lexer('CREATE INDEX idx FOR (n:P) ON (n.name)').tokenise();
      expect(tokens[0].kind).toBe(TokenKind.CREATE);
      expect(tokens[1].kind).toBe(TokenKind.INDEX);
      expect(tokens[2].kind).toBe(TokenKind.IDENT); // idx
      expect(tokens[3].kind).toBe(TokenKind.FOR);
    });
  });

  // ── Error: unexpected character ────────────────────────────────
  describe('errors', () => {
    it('throws on unrecognised character', () => {
      expect(() => new Lexer('@').tokenise()).toThrow(CypherSyntaxError);
    });
  });
});
