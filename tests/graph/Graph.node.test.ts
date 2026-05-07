import { beforeEach, describe, expect, it } from '@jest/globals';
import { Graph } from '../../src/index';
import { NodeHasEdgesError } from '../../src/errors';

describe('Graph.Node Operations', () => {
  let graph: Graph;

  beforeEach(async () => {
    graph = new Graph();
  });

  it('should add a node without properties', async () => {
    const node = await graph.addNode('Person', { name: 'Alice' });
    expect(node.id).toBeDefined();
    expect(node.type).toBe('Person');
    expect(node.properties.name).toBe('Alice');
    expect(node.properties).toEqual({ name: 'Alice' });
  });

  it('should add a node with properties', async () => {
    const properties = { name: 'Alice', age: 30, city: 'NYC' };
    const node = await graph.addNode('Person', properties);
    expect(node.id).toBeDefined();
    expect(node.type).toBe('Person');
    expect(node.properties).toEqual({ name: 'Alice', age: 30, city: 'NYC' });
  });

  it('should retrieve a node by id', async () => {
    const node = await graph.addNode('Person', { name: 'Alice', age: 30 });
    const retrieved = await graph.getNode(node.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(node.id);
    expect(retrieved?.properties.age).toBe(30);
  });

  it('should return undefined for non-existent node', async () => {
    const node = await graph.getNode('non-existent-id');
    expect(node).toBeUndefined();
  });

  it('should check if node exists by id', async () => {
    const node = await graph.addNode('Person', { name: 'Alice' });
    await expect(graph.hasNode(node.id)).resolves.toBe(true);
    await expect(graph.hasNode('non-existent-id')).resolves.toBe(false);
  });

  it('should remove a node', async () => {
    const node = await graph.addNode('Person', { name: 'Alice' });
    await expect(graph.removeNode(node.id)).resolves.toBe(true);
    await expect(graph.hasNode(node.id)).resolves.toBe(false);
  });

  it('should return false when removing non-existent node', async () => {
    await expect(graph.removeNode('non-existent-id')).resolves.toBe(false);
  });

  it('should cascade remove incident edges when removing node', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    const edge1 = await graph.addEdge(alice.id, bob.id, 'KNOWS');
    const edge2 = await graph.addEdge(bob.id, alice.id, 'LIKES');

    await graph.removeNode(alice.id, true);

    await expect(graph.hasNode(alice.id)).resolves.toBe(false);
    await expect(graph.hasEdge(edge1.id)).resolves.toBe(false);
    await expect(graph.hasEdge(edge2.id)).resolves.toBe(false);
  });

  it('should throw NodeHasEdgesError when removing a connected node without cascade', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });
    const bob = await graph.addNode('Person', { name: 'Bob' });
    await graph.addEdge(alice.id, bob.id, 'KNOWS');

    await expect(graph.removeNode(alice.id)).rejects.toThrow(NodeHasEdgesError);
    // Node should still exist since removal was rejected
    await expect(graph.hasNode(alice.id)).resolves.toBe(true);
  });

  it('should remove a node without edges (no cascade needed)', async () => {
    const alice = await graph.addNode('Person', { name: 'Alice' });

    await expect(graph.removeNode(alice.id)).resolves.toBe(true);
    await expect(graph.hasNode(alice.id)).resolves.toBe(false);
  });

  it('should get all nodes', async () => {
    await graph.addNode('Person', { name: 'Alice' });
    await graph.addNode('Person', { name: 'Bob' });
    await graph.addNode('Person', { name: 'Charlie' });

    const nodes = await graph.getNodes();
    expect(nodes).toHaveLength(3);
  });

  it('should get nodes by type', async () => {
    await graph.addNode('Person', { name: 'Alice' });
    await graph.addNode('Person', { name: 'Bob' });
    await graph.addNode('Course', { name: 'Python' });

    const people = await graph.getNodesByType('Person');
    expect(people).toHaveLength(2);
    expect(people.map(n => n.properties.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('should get nodes by property', async () => {
    await graph.addNode('Person', { name: 'Alice', age: 30 });
    await graph.addNode('Person', { name: 'Bob', age: 25 });
    await graph.addNode('Person', { name: 'Charlie', age: 30 });

    const thirties = await graph.getNodesByProperty('age', 30);
    expect(thirties).toHaveLength(2);
    expect(thirties.map(n => n.properties.name).sort()).toEqual(['Alice', 'Charlie']);
  });

  it('should return empty array when property value does not match', async () => {
    await graph.addNode('Person', { name: 'Alice', age: 30 });
    await graph.addNode('Person', { name: 'Bob', age: 25 });

    const nonexistent = await graph.getNodesByProperty('age', 50);
    expect(nonexistent).toHaveLength(0);
  });

  it('should find nodes by string property value', async () => {
    await graph.addNode('Person', { name: 'Alice', city: 'NYC' });
    await graph.addNode('Person', { name: 'Bob', city: 'LA' });
    await graph.addNode('Person', { name: 'Charlie', city: 'NYC' });

    const nycResidents = await graph.getNodesByProperty('city', 'NYC');
    expect(nycResidents).toHaveLength(2);
    expect(nycResidents.map(n => n.properties.name).sort()).toEqual(['Alice', 'Charlie']);
  });
});
