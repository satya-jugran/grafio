import { beforeEach, describe, expect, it } from '@jest/globals';
import { Graph, InvalidPropertyError, PropertyAlreadyExistsError, PropertyNotFoundError } from '../../src/index';

describe('Graph Node/Edge Properties Validation', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  describe('Node property validation', () => {
    it('should accept primitive property values', async () => {
      const node = await graph.addNode('Person', {
        name: 'Alice',
        age: 30,
        active: true,
        email: null,
        score: undefined,
      });
      expect(node.properties.name).toBe('Alice');
      expect(node.properties.age).toBe(30);
      expect(node.properties.active).toBe(true);
      expect(node.properties.email).toBe(null);
    });

    it('should reject nested object property values', async () => {
      await expect(
        graph.addNode('Person', {
          name: 'Alice',
          address: { city: 'NYC' },
        })
      ).rejects.toThrow(InvalidPropertyError);
    });

    it('should reject array property values', async () => {
      await expect(
        graph.addNode('Person', {
          name: 'Alice',
          tags: ['admin', 'user'],
        })
      ).rejects.toThrow(InvalidPropertyError);
    });

    it('should reject function property values', async () => {
      await expect(
        graph.addNode('Person', {
          name: 'Alice',
          callback: () => {},
        })
      ).rejects.toThrow(InvalidPropertyError);
    });

    it('should reject deeply nested objects', async () => {
      await expect(
        graph.addNode('Course', {
          title: 'Math',
          metadata: { info: { author: 'Dr. Smith' } },
        })
      ).rejects.toThrow(InvalidPropertyError);
    });
  });

  describe('Edge property validation', () => {
    it('should accept primitive property values', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', {
        since: 2020,
        weight: 0.95,
        active: true,
      });
      expect(edge.properties.since).toBe(2020);
      expect(edge.properties.weight).toBe(0.95);
      expect(edge.properties.active).toBe(true);
    });

    it('should reject nested object property values', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      await expect(
        graph.addEdge(alice.id, bob.id, 'KNOWS', {
          metadata: { level: 'high' },
        })
      ).rejects.toThrow(InvalidPropertyError);
    });

    it('should reject array property values', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      await expect(
        graph.addEdge(alice.id, bob.id, 'KNOWS', {
          skills: ['javascript', 'typescript'],
        })
      ).rejects.toThrow(InvalidPropertyError);
    });
  });
});

describe('Graph.createIndex', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  describe('createIndex on nodes', () => {
    it('should create simple index on node property', async () => {
      await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
      await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
      await graph.addNode('Course', { title: 'Math' });

      // Should not throw
      await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();

      // Should be able to query by the indexed property
      const results = await graph.getNodesByProperty('email', 'alice@example.com');
      expect(results).toHaveLength(1);
      expect(results[0].properties.name).toBe('Alice');
    });

    it('should create compound index on node property with type', async () => {
      await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
      await graph.addNode('Person', { name: 'Bob', email: 'bob@example.com' });
      await graph.addNode('Course', { title: 'Math' });

      // Create compound index for Person nodes only
      await expect(graph.createIndex('node', 'email', 'Person')).resolves.toBeUndefined();

      const results = await graph.getNodesByProperty('email', 'alice@example.com', { nodeType: 'Person' });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('Person');
    });

    it('should create simple index with type=*', async () => {
      await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
      await graph.addNode('Course', { title: 'Math', email: 'math@example.com' });

      // type='*' should create simple index across all types
      await expect(graph.createIndex('node', 'email', '*')).resolves.toBeUndefined();

      const results = await graph.getNodesByProperty('email', 'math@example.com');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('Course');
    });
  });

  describe('createIndex on edges', () => {
    it('should create simple index on edge property', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const charlie = await graph.addNode('Person', { name: 'Charlie' });

      await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
      await graph.addEdge(bob.id, charlie.id, 'KNOWS', { weight: 0.9 });

      // Should not throw
      await expect(graph.createIndex('edge', 'weight')).resolves.toBeUndefined();

      // Should be able to query by the indexed property
      const results = await graph.getEdgesByProperty('weight', 0.8);
      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe(alice.id);
      expect(results[0].targetId).toBe(bob.id);
    });

    it('should create compound index on edge property with type', async () => {
      const alice = await graph.addNode('Person', { name: 'Alice' });
      const bob = await graph.addNode('Person', { name: 'Bob' });
      const charlie = await graph.addNode('Person', { name: 'Charlie' });

      await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.8 });
      await graph.addEdge(bob.id, charlie.id, 'KNOWS', { weight: 0.9 });
      await graph.addEdge(alice.id, charlie.id, 'LIKES', { weight: 0.5 });

      // Create compound index for KNOWS edges only
      await expect(graph.createIndex('edge', 'weight', 'KNOWS')).resolves.toBeUndefined();

      const results = await graph.getEdgesByProperty('weight', 0.8, { edgeType: 'KNOWS' });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('KNOWS');
    });
  });

  describe('createIndex edge cases', () => {
    it('should allow multiple indexes on same target', async () => {
      await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com', age: 30 });

      await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();
      await expect(graph.createIndex('node', 'age')).resolves.toBeUndefined();
    });

    it('should be idempotent - calling twice should not error', async () => {
      await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });

      await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();
      await expect(graph.createIndex('node', 'email')).resolves.toBeUndefined();
    });
  });
});

