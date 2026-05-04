import { beforeEach, describe, expect, it } from '@jest/globals';
import { Graph } from '../../src/index';
import {
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  InvalidPropertyError,
} from '../../src/errors';

describe('Graph.importJSON() validation', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should throw NodeAlreadyExistsError for duplicate node IDs', async () => {
    const data = {
      nodes: [
        { id: 'node1', type: 'Test', properties: { name: 'A' } },
        { id: 'node1', type: 'Test', properties: { name: 'B' } },
      ],
      edges: [],
    };
    await expect(Graph.importJSON(data)).rejects.toThrow(NodeAlreadyExistsError);
  });

  it('should throw EdgeAlreadyExistsError for duplicate edge IDs', async () => {
    const data = {
      nodes: [
        { id: 'node1', type: 'Test', properties: { name: 'A' } },
        { id: 'node2', type: 'Test', properties: { name: 'B' } },
      ],
      edges: [
        { id: 'edge1', sourceId: 'node1', targetId: 'node2', type: 'LINKS', properties: {} },
        { id: 'edge1', sourceId: 'node2', targetId: 'node1', type: 'LINKS', properties: {} },
      ],
    };
    await expect(Graph.importJSON(data)).rejects.toThrow(EdgeAlreadyExistsError);
  });

  it('should throw NodeNotFoundError for edge referencing non-existent source', async () => {
    const data = {
      nodes: [
        { id: 'node1', type: 'Test', properties: { name: 'A' } },
      ],
      edges: [
        { id: 'edge1', sourceId: 'non-existent', targetId: 'node1', type: 'LINKS', properties: {} },
      ],
    };
    await expect(Graph.importJSON(data)).rejects.toThrow(NodeNotFoundError);
  });

  it('should throw NodeNotFoundError for edge referencing non-existent target', async () => {
    const data = {
      nodes: [
        { id: 'node1', type: 'Test', properties: { name: 'A' } },
      ],
      edges: [
        { id: 'edge1', sourceId: 'node1', targetId: 'non-existent', type: 'LINKS', properties: {} },
      ],
    };
    await expect(Graph.importJSON(data)).rejects.toThrow(NodeNotFoundError);
  });

  it('should successfully create graph with valid data', async () => {
    const data = {
      nodes: [
        { id: 'node1', type: 'Test', properties: { name: 'A' } },
        { id: 'node2', type: 'Test', properties: { name: 'B' } },
      ],
      edges: [
        { id: 'edge1', sourceId: 'node1', targetId: 'node2', type: 'LINKS', properties: {} },
      ],
    };
    const graph = await Graph.importJSON(data);
    await expect(graph.getNodes()).resolves.toHaveLength(2);
    await expect(graph.getEdges()).resolves.toHaveLength(1);
  });

  describe('isFlatRecord validation for nodes', () => {
    it('should throw InvalidPropertyError when node has nested object property', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { name: 'A', meta: { key: 'value' } } },
        ],
        edges: [],
      };
      await expect(Graph.importJSON(data)).rejects.toThrow(InvalidPropertyError);
    });

    it('should throw InvalidPropertyError when node has array property', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { tags: ['a', 'b'] } },
        ],
        edges: [],
      };
      await expect(Graph.importJSON(data)).rejects.toThrow(InvalidPropertyError);
    });

    it('should throw InvalidPropertyError when node has function property', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { callback: () => {} } },
        ],
        edges: [],
      };
      await expect(Graph.importJSON(data)).rejects.toThrow(InvalidPropertyError);
    });

    it('should accept node with all primitive properties', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { name: 'A', age: 30, active: true, score: 99.5 } },
        ],
        edges: [],
      };
      const graph = await Graph.importJSON(data);
      await expect(graph.getNodes()).resolves.toHaveLength(1);
    });
  });

  describe('isFlatRecord validation for edges', () => {
    it('should throw InvalidPropertyError when edge has nested object property', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { name: 'A' } },
          { id: 'node2', type: 'Test', properties: { name: 'B' } },
        ],
        edges: [
          { id: 'edge1', sourceId: 'node1', targetId: 'node2', type: 'LINKS', properties: { meta: { key: 'value' } } },
        ],
      };
      await expect(Graph.importJSON(data)).rejects.toThrow(InvalidPropertyError);
    });

    it('should throw InvalidPropertyError when edge has array property', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { name: 'A' } },
          { id: 'node2', type: 'Test', properties: { name: 'B' } },
        ],
        edges: [
          { id: 'edge1', sourceId: 'node1', targetId: 'node2', type: 'LINKS', properties: { values: [1, 2, 3] } },
        ],
      };
      await expect(Graph.importJSON(data)).rejects.toThrow(InvalidPropertyError);
    });

    it('should throw InvalidPropertyError when edge has function property', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { name: 'A' } },
          { id: 'node2', type: 'Test', properties: { name: 'B' } },
        ],
        edges: [
          { id: 'edge1', sourceId: 'node1', targetId: 'node2', type: 'LINKS', properties: { handler: () => {} } },
        ],
      };
      await expect(Graph.importJSON(data)).rejects.toThrow(InvalidPropertyError);
    });

    it('should accept edge with all primitive properties', async () => {
      const data = {
        nodes: [
          { id: 'node1', type: 'Test', properties: { name: 'A' } },
          { id: 'node2', type: 'Test', properties: { name: 'B' } },
        ],
        edges: [
          { id: 'edge1', sourceId: 'node1', targetId: 'node2', type: 'LINKS', properties: { weight: 1.5, active: true, label: 'test' } },
        ],
      };
      const graph = await Graph.importJSON(data);
      await expect(graph.getEdges()).resolves.toHaveLength(1);
    });
  });
});
