import { beforeEach, describe, expect, it } from '@jest/globals';
import { Graph, GraphToMermaid } from '../../src/index';

describe('GraphToMermaid', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  describe('constructor', () => {
    it('should create from a Graph instance', async () => {
      const node = await graph.addNode('Person', { name: 'Alice' });
      await graph.addNode('Person', { name: 'Bob' });
      const nodes = await graph.getNodes();
      await graph.addEdge(node.id, nodes[1].id, 'KNOWS');

      const mermaid = await GraphToMermaid.fromGraph(graph);
      expect(mermaid.toString()).toContain('flowchart TD');
      expect(mermaid.toString()).toContain('Person');
    });

    it('should create from a JSON string', () => {
      const jsonData = JSON.stringify({
        nodes: [
          { id: 'node1', type: 'Course', properties: { name: 'Test' } },
        ],
        edges: [],
      });

      const mermaid = new GraphToMermaid(jsonData);
      expect(mermaid.toString()).toContain('flowchart TD');
    });
  });

  describe('toString', () => {
    it('should generate mermaid syntax for an empty graph', async () => {
      const mermaid = await GraphToMermaid.fromGraph(graph);
      const result = mermaid.toString();

      expect(result).toBe('flowchart TD');
    });

    it('should generate node definitions with id and type', async () => {
      const course = await graph.addNode('Course', { name: 'Python' });
      const chapter = await graph.addNode('Chapter', { name: 'Basics' });
      await graph.addEdge(course.id, chapter.id, 'CONTAINS');

      const mermaid = await GraphToMermaid.fromGraph(graph);
      const result = mermaid.toString();

      expect(result).toContain('Course');
      expect(result).toContain('Chapter');
      expect(result).toContain('CONTAINS');
    });

    it('should use node id as identifier', async () => {
      const course = await graph.addNode('Course', { name: 'Python' });
      const chapter = await graph.addNode('Chapter', { name: 'Basics' });

      const mermaid = await GraphToMermaid.fromGraph(graph);
      const result = mermaid.toString();

      // Node id should appear in the output (as part of the label)
      expect(result).toContain(course.id);
    });

    it('should generate directed edges with labels', async () => {
      const source = await graph.addNode('Course', { name: 'Python' });
      const target = await graph.addNode('Chapter', { name: 'Basics' });
      await graph.addEdge(source.id, target.id, 'CONTAINS');

      const mermaid = await GraphToMermaid.fromGraph(graph);
      const result = mermaid.toString();

      expect(result).toContain('-->|"CONTAINS"|');
    });

    it('should generate directed edges without labels when includeEdgeLabels is false', async () => {
      const source = await graph.addNode('Course', { name: 'Python' });
      const target = await graph.addNode('Chapter', { name: 'Basics' });
      await graph.addEdge(source.id, target.id, 'CONTAINS');

      const mermaid = await GraphToMermaid.fromGraph(graph, { includeEdgeLabels: false });
      const result = mermaid.toString();

      expect(result).toContain('-->');
      expect(result).not.toContain('CONTAINS');
    });

    it('should respect direction option TD (top-down)', async () => {
      await graph.addNode('Course', {});

      const mermaid = await GraphToMermaid.fromGraph(graph, { direction: 'TD' });
      const result = mermaid.toString();

      expect(result).toContain('flowchart TD');
    });

    it('should respect direction option LR (left-right)', async () => {
      await graph.addNode('Course', {});

      const mermaid = await GraphToMermaid.fromGraph(graph, { direction: 'LR' });
      const result = mermaid.toString();

      expect(result).toContain('flowchart LR');
    });
  });

  describe('node label formatting', () => {
    it('should not include properties by default', async () => {
      await graph.addNode('Course', { name: 'Python', duration: 40 });

      const mermaid = await GraphToMermaid.fromGraph(graph);
      const result = mermaid.toString();

      expect(result).toContain('Course');
      // The label should just be "Course | <id>" without property content
      expect(result).not.toMatch(/Course.*duration/);
    });

    it('should include properties when showProperties is true', async () => {
      await graph.addNode('Course', { name: 'Python', duration: 40 });

      const mermaid = await GraphToMermaid.fromGraph(graph, { showProperties: true });
      const result = mermaid.toString();

      expect(result).toContain('duration');
      expect(result).toContain('40');
    });

    it('should limit properties to first 3 when showProperties is true', async () => {
      await graph.addNode('Course', {
        prop1: 'a',
        prop2: 'b',
        prop3: 'c',
        prop4: 'd',
        prop5: 'e',
      });

      const mermaid = await GraphToMermaid.fromGraph(graph, { showProperties: true });
      const result = mermaid.toString();

      expect(result).toContain('prop1');
      expect(result).toContain('prop2');
      expect(result).toContain('prop3');
      expect(result).not.toContain('prop4');
      expect(result).not.toContain('prop5');
    });
  });

  describe('id sanitization', () => {
    it('should handle special characters in node ids via JSON constructor', () => {
      const jsonData = JSON.stringify({
        nodes: [
          { id: 'node-with-dashes', type: 'Course', properties: {} },
          { id: 'node_with_underscores', type: 'Course', properties: {} },
          { id: 'node.with.dots', type: 'Course', properties: {} },
        ],
        edges: [],
      });

      const mermaid = new GraphToMermaid(jsonData);
      const result = mermaid.toString();

      // Should not throw and should contain sanitized ids (dots converted to underscores)
      expect(result).toContain('node-with-dashes');
      expect(result).toContain('node_with_underscores');
      expect(result).toContain('node_with_dots');
    });

    it('should escape spaces and special characters via JSON constructor', () => {
      const jsonData = JSON.stringify({
        nodes: [
          { id: 'node with spaces', type: 'Course', properties: {} },
        ],
        edges: [],
      });

      const mermaid = new GraphToMermaid(jsonData);
      const result = mermaid.toString();

      expect(result).toContain('node_with_spaces');
    });
  });

  describe('edge cases', () => {
    it('should handle nodes without edges', async () => {
      await graph.addNode('Course', { name: 'Python' });
      await graph.addNode('Chapter', { name: 'Basics' });

      const mermaid = await GraphToMermaid.fromGraph(graph);
      const result = mermaid.toString();

      expect(result).toContain('Course');
      expect(result).toContain('Chapter');
    });

    it('should handle multiple edges from same source', async () => {
      const course = await graph.addNode('Course', {});
      const ch1 = await graph.addNode('Chapter', { name: 'Ch1' });
      const ch2 = await graph.addNode('Chapter', { name: 'Ch2' });
      const ch3 = await graph.addNode('Chapter', { name: 'Ch3' });

      await graph.addEdge(course.id, ch1.id, 'CONTAINS');
      await graph.addEdge(course.id, ch2.id, 'CONTAINS');
      await graph.addEdge(course.id, ch3.id, 'CONTAINS');

      const mermaid = await GraphToMermaid.fromGraph(graph);
      const result = mermaid.toString();

      const containsCount = (result.match(/CONTAINS/g) || []).length;
      expect(containsCount).toBe(3);
    });
  });

  describe('integration with Graph serialization', () => {
    it('should work with Graph.exportJSON() output', async () => {
      const course = await graph.addNode('Course', { name: 'Python' });
      const chapter = await graph.addNode('Chapter', { name: 'Basics' });
      await graph.addEdge(course.id, chapter.id, 'CONTAINS');

      const jsonData = await graph.exportJSON();
      const mermaid = new GraphToMermaid(JSON.stringify(jsonData));
      const result = mermaid.toString();

      expect(result).toContain('Course');
      expect(result).toContain('Chapter');
      expect(result).toContain('CONTAINS');
    });
  });

  describe('_validateGraphData validation', () => {
    it('should throw when data is null', () => {
      expect(() => new GraphToMermaid('null')).toThrow('GraphData must be an object');
    });

    it('should throw when data is a function', () => {
      expect(() => new GraphToMermaid('function() {}')).toThrow('Invalid JSON');
    });

    it('should throw when data is missing nodes property', () => {
      const jsonData = JSON.stringify({
        edges: [],
      });

      expect(() => new GraphToMermaid(jsonData)).toThrow('GraphData must have a nodes array');
    });

    it('should throw when data is missing edges property', () => {
      const jsonData = JSON.stringify({
        nodes: [],
      });

      expect(() => new GraphToMermaid(jsonData)).toThrow('GraphData must have an edges array');
    });
  });
});
