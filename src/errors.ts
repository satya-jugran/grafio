import { safeStringify } from './utils';

/**
 * Base class for all graph-related errors
 */
export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
    Object.setPrototypeOf(this, GraphError.prototype);
  }
}

/**
 * Error thrown when attempting to add a node that already exists
 */
export class NodeAlreadyExistsError extends GraphError {
  constructor(nodeId: string) {
    super(`Node with id '${nodeId}' already exists`);
    this.name = 'NodeAlreadyExistsError';
    Object.setPrototypeOf(this, NodeAlreadyExistsError.prototype);
  }
}

/**
 * Error thrown when attempting to add an edge that already exists
 */
export class EdgeAlreadyExistsError extends GraphError {
  constructor(edgeId: string) {
    super(`Edge with id '${edgeId}' already exists`);
    this.name = 'EdgeAlreadyExistsError';
    Object.setPrototypeOf(this, EdgeAlreadyExistsError.prototype);
  }
}

/**
 * Error thrown when a node is not found in the graph
 */
export class NodeNotFoundError extends GraphError {
  constructor(nodeId: string) {
    super(`Node with id '${nodeId}' not found`);
    this.name = 'NodeNotFoundError';
    Object.setPrototypeOf(this, NodeNotFoundError.prototype);
  }
}

/**
 * Error thrown when an edge is not found in the graph
 */
export class EdgeNotFoundError extends GraphError {
  constructor(edgeId: string) {
    super(`Edge with id '${edgeId}' not found`);
    this.name = 'EdgeNotFoundError';
    Object.setPrototypeOf(this, EdgeNotFoundError.prototype);
  }
}

/**
 * Error thrown when a wildcard traversal exceeds the maximum allowed nodes
 */
export class TraversalLimitExceededError extends GraphError {
  constructor(limit: number) {
    super(`Wildcard traversal exceeded limit of ${limit} nodes. Use typed node filters (e.g., nodeTypes: ['User']) instead of wildcard '*' for large graphs.`);
    this.name = 'TraversalLimitExceededError';
    Object.setPrototypeOf(this, TraversalLimitExceededError.prototype);
  }
}

/**
 * Error thrown when attempting to remove a node that still has incident edges without cascade
 */
export class NodeHasEdgesError extends GraphError {
  constructor(nodeId: string, edgeCount: number) {
    super(`Cannot remove node '${nodeId}': it still has ${edgeCount} incident edge(s). Use cascade=true to also remove them.`);
    this.name = 'NodeHasEdgesError';
    Object.setPrototypeOf(this, NodeHasEdgesError.prototype);
  }
}

/**
 * Error thrown when GraphData is invalid (malformed JSON or missing required fields)
 */
export class InvalidGraphDataError extends GraphError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGraphDataError';
    Object.setPrototypeOf(this, InvalidGraphDataError.prototype);
  }
}

/**
 * Error thrown when a node or edge has non-primitive property values.
 * Properties must be flat key/value pairs with primitive values only.
 */
export class InvalidPropertyError extends GraphError {
  constructor(propertyKey: string, propertyValue: unknown) {
    super(`Invalid property value for key '${propertyKey}': property values must be primitives only. Received: ${safeStringify(propertyValue)}`);
    this.name = 'InvalidPropertyError';
    Object.setPrototypeOf(this, InvalidPropertyError.prototype);
  }
}

/**
 * Error thrown when attempting to add a property that already exists
 */
export class PropertyAlreadyExistsError extends GraphError {
  constructor(targetType: 'node' | 'edge', targetId: string, propertyKey: string) {
    super(`Property '${propertyKey}' already exists on ${targetType} '${targetId}'`);
    this.name = 'PropertyAlreadyExistsError';
    Object.setPrototypeOf(this, PropertyAlreadyExistsError.prototype);
  }
}

/**
 * Error thrown when attempting to update a property that does not exist
 */
export class PropertyNotFoundError extends GraphError {
  constructor(targetType: 'node' | 'edge', targetId: string, propertyKey: string) {
    super(`Property '${propertyKey}' not found on ${targetType} '${targetId}'`);
    this.name = 'PropertyNotFoundError';
    Object.setPrototypeOf(this, PropertyNotFoundError.prototype);
  }
}
