import { afterAll, beforeAll, beforeEach, describe, it, expect } from '@jest/globals';
import { Graph, Node } from '../../index';

/**
 * Shared test scenarios for the Education Graph.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param buildGraph - Factory that returns a fresh Graph instance (async to support MongoStorageProvider)
 */
export function runEducationGraphScenarios(buildGraph: () => Promise<Graph>): void {
  describe('Education Graph', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = await buildGraph();
    });

    // Helper functions to replace getChildren and getParents
    async function getChildNodes(nodeId: string, edgeType?: string): Promise<Node[]> {
      const edges = await graph.getEdgesFrom(nodeId, edgeType ? { filter: { types: [edgeType] } } : undefined);
      const childNodes = await Promise.all(edges.map(e => graph.getNode(e.targetId)));
      return childNodes.filter((n): n is Node => n !== undefined);
    }

    async function getParentNodes(nodeId: string, edgeType?: string): Promise<Node[]> {
      const edges = await graph.getEdgesTo(nodeId, edgeType ? { filter: { types: [edgeType] } } : undefined);
      const parentNodes = await Promise.all(edges.map(e => graph.getNode(e.sourceId)));
      return parentNodes.filter((n): n is Node => n !== undefined);
    }

    describe('Graph Structure', () => {
      it('should have 2 courses', async () => {
        const courses = await graph.getNodes({ filter: { types: ['Course'] } });
        expect(courses).toHaveLength(2);
      });

      it('should have 4 authors', async () => {
        const authors = await graph.getNodes({ filter: { types: ['Author'] } });
        expect(authors).toHaveLength(4);
      });

      it('should have 1 publisher', async () => {
        const publishers = await graph.getNodes({ filter: { types: ['Publisher'] } });
        expect(publishers).toHaveLength(1);
      });

      it('should have 6 chapters for Python', async () => {
        const nodes = await graph.getNodes();
        const pythonCourse = nodes.find(n => n.properties.name === 'Python');
        const children = await getChildNodes(pythonCourse!.id);
        const chapters = children.filter(n => n.type === 'Chapter');
        expect(chapters).toHaveLength(6);
      });

      it('should have 7 chapters for NodeJS', async () => {
        const nodes = await graph.getNodes();
        const nodejsCourse = nodes.find(n => n.properties.name === 'NodeJS');
        const children = await getChildNodes(nodejsCourse!.id);
        const chapters = children.filter(n => n.type === 'Chapter');
        expect(chapters).toHaveLength(7);
      });

      it('should have 4 tags', async () => {
        const tags = await graph.getNodes({ filter: { types: ['Tag'] } });
        expect(tags).toHaveLength(4);
      });
    });

    describe('Course Content', () => {
      it('should have correct Python course properties', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        expect(python?.properties.duration).toBe(40);
      });

      it('should have correct NodeJS course properties', async () => {
        const nodes = await graph.getNodes();
        const nodejs = nodes.find(n => n.properties.name === 'NodeJS');
        expect(nodejs?.properties.duration).toBe(35);
      });

      it('should have chapters with order property', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const children = await getChildNodes(python!.id);
        const chapters = children.filter(n => n.type === 'Chapter');
        const orderedChapters = chapters.sort((a, b) =>
          (a.properties.order as number) - (b.properties.order as number)
        );
        expect(orderedChapters[0]?.properties.name).toBe('Python Basics');
        expect(orderedChapters[4]?.properties.name).toBe('OOP');
        expect(orderedChapters[5]?.properties.name).toBe('Modules');
      });
    });

    describe('Chapters and Sections', () => {
      it('should have sections within Python chapters', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const chapters = pythonChildren.filter(n => n.type === 'Chapter');
        const firstChapter = chapters.find(n => n.properties.name === 'Python Basics');
        const sections = await getChildNodes(firstChapter!.id);
        expect(sections).toHaveLength(3);
      });

      it('should have at least 2 sections per chapter', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const chapters = pythonChildren.filter(n => n.type === 'Chapter');

        for (const chapter of chapters) {
          const sections = await getChildNodes(chapter.id);
          expect(sections.length).toBeGreaterThanOrEqual(2);
        }
      });

      it('should have sections with duration property', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const chapters = pythonChildren.filter(n => n.type === 'Chapter');
        const firstChapter = chapters.find(n => n.properties.name === 'Python Basics');
        const sections = await getChildNodes(firstChapter!.id);
        expect(sections[0]?.properties.duration).toBeDefined();
      });
    });

    describe('Exams and Tests', () => {
      it('should have 2 exams per course', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const children = await getChildNodes(python!.id);
        const exams = children.filter(n => n.type === 'Exam');
        expect(exams).toHaveLength(2);
      });

      it('should have 3-4 tests per Python exam', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const exams = pythonChildren.filter(n => n.type === 'Exam');

        for (const exam of exams) {
          const examChildren = await getChildNodes(exam.id);
          const tests = examChildren.filter(n => n.type === 'Test');
          expect(tests.length).toBeGreaterThanOrEqual(3);
          expect(tests.length).toBeLessThanOrEqual(4);
        }
      });

      it('should have tests with questions property', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const exams = pythonChildren.filter(n => n.type === 'Exam');
        const firstExam = exams[0];
        const tests = await getChildNodes(firstExam!.id);
        expect(tests[0]?.properties.questions).toBeDefined();
      });
    });

    describe('Authors and Publishers', () => {
      it('should have 2 authors per course', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const nodejs = nodes.find(n => n.properties.name === 'NodeJS');

        const pythonParents = await getParentNodes(python!.id);
        const nodejsParents = await getParentNodes(nodejs!.id);
        const pythonAuthors = pythonParents.filter(n => n.type === 'Author');
        const nodejsAuthors = nodejsParents.filter(n => n.type === 'Author');

        expect(pythonAuthors).toHaveLength(2);
        expect(nodejsAuthors).toHaveLength(2);
      });

      it('should have correct author names', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const parents = await getParentNodes(python!.id);
        const authors = parents.filter(n => n.type === 'Author');
        const authorNames = authors.map(a => a.properties.name);
        expect(authorNames).toContain('John Doe');
        expect(authorNames).toContain('Jane Smith');
      });

      it('should share same publisher for both courses', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const nodejs = nodes.find(n => n.properties.name === 'NodeJS');

        const pythonParents = await getParentNodes(python!.id);
        const nodejsParents = await getParentNodes(nodejs!.id);
        const pythonPublishers = pythonParents.filter(n => n.type === 'Publisher');
        const nodejsPublishers = nodejsParents.filter(n => n.type === 'Publisher');

        expect(pythonPublishers).toHaveLength(1);
        expect(nodejsPublishers).toHaveLength(1);
        expect(pythonPublishers[0]?.id).toBe(nodejsPublishers[0]?.id);
      });

      it('should have correct publisher name', async () => {
        const publishers = await graph.getNodes({ filter: { types: ['Publisher'] } });
        expect(publishers[0]?.properties.name).toBe("O'Reilly Media");
      });
    });

    describe('Tags', () => {
      it('should tag courses with programming tags', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const children = await getChildNodes(python!.id);
        const tags = children.filter(n => n.type === 'Tag');
        const tagNames = tags.map(t => t.properties.name);

        expect(tagNames).toContain('Programming');
        expect(tagNames).toContain('Backend');
      });

      it('should tag NodeJS with web development tags', async () => {
        const nodes = await graph.getNodes();
        const nodejs = nodes.find(n => n.properties.name === 'NodeJS');
        const children = await getChildNodes(nodejs!.id);
        const tags = children.filter(n => n.type === 'Tag');
        const tagNames = tags.map(t => t.properties.name);

        expect(tagNames).toContain('Programming');
        expect(tagNames).toContain('Backend');
        expect(tagNames).toContain('Frontend');
        expect(tagNames).toContain('Web Development');
      });

      it('should have correct tag names', async () => {
        const tags = await graph.getNodes({ filter: { types: ['Tag'] } });
        const tagNames = tags.map((t: any) => t.properties.name).sort();
        expect(tagNames).toEqual(['Backend', 'Frontend', 'Programming', 'Web Development']);
      });
    });

    describe('Edge Types', () => {
      it('should have CONTAINS edges for course content', async () => {
        const containsEdges = await graph.getEdges({ filter: { types: ['CONTAINS'] } });
        expect(containsEdges.length).toBeGreaterThan(0);
      });

      it('should have AUTHOR_OF edges for authors', async () => {
        const authorEdges = await graph.getEdges({ filter: { types: ['AUTHOR_OF'] } });
        expect(authorEdges).toHaveLength(4);
      });

      it('should have PUBLISHED_BY edges for publisher', async () => {
        const publishedEdges = await graph.getEdges({ filter: { types: ['PUBLISHED_BY'] } });
        expect(publishedEdges).toHaveLength(2);
      });

      it('should have TAGGED_WITH edges for tags', async () => {
        const taggedEdges = await graph.getEdges({ filter: { types: ['TAGGED_WITH'] } });
        expect(taggedEdges).toHaveLength(6);
      });
    });

    describe('traverse()', () => {
      it('should find path from course to chapter', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const chapters = pythonChildren.filter(n => n.type === 'Chapter');
        const firstChapter = chapters[0];

        const paths = await graph.traverse(python!.id, firstChapter!.id, { method: 'bfs' });
        expect(paths).toEqual([[python!.id, firstChapter!.id]]);
      });

      it('should find path from course to section (multi-hop)', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const chapters = pythonChildren.filter(n => n.type === 'Chapter');
        const firstChapter = chapters[0];
        const sections = await getChildNodes(firstChapter!.id);
        const firstSection = sections[0];

        const paths = await graph.traverse(python!.id, firstSection!.id, { method: 'bfs' });
        expect(paths).toEqual([[python!.id, firstChapter!.id, firstSection!.id]]);
      });

      it('should find path from course to exam', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const exams = pythonChildren.filter(n => n.type === 'Exam');
        const firstExam = exams[0];

        const paths = await graph.traverse(python!.id, firstExam!.id, { method: 'bfs' });
        expect(paths).toEqual([[python!.id, firstExam!.id]]);
      });

      it('should find path from exam to test', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const exams = pythonChildren.filter(n => n.type === 'Exam');
        const firstExam = exams[0];
        const tests = await getChildNodes(firstExam!.id);
        const firstTest = tests[0];

        const paths = await graph.traverse(firstExam!.id, firstTest!.id, { method: 'bfs' });
        expect(paths).toEqual([[firstExam!.id, firstTest!.id]]);
      });

      it('should find path from author to course', async () => {
        const nodes = await graph.getNodes();
        const author = nodes.find(n => n.properties.name === 'John Doe');
        const python = nodes.find(n => n.properties.name === 'Python');

        const paths = await graph.traverse(author!.id, python!.id, { method: 'bfs' });
        expect(paths).toEqual([[author!.id, python!.id]]);
      });

      it('should find path from publisher to course', async () => {
        const nodes = await graph.getNodes();
        const publisher = nodes.find(n => n.properties.name === "O'Reilly Media");
        const python = nodes.find(n => n.properties.name === 'Python');

        const paths = await graph.traverse(publisher!.id, python!.id, { method: 'bfs' });
        expect(paths).toEqual([[publisher!.id, python!.id]]);
      });

      it('should find path from course to tag', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const children = await getChildNodes(python!.id);
        const tags = children.filter(n => n.type === 'Tag');
        const firstTag = tags[0];

        const paths = await graph.traverse(python!.id, firstTag!.id, { method: 'bfs' });
        expect(paths).toEqual([[python!.id, firstTag!.id]]);
      });

      it('should return null when no path exists', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const pythonExams = pythonChildren.filter(n => n.type === 'Exam');
        const pythonExam = pythonExams[0];

        const nodejs = nodes.find(n => n.properties.name === 'NodeJS');
        const nodejsChildren = await getChildNodes(nodejs!.id);
        const nodejsChapters = nodejsChildren.filter(n => n.type === 'Chapter');
        const nodejsChapter = nodejsChapters[0];

        const paths = await graph.traverse(pythonExam!.id, nodejsChapter!.id, { method: 'bfs' });
        expect(paths).toBeNull();
      });

      it('should use DFS traversal', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        const pythonChildren = await getChildNodes(python!.id);
        const chapters = pythonChildren.filter(n => n.type === 'Chapter');
        const firstChapter = chapters[0];

        const paths = await graph.traverse(python!.id, firstChapter!.id, { method: 'dfs' });
        expect(paths).toEqual([[python!.id, firstChapter!.id]]);
      });

      it('should combine nodeType and edgeType filters during traversal', async () => {
        const nodes = await graph.getNodes();
        const python = nodes.find(n => n.properties.name === 'Python');
        // Find an author who is actually an author of the Python course
        // (alice and jane are Python authors; john and doe are NodeJS authors)
        const authors = nodes.filter(n => n.type === 'Author');
        const pythonAuthorIds = new Set(
          (await graph.getEdges({ filter: { types: ['AUTHOR_OF'] } }))
            .filter((e: any) => e.targetId === python!.id)
            .map((e: any) => e.sourceId)
        );
        const author = authors.find(a => pythonAuthorIds.has(a.id));

        const courseChildren = await getChildNodes(python!.id);
        const chapters = courseChildren.filter(n => n.type === 'Chapter');
        const firstChapter = chapters[0];

        const chapterChildren = await getChildNodes(firstChapter!.id);
        const sections = chapterChildren.filter(n => n.type === 'Section');
        const firstSection = sections[0];

        const pathAuthorToCourse = await graph.traverse(author!.id, python!.id, { method: 'bfs' });
        expect(pathAuthorToCourse).toEqual([[author!.id, python!.id]]);

        const pathCourseToChapter = await graph.traverse(python!.id, firstChapter!.id, { method: 'bfs' });
        expect(pathCourseToChapter).toEqual([[python!.id, firstChapter!.id]]);

        const pathWithNodeFilter = await graph.traverse(python!.id, firstChapter!.id, {
          method: 'bfs',
          nodeTypes: ['Chapter']
        });
        expect(pathWithNodeFilter).toEqual([[python!.id, firstChapter!.id]]);

        const pathWithEdgeFilter = await graph.traverse(python!.id, firstChapter!.id, {
          method: 'bfs',
          edgeTypes: ['AUTHOR_OF']
        });
        expect(pathWithEdgeFilter).toBeNull();

        const pathWithContains = await graph.traverse(python!.id, firstChapter!.id, {
          method: 'bfs',
          edgeTypes: ['CONTAINS']
        });
        expect(pathWithContains).toEqual([[python!.id, firstChapter!.id]]);

        const pathBothFilters = await graph.traverse(python!.id, firstChapter!.id, {
          method: 'bfs',
          nodeTypes: ['Chapter'],
          edgeTypes: ['CONTAINS']
        });
        expect(pathBothFilters).toEqual([[python!.id, firstChapter!.id]]);
      });

      it('should filter by multiple nodeTypes and edgeTypes', async () => {
        const authors = await graph.getNodes({ filter: { types: ['Author'] } });
        const author = authors[0];
        const courses = await graph.getNodes({ filter: { types: ['Course'] } });
        const course = courses[0];
        const chapters = await graph.getNodes({ filter: { types: ['Chapter'] } });
        const chapter = chapters[0];

        const pathAll = await graph.traverse(author.id, chapter.id, { method: 'bfs' });
        expect(pathAll).toEqual([[author.id, course.id, chapter.id]]);

        const pathMultiEdge = await graph.traverse(author.id, chapter.id, {
          method: 'bfs',
          edgeTypes: ['AUTHOR_OF', 'CONTAINS', 'SOME_OTHER']
        });
        expect(pathMultiEdge).toEqual([[author.id, course.id, chapter.id]]);

        const pathMultiNode = await graph.traverse(author.id, chapter.id, {
          method: 'bfs',
          nodeTypes: ['Author', 'Course', 'Chapter']
        });
        expect(pathMultiNode).toEqual([[author.id, course.id, chapter.id]]);

        const pathBothMulti = await graph.traverse(author.id, chapter.id, {
          method: 'bfs',
          nodeTypes: ['Author', 'Course', 'Chapter'],
          edgeTypes: ['AUTHOR_OF', 'CONTAINS']
        });
        expect(pathBothMulti).toEqual([[author.id, course.id, chapter.id]]);

        const pathWrongEdge = await graph.traverse(author.id, chapter.id, {
          method: 'bfs',
          edgeTypes: ['CONTAINS', 'SOME_OTHER']
        });
        expect(pathWrongEdge).toBeNull();

        const pathWrongNode = await graph.traverse(author.id, chapter.id, {
          method: 'bfs',
          nodeTypes: ['Author', 'Chapter']
        });
        expect(pathWrongNode).toBeNull();
      });

      it('should find all authors of python-course using wildcard source', async () => {
        const nodes = await graph.getNodes();
        const pythonCourse = nodes.find(n => n.properties.name === 'Python');

        const paths = await graph.traverse('*', pythonCourse!.id, {
          edgeTypes: ['AUTHOR_OF']
        });

        expect(paths).not.toBeNull();
        expect(paths!).toContainEqual(['python-course']);
        expect(paths!).toContainEqual(['author-john', 'python-course']);
        expect(paths!).toContainEqual(['author-jane', 'python-course']);
        expect(paths!).toHaveLength(3);
      });

      it('should find all reachable nodes from python-course using wildcard target', async () => {
        const nodes = await graph.getNodes();
        const pythonCourse = nodes.find(n => n.properties.name === 'Python');

        const paths = await graph.traverse(pythonCourse!.id, '*');

        expect(paths).not.toBeNull();

        const pathTargets = paths!.map(p => p[p.length - 1]);
        const children = await getChildNodes(pythonCourse!.id);
        const chapters = children.filter(n => n.type === 'Chapter');
        const exams = children.filter(n => n.type === 'Exam');
        const tags = children.filter(n => n.type === 'Tag');

        chapters.forEach(ch => {
          expect(pathTargets).toContain(ch.id);
        });
        exams.forEach(ex => {
          expect(pathTargets).toContain(ex.id);
        });
        tags.forEach(tg => {
          expect(pathTargets).toContain(tg.id);
        });
      });

      it('should find all paths between multiple sources and targets', async () => {
        const authors = await graph.getNodes({ filter: { types: ['Author'] } });
        const chapters = await graph.getNodes({ filter: { types: ['Chapter'] } });
        const pythonChapters = chapters.slice(0, 2);

        const paths = await graph.traverse(
          [authors[0].id, authors[1].id],
          [pythonChapters[0].id, pythonChapters[1].id],
          { edgeTypes: ['AUTHOR_OF', 'CONTAINS'] }
        );

        expect(paths).not.toBeNull();
        expect(paths!.length).toBeGreaterThan(0);
        paths!.forEach(p => {
          expect(p[0]).toMatch(/^author-/);
          expect(p[p.length - 1]).toMatch(/^python-ch/);
        });
      });
    });

    describe('Serialization', () => {
      it('should serialize and deserialize correctly', async () => {
        const data = await graph.exportJSON();
        const restored = await Graph.importJSON(data);

        const restoredCourses = await restored.getNodes({ filter: { types: ['Course'] } });
        const restoredAuthors = await restored.getNodes({ filter: { types: ['Author'] } });
        const restoredPublishers = await restored.getNodes({ filter: { types: ['Publisher'] } });
        const restoredChapters = await restored.getNodes({ filter: { types: ['Chapter'] } });
        const restoredSections = await restored.getNodes({ filter: { types: ['Section'] } });
        const restoredExams = await restored.getNodes({ filter: { types: ['Exam'] } });
        const restoredTests = await restored.getNodes({ filter: { types: ['Test'] } });

        expect(restoredCourses).toHaveLength(2);
        expect(restoredAuthors).toHaveLength(4);
        expect(restoredPublishers).toHaveLength(1);
        expect(restoredChapters).toHaveLength(13);
        expect(restoredSections).toHaveLength(39);
        expect(restoredExams).toHaveLength(4);
        expect(restoredTests).toHaveLength(14);
      });

      it('should maintain edge types through serialization', async () => {
        const data = await graph.exportJSON();
        const restored = await Graph.importJSON(data);

        const containsEdges = await restored.getEdges({ filter: { types: ['CONTAINS'] } });
        expect(containsEdges.length).toBeGreaterThan(0);
      });
    });
  });
}
