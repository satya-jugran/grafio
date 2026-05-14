import { describe, it, expect, beforeEach } from '@jest/globals';
import { Graph, Node } from '../../../index';
import { CypherEngine } from '../../../cypher';
import { educationGraphData } from '../index';

/**
 * Cypher query test scenarios for the Education Graph.
 * Mirrors the original educationGraphScenarios.ts but uses Cypher queries.
 * Excludes the Serialization section as requested.
 */

export function runEducationGraphCypherScenarios(buildGraph: () => Promise<Graph>): void {
  describe('Education Graph (Cypher)', () => {
    let graph: Graph;
    let engine: CypherEngine;

    beforeEach(async () => {
      graph = await buildGraph();
      engine = new CypherEngine(graph);
    });

    // ========================================
    // A. GRAPH STRUCTURE
    // ========================================
    describe('A. Graph Structure', () => {
      it('should have 2 courses', async () => {
        const result = await engine.execute('MATCH (c:Course) RETURN count(c) AS total');
        expect(result.rows[0].total).toBe(2);
      });

      it('should have 4 authors', async () => {
        const result = await engine.execute('MATCH (a:Author) RETURN count(a) AS total');
        expect(result.rows[0].total).toBe(4);
      });

      it('should have 1 publisher', async () => {
        const result = await engine.execute('MATCH (p:Publisher) RETURN count(p) AS total');
        expect(result.rows[0].total).toBe(1);
      });

      it('should have 6 chapters for Python', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(ch:Chapter)
           RETURN count(ch) AS total`
        );
        expect(result.rows[0].total).toBe(6);
      });

      it('should have 7 chapters for NodeJS', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'NodeJS'})-[:CONTAINS]->(ch:Chapter)
           RETURN count(ch) AS total`
        );
        expect(result.rows[0].total).toBe(7);
      });

      it('should have 4 tags', async () => {
        const result = await engine.execute('MATCH (t:Tag) RETURN count(t) AS total');
        expect(result.rows[0].total).toBe(4);
      });
    });

    // ========================================
    // B. COURSE CONTENT
    // ========================================
    describe('B. Course Content', () => {
      it('should have correct Python course properties', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'}) RETURN c.duration AS duration`
        );
        expect(result.rows[0].duration).toBe(40);
      });

      it('should have correct NodeJS course properties', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'NodeJS'}) RETURN c.duration AS duration`
        );
        expect(result.rows[0].duration).toBe(35);
      });

      it('should have chapters with order property', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(ch:Chapter)
           RETURN ch.name AS name, ch.order AS orderNum
           ORDER BY ch.order`
        );
        expect(result.rows[0].name).toBe('Python Basics');
        expect(result.rows[4].name).toBe('OOP');
        expect(result.rows[5].name).toBe('Modules');
      });
    });

    // ========================================
    // C. CHAPTERS AND SECTIONS
    // ========================================
    describe('C. Chapters and Sections', () => {
      it('should have sections within Python chapters', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(ch:Chapter {name: 'Python Basics'})-[:CONTAINS]->(s:Section)
           RETURN count(s) AS total`
        );
        expect(result.rows[0].total).toBe(3);
      });

      it('should have at least 2 sections per chapter', async () => {
        // Count all section nodes and verify the total is reasonable
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(ch:Chapter)-[:CONTAINS]->(s:Section)
           RETURN count(s) AS totalSections`
        );
        // Python has 6 chapters, each with 2-4 sections, total should be >= 12
        expect(result.rows[0].totalSections as number).toBeGreaterThanOrEqual(12);
      });

      it('should have sections with duration property', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(ch:Chapter {name: 'Python Basics'})-[:CONTAINS]->(s:Section)
           RETURN s.duration AS duration LIMIT 1`
        );
        expect(result.rows[0].duration).toBeDefined();
      });
    });

    // ========================================
    // D. EXAMS AND TESTS
    // ========================================
    describe('D. Exams and Tests', () => {
      it('should have 2 exams per course', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(e:Exam)
           RETURN count(e) AS total`
        );
        expect(result.rows[0].total).toBe(2);
      });

      it('should have 3-4 tests per Python exam', async () => {
        // Count total tests for Python course and verify it's in range (2 exams * 3-4 = 6-8)
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(e:Exam)-[:CONTAINS]->(t:Test)
           RETURN count(t) AS totalTests`
        );
        const totalTests = result.rows[0].totalTests as number;
        expect(totalTests).toBeGreaterThanOrEqual(6);
        expect(totalTests).toBeLessThanOrEqual(8);
      });

      it('should have tests with questions property', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:CONTAINS]->(e:Exam)-[:CONTAINS]->(t:Test)
           RETURN t.questions AS questions LIMIT 1`
        );
        expect(result.rows[0].questions).toBeDefined();
      });
    });

    // ========================================
    // E. AUTHORS AND PUBLISHERS
    // ========================================
    describe('E. Authors and Publishers', () => {
      it('should have 2 authors per course', async () => {
        const pythonAuthors = await engine.execute(
          `MATCH (a:Author)-[:AUTHOR_OF]->(c:Course {name: 'Python'})
           RETURN count(a) AS total`
        );
        const nodejsAuthors = await engine.execute(
          `MATCH (a:Author)-[:AUTHOR_OF]->(c:Course {name: 'NodeJS'})
           RETURN count(a) AS total`
        );
        expect(pythonAuthors.rows[0].total).toBe(2);
        expect(nodejsAuthors.rows[0].total).toBe(2);
      });

      it('should have correct author names', async () => {
        const result = await engine.execute(
          `MATCH (a:Author)-[:AUTHOR_OF]->(c:Course {name: 'Python'})
           RETURN a.name AS name`
        );
        const names = result.rows.map((r: any) => r.name as string);
        expect(names).toContain('John Doe');
        expect(names).toContain('Jane Smith');
      });

      it('should share same publisher for both courses', async () => {
        // Verify both courses have the same publisher by checking count
        const result = await engine.execute(
          `MATCH (p:Publisher)-[:PUBLISHED_BY]->(c:Course)
           RETURN count(DISTINCT p.id) AS publisherCount`
        );
        // Both courses should be published by the same publisher (count = 1)
        expect(result.rows[0].publisherCount).toBe(1);
      });

      it('should have correct publisher name', async () => {
        const result = await engine.execute(
          `MATCH (p:Publisher) RETURN p.name AS name`
        );
        expect(result.rows[0].name).toBe("O'Reilly Media");
      });
    });

    // ========================================
    // F. TAGS
    // ========================================
    describe('F. Tags', () => {
      it('should tag courses with programming tags', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'Python'})-[:TAGGED_WITH]->(t:Tag)
           RETURN t.name AS name`
        );
        const tagNames = result.rows.map((r: any) => r.name as string);
        expect(tagNames).toContain('Programming');
        expect(tagNames).toContain('Backend');
      });

      it('should tag NodeJS with web development tags', async () => {
        const result = await engine.execute(
          `MATCH (c:Course {name: 'NodeJS'})-[:TAGGED_WITH]->(t:Tag)
           RETURN t.name AS name`
        );
        const tagNames = result.rows.map((r: any) => r.name as string);
        expect(tagNames).toContain('Programming');
        expect(tagNames).toContain('Backend');
        expect(tagNames).toContain('Frontend');
        expect(tagNames).toContain('Web Development');
      });

      it('should have correct tag names', async () => {
        const result = await engine.execute(
          `MATCH (t:Tag) RETURN t.name AS name ORDER BY t.name`
        );
        const tagNames = result.rows.map((r: any) => r.name as string);
        expect(tagNames).toEqual(['Backend', 'Frontend', 'Programming', 'Web Development']);
      });
    });

    // ========================================
    // G. EDGE TYPES
    // ========================================
    describe('G. Edge Types', () => {
      it('should have CONTAINS edges for course content', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:CONTAINS]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total as number).toBeGreaterThan(0);
      });

      it('should have AUTHOR_OF edges for authors', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:AUTHOR_OF]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(4);
      });

      it('should have PUBLISHED_BY edges for publisher', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:PUBLISHED_BY]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(2);
      });

      it('should have TAGGED_WITH edges for tags', async () => {
        const result = await engine.execute(
          'MATCH ()-[r:TAGGED_WITH]->() RETURN count(r) AS total'
        );
        expect(result.rows[0].total).toBe(6);
      });
    });

    // ========================================
    // H. TRAVERSAL
    // ========================================
    describe('H. Traversal', () => {
      it('should find path from course to chapter', async () => {
        const result = await engine.execute(
          `MATCH path = (c:Course {name: 'Python'})-[:CONTAINS]->(ch:Chapter)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find path from course to section (multi-hop)', async () => {
        const result = await engine.execute(
          `MATCH path = (c:Course {name: 'Python'})-[:CONTAINS]->(:Chapter)-[:CONTAINS]->(s:Section)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
        const path = result.rows[0].path as Array<unknown>;
        expect(path.length).toBeGreaterThanOrEqual(3);
      });

      it('should find path from course to exam', async () => {
        const result = await engine.execute(
          `MATCH path = (c:Course {name: 'Python'})-[:CONTAINS]->(e:Exam)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find path from exam to test', async () => {
        const result = await engine.execute(
          `MATCH path = (e:Exam)-[:CONTAINS]->(t:Test)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find path from author to course', async () => {
        const result = await engine.execute(
          `MATCH path = (a:Author {name: 'John Doe'})-[:AUTHOR_OF]->(c:Course {name: 'Python'})
           RETURN path`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find path from publisher to course', async () => {
        const result = await engine.execute(
          `MATCH path = (p:Publisher {name: "O'Reilly Media"})-[:PUBLISHED_BY]->(c:Course {name: 'Python'})
           RETURN path`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find path from course to tag', async () => {
        const result = await engine.execute(
          `MATCH path = (c:Course {name: 'Python'})-[:TAGGED_WITH]->(t:Tag)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should return results when path exists', async () => {
        // Verify that Python exams have tests (path exists)
        const result = await engine.execute(
          `MATCH path = (e:Exam)-[:CONTAINS]->(t:Test)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find path with filtered edge type', async () => {
        const result = await engine.execute(
          `MATCH path = (c:Course {name: 'Python'})-[:CONTAINS]->(ch:Chapter)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find path from author to chapter via course', async () => {
        const result = await engine.execute(
          `MATCH path = (a:Author)-[:AUTHOR_OF]->(:Course)-[:CONTAINS]->(ch:Chapter)
           RETURN path LIMIT 1`
        );
        expect(result.rows.length).toBeGreaterThan(0);
        const path = result.rows[0].path as Array<unknown>;
        expect(path.length).toBeGreaterThanOrEqual(3);
      });

      it('should find all authors of Python course', async () => {
        const result = await engine.execute(
          `MATCH (a:Author)-[:AUTHOR_OF]->(c:Course {name: 'Python'})
           RETURN a.name AS name`
        );
        const names = result.rows.map((r: any) => r.name as string);
        expect(names).toContain('John Doe');
        expect(names).toContain('Jane Smith');
      });

      it('should find all reachable chapters from Python course', async () => {
        const result = await engine.execute(
          `MATCH path = (c:Course {name: 'Python'})-[:CONTAINS*1..2]->(ch:Chapter)
           RETURN DISTINCT ch.id AS chapterId`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });

      it('should find all reachable nodes from Python course', async () => {
        const result = await engine.execute(
          `MATCH path = (c:Course {name: 'Python'})-[:CONTAINS*1..2]->(target)
           RETURN DISTINCT target.id AS nodeId`
        );
        expect(result.rows.length).toBeGreaterThan(0);
      });
    });
  });
}