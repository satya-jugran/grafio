import { Node } from '../Node';
import { Edge } from '../Edge';
import {
  NodeAlreadyExistsError,
  EdgeAlreadyExistsError,
  NodeNotFoundError,
  InvalidPropertyError,
  NodeHasEdgesError,
} from '../errors';
import { findInvalidPropertyEntry } from '../utils';
import {
  isSyncGraphKernel,
  type CreateIndexOptions,
  type IndexMetadata,
  type IStorageProvider,
  type ISyncGraphKernel,
  type StorageQueryOptions,
} from '../storage/IStorageProvider';
import type { AggregateResult, PropertyPatch } from '../types';
import type { GraphQueryOptions } from './GraphQueryOptions';
import { InMemoryStorageProvider } from '../storage/InMemoryStorageProvider';
import { GraphTransaction } from './GraphTransaction';

/**
 * Internal class that manages graph CRUD, indexing, and aggregations.
 *
 * Uses the synchronous `ISyncGraphKernel` fast path when backed by
 * `InMemoryStorageProvider` (returning cached lazy-property `Node` / `Edge`
 * instances without redundant copies or microtask overhead), and falls back
 * transparently to async `IStorageProvider` calls for remote/cached backends.
 */
export class GraphIndex {
  private readonly _store: IStorageProvider;
  private readonly _kernel: ISyncGraphKernel | null;

  constructor(store: IStorageProvider = new InMemoryStorageProvider()) {
    this._store = store;
    this._kernel = isSyncGraphKernel(store) ? store : null;
  }

  /** @internal Exposes the underlying storage provider. */
  _getStore(): IStorageProvider {
    return this._store;
  }

  /** @internal Exposes the synchronous kernel when backed by InMemoryStorageProvider. */
  _getSyncKernel(): ISyncGraphKernel | null {
    return this._kernel;
  }

  get indexEpoch(): number {
    return this._store.indexEpoch;
  }

