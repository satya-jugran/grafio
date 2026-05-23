import type { IStorageProvider } from '../storage/IStorageProvider';
import type { TraversalOptions } from './TraversalOptions';
import { TraversalLimitExceededError } from '../errors';

/**
 * Internal class that handles graph traversal operations.
 * Provides path finding, cycle detection, and topological sorting.
 *
 * Operates directly on IStorageProvider so it works correctly with any
 * storage backend without depending on GraphIndex internals.
 *
 * All methods are async to support both synchronous in-memory providers
 * and asynchronous network-based providers through a unified API.
 */
export class GraphTraversal {
  constructor(private _store: IStorageProvider) { }

  /**
   * Gets traversable children for a given node during type-filtered traversal.
   * @param nodeId - The source node id
   * @param nodeTypes - Filter for node types (array with '*' for all, default: ['*'])
   * @param edgeTypes - Filter for edge types (array with '*' for all, default: ['*'])
   * @returns Array of child node ids that pass the type filters
   */
  private async _getTraversableChildren(
    nodeId: string,
    nodeTypes: string[] = ['*'],
    edgeTypes: string[] = ['*']
  ): Promise<string[]> {
    // Pass edge types to storage for filtering (supports multiple types)
    const edgeTypeFilter = (edgeTypes.length > 0 && !edgeTypes.includes('*')) ? edgeTypes : undefined;
    const outEdges = await this._store.getEdgesBySource(nodeId, edgeTypeFilter ? { filter: { types: edgeTypeFilter } } : undefined);
    const children: string[] = [];

    for (const edge of outEdges) {
      // Apply node type filter for target node
      const targetNode = await this._store.getNode(edge.targetId);
      if (!targetNode) continue;
      const shouldFilterNode = nodeTypes.length > 0 && !nodeTypes.includes('*');
      if (shouldFilterNode && !targetNode.labels.some(l => nodeTypes.includes(l))) {
        continue;
      }

      children.push(edge.targetId);
    }

    return children;
  }

  /**
   * Normalizes source/target input to an array of node IDs.
   * '*', [], and ['*'] all expand to all node IDs in the graph.
   * @param input - Single ID, '*', or array of IDs
   * @returns Array of node IDs
   */
  private async _normalizeToNodeIds(input: string | string[], nodeTypes?: string[]): Promise<string[]> {
    const isWildcard = Array.isArray(input)
      ? input.length === 0 || input.includes('*')
      : input === '*';

    if (!isWildcard) {
      return Array.isArray(input) ? input : [input];
    }

    // Use type-filtered query if nodeTypes are specified and not ['*']
    if (nodeTypes && nodeTypes.length > 0 && !nodeTypes.includes('*')) {
      // Use single query with multiple types (filter.types supports matching any of them)
      const nodes = await this._store.getNodes({ filter: { types: nodeTypes } });
      return nodes.map(n => n.id);
    }

    // Fall back to all nodes (limit to prevent unbounded traversal)
    const LIMIT = 100;
    const all = await this._store.getNodes({ limit: LIMIT });
    if (all.length >= LIMIT) {
      throw new TraversalLimitExceededError(LIMIT);
    }
    return all.map(n => n.id);
  }

  /**
   * Traverses the graph from source to target using the specified algorithm.
   * Supports wildcards: '*' or array of ids for source/target to find multiple paths.
   * @param sourceId - Id of the source node (or '*' for all nodes, or array of ids)
   * @param targetId - Id of the target node (or '*' for all nodes, or array of ids)
   * @param options - Traversal options including method, nodeTypes, and edgeTypes filters
   * @returns Array of paths (each path is array of node ids), or null if no paths found
   */
  async traverse(
    sourceId: string | string[],
    targetId: string | string[],
    options: TraversalOptions = {}
  ): Promise<string[][] | null> {
    const sources = await this._normalizeToNodeIds(sourceId, options.nodeTypes);
    const targets = await this._normalizeToNodeIds(targetId, options.nodeTypes);

    const allPaths: string[][] = [];
    // Both wildcards: hardcode maxResults to 10 to discourage blind wildcard search
    // while still honoring a smaller caller-provided maxResults.
    const onlyOneWildcard = (sourceId === '*' || (Array.isArray(sourceId) && sourceId.includes('*'))) !==
      (targetId === '*' || (Array.isArray(targetId) && targetId.includes('*')));
    const bothWildcards = (sourceId === '*' || (Array.isArray(sourceId) && sourceId.includes('*'))) &&
      (targetId === '*' || (Array.isArray(targetId) && targetId.includes('*')));
    const requestedMaxResults = options.maxResults ?? 100;
    const maxResults = onlyOneWildcard ? Math.min(requestedMaxResults, 50)
      : bothWildcards ? Math.min(requestedMaxResults, 10) : requestedMaxResults;

    for (const src of sources) {
      for (const tgt of targets) {
        const path = await this._traverseSingle(src, tgt, options);
        if (path !== null) {
          allPaths.push(path);
          if (maxResults && allPaths.length >= maxResults) break;
        }
      }
      if (maxResults && allPaths.length >= maxResults) break;
    }

    return allPaths.length > 0 ? allPaths : null;
  }