describe('Graph.addNodeProperty', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should add a new property to a node', async () => {
    const node = await graph.addNode('Person', { name: 'Alice' });
    await graph.addNodeProperty(node.id, 'email', 'alice@example.com');
    
    const updated = await graph.getNode(node.id);
    expect(updated?.properties.email).toBe('alice@example.com');
  });

  it('should reject if property already exists', async () => {
    const node = await graph.addNode('Person', { name: 'Alice', email: 'existing@example.com' });
    await expect(
      graph.addNodeProperty(node.id, 'email', 'new@example.com')
    ).rejects.toThrow(/Property 'email' already exists/);
  });

  it('should reject non-primitive value', async () => {
    const node = await graph.addNode('Person', { name: 'Alice' });
    await expect(
      graph.addNodeProperty(node.id, 'address', { city: 'NYC' })
    ).rejects.toThrow(InvalidPropertyError);
  });

  it('should throw NodeNotFoundError for non-existent node', async () => {
    await expect(
      graph.addNodeProperty('non-existent-id', 'name', 'Bob')
    ).rejects.toThrow(/Node with id 'non-existent-id' not found/);
  });
});

describe('Graph.updateNodeProperty', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should update an existing node property', async () => {
    const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
    await graph.updateNodeProperty(node.id, 'age', 31);
    
    const updated = await graph.getNode(node.id);
    expect(updated?.properties.age).toBe(31);
  });

  it('should throw PropertyNotFoundError if property does not exist', async () => {
    const node = await graph.addNode('Person', { name: 'Alice' });
    await expect(
      graph.updateNodeProperty(node.id, 'email', 'alice@example.com')
    ).rejects.toThrow(/Property 'email' not found/);
  });

  it('should reject non-primitive value', async () => {
    const node = await graph.addNode('Person', { name: 'Alice' });
    await expect(
      graph.updateNodeProperty(node.id, 'address', { city: 'NYC' })
    ).rejects.toThrow(InvalidPropertyError);
  });

  it('should throw NodeNotFoundError for non-existent node', async () => {
    await expect(
      graph.updateNodeProperty('non-existent-id', 'name', 'Bob')
    ).rejects.toThrow(/Node with id 'non-existent-id' not found/);
  });
});

