import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import type { NodeData, EdgeData } from '../../src/types';
import { CachedStorageProvider } from '../../src/storage/CachedStorageProvider';
import { CacheManager } from '../../src/storage/cache/CacheManager';
import { CacheConfig } from '../../src/storage/cache/CacheConfig';
import { ITransactionHandle } from '../../src/storage/IStorageProvider';

// Mock IStorageProvider for testing CachedStorageProvider behavior
class MockStorageProvider {
  public nodes: Map<string, NodeData> = new Map();
  public edges: Map<string, EdgeData> = new Map();
  public insertNodeCalls: Array<{ node: NodeData; transaction?: ITransactionHandle }> = [];
  public insertEdgeCalls: Array<{ edge: EdgeData; transaction?: ITransactionHandle }> = [];
  public hasNodeCalls: string[] = [];
  public getNodeCalls: string[] = [];

  async insertNode(node: NodeData, transaction?: ITransactionHandle): Promise<void> {
    this.insertNodeCalls.push({ node, transaction });
    this.nodes.set(node.id, node);
  }

  async insertEdge(edge: EdgeData, transaction?: ITransactionHandle): Promise<void> {
    this.insertEdgeCalls.push({ edge, transaction });
    this.edges.set(edge.id, edge);
  }

  async deleteNode(id: string, transaction?: ITransactionHandle): Promise<void> {
    this.nodes.delete(id);
  }

  async deleteEdge(id: string, transaction?: ITransactionHandle): Promise<void> {
    this.edges.delete(id);
  }

  async hasNode(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    this.hasNodeCalls.push(id);
    return this.nodes.has(id);
  }

  async hasEdge(id: string, transaction?: ITransactionHandle): Promise<boolean> {
    return this.edges.has(id);
  }

  async getNode(id: string, transaction?: ITransactionHandle): Promise<NodeData | undefined> {
    this.getNodeCalls.push(id);
    return this.nodes.get(id);
  }

  async getEdge(id: string, transaction?: ITransactionHandle): Promise<EdgeData | undefined> {
    return this.edges.get(id);
  }

  async getAllNodes(limit?: number, orderBy?: { field: string; direction: 'asc' | 'desc' }): Promise<NodeData[]> {
    let nodes = Array.from(this.nodes.values());
    if (orderBy?.field === 'updatedOn') {
      nodes.sort((a, b) => {
        const aVal = (a as any).updatedOn ?? 0;
        const bVal = (b as any).updatedOn ?? 0;
        return orderBy.direction === 'desc' ? bVal - aVal : aVal - bVal;
      });
    }
    if (limit) nodes = nodes.slice(0, limit);
    return nodes;
  }

  async getAllEdges(limit?: number, orderBy?: { field: string; direction: 'asc' | 'desc' }): Promise<EdgeData[]> {
    let edges = Array.from(this.edges.values());
    if (orderBy?.field === 'updatedOn') {
      edges.sort((a, b) => {
        const aVal = (a as any).updatedOn ?? 0;
        const bVal = (b as any).updatedOn ?? 0;
        return orderBy.direction === 'desc' ? bVal - aVal : aVal - bVal;
      });
    }
    if (limit) edges = edges.slice(0, limit);
    return edges;
  }

  async getNodesByType(type: string): Promise<NodeData[]> {
    return Array.from(this.nodes.values()).filter(n => n.type === type);
  }

  async getEdgesByType(type: string): Promise<EdgeData[]> {
    return Array.from(this.edges.values()).filter(e => e.type === type);
  }

  async getEdgesBySource(nodeId: string): Promise<EdgeData[]> {
    return Array.from(this.edges.values()).filter(e => e.sourceId === nodeId);
  }

  async getEdgesByTarget(nodeId: string): Promise<EdgeData[]> {
    return Array.from(this.edges.values()).filter(e => e.targetId === nodeId);
  }

  async getTotalNodeCount(): Promise<number> {
    return this.nodes.size;
  }

  async getTotalEdgeCount(): Promise<number> {
    return this.edges.size;
  }