  compact(): void {
    if (this._kernel) {
      this._kernel.compact();
    } else {
      this._store.compact?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Node Queries
  // ---------------------------------------------------------------------------

  async getNodes(options?: GraphQueryOptions): Promise<readonly Node[]> {
    if (this._kernel) {
      return this._kernel.queryNodesSync(this._toStorageOptions(options));
    }
    const data = await this._store.getNodes(this._toStorageOptions(options));
    return data.map((d) =>
      Node._fromFrozen(
        d.id,
        d.labels,
        d.properties,
        d.createdOn ?? Date.now(),
        d.updatedOn ?? Date.now(),
      ),
    );
  }

  async getEdges(options?: GraphQueryOptions): Promise<readonly Edge[]> {
    if (this._kernel) {
      return this._kernel.queryEdgesSync(this._toStorageOptions(options));
    }
    const data = await this._store.getEdges(this._toStorageOptions(options));
    return data.map((d) =>
      Edge._fromFrozen(
        d.id,
        d.sourceId,
        d.targetId,
        d.type,
        d.properties,
        d.createdOn ?? Date.now(),
        d.updatedOn ?? Date.now(),
      ),
    );
  }

  async getNodeCount(options?: GraphQueryOptions): Promise<number> {
    if (this._kernel) {
      return this._kernel.countNodesSync(this._toStorageOptions(options));
    }
    return this._store.getNodeCount(this._toStorageOptions(options));
  }

  async getEdgeCount(options?: GraphQueryOptions): Promise<number> {
    if (this._kernel) {
      return this._kernel.countEdgesSync(this._toStorageOptions(options));
    }
    return this._store.getEdgeCount(this._toStorageOptions(options));
  }

  async hasNode(id: string, transaction?: GraphTransaction): Promise<boolean> {
    const handle = transaction?._getHandle();
    if (this._kernel && !handle) {
      return this._kernel.getNodeSlot(id) >= 0;
    }
    return this._store.hasNode(id, handle);
  }

  async hasEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    const handle = transaction?._getHandle();
    if (this._kernel && !handle) {
      return this._kernel.getEdgeSlot(id) >= 0;
    }
    return this._store.hasEdge(id, handle);
  }

  async getNode(id: string, transaction?: GraphTransaction): Promise<Node | undefined> {
    const handle = transaction?._getHandle();
    if (this._kernel) {
      return this._kernel.getNodeSync(id, handle);
    }
    const data = await this._store.getNode(id, handle);
    if (!data) return undefined;
    return Node._fromFrozen(
      data.id,
      data.labels,
      data.properties,
      data.createdOn ?? Date.now(),
      data.updatedOn ?? Date.now(),
    );
  }

  async getNodesByIds(ids: string[], transaction?: GraphTransaction): Promise<Map<string, Node>> {
    const handle = transaction?._getHandle();
    if (this._kernel) {
      return this._kernel.getNodesByIdsSync(ids, handle);
    }
    const data = await this._store.getNodesByIds(ids, handle);
    const result = new Map<string, Node>();
    for (const [id, d] of data) {
      result.set(
        id,
        Node._fromFrozen(
          d.id,
          d.labels,
          d.properties,
          d.createdOn ?? Date.now(),
          d.updatedOn ?? Date.now(),
        ),
      );
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Node Mutations
  // ---------------------------------------------------------------------------

  async addNode(
    labels: string | string[],
    properties: Record<string, unknown> = {},
    transaction?: GraphTransaction,
    id?: string,
  ): Promise<Node> {
    const invalid = findInvalidPropertyEntry(properties);
    if (invalid) {
      throw new InvalidPropertyError(invalid[0], invalid[1]);
    }

    const handle = transaction?._getHandle();
    const labelArr = Array.isArray(labels) ? labels : [labels];
    if (this._kernel) {
      try {
        return this._kernel.insertNodeSync(labelArr, properties, id, handle);
      } catch (error) {
        transaction?.markFailed();
        throw error;
      }
    }

    const node = new Node(labelArr, properties, id);
    try {
      if (await this._store.hasNode(node.id, handle)) {
        throw new NodeAlreadyExistsError(node.id);
      }
      await this._store.insertNode(node.toJSON(), handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return node;
  }

  async addNodes(
    items: ReadonlyArray<{
      labels: string | string[];
      properties?: Record<string, unknown>;
      id?: string;
    }>,
    transaction?: GraphTransaction,
  ): Promise<Node[]> {
    const normalized: Array<{
      labels: readonly string[];
      properties: Record<string, unknown>;
      id?: string;
    }> = new Array(items.length);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const props = it.properties ?? {};
      const invalid = findInvalidPropertyEntry(props);
      if (invalid) {
        throw new InvalidPropertyError(invalid[0], invalid[1]);
      }
      normalized[i] = {
        labels: Array.isArray(it.labels) ? it.labels : [it.labels],
        properties: props,
        id: it.id,
      };
    }

    const handle = transaction?._getHandle();
    if (this._kernel) {
      try {
        return this._kernel.insertNodesSync(normalized, handle);
      } catch (error) {
        transaction?.markFailed();
        throw error;
      }
    }

    const nodes = normalized.map((n) => new Node(n.labels, n.properties, n.id));
    try {
      await this._store.insertNodes(nodes.map((n) => n.toJSON()), handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return nodes;
  }

  async removeNode(
    id: string,
    cascade: boolean = false,
    transaction?: GraphTransaction,
  ): Promise<{ result: boolean; cascadeDeletedEdgesCount?: number }> {
    const handle = transaction?._getHandle();
    if (this._kernel) {
      try {
        return this._kernel.deleteNodeByIdSync(id, cascade, handle);
      } catch (error) {
        transaction?.markFailed();
        throw error;
      }
    }

    let cascadeDeletedEdgesCount = cascade ? 0 : undefined;
    try {
      if (!(await this._store.hasNode(id, handle))) return { result: false };

      const [outgoing, incoming] = await Promise.all([
        this._store.getEdgesBySource(id, { transaction: handle }),
        this._store.getEdgesByTarget(id, { transaction: handle }),
      ]);

      if (cascade) {
        for (const edge of [...outgoing, ...incoming]) {
          await this._store.deleteEdge(edge.id, handle);
        }
        cascadeDeletedEdgesCount = outgoing.length + incoming.length;
      } else {
        const incidentCount = outgoing.length + incoming.length;
        if (incidentCount > 0) {
          throw new NodeHasEdgesError(id, incidentCount);
        }
      }

      await this._store.deleteNode(id, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return cascadeDeletedEdgesCount === undefined
      ? { result: true }
      : { result: true, cascadeDeletedEdgesCount };
  }

  // ---------------------------------------------------------------------------
  // Edge Mutations & Queries
  // ---------------------------------------------------------------------------

  async addEdge(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Record<string, unknown> = {},
    transaction?: GraphTransaction,
    id?: string,
  ): Promise<Edge> {
    const invalid = findInvalidPropertyEntry(properties);
    if (invalid) {
      throw new InvalidPropertyError(invalid[0], invalid[1]);
    }

    const handle = transaction?._getHandle();
    if (this._kernel) {
      try {
        return this._kernel.insertEdgeSync(sourceId, targetId, type, properties, id, handle);
      } catch (error) {
        transaction?.markFailed();
        throw error;
      }
    }

    const now = Date.now();
    const edge = new Edge(sourceId, targetId, type, properties, id, now, now);
    try {
      const sourceExists = await this._store.hasNode(sourceId, handle);
      const targetExists = await this._store.hasNode(targetId, handle);
      if (!sourceExists) throw new NodeNotFoundError(sourceId);
      if (!targetExists) throw new NodeNotFoundError(targetId);

      if (await this._store.hasEdge(edge.id, handle)) throw new EdgeAlreadyExistsError(edge.id);
      await this._store.insertEdge(edge.toJSON(), handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return edge;
  }

  async addEdges(
    items: ReadonlyArray<{
      sourceId: string;
      targetId: string;
      type: string;
      properties?: Record<string, unknown>;
      id?: string;
    }>,
    transaction?: GraphTransaction,
  ): Promise<Edge[]> {
    for (let i = 0; i < items.length; i++) {
      const props = items[i].properties;
      if (props) {
        const invalid = findInvalidPropertyEntry(props);
        if (invalid) throw new InvalidPropertyError(invalid[0], invalid[1]);
      }
    }

    const handle = transaction?._getHandle();
    if (this._kernel) {
      try {
        return this._kernel.insertEdgesSync(items, handle);
      } catch (error) {
        transaction?.markFailed();
        throw error;
      }
    }

    const now = Date.now();
    const edges = items.map(
      (it) => new Edge(it.sourceId, it.targetId, it.type, it.properties ?? {}, it.id, now, now),
    );
    try {
      await this._store.insertEdges(edges.map((e) => e.toJSON()), handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return edges;
  }

  async removeEdge(id: string, transaction?: GraphTransaction): Promise<boolean> {
    const handle = transaction?._getHandle();
    if (this._kernel) {
      try {
        return this._kernel.deleteEdgeByIdSync(id, handle);
      } catch (error) {
        transaction?.markFailed();
        throw error;
      }
    }
    try {
      if (!(await this._store.hasEdge(id, handle))) return false;
      await this._store.deleteEdge(id, handle);
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
    return true;
  }

  async getEdge(id: string, transaction?: GraphTransaction): Promise<Edge | undefined> {
    const handle = transaction?._getHandle();
    if (this._kernel) {
      return this._kernel.getEdgeSync(id, handle);
    }
    const data = await this._store.getEdge(id, handle);
    if (!data) return undefined;
    return Edge._fromFrozen(
      data.id,
      data.sourceId,
      data.targetId,
      data.type,
      data.properties,
      data.createdOn ?? Date.now(),
      data.updatedOn ?? Date.now(),
    );
  }

  async getEdgesFrom(sourceId: string, options?: GraphQueryOptions): Promise<Edge[]> {
    const handle = options?.transaction?._getHandle();
    if (this._kernel) {
      if (!handle && this._kernel.getNodeSlot(sourceId) < 0) {
        throw new NodeNotFoundError(sourceId);
      }
      if (handle && !(await this._store.hasNode(sourceId, handle))) {
        throw new NodeNotFoundError(sourceId);
      }
      return this._kernel.getEdgesBySourceSync(sourceId, this._toStorageOptions(options));
    }
    if (!(await this._store.hasNode(sourceId, handle))) throw new NodeNotFoundError(sourceId);
    const data = await this._store.getEdgesBySource(sourceId, this._toStorageOptions(options));
    return data.map((d) =>
      Edge._fromFrozen(
        d.id,
        d.sourceId,
        d.targetId,
        d.type,
        d.properties,
        d.createdOn ?? Date.now(),
        d.updatedOn ?? Date.now(),
      ),
    );
  }

  async getEdgesTo(targetId: string, options?: GraphQueryOptions): Promise<Edge[]> {
    const handle = options?.transaction?._getHandle();
    if (this._kernel) {
      if (!handle && this._kernel.getNodeSlot(targetId) < 0) {
        throw new NodeNotFoundError(targetId);
      }
      if (handle && !(await this._store.hasNode(targetId, handle))) {
        throw new NodeNotFoundError(targetId);
      }
      return this._kernel.getEdgesByTargetSync(targetId, this._toStorageOptions(options));
    }
    if (!(await this._store.hasNode(targetId, handle))) throw new NodeNotFoundError(targetId);
    const data = await this._store.getEdgesByTarget(targetId, this._toStorageOptions(options));
    return data.map((d) =>
      Edge._fromFrozen(
        d.id,
        d.sourceId,
        d.targetId,
        d.type,
        d.properties,
        d.createdOn ?? Date.now(),
        d.updatedOn ?? Date.now(),
      ),
    );
  }

  async getDirectEdgesBetween(
    sourceId: string,
    targetId: string,
    options?: GraphQueryOptions,
  ): Promise<Edge[]> {
    const handle = options?.transaction?._getHandle();
    if (this._kernel && !handle) {
      if (this._kernel.getNodeSlot(sourceId) < 0) throw new NodeNotFoundError(sourceId);
      if (this._kernel.getNodeSlot(targetId) < 0) throw new NodeNotFoundError(targetId);

      const storageOpts = options?.filter ? { filter: options.filter } : undefined;
      const outFromSource = this._kernel.getEdgesBySourceSync(sourceId, storageOpts);

      const result: Edge[] = [];
      for (let i = 0; i < outFromSource.length; i++) {
        if (outFromSource[i].targetId === targetId) result.push(outFromSource[i]);
      }
      if (sourceId !== targetId) {
        const outFromTarget = this._kernel.getEdgesBySourceSync(targetId, storageOpts);
        for (let i = 0; i < outFromTarget.length; i++) {
          if (outFromTarget[i].targetId === sourceId) result.push(outFromTarget[i]);
        }
      }
      return this._applyOrderAndLimitEdges(result, options);
    }

    const [sourceExists, targetExists] = await Promise.all([
      this._store.hasNode(sourceId, handle),
      this._store.hasNode(targetId, handle),
    ]);
    if (!sourceExists) throw new NodeNotFoundError(sourceId);
    if (!targetExists) throw new NodeNotFoundError(targetId);

    const storageOptions = options?.filter
      ? { filter: options.filter, transaction: handle }
      : (handle ? { transaction: handle } : undefined);
    const [outFromSource, outFromTarget] = await Promise.all([
      this._store.getEdgesBySource(sourceId, storageOptions),
      sourceId !== targetId ? this._store.getEdgesBySource(targetId, storageOptions) : Promise.resolve([]),
    ]);

    const result: Edge[] = [];
    for (const e of outFromSource) {
      if (e.targetId === targetId) {
        result.push(
          Edge._fromFrozen(
            e.id,
            e.sourceId,
            e.targetId,
            e.type,
            e.properties,
            e.createdOn ?? Date.now(),
            e.updatedOn ?? Date.now(),
          ),
        );
      }
    }
    if (sourceId !== targetId) {
      for (const e of outFromTarget) {
        if (e.targetId === sourceId) {
          result.push(
            Edge._fromFrozen(
              e.id,
              e.sourceId,
              e.targetId,
              e.type,
              e.properties,
              e.createdOn ?? Date.now(),
              e.updatedOn ?? Date.now(),
            ),
          );
        }
      }
    }
    return this._applyOrderAndLimitEdges(result, options);
  }

  private _applyOrderAndLimitEdges(edges: Edge[], options?: GraphQueryOptions): Edge[] {
    let out = edges;
    if (options?.orderBy && out.length > 1) {
      const { field, direction } = options.orderBy;
      out = [...out].sort((a, b) => {
        const va = field === 'createdOn' ? a.createdOn : field === 'updatedOn' ? a.updatedOn : a.properties[field];
        const vb = field === 'createdOn' ? b.createdOn : field === 'updatedOn' ? b.updatedOn : b.properties[field];
        if (va === undefined && vb === undefined) return 0;
        if (va === undefined) return direction === 'asc' ? 1 : -1;
        if (vb === undefined) return direction === 'asc' ? -1 : 1;
        if (va === vb) return 0;
        const lt = (va as number | string) < (vb as number | string);
        return direction === 'asc' ? (lt ? -1 : 1) : (lt ? 1 : -1);
      });
    }
    if (options?.limit !== undefined && out.length > options.limit) {
      return out.slice(0, options.limit);
    }
    return out;
  }

  async clear(): Promise<void> {
    await this._store.clear();
  }

  // ---------------------------------------------------------------------------
  // Property & Label Mutations (Unified Patch API)
  // ---------------------------------------------------------------------------

  async setNodeProperties(
    nodeId: string,
    properties: Record<string, unknown>,
    options?: { merge?: boolean; transaction?: GraphTransaction },
  ): Promise<void> {
    const invalid = findInvalidPropertyEntry(properties);
    if (invalid) {
      throw new InvalidPropertyError(invalid[0], invalid[1]);
    }
    const patch: PropertyPatch = {
      set: properties,
      replace: options?.merge === false,
    };
    const handle = options?.transaction?._getHandle();
    try {
      if (this._kernel) {
        this._kernel.patchPropertiesSync('node', nodeId, patch, handle);
      } else {
        await this._store.patchProperties('node', nodeId, patch, handle);
      }
    } catch (error) {
      options?.transaction?.markFailed();
      throw error;
    }
  }

  async unsetNodeProperties(
    nodeId: string,
    keys: string[],
    transaction?: GraphTransaction,
  ): Promise<void> {
    const handle = transaction?._getHandle();
    const patch: PropertyPatch = { unset: keys };
    try {
      if (this._kernel) {
        this._kernel.patchPropertiesSync('node', nodeId, patch, handle);
      } else {
        await this._store.patchProperties('node', nodeId, patch, handle);
      }
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  async removeNodeLabels(
    nodeId: string,
    labels: string[],
    transaction?: GraphTransaction,
  ): Promise<void> {
    const handle = transaction?._getHandle();
    try {
      if (this._kernel) {
        this._kernel.removeNodeLabelsSync(nodeId, labels, handle);
      } else {
        await this._store.removeNodeLabels(nodeId, labels, handle);
      }
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  async setEdgeProperties(
    edgeId: string,
    properties: Record<string, unknown>,
    options?: { merge?: boolean; transaction?: GraphTransaction },
  ): Promise<void> {
    const invalid = findInvalidPropertyEntry(properties);
    if (invalid) {
      throw new InvalidPropertyError(invalid[0], invalid[1]);
    }
    const patch: PropertyPatch = {
      set: properties,
      replace: options?.merge === false,
    };
    const handle = options?.transaction?._getHandle();
    try {
      if (this._kernel) {
        this._kernel.patchPropertiesSync('edge', edgeId, patch, handle);
      } else {
        await this._store.patchProperties('edge', edgeId, patch, handle);
      }
    } catch (error) {
      options?.transaction?.markFailed();
      throw error;
    }
  }

  async unsetEdgeProperties(
    edgeId: string,
    keys: string[],
    transaction?: GraphTransaction,
  ): Promise<void> {
    const handle = transaction?._getHandle();
    const patch: PropertyPatch = { unset: keys };
    try {
      if (this._kernel) {
        this._kernel.patchPropertiesSync('edge', edgeId, patch, handle);
      } else {
        await this._store.patchProperties('edge', edgeId, patch, handle);
      }
    } catch (error) {
      transaction?.markFailed();
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Index Management
  // ---------------------------------------------------------------------------

  async createIndex(
    name: string,
    target: 'node' | 'edge',
    propertyKeys: string[],
    options?: CreateIndexOptions,
  ): Promise<void> {
    if (this._kernel) {
      this._kernel.createIndexSync(name, target, propertyKeys, options);
      return;
    }
    await this._store.createIndex(name, target, propertyKeys, options);
  }

  async hasIndex(
    target: 'node' | 'edge',
    propertyKeys: string[],
    labelOrType?: string,
  ): Promise<boolean> {
    if (this._kernel) {
      return this._kernel.hasIndexSync(target, propertyKeys, labelOrType);
    }
    return this._store.hasIndex(target, propertyKeys, labelOrType);
  }

  async getIndex(name: string): Promise<IndexMetadata | undefined> {
    return this._store.getIndex(name);
  }

  async deleteIndex(name: string): Promise<void> {
    if (this._kernel) {
      this._kernel.deleteIndexSync(name);
      return;
    }
    return this._store.deleteIndex(name);
  }

  async getIndexes(): Promise<IndexMetadata[]> {
    if (this._kernel) {
      return this._kernel.getIndexesSync();
    }
    return this._store.getIndexes();
  }

  // ---------------------------------------------------------------------------
  // Aggregations
  // ---------------------------------------------------------------------------

  async aggregateNodeProperty(
    key: string,
    options?: GraphQueryOptions,
  ): Promise<AggregateResult> {
    const storageOpts = this._toStorageOptions(options);
    if (this._kernel) {
      return this._kernel.aggregateNodePropertySync(key, storageOpts);
    }
    return this._store.aggregateNodeProperty(key, storageOpts);
  }

  async aggregateEdgeProperty(
    key: string,
    options?: GraphQueryOptions,
  ): Promise<AggregateResult> {
    const storageOpts = this._toStorageOptions(options);
    if (this._kernel) {
      return this._kernel.aggregateEdgePropertySync(key, storageOpts);
    }
    return this._store.aggregateEdgeProperty(key, storageOpts);
  }

  private _toStorageOptions(options?: GraphQueryOptions): StorageQueryOptions | undefined {
    if (!options) return undefined;
    return {
      filter: options.filter,
      orderBy: options.orderBy,
      limit: options.limit,
      distinct: options.distinct,
      transaction: options.transaction?._getHandle(),
    };
  }
}
