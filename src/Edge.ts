import type { EdgeData } from './types';
import { fastUUID } from './utils';

const EMPTY_PROPS: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * Represents a directed edge (relationship) in the graph database.
 * Edges connect two nodes and have a type (relationship type).
 */
export class Edge {
  private readonly _id: string;
  private readonly _sourceId: string;
  private readonly _targetId: string;
  private readonly _type: string;
  private readonly _createdOn: number;
  private _updatedOn: number;
  private _properties: Readonly<Record<string, unknown>> | null;
  private _propLoader: (() => Readonly<Record<string, unknown>>) | undefined;

  /** @internal Optional dense kernel slot index for O(1) execution access */
  readonly _slot: number | undefined;

  /**
   * Creates a new Edge instance.
   * @param sourceId - The id of the source node
   * @param targetId - The id of the target node
   * @param type - The relationship type (e.g., "CONTAINS", "AUTHOR_OF")
   * @param properties - Optional flat primitive JSON properties
   * @param id - Optional id. If not provided, a UUID will be generated.
   * @param createdOn - Optional creation timestamp (ms). Defaults to Date.now().
   * @param updatedOn - Optional last update timestamp (ms). Defaults to createdOn.
   */
  constructor(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Readonly<Record<string, unknown>> = EMPTY_PROPS,
    id?: string,
    createdOn?: number,
    updatedOn?: number,
  ) {
    this._id = id ?? fastUUID();
    this._sourceId = sourceId;
    this._targetId = targetId;
    this._type = type;
    this._createdOn = createdOn ?? Date.now();
    this._updatedOn = updatedOn ?? this._createdOn;
    this._properties = properties === EMPTY_PROPS
      ? EMPTY_PROPS
      : Object.freeze({ ...properties });
    this._propLoader = undefined;
    this._slot = undefined;
  }

  /**
   * @internal Creates a lightweight Edge wrapper around kernel metadata with lazy
   * property materialization.
   */
  static _fromKernel(
    id: string,
    sourceId: string,
    targetId: string,
    type: string,
    propLoader: () => Readonly<Record<string, unknown>>,
    createdOn: number,
    updatedOn: number,
    slot: number,
  ): Edge {
    const edge = Object.create(Edge.prototype) as unknown as {
      _id: string;
      _sourceId: string;
      _targetId: string;
      _type: string;
      _createdOn: number;
      _updatedOn: number;
      _properties: Readonly<Record<string, unknown>> | null;
      _propLoader: (() => Readonly<Record<string, unknown>>) | undefined;
      _slot: number | undefined;
    };
    edge._id = id;
    edge._sourceId = sourceId;
    edge._targetId = targetId;
    edge._type = type;
    edge._createdOn = createdOn;
    edge._updatedOn = updatedOn;
    edge._properties = null;
    edge._propLoader = propLoader;
    edge._slot = slot;
    return edge as unknown as Edge;
  }

  /**
   * @internal Creates an Edge wrapping already-frozen properties without cloning.
   */
  static _fromFrozen(
    id: string,
    sourceId: string,
    targetId: string,
    type: string,
    frozenProps: Readonly<Record<string, unknown>>,
    createdOn: number,
    updatedOn: number,
    slot?: number,
  ): Edge {
    const edge = Object.create(Edge.prototype) as unknown as {
      _id: string;
      _sourceId: string;
      _targetId: string;
      _type: string;
      _createdOn: number;
      _updatedOn: number;
      _properties: Readonly<Record<string, unknown>> | null;
      _propLoader: (() => Readonly<Record<string, unknown>>) | undefined;
      _slot: number | undefined;
    };
    edge._id = id;
    edge._sourceId = sourceId;
    edge._targetId = targetId;
    edge._type = type;
    edge._createdOn = createdOn;
    edge._updatedOn = updatedOn;
    edge._properties = frozenProps;
    edge._propLoader = undefined;
    edge._slot = slot;
    return edge as unknown as Edge;
  }

  /** @internal Materializes lazy properties before underlying slot mutation/deletion. */
  _materializeIfNeeded(): void {
    if (this._properties === null && this._propLoader) {
      this._properties = Object.freeze(this._propLoader());
      this._propLoader = undefined;
    }
  }

  /**
   * Returns the unique id of this edge.
   */
  get id(): string {
    return this._id;
  }

  /**
   * Returns the id of the source node.
   */
  get sourceId(): string {
    return this._sourceId;
  }

  /**
   * Returns the id of the target node.
   */
  get targetId(): string {
    return this._targetId;
  }

  /**
   * Returns the type (relationship type) of this edge.
   */
  get type(): string {
    return this._type;
  }

  /**
   * Returns the creation timestamp of this edge (ms since epoch).
   */
  get createdOn(): number {
    return this._createdOn;
  }

  /**
   * Returns the last update timestamp of this edge (ms since epoch).
   */
  get updatedOn(): number {
    return this._updatedOn;
  }

  /**
   * Returns a read-only copy of this edge's properties.
   */
  get properties(): Readonly<Record<string, unknown>> {
    if (this._properties === null) {
      this._properties = Object.freeze(this._propLoader!());
      this._propLoader = undefined;
    }
    return this._properties;
  }

  /**
   * Serializes this edge to a plain object for JSON storage.
   * @returns EdgeData representation
   */
  toJSON(): EdgeData {
    return {
      id: this._id,
      sourceId: this._sourceId,
      targetId: this._targetId,
      type: this._type,
      createdOn: this._createdOn,
      updatedOn: this._updatedOn,
      properties: { ...this.properties },
    };
  }
}
