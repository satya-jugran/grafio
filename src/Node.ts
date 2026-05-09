import { randomUUID } from 'crypto';
import type { NodeData } from './types';
import { deepFreeze } from './utils';

/**
 * Represents a node in the graph database.
 * Nodes are identified by a unique id and have a type (label).
 */
export class Node {
  private readonly _id: string;
  private readonly _type: string;
  private readonly _createdOn: number;
  private _updatedOn: number;
  private readonly _properties: Readonly<Record<string, unknown>>;

  /**
   * Creates a new Node instance.
   * @param type - The type (label) of the node (e.g., "Course", "Chapter")
   * @param properties - Optional arbitrary JSON properties
   * @param id - Optional id. If not provided, a UUID will be generated.
   * @param createdOn - Optional creation timestamp (ms). Defaults to Date.now().
   * @param updatedOn - Optional last update timestamp (ms). Defaults to createdOn.
   */
  constructor(
    type: string,
    properties: Record<string, unknown> = {},
    id?: string,
    createdOn?: number,
    updatedOn?: number,
  ) {
    this._id = id ?? randomUUID();
    this._type = type;
    this._createdOn = createdOn ?? Date.now();
    this._updatedOn = updatedOn ?? this._createdOn;
    this._properties = deepFreeze({ ...properties });
  }

  /**
   * Returns the unique id of this node.
   */
  get id(): string {
    return this._id;
  }

  /**
   * Returns the type (label) of this node.
   */
  get type(): string {
    return this._type;
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
    return this._properties;
  }

  /**
   * Serializes this node to a plain object for JSON storage.
   * @returns NodeData representation
   */
  toJSON(): NodeData {
    return {
      id: this._id,
      type: this._type,
      createdOn: this._createdOn,
      updatedOn: this._updatedOn,
      properties: { ...this._properties },
    };
  }
}