  /**
   * Internal method to traverse from a single source to a single target.
   * @param sourceId - Single source node id
   * @param targetId - Single target node id
   * @param options - Traversal options
   * @returns Single path as array of node ids, or null if no path exists
   */
  private async _traverseSingle(
    sourceId: string,
    targetId: string,
    options: TraversalOptions
  ): Promise<string[] | null> {
    const { method = 'bfs', nodeTypes = ['*'], edgeTypes = ['*'] } = options;

    const [sourceExists, targetExists] = await Promise.all([
      this._store.hasNode(sourceId),
      this._store.hasNode(targetId),
    ]);
    if (!sourceExists || !targetExists) {
      return null;
    }

    if (sourceId === targetId) {
      return [sourceId];
    }

    const visited = new Set<string>();
    const parent = new Map<string, string | null>();

    // Single frontier structure: index-based array used as queue (BFS) or stack (DFS)
    const frontier: string[] = [sourceId];
    let queueIndex = 0; // only used for BFS

    parent.set(sourceId, null);
    visited.add(sourceId);

    while (method === 'bfs' ? queueIndex < frontier.length : frontier.length > 0) {
      const current = method === 'bfs'
        ? frontier[queueIndex++]   // BFS: dequeue from front via index
        : frontier.pop()!;         // DFS: pop from back (LIFO)

      if (current === targetId) {
        // Reconstruct path
        const path: string[] = [];
        let node: string | null = targetId;
        while (node !== null) {
          path.push(node);
          node = parent.get(node) ?? null;
        }
        return path.reverse();
      }

      // Get children with type filtering
      const children = await this._getTraversableChildren(current, nodeTypes, edgeTypes);
      for (const childId of children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          parent.set(childId, current);
          frontier.push(childId);
        }
      }
    }

    return null;
  }

  /**
   * Check if graph is a Directed Acyclic Graph (no cycles).
   * Uses DFS-based cycle detection.
   * @returns true if the graph has no cycles, false otherwise
   */
  async isDAG(): Promise<boolean> {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const hasCycle = async (nodeId: string): Promise<boolean> => {
      visited.add(nodeId);
      visiting.add(nodeId);

      const children = await this._getTraversableChildren(nodeId);
      for (const childId of children) {
        if (!visited.has(childId)) {
          if (await hasCycle(childId)) return true;
        } else if (visiting.has(childId)) {
          return true;
        }
      }

      visiting.delete(nodeId);
      return false;
    };

    const nodes = await this._store.getNodes();
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        if (await hasCycle(node.id)) return false;
      }
    }

    return true;
  }

  /**
   * Computes a topological ordering of the graph nodes using Kahn's algorithm.
   * Returns null if the graph is not a DAG (contains cycles).
   * @returns Array of node ids in topological order, or null if graph has cycles
   */
  async topologicalSort(): Promise<string[] | null> {
    const [nodes, edges] = await Promise.all([
      this._store.getNodes(),
      this._store.getEdges(),
    ]);

    const nodeIds = new Set(nodes.map(n => n.id));

    // Calculate in-degree for each node
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
      inDegree.set(node.id, 0);
    }

    // Build adjacency list and calculate in-degrees
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) {
      adjacency.set(node.id, []);
    }

    for (const edge of edges) {
      // Skip edges with dangling endpoints (nodes removed without cascade)
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue;
      adjacency.get(edge.sourceId)!.push(edge.targetId);
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) ?? 0) + 1);
    }

    // Kahn's algorithm: start with nodes that have no incoming edges
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const result: string[] = [];
    let queueIndex = 0;

    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      result.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    // If we didn't process all nodes, there's a cycle
    return result.length !== nodes.length ? null : result;
  }
}