  async addProperty(): Promise<void> {}
  async updateProperty(): Promise<void> {}
  async deleteProperty(): Promise<void> {}
  async clearProperties(): Promise<void> {}
  async createIndex(): Promise<void> {}
  async exportJSON() { return { nodes: [], edges: [] }; }
  async importJSON() {}

  supportsTransactions(): boolean { return true; }
  async beginTransaction(): Promise<ITransactionHandle> {
    return { id: 'txn-1',  context: {} };
  }
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}

  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.insertNodeCalls = [];
    this.insertEdgeCalls = [];
  }
}

describe('CachedStorageProvider', () => {
  const defaultConfig: CacheConfig = {
    maxNodesCount: 100,
    maxEdgesCount: 200,
    cacheStore: 'in-memory',
    evictionStrategy: 'LRU',
    preloadStrategy: 'none',
  };

  let mockProvider: MockStorageProvider;
  let cacheManager: CacheManager;
  let provider: CachedStorageProvider;

  beforeEach(() => {
    mockProvider = new MockStorageProvider();
    cacheManager = new CacheManager(defaultConfig);
    provider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, defaultConfig);
  });

  afterEach(async () => {
    await cacheManager.invalidateAll();
  });

  describe('transaction bypass — insertNode/insertEdge', () => {
    it('should NOT populate cache when inserting inside a transaction', async () => {
      const txn = await provider.beginTransaction();
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} }, txn);

      // Cache should NOT have the node
      const cached = await cacheManager.getNode('graph-test', 'node-1');
      expect(cached).toBeUndefined();

      // But underlying storage should have it
      expect(mockProvider.nodes.has('node-1')).toBe(true);
    });

    it('should populate cache after commit when insert was in transaction', async () => {
      const txn = await provider.beginTransaction();
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} }, txn);
      await provider.commitTransaction(txn);

      // After commit, cache should be populated on next read (not during commit)
      const node = await provider.getNode('node-1');
      expect(node).not.toBeUndefined();
    });

    it('should NOT populate cache when inserting edge inside a transaction', async () => {
      const txn = await provider.beginTransaction();
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} }, txn);

      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });
  });

  describe('transaction bypass — hasNode/getNode', () => {
    it('should bypass cache on hasNode when inside transaction', async () => {
      // Insert node without transaction first
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });
      // Cache it
      await cacheManager.setNode('graph-test', 'node-1', { id: 'node-1', type: 'Test', properties: {} });

      // Now query inside transaction — should hit underlying (which knows about the node)
      const txn = await provider.beginTransaction();
      const result = await provider.hasNode('node-1', txn);

      expect(result).toBe(true);
      // hasNodeCalls tracks calls to underlying (bypass cache)
      expect(mockProvider.hasNodeCalls).toContain('node-1');
    });

    it('should bypass cache on getNode when inside transaction', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });

      const txn = await provider.beginTransaction();
      await provider.getNode('node-1', txn);

      expect(mockProvider.getNodeCalls).toContain('node-1');
    });
  });

  describe('write-through cache population (no transaction)', () => {
    it('should populate cache after insertNode without transaction', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });

      const cached = await cacheManager.getNode('graph-test', 'node-1');
      expect(cached).not.toBeUndefined();
      expect(cached!.id).toBe('node-1');
    });

    it('should populate cache after insertEdge without transaction', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();
    });

    it('should NOT populate cache when node budget exceeded', async () => {
      // Use a tiny budget
      const tinyConfig: CacheConfig = { ...defaultConfig, maxNodesCount: 1 };
      const tinyCacheManager = new CacheManager(tinyConfig);
      const tinyProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', tinyCacheManager, tinyConfig);

      // Insert first node (should be cached)
      await tinyProvider.insertNode({ id: 'node-1', type: 'Test', properties: {} });
      const cached1 = await tinyCacheManager.getNode('graph-test', 'node-1');
      expect(cached1).not.toBeUndefined();

      // Insert second node - budget exceeded, should NOT be cached
      await tinyProvider.insertNode({ id: 'node-2', type: 'Test', properties: {} });
      const cached2 = await tinyCacheManager.getNode('graph-test', 'node-2');
      expect(cached2).toBeUndefined(); // Budget exceeded, not cached

      await tinyCacheManager.invalidateAll();
    });

    it('should NOT populate cache when edge budget exceeded', async () => {
      // Use a tiny budget
      const tinyConfig: CacheConfig = { ...defaultConfig, maxEdgesCount: 1 };
      const tinyCacheManager = new CacheManager(tinyConfig);
      const tinyProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', tinyCacheManager, tinyConfig);

      // Insert first edge (should be cached)
      await tinyProvider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      const cached1 = await tinyCacheManager.getEdge('graph-test', 'edge-1');
      expect(cached1).not.toBeUndefined();

      // Insert second edge - budget exceeded, should NOT be cached
      await tinyProvider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} });
      const cached2 = await tinyCacheManager.getEdge('graph-test', 'edge-2');
      expect(cached2).toBeUndefined(); // Budget exceeded, not cached

      await tinyCacheManager.invalidateAll();
    });
  });

  describe('cache hit branches — getNode', () => {
    it('should return cached node without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setNode('graph-test', 'node-cached', { id: 'node-cached', type: 'Test', properties: {} });

      const node = await provider.getNode('node-cached');

      expect(node).not.toBeUndefined();
      expect(node!.id).toBe('node-cached');
      // Underlying getNode should NOT be called when cache hit
      expect(mockProvider.getNodeCalls).not.toContain('node-cached');
    });
  });

  describe('warmCache() strategies', () => {
    it('should do nothing when preloadStrategy is none', async () => {
      const freshCacheManager = new CacheManager(defaultConfig);
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'none' };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', freshCacheManager, config);

      // Add some data to underlying via insert (which write-through caches)
      await p.insertNode({ id: 'node-1', type: 'Test', properties: {} });

      // warmCache with 'none' should not add more
      await p.warmCache();

      // Cache has the write-through entry but warmCache did nothing additional
      const cached = await freshCacheManager.getNode('graph-test', 'node-1');
      expect(cached).not.toBeUndefined(); // write-through already populated it

      await freshCacheManager.invalidateAll();
    });

    it('should load all nodes/edges when preloadStrategy is all', async () => {
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, config);

      await p.insertNode({ id: 'node-1', type: 'Test', properties: {} });
      await p.insertNode({ id: 'node-2', type: 'Test', properties: {} });
      await p.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      await p.warmCache();

      const node1 = await cacheManager.getNode('graph-test', 'node-1');
      const node2 = await cacheManager.getNode('graph-test', 'node-2');
      const edge1 = await cacheManager.getEdge('graph-test', 'edge-1');

      expect(node1).not.toBeUndefined();
      expect(node2).not.toBeUndefined();
      expect(edge1).not.toBeUndefined();
    });

    it('should load nodes/edges sorted by updatedOn desc when preloadStrategy is recent', async () => {
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'recent', maxNodesCount: 10, maxEdgesCount: 10 };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, config);

      // Insert nodes with different updatedOn timestamps
      await p.insertNode({ id: 'node-old', type: 'Test', properties: {}, updatedOn: 100 });
      await p.insertNode({ id: 'node-new', type: 'Test', properties: {}, updatedOn: 200 });
      await p.insertNode({ id: 'node-mid', type: 'Test', properties: {}, updatedOn: 150 });

      // Insert edges to test adjacency index population
      await p.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'node-old', targetId: 'node-new', properties: {} });
      await p.insertEdge({ id: 'edge-2', type: 'KNOWS', sourceId: 'node-mid', targetId: 'node-old', properties: {} });

      await p.warmCache();

      // Cache should have all nodes
      const nodeOld = await cacheManager.getNode('graph-test', 'node-old');
      const nodeNew = await cacheManager.getNode('graph-test', 'node-new');
      const nodeMid = await cacheManager.getNode('graph-test', 'node-mid');

      expect(nodeOld).not.toBeUndefined();
      expect(nodeNew).not.toBeUndefined();
      expect(nodeMid).not.toBeUndefined();

      // Verify adjacency index is populated for edges
      const edgesFromOld = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'node-old');
      expect(edgesFromOld).toContain('edge-1');

      const edgesToOld = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'node-old');
      expect(edgesToOld).toContain('edge-2');
    });

    it('should load first N nodes/edges when preloadStrategy is first-n', async () => {
      const config: CacheConfig = { ...defaultConfig, preloadStrategy: 'first-n', maxNodesCount: 2, maxEdgesCount: 2 };
      const p = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, config);

      // Insert 5 nodes
      for (let i = 1; i <= 5; i++) {
        await p.insertNode({ id: `node-${i}`, type: 'Test', properties: {} });
      }

      // Insert edges to test adjacency index population
      await p.insertEdge({ id: 'edge-a', type: 'KNOWS', sourceId: 'node-1', targetId: 'node-2', properties: {} });
      await p.insertEdge({ id: 'edge-b', type: 'KNOWS', sourceId: 'node-2', targetId: 'node-3', properties: {} });
      await p.insertEdge({ id: 'edge-c', type: 'KNOWS', sourceId: 'node-3', targetId: 'node-4', properties: {} });

      await p.warmCache();

      // Should only cache first 2 (maxNodesCount limit)
      const node1 = await cacheManager.getNode('graph-test', 'node-1');
      const node2 = await cacheManager.getNode('graph-test', 'node-2');

      expect(node1).not.toBeUndefined();
      expect(node2).not.toBeUndefined();

      // Verify adjacency index is populated for edges
      const edgesFrom1 = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'node-1');
      expect(edgesFrom1).toContain('edge-a');

      const edgesTo2 = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'node-2');
      expect(edgesTo2).toContain('edge-a');
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate node from cache on deleteNode', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });

      const cached = await cacheManager.getNode('graph-test', 'node-1');
      expect(cached).not.toBeUndefined();

      await provider.deleteNode('node-1');

      const afterDelete = await cacheManager.getNode('graph-test', 'node-1');
      expect(afterDelete).toBeUndefined();
    });

    it('should invalidate edge from cache on deleteEdge', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).not.toBeUndefined();

      await provider.deleteEdge('edge-1');

      const afterDelete = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(afterDelete).toBeUndefined();
    });

    it('should invalidate all for graph on clear()', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      await provider.clear();

      const nodeStats = await cacheManager.getStats();
      expect(nodeStats.totalNodes).toBe(0);
    });
  });

  describe('delegation to underlying — hasNode (no transaction)', () => {
    it('should return true when node exists', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });

      const result = await provider.hasNode('node-1');

      expect(result).toBe(true);
    });

    it('should return false when node does not exist', async () => {
      const result = await provider.hasNode('nonexistent');
      expect(result).toBe(false);
    });

    it('should return true from cache without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setNode('graph-test', 'node-cached', { id: 'node-cached', type: 'Test', properties: {} });

      const result = await provider.hasNode('node-cached');

      expect(result).toBe(true);
      // Underlying hasNode should NOT be called when cache hit
      expect(mockProvider.hasNodeCalls).not.toContain('node-cached');
    });

    it('should cache node data after hasNode finds it in underlying on cache miss', async () => {
      // Insert node directly into mock storage (bypassing cache)
      await mockProvider.insertNode({ id: 'node-orphan', type: 'Test', properties: {} });

      // hasNode should find it in underlying and cache it
      const result = await provider.hasNode('node-orphan');
      expect(result).toBe(true);

      // Verify cache was populated (subsequent getNode should hit cache)
      const cached = await cacheManager.getNode('graph-test', 'node-orphan');
      expect(cached).not.toBeUndefined();
      expect(cached!.id).toBe('node-orphan');
    });
  });

  describe('delegation to underlying — hasEdge', () => {
    it('should return true when edge exists', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const result = await provider.hasEdge('edge-1');

      expect(result).toBe(true);
    });

    it('should return false when edge does not exist', async () => {
      const result = await provider.hasEdge('nonexistent');
      expect(result).toBe(false);
    });

    it('should return true from cache without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setEdge('graph-test', 'edge-cached', { id: 'edge-cached', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const result = await provider.hasEdge('edge-cached');

      expect(result).toBe(true);
    });

    it('should cache edge data after hasEdge finds it in underlying on cache miss', async () => {
      // Insert edge directly into mock storage (bypassing cache)
      await mockProvider.insertEdge({ id: 'edge-orphan', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      // hasEdge should find it in underlying and cache it
      const result = await provider.hasEdge('edge-orphan');
      expect(result).toBe(true);

      // Verify cache was populated
      const cached = await cacheManager.getEdge('graph-test', 'edge-orphan');
      expect(cached).not.toBeUndefined();
      expect(cached!.id).toBe('edge-orphan');
    });
  });

  describe('delegation to underlying — getEdge', () => {
    it('should return edge when it exists', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const edge = await provider.getEdge('edge-1');

      expect(edge).not.toBeUndefined();
      expect(edge!.id).toBe('edge-1');
    });

    it('should return undefined when edge does not exist', async () => {
      const edge = await provider.getEdge('nonexistent');
      expect(edge).toBeUndefined();
    });

    it('should return edge from cache without calling underlying when cache hit', async () => {
      // Pre-populate cache directly
      await cacheManager.setEdge('graph-test', 'edge-cached', { id: 'edge-cached', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });

      const edge = await provider.getEdge('edge-cached');

      expect(edge).not.toBeUndefined();
      expect(edge!.id).toBe('edge-cached');
      // getEdgeCalls should NOT include 'edge-cached' when cache hit
      expect(mockProvider.getNodeCalls).not.toContain('edge-cached');
    });

    it('should return undefined when getEdge finds no edge in underlying on cache miss', async () => {
      // No edge inserted, cache miss, underlying returns undefined
      const edge = await provider.getEdge('nonexistent-edge');
      expect(edge).toBeUndefined();
    });
  });

  describe('delegation to underlying — getAllNodes', () => {
    it('should return all nodes from underlying', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: {} });

      const nodes = await provider.getAllNodes();

      expect(nodes).toHaveLength(2);
    });

    it('should return empty array when no nodes', async () => {
      const nodes = await provider.getAllNodes();
      expect(nodes).toHaveLength(0);
    });
  });

  describe('delegation to underlying — getAllEdges', () => {
    it('should return all edges from underlying', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} });

      const edges = await provider.getAllEdges();

      expect(edges).toHaveLength(2);
    });

    it('should return empty array when no edges', async () => {
      const edges = await provider.getAllEdges();
      expect(edges).toHaveLength(0);
    });
  });

  describe('delegation to underlying — getNodesByType', () => {
    it('should return nodes filtered by type', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Person', properties: {} });
      await provider.insertNode({ id: 'node-2', type: 'Place', properties: {} });
      await provider.insertNode({ id: 'node-3', type: 'Person', properties: {} });

      const nodes = await provider.getNodesByType('Person');

      expect(nodes).toHaveLength(2);
    });
  });

  describe('delegation to underlying — getEdgesByType', () => {
    it('should return edges filtered by type', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'LIKES', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'KNOWS', sourceId: 'n3', targetId: 'n4', properties: {} });

      const edges = await provider.getEdgesByType('KNOWS');

      expect(edges).toHaveLength(2);
    });
  });

  describe('delegation to underlying — getEdgesBySource', () => {
    it('should return edges filtered by source', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'KNOWS', sourceId: 'n1', targetId: 'n3', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'KNOWS', sourceId: 'n4', targetId: 'n5', properties: {} });

      const edges = await provider.getEdgesBySource('n1');

      expect(edges).toHaveLength(2);
    });
  });

  describe('delegation to underlying — getEdgesByTarget', () => {
    it('should return edges filtered by target', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'KNOWS', sourceId: 'n3', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-3', type: 'KNOWS', sourceId: 'n4', targetId: 'n5', properties: {} });

      const edges = await provider.getEdgesByTarget('n2');

      expect(edges).toHaveLength(2);
    });
  });

  describe('delegation to underlying — property operations', () => {
    it('should delegate addProperty', async () => {
      const spy = jest.spyOn(mockProvider, 'addProperty');
      await provider.addProperty('node', 'node-1', 'name', 'Alice');
      expect(spy).toHaveBeenCalledWith('node', 'node-1', 'name', 'Alice', undefined);
    });

    it('should delegate updateProperty', async () => {
      const spy = jest.spyOn(mockProvider, 'updateProperty');
      await provider.updateProperty('node', 'node-1', 'name', 'Bob');
      expect(spy).toHaveBeenCalledWith('node', 'node-1', 'name', 'Bob', undefined);
    });

    it('should delegate deleteProperty', async () => {
      const spy = jest.spyOn(mockProvider, 'deleteProperty');
      await provider.deleteProperty('node', 'node-1', 'name');
      expect(spy).toHaveBeenCalledWith('node', 'node-1', 'name', undefined);
    });

    it('should delegate clearProperties', async () => {
      const spy = jest.spyOn(mockProvider, 'clearProperties');
      await provider.clearProperties('node', 'node-1');
      expect(spy).toHaveBeenCalledWith('node', 'node-1', undefined);
    });

    it('should invalidate edge cache when addProperty targets edge', async () => {
      await cacheManager.setEdge('graph-test', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.addProperty('edge', 'edge-1', 'weight', 5);
      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });

    it('should invalidate edge cache when updateProperty targets edge', async () => {
      await cacheManager.setEdge('graph-test', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.updateProperty('edge', 'edge-1', 'weight', 10);
      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });

    it('should invalidate edge cache when deleteProperty targets edge', async () => {
      await cacheManager.setEdge('graph-test', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.deleteProperty('edge', 'edge-1', 'weight');
      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });

    it('should invalidate edge cache when clearProperties targets edge', async () => {
      await cacheManager.setEdge('graph-test', 'edge-1', { id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.clearProperties('edge', 'edge-1');
      const cached = await cacheManager.getEdge('graph-test', 'edge-1');
      expect(cached).toBeUndefined();
    });
  });

  describe('delegation to underlying — createIndex', () => {
    it('should delegate createIndex', async () => {
      const spy = jest.spyOn(mockProvider, 'createIndex');
      await provider.createIndex('node', 'name');
      expect(spy).toHaveBeenCalledWith('node', 'name', undefined);
    });
  });

  describe('delegation to underlying — exportJSON/importJSON', () => {
    it('should delegate exportJSON', async () => {
      const spy = jest.spyOn(mockProvider, 'exportJSON');
      await provider.exportJSON();
      expect(spy).toHaveBeenCalled();
    });

    it('should delegate importJSON', async () => {
      const spy = jest.spyOn(mockProvider, 'importJSON');
      await provider.importJSON({ nodes: [], edges: [] });
      expect(spy).toHaveBeenCalledWith({ nodes: [], edges: [] });
    });
  });

  describe('delegation to underlying — supportsTransactions', () => {
    it('should return underlying supportsTransactions', () => {
      expect(provider.supportsTransactions()).toBe(true);
    });
  });

  describe('delegation to underlying — rollbackTransaction', () => {
    it('should delegate rollbackTransaction', async () => {
      const spy = jest.spyOn(mockProvider, 'rollbackTransaction');
      const txn = await provider.beginTransaction();
      await provider.rollbackTransaction(txn);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('getAllNodes cache optimization', () => {
    it('should serve from cache when orderBy is undefined and cache has entries', async () => {
      // Insert nodes into underlying
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: {} });

      // Warm the cache to populate it (need preloadStrategy: all)
      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      // Verify cache is being used by checking underlying was not called
      const spy = jest.spyOn(mockProvider, 'getAllNodes');
      const nodes = await warmProvider.getAllNodes();

      expect(nodes).toHaveLength(2);
      expect(nodes.map(n => n.id).sort()).toEqual(['node-1', 'node-2']);
    });

    it('should delegate to underlying when orderBy provided but cache is incomplete', async () => {
      // Insert only some nodes into cache via insertNode
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: {} });

      // Warm cache for only 2 nodes
      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Manually add a node to underlying but not to cache
      mockProvider.nodes.set('node-3', { id: 'node-3', type: 'Test', properties: {} });

      const nodes = await warmProvider.getAllNodes(undefined, { field: 'updatedOn', direction: 'asc' });

      // Should get all 3 nodes from underlying since cache is incomplete
      expect(nodes).toHaveLength(3);
    });

    it('should delegate to underlying when inside transaction', async () => {
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: {} });

      const txn = await provider.beginTransaction();
      const nodes = await provider.getAllNodes(undefined, undefined, txn);

      expect(nodes).toHaveLength(1);
    });

    it('should limit results when limit <= cachedCount', async () => {
      // Insert 5 nodes
      for (let i = 1; i <= 5; i++) {
        await provider.insertNode({ id: `node-${i}`, type: 'Test', properties: { order: i } });
      }

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      // Request only 3 nodes, cache has 5
      const nodes = await warmProvider.getAllNodes(3);

      expect(nodes).toHaveLength(3);
    });

    it('should serve from cache with sorting when orderBy provided and cache is complete', async () => {
      // Insert nodes with different createdOn timestamps
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'A' }, createdOn: 1000 });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: { name: 'B' }, createdOn: 3000 });
      await provider.insertNode({ id: 'node-3', type: 'Test', properties: { name: 'C' }, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // NOTE: Do NOT clear underlying here - the orderBy case requires cachedCount === totalCount
      // If we clear underlying, totalCount would be 0 while cachedCount is 3, breaking the condition

      const nodes = await warmProvider.getAllNodes(undefined, { field: 'createdOn', direction: 'desc' });

      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe('node-2'); // highest createdOn
      expect(nodes[1].id).toBe('node-3');
      expect(nodes[2].id).toBe('node-1'); // lowest createdOn
    });

    it('should handle undefined fields during sorting', async () => {
      // Insert nodes where some have undefined createdOn
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'A' }, createdOn: 1000 });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: { name: 'B' } }); // createdOn undefined
      await provider.insertNode({ id: 'node-3', type: 'Test', properties: { name: 'C' }, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const nodes = await warmProvider.getAllNodes(undefined, { field: 'createdOn', direction: 'asc' });

      // node-2 with undefined createdOn should come last in asc order
      expect(nodes).toHaveLength(3);
      expect(nodes[2].id).toBe('node-2'); // undefined values sort to end in asc
    });

    it('should sort desc with undefined fields', async () => {
      // Insert nodes where some have undefined createdOn
      await provider.insertNode({ id: 'node-1', type: 'Test', properties: { name: 'A' }, createdOn: 1000 });
      await provider.insertNode({ id: 'node-2', type: 'Test', properties: { name: 'B' } }); // createdOn undefined
      await provider.insertNode({ id: 'node-3', type: 'Test', properties: { name: 'C' }, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const nodes = await warmProvider.getAllNodes(undefined, { field: 'createdOn', direction: 'desc' });

      // node-2 with undefined createdOn should come first in desc order
      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe('node-2'); // undefined values sort to start in desc
    });
  });

  describe('getAllEdges cache optimization', () => {
    it('should serve from cache when orderBy is undefined and cache has entries', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {} });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      const spy = jest.spyOn(mockProvider, 'getAllEdges');
      const edges = await warmProvider.getAllEdges();

      expect(edges).toHaveLength(2);
      expect(edges.map(e => e.id).sort()).toEqual(['edge-1', 'edge-2']);
    });

    it('should limit results when limit <= cachedCount', async () => {
      // Insert 5 edges
      for (let i = 1; i <= 5; i++) {
        await provider.insertEdge({ id: `edge-${i}`, type: 'Test', sourceId: `n${i}`, targetId: `n${i+1}`, properties: {} });
      }

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // Do NOT clear underlying - cache completeness check requires cachedCount === totalCount
      // Request only 3 edges, cache has 5
      const edges = await warmProvider.getAllEdges(3);

      expect(edges).toHaveLength(3);
    });

    it('should serve from cache with sorting when orderBy provided and cache is complete', async () => {
      // Insert edges with different createdOn timestamps
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {}, createdOn: 3000 });
      await provider.insertEdge({ id: 'edge-3', type: 'Test', sourceId: 'n5', targetId: 'n6', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      // NOTE: Do NOT clear underlying here - the orderBy case requires cachedCount === totalCount

      const edges = await warmProvider.getAllEdges(undefined, { field: 'createdOn', direction: 'desc' });

      expect(edges).toHaveLength(3);
      expect(edges[0].id).toBe('edge-2'); // highest createdOn
      expect(edges[1].id).toBe('edge-3');
      expect(edges[2].id).toBe('edge-1'); // lowest createdOn
    });

    it('should handle undefined fields during edge sorting', async () => {
      // Insert edges where some have undefined createdOn
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} }); // createdOn undefined
      await provider.insertEdge({ id: 'edge-3', type: 'Test', sourceId: 'n5', targetId: 'n6', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getAllEdges(undefined, { field: 'createdOn', direction: 'asc' });

      // edge-2 with undefined createdOn should come last in asc order
      expect(edges).toHaveLength(3);
      expect(edges[2].id).toBe('edge-2'); // undefined values sort to end in asc
    });

    it('should sort edges desc with undefined fields', async () => {
      // Insert edges where some have undefined createdOn
      await provider.insertEdge({ id: 'edge-1', type: 'Test', sourceId: 'n1', targetId: 'n2', properties: {}, createdOn: 1000 });
      await provider.insertEdge({ id: 'edge-2', type: 'Test', sourceId: 'n3', targetId: 'n4', properties: {} }); // createdOn undefined
      await provider.insertEdge({ id: 'edge-3', type: 'Test', sourceId: 'n5', targetId: 'n6', properties: {}, createdOn: 2000 });

      const warmConfig: CacheConfig = { ...defaultConfig, preloadStrategy: 'all' };
      const warmProvider = new CachedStorageProvider(mockProvider as any, 'graph-test', cacheManager, warmConfig);
      await warmProvider.warmCache();

      const edges = await warmProvider.getAllEdges(undefined, { field: 'createdOn', direction: 'desc' });

      // edge-2 with undefined createdOn should come first in desc order
      expect(edges).toHaveLength(3);
      expect(edges[0].id).toBe('edge-2'); // undefined values sort to start in desc
    });
  });

  describe('getEdgesBySource cache optimization', () => {
    it('should delegate to underlying when inside transaction', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      const txn = await provider.beginTransaction();
      const edges = await provider.getEdgesBySource('n1', undefined, txn);

      expect(edges).toHaveLength(1);
    });
  });

  describe('getEdgesByTarget cache optimization', () => {
    it('should delegate to underlying when inside transaction', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      const txn = await provider.beginTransaction();
      const edges = await provider.getEdgesByTarget('n2', undefined, txn);

      expect(edges).toHaveLength(1);
    });
  });

  describe('adjacency index maintenance', () => {
    it('should update adjacency index on insertEdge', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      const sourceEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'n1');
      const targetEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'n2');

      expect(sourceEdges).toContain('edge-1');
      expect(targetEdges).toContain('edge-1');
    });

    it('should remove from adjacency index on deleteEdge', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      await provider.deleteEdge('edge-1');

      const sourceEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'n1');
      const targetEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'target', 'n2');

      expect(sourceEdges).not.toContain('edge-1');
      expect(targetEdges).not.toContain('edge-1');
    });

    it('should invalidate adjacency on clear', async () => {
      await provider.insertEdge({ id: 'edge-1', type: 'KNOWS', sourceId: 'n1', targetId: 'n2', properties: {} });

      await provider.clear();

      const sourceEdges = await cacheManager.getEdgeIdsByAdjacencyIndex('graph-test', 'source', 'n1');
      expect(sourceEdges).toHaveLength(0);
    });
  });
});
