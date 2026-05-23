import { beforeEach, beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { Graph, GraphToMermaid, IStorageProvider } from '../../index';

/**
 * Shared test scenarios for GraphToMermaid visualization.
 * Both InMemory and MongoDB providers run the exact same assertions.
 *
 * @param providerFunc - Factory function that returns a Promise<IStorageProvider>
 * @param beforeAllFunc - Optional beforeAll hook (e.g., for MongoDB setup)
 * @param afterAllFunc - Optional afterAll hook (e.g., for MongoDB cleanup)
 */
export function runGraphToMermaidScenarios(
  providerFunc: () => Promise<IStorageProvider> | IStorageProvider = undefined as any,
  beforeAllFunc: () => Promise<void> = async () => {},
  afterAllFunc: () => Promise<void> = async () => {}
): void {
  let provider: IStorageProvider | undefined;

  beforeAll(async () => {
    provider = providerFunc ? await (providerFunc as () => Promise<IStorageProvider>)() : undefined;
    await beforeAllFunc();
  });

  afterAll(async () => {
    await afterAllFunc();
  });

  beforeEach(async () => {
    if (provider) {
      await provider.clear();
    }
  });

  describe('GraphToMermaid', () => {
    let graph: Graph;

    beforeEach(async () => {
      graph = new Graph(provider);
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
            { id: 'node1', labels: ['Course'], properties: { name: 'Test' } },
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
        expect(mermaid.toString()).toContain('flowchart TD');
      });

      it('should respect direction option LR (left-right)', async () => {
        await graph.addNode('Course', {});
        const mermaid = await GraphToMermaid.fromGraph(graph, { direction: 'LR' });
        expect(mermaid.toString()).toContain('flowchart LR');
      });
    });

    describe('node label formatting', () => {
      it('should not include properties by default', async () => {
        await graph.addNode('Person', { name: 'Alice', age: 30 });
        const mermaid = await GraphToMermaid.fromGraph(graph);
        const result = mermaid.toString();

        // Default label should be "type:id" without properties
        expect(result).toContain('Person');
        expect(result).not.toContain('Alice');
      });

      it('should include properties when showProperties is true', async () => {
        await graph.addNode('Person', { name: 'Alice', age: 30 });
        const mermaid = await GraphToMermaid.fromGraph(graph, { showProperties: true });
        const result = mermaid.toString();

        expect(result).toContain('Alice');
        expect(result).toContain('30');
      });

      it('should limit properties to first 3 when showProperties is true', async () => {
        await graph.addNode('Person', { name: 'Alice', age: 30, city: 'NYC', country: 'USA' });
        const mermaid = await GraphToMermaid.fromGraph(graph, { showProperties: true });
        const result = mermaid.toString();

        expect(result).toContain('Alice');
        expect(result).toContain('30');
        expect(result).toContain('NYC');
        // Only first 3 properties should be included
        expect(result).not.toContain('USA');
      });
    });

    describe('id sanitization', () => {
      it('should handle special characters in node ids via JSON constructor', () => {
        const jsonData = JSON.stringify({
          nodes: [
            { id: 'node-with-dashes', labels: ['Course'], properties: { name: 'Test' } },
            { id: 'node.with.dots', labels: ['Chapter'], properties: { name: 'Ch1' } },
          ],
          edges: [
            { id: 'e1', sourceId: 'node-with-dashes', targetId: 'node.with.dots', type: 'CONTAINS', properties: {} },
          ],
        });

        const mermaid = new GraphToMermaid(jsonData);
        const result = mermaid.toString();

        // Should contain flowchart definition
        expect(result).toContain('flowchart');
      });

      it('should escape spaces and special characters via JSON constructor', () => {
        const jsonData = JSON.stringify({
          nodes: [
            { id: 'node with spaces', labels: ['Course'], properties: { name: 'Test' } },
          ],
          edges: [],
        });

        const mermaid = new GraphToMermaid(jsonData);
        const result = mermaid.toString();

        expect(result).toContain('flowchart');
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
        const course = await graph.addNode('Course', { name: 'Python' });
        const ch1 = await graph.addNode('Chapter', { name: 'Ch1' });
        const ch2 = await graph.addNode('Chapter', { name: 'Ch2' });
        await graph.addEdge(course.id, ch1.id, 'CONTAINS');
        await graph.addEdge(course.id, ch2.id, 'CONTAINS');

        const mermaid = await GraphToMermaid.fromGraph(graph);
        const result = mermaid.toString();

        expect(result).toContain('CONTAINS');
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
      it('should throw when data is missing nodes property', () => {
        const invalidData = JSON.stringify({ edges: [] });
        expect(() => new GraphToMermaid(invalidData)).toThrow();
      });

      it('should throw when data is missing edges property', () => {
        const invalidData = JSON.stringify({ nodes: [] });
        expect(() => new GraphToMermaid(invalidData)).toThrow();
      });
    });
  });
}