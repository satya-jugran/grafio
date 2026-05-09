import { randomUUID } from 'crypto';
import type { EdgeData } from './types';
import { deepFreeze } from './utils';

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
  private readonly _properties: Readonly<Record<string, unknown>>;

  /**
   * Creates a new Edge instance.
   * @param sourceId - The id of the source node
   * @param targetId - The id of the target node
   * @param type - The relationship type (e.g., "CONTAINS", "AUTHOR_OF")
   * @param properties - Optional arbitrary JSON properties
   * @param id - Optional id. If not provided, a UUID will be generated.
   * @param createdOn - Optional creation timestamp (ms). Defaults to Date.now().
   * @param updatedOn - Optional last update timestamp (ms). Defaults to createdOn.
   */
  constructor(
    sourceId: string,
    targetId: string,
    type: string,
    properties: Record<string, unknown> = {},
    id?: string,
    createdOn?: number,
    updatedOn?: number,
  ) {
    this._id = id ?? randomUUID();
    this._sourceId = sourceId;
    this._targetId = targetId;
    this._type = type;
    this._createdOn = createdOn ?? Date.now();
    this._updatedOn = updatedOn ?? this._createdOn;
    this._properties = deepFreeze({ ...properties });
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
      properties: { ...this._properties },
    };
  }
}
