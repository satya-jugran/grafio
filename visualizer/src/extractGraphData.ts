export interface VisualizerNodeData {
  id: string;
  labels: readonly string[];
  properties?: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface VisualizerEdgeData {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties?: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface VisualizerNode {
  id: string;
  label?: string;
  data?: VisualizerNodeData;
  x?: number;
  y?: number;
  z?: number;
  __bckgDimensions?: [number, number];
}

export interface VisualizerLink {
  id?: string;
  source: string | VisualizerNode;
  target: string | VisualizerNode;
  name?: string;
  data?: VisualizerEdgeData;
}

export interface VisualizerGraphData {
  nodes: VisualizerNode[];
  links: VisualizerLink[];
}

export function isVisualizerEdgeData(value: object): value is VisualizerEdgeData {
  const candidate = value as Partial<VisualizerEdgeData>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceId === 'string'
    && typeof candidate.targetId === 'string'
    && typeof candidate.type === 'string';
}

export function isVisualizerNodeData(value: object): value is VisualizerNodeData {
  const candidate = value as Partial<VisualizerNodeData>;
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.labels)
    && !('sourceId' in value);
}

/**
 * Extract force-graph nodes and links from Cypher result rows, synthesizing
 * minimal stub nodes (`{ id, label: id }`) for any dangling edge endpoints
 * absent from the projected result set.
 */
export function extractGraphData(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): VisualizerGraphData {
  const nodesMap = new Map<string, VisualizerNode>();
  const edgesMap = new Map<string, VisualizerLink>();

  const processValue = (val: unknown): void => {
    if (!val || typeof val !== 'object') return;

    if (Array.isArray(val)) {
      val.forEach(processValue);
      return;
    }

    // Check if Edge: must have id, sourceId, targetId, type
    if (isVisualizerEdgeData(val)) {
      if (!edgesMap.has(val.id)) {
        edgesMap.set(val.id, {
          id: val.id,
          source: val.sourceId,
          target: val.targetId,
          name: val.type,
          data: val,
        });
      }
      return;
    }

    // Check if Node: must have id, labels (and no sourceId to be safe)
    if (isVisualizerNodeData(val)) {
      if (!nodesMap.has(val.id)) {
        nodesMap.set(val.id, {
          id: val.id,
          label: val.labels[0] || 'Node',
          data: val,
        });
      }
      return;
    }

    // For any other object, recurse into its values (might be nested)
    Object.values(val).forEach(processValue);
  };

  rows.forEach((row) => {
    Object.values(row).forEach(processValue);
  });

  // Synthesize minimal stub nodes for any dangling edge endpoints
  for (const link of edgesMap.values()) {
    const srcId = typeof link.source === 'string' ? link.source : link.source.id;
    if (!nodesMap.has(srcId)) {
      nodesMap.set(srcId, { id: srcId, label: srcId });
    }
    const tgtId = typeof link.target === 'string' ? link.target : link.target.id;
    if (!nodesMap.has(tgtId)) {
      nodesMap.set(tgtId, { id: tgtId, label: tgtId });
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    links: Array.from(edgesMap.values()),
  };
}