describe('Graph.deleteNodeProperty', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should delete a property from a node', async () => {
    const node = await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com' });
    await graph.deleteNodeProperty(node.id, 'email');
    
    const updated = await graph.getNode(node.id);
    expect(updated?.properties.email).toBeUndefined();
  });

  it('should throw NodeNotFoundError for non-existent node', async () => {
    await expect(
      graph.deleteNodeProperty('non-existent-id', 'email')
    ).rejects.toThrow(/Node with id 'non-existent-id' not found/);
  });
});

describe('Graph.clearNodeProperties', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should clear all properties from a node', async () => {
    const node = await graph.addNode('Person', { name: 'Alice', email: 'alice@example.com', age: 30 });
    await graph.clearNodeProperties(node.id);
    
    const updated = await graph.getNode(node.id);
    expect(updated?.properties).toEqual({});
  });

  it('should throw NodeNotFoundError for non-existent node', async () => {
    await expect(
      graph.clearNodeProperties('non-existent-id')
    ).rejects.toThrow(/Node with id 'non-existent-id' not found/);
  });
});

describe('Graph.addEdgeProperty', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should add a new property to an edge', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');
    
    await graph.addEdgeProperty(edge.id, 'weight', 0.95);
    
    const updated = await graph.getEdge(edge.id);
    expect(updated?.properties.weight).toBe(0.95);
  });

  it('should reject if property already exists', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.5 });
    
    await expect(
      graph.addEdgeProperty(edge.id, 'weight', 0.9)
    ).rejects.toThrow(/Property 'weight' already exists/);
  });

  it('should reject non-primitive value', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');
    
    await expect(
      graph.addEdgeProperty(edge.id, 'metadata', { level: 'high' })
    ).rejects.toThrow(InvalidPropertyError);
  });

  it('should throw EdgeNotFoundError for non-existent edge', async () => {
    await expect(
      graph.addEdgeProperty('non-existent-id', 'name', 'value')
    ).rejects.toThrow(/Edge with id 'non-existent-id' not found/);
  });
});

describe('Graph.updateEdgeProperty', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should update an existing edge property', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020 });
    
    await graph.updateEdgeProperty(edge.id, 'since', 2021);
    
    const updated = await graph.getEdge(edge.id);
    expect(updated?.properties.since).toBe(2021);
  });

  it('should throw PropertyNotFoundError if property does not exist', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');
    
    await expect(
      graph.updateEdgeProperty(edge.id, 'weight', 0.95)
    ).rejects.toThrow(/Property 'weight' not found/);
  });

  it('should reject non-primitive value', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS');
    
    await expect(
      graph.updateEdgeProperty(edge.id, 'metadata', { level: 'high' })
    ).rejects.toThrow(InvalidPropertyError);
  });

  it('should throw EdgeNotFoundError for non-existent edge', async () => {
    await expect(
      graph.updateEdgeProperty('non-existent-id', 'name', 'value')
    ).rejects.toThrow(/Edge with id 'non-existent-id' not found/);
  });
});

describe('Graph.deleteEdgeProperty', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should delete a property from an edge', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { weight: 0.5 });
    
    await graph.deleteEdgeProperty(edge.id, 'weight');
    
    const updated = await graph.getEdge(edge.id);
    expect(updated?.properties.weight).toBeUndefined();
  });

  it('should throw EdgeNotFoundError for non-existent edge', async () => {
    await expect(
      graph.deleteEdgeProperty('non-existent-id', 'weight')
    ).rejects.toThrow(/Edge with id 'non-existent-id' not found/);
  });
});

describe('Graph.clearEdgeProperties', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should clear all properties from an edge', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge = await graph.addEdge(alice.id, bob.id, 'KNOWS', { since: 2020, weight: 0.5 });
    
    await graph.clearEdgeProperties(edge.id);
    
    const updated = await graph.getEdge(edge.id);
    expect(updated?.properties).toEqual({});
  });

  it('should throw EdgeNotFoundError for non-existent edge', async () => {
    await expect(
      graph.clearEdgeProperties('non-existent-id')
    ).rejects.toThrow(/Edge with id 'non-existent-id' not found/);
  });
});
