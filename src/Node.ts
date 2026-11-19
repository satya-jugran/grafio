import type { NodeData } from './types';
import { fastUUID } from './utils';

const EMPTY_PROPS: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * Represents a node in the graph database.
 * Nodes are identified by a unique id and have one or more labels.
 */
export class Node {
  private readonly _id: string;
  private readonly _labels: readonly string[];
  private readonly _createdOn: number;
  private _updatedOn: number;
  private _properties: Readonly<Record<string, unknown>> | null;
  private _propLoader: (() => Readonly<Record<string, unknown>>) | undefined;

  /** @internal Optional dense kernel slot index for O(1) execution access */
  readonly _slot: number | undefined;

  /**
   * Creates a new Node instance.
   * @param labels - One or more labels for the node (e.g., "Course" or ["Person", "Employee"])
   * @param properties - Optional flat primitive JSON properties
   * @param id - Optional id. If not provided, a UUID will be generated.
   * @param createdOn - Optional creation timestamp (ms). Defaults to Date.now().
   * @param updatedOn - Optional last update timestamp (ms). Defaults to createdOn.
   */
  constructor(
    labels: string | readonly string[],
    properties: Readonly<Record<string, unknown>> = EMPTY_PROPS,
    id?: string,
    createdOn?: number,
    updatedOn?: number,
  ) {
    this._id = id ?? fastUUID();
    this._labels = Object.freeze(Array.isArray(labels) ? [...labels] : [labels as string]);
    this._createdOn = createdOn ?? Date.now();
    this._updatedOn = updatedOn ?? this._createdOn;
    this._properties = properties === EMPTY_PROPS
      ? EMPTY_PROPS
      : Object.freeze({ ...properties });
    this._propLoader = undefined;
    this._slot = undefined;
  }

  /**
   * @internal Creates a lightweight Node wrapper around pre-frozen kernel metadata
   * with lazy property materialization.
   */
  static _fromKernel(
    id: string,
    frozenLabels: readonly string[],
    propLoader: () => Readonly<Record<string, unknown>>,
    createdOn: number,
    updatedOn: number,
    slot: number,
  ): Node {
    const node = Object.create(Node.prototype) as unknown as {
      _id: string;
      _labels: readonly string[];
      _createdOn: number;
      _updatedOn: number;
      _properties: Readonly<Record<string, unknown>> | null;
      _propLoader: (() => Readonly<Record<string, unknown>>) | undefined;
      _slot: number | undefined;
    };
    node._id = id;
    node._labels = frozenLabels;
    node._createdOn = createdOn;
    node._updatedOn = updatedOn;
    node._properties = null;
    node._propLoader = propLoader;
    node._slot = slot;
    return node as unknown as Node;
  }

  /**
   * @internal Creates a Node wrapping already-frozen labels and properties without cloning.
   */
  static _fromFrozen(
    id: string,
    frozenLabels: readonly string[],
    frozenProps: Readonly<Record<string, unknown>>,
    createdOn: number,
    updatedOn: number,
    slot?: number,
  ): Node {
    const node = Object.create(Node.prototype) as unknown as {
      _id: string;
      _labels: readonly string[];
      _createdOn: number;
      _updatedOn: number;
      _properties: Readonly<Record<string, unknown>> | null;
      _propLoader: (() => Readonly<Record<string, unknown>>) | undefined;
      _slot: number | undefined;
    };
    node._id = id;
    node._labels = frozenLabels;
    node._createdOn = createdOn;
    node._updatedOn = updatedOn;
    node._properties = frozenProps;
    node._propLoader = undefined;
    node._slot = slot;
    return node as unknown as Node;
  }

  /** @internal Materializes lazy properties before underlying slot mutation/deletion. */
  _materializeIfNeeded(): void {
    if (this._properties === null && this._propLoader) {
      this._properties = Object.freeze(this._propLoader());
      this._propLoader = undefined;
    }
  }

  /**
   * Returns the unique id of this node.
   */
  get id(): string {
    return this._id;
  }

  /**
   * Returns the labels of this node.
   */
  get labels(): readonly string[] {
    return this._labels;
  }

  /**
   * Returns the creation timestamp of this node (ms since epoch).
   */
  get createdOn(): number {
    return this._createdOn;
  }

  /**
   * Returns the last update timestamp of this node (ms since epoch).
   */
  get updatedOn(): number {
    return this._updatedOn;
  }

  /**
   * Returns a read-only copy of this node's properties.
   */
  get properties(): Readonly<Record<string, unknown>> {
    if (this._properties === null) {
      this._properties = Object.freeze(this._propLoader!());
      this._propLoader = undefined;
    }
    return this._properties;
  }

  /**
   * Serializes this node to a plain object for JSON storage.
   * @returns NodeData representation
   */
  toJSON(): NodeData {
    return {
      id: this._id,
      labels: [...this._labels],
      createdOn: this._createdOn,
      updatedOn: this._updatedOn,
      properties: { ...this.properties },
    };
  }
}
