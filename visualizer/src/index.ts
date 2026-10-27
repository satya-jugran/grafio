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

export interface CypherVisualizerResult {
  rows?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

interface Position3D {
  x: number;
  y: number;
  z: number;
}

interface SpriteTextInstance {
  color: string;
  textHeight: number;
  backgroundColor?: string | false;
  padding?: number;
  borderRadius?: number;
  position: { x: number; y: number; z: number };
}

interface GraphInstance {
  width(value: number): GraphInstance;
  height(value: number): GraphInstance;
  nodeColor(callback: (node: VisualizerNode) => string): GraphInstance;
  nodeLabel(callback: (node: VisualizerNode) => string | null): GraphInstance;
  linkLabel(callback: (link: VisualizerLink) => string | null): GraphInstance;
  onNodeClick(callback: (node: VisualizerNode) => void): GraphInstance;
  onLinkClick(callback: (link: VisualizerLink) => void): GraphInstance;
  graphData(data: VisualizerGraphData): GraphInstance;
  nodeThreeObject?(callback: (node: VisualizerNode) => SpriteTextInstance): GraphInstance;
  linkThreeObjectExtend?(enabled: boolean): GraphInstance;
  linkThreeObject?(callback: (link: VisualizerLink) => SpriteTextInstance): GraphInstance;
  linkPositionUpdate?(callback: (sprite: SpriteTextInstance, position: { start: Position3D; end: Position3D }) => void): GraphInstance;
  linkDirectionalArrowLength?(length: number): GraphInstance;
  linkDirectionalArrowRelPos?(position: number): GraphInstance;
  nodeCanvasObject?(callback: (node: VisualizerNode, context: CanvasRenderingContext2D, globalScale: number) => void): GraphInstance;
  nodePointerAreaPaint?(callback: (node: VisualizerNode, color: string, context: CanvasRenderingContext2D) => void): GraphInstance;
  linkCanvasObjectMode?(callback: () => 'after'): GraphInstance;
  linkCanvasObject?(callback: (link: VisualizerLink, context: CanvasRenderingContext2D, globalScale: number) => void): GraphInstance;
  _destructor?(): void;
}

type GraphFactory = () => (container: HTMLElement) => GraphInstance;
type SpriteTextConstructor = new (text?: string, textHeight?: number, color?: string) => SpriteTextInstance;

function resolveDefault<T>(module: unknown): T {
  if (typeof module === 'object' && module !== null && 'default' in module) {
    const candidate = module as { default?: unknown };
    if (candidate.default) return candidate.default as T;
  }
  return module as T;
}

function isVisualizerEdgeData(value: object): value is VisualizerEdgeData {
  const candidate = value as Partial<VisualizerEdgeData>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceId === 'string'
    && typeof candidate.targetId === 'string'
    && typeof candidate.type === 'string';
}

function isVisualizerNodeData(value: object): value is VisualizerNodeData {
  const candidate = value as Partial<VisualizerNodeData>;
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.labels)
    && !('sourceId' in value);
}

export interface VisualizerOptions {
  mode?: '2d' | '3d';
  showArrows?: boolean;
  showHoverData?: boolean;
  showPermanentLabels?: boolean;
  showEdgeLabels?: boolean;
  onNodeClick?: (node: VisualizerNode) => void;
  onLinkClick?: (link: VisualizerLink) => void;
}

export class CypherVisualizer {
  private container: HTMLElement;
  private options: VisualizerOptions;
  private graphInstance: GraphInstance | null = null;
  private pendingData: VisualizerGraphData | null = null;
  private lastCypherResult: CypherVisualizerResult | null | undefined = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly colorPalette = [
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#14b8a6', // teal
    '#6366f1', // indigo
    '#f43f5e'  // rose
  ];
  private labelColorMap = new Map<string, string>();
  private nextColorIndex = 0;

  constructor(container: HTMLElement, options: VisualizerOptions = {}) {
    if (typeof window === 'undefined') {
      throw new Error("CypherVisualizer can only be used in a browser environment.");
    }
    
    this.container = container;
    this.options = {
      mode: '2d',
      showArrows: false,
      showHoverData: true,
      showPermanentLabels: false,
      showEdgeLabels: false,
      ...options
    };

    this.initGraph();

    // Attach ResizeObserver to keep canvas strictly synced with flex container
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && this.graphInstance) {
          this.graphInstance.width(width).height(height);
        }
      }
    });
    this.resizeObserver.observe(this.container);
  }

  public destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.graphInstance && typeof this.graphInstance._destructor === 'function') {
      this.graphInstance._destructor();
    }
    this.container.innerHTML = '';
  }

  private getNodeColor(node: VisualizerNode): string {
    const label = node.label || 'Unknown';
    if (!this.labelColorMap.has(label)) {
      this.labelColorMap.set(label, this.colorPalette[this.nextColorIndex % this.colorPalette.length]);
      this.nextColorIndex++;
    }
    return this.labelColorMap.get(label)!;
  }

  private async initGraph() {
    this.container.innerHTML = ''; // clear
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    if (this.options.mode === '3d') {
      const [ForceGraph3DModule, SpriteTextModule] = await Promise.all([
        import('3d-force-graph'),
        import('three-spritetext')
      ]);
      const ForceGraph3D = resolveDefault<GraphFactory>(ForceGraph3DModule);
      const SpriteText = resolveDefault<SpriteTextConstructor>(SpriteTextModule);

      this.graphInstance = ForceGraph3D()(this.container)
        .width(width).height(height)
        .nodeColor((node: VisualizerNode) => this.getNodeColor(node))
        .nodeLabel((node: VisualizerNode) => this.options.showHoverData ? this.getNodeLabel(node) : null)
        .linkLabel((link: VisualizerLink) => this.options.showHoverData ? this.getLinkLabel(link) : null)
        .onNodeClick((node: VisualizerNode) => { if (this.options.onNodeClick) this.options.onNodeClick(node); })
        .onLinkClick((link: VisualizerLink) => { if (this.options.onLinkClick) this.options.onLinkClick(link); });

      if (this.options.showPermanentLabels) {
        this.graphInstance.nodeThreeObject?.((node: VisualizerNode) => {
          const label = node.label || node.id;
          const sprite = new SpriteText(`${label}\n${node.id}`);
          sprite.color = '#ffffff';
          sprite.textHeight = 4;
          sprite.backgroundColor = this.getNodeColor(node);
          sprite.padding = 2;
          sprite.borderRadius = 2;
          return sprite;
        });
      }

      if (this.options.showEdgeLabels) {
        this.graphInstance.linkThreeObjectExtend?.(true);
        this.graphInstance.linkThreeObject?.((link: VisualizerLink) => {
          const sprite = new SpriteText(link.name || '');
          sprite.color = 'lightgrey';
          sprite.textHeight = 2.5;
          return sprite;
        });
        this.graphInstance.linkPositionUpdate?.((sprite: SpriteTextInstance, { start, end }) => {
          const middlePos = {
            x: start.x + (end.x - start.x) / 2,
            y: start.y + (end.y - start.y) / 2,
            z: start.z + (end.z - start.z) / 2
          };
          Object.assign(sprite.position, middlePos);
        });
      }

      if (this.options.showArrows) {
        this.graphInstance.linkDirectionalArrowLength?.(3.5)?.linkDirectionalArrowRelPos?.(1);
      }

      if (this.pendingData) {
        this.graphInstance.graphData(this.pendingData);
        this.pendingData = null;
      }
    } else {
      const ForceGraphModule = await import('force-graph');
      const ForceGraph = resolveDefault<GraphFactory>(ForceGraphModule);

      this.graphInstance = ForceGraph()(this.container)
        .width(width).height(height)
        .nodeColor((node: VisualizerNode) => this.getNodeColor(node))
        .nodeLabel((node: VisualizerNode) => this.options.showHoverData ? this.getNodeLabel(node) : null)
        .linkLabel((link: VisualizerLink) => this.options.showHoverData ? this.getLinkLabel(link) : null)
        .onNodeClick((node: VisualizerNode) => { if (this.options.onNodeClick) this.options.onNodeClick(node); })
        .onLinkClick((link: VisualizerLink) => { if (this.options.onLinkClick) this.options.onLinkClick(link); });

      if (this.options.showPermanentLabels) {
        this.graphInstance.nodeCanvasObject?.((node: VisualizerNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const label = node.label || node.id;
          const text = `${label}\n${node.id}`;
          const fontSize = 12/globalScale;
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          ctx.font = `${fontSize}px Sans-Serif`;
          
          const lines = text.split('\n');
          const maxTextWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
          
          const bckgDimensions: [number, number] = [
            maxTextWidth + fontSize * 0.2,
            fontSize * lines.length + fontSize * 0.2,
          ];
          
          ctx.fillStyle = this.getNodeColor(node);
          ctx.fillRect(x - bckgDimensions[0] / 2, y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          lines.forEach((line, i) => {
             ctx.fillText(line, x, y - (bckgDimensions[1]/2) + (i + 0.5) * fontSize + fontSize * 0.1);
          });
          
          node.__bckgDimensions = bckgDimensions; // save for hover interaction if needed
        });
        
        // Disable node point rendering so only the canvas card shows
        this.graphInstance.nodePointerAreaPaint?.((node: VisualizerNode, color: string, ctx: CanvasRenderingContext2D) => {
          if (!node.__bckgDimensions) return;
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          ctx.fillStyle = color;
          const bckgDimensions = node.__bckgDimensions;
          ctx.fillRect(x - bckgDimensions[0] / 2, y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
        });
      }

      if (this.options.showEdgeLabels) {
        this.graphInstance.linkCanvasObjectMode?.(() => 'after');
        this.graphInstance.linkCanvasObject?.((link: VisualizerLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const start = typeof link.source === 'string' ? undefined : link.source;
          const end = typeof link.target === 'string' ? undefined : link.target;
          if (!start || !end || typeof start.x !== 'number' || typeof start.y !== 'number'
            || typeof end.x !== 'number' || typeof end.y !== 'number') return;
          
          const textPos = {
            x: start.x + (end.x - start.x) / 2,
            y: start.y + (end.y - start.y) / 2
          };

          const relLink = { x: end.x - start.x, y: end.y - start.y };
          let textAngle = Math.atan2(relLink.y, relLink.x);
          // maintain label upright
          if (textAngle > Math.PI / 2) textAngle = -(Math.PI - textAngle);
          if (textAngle < -Math.PI / 2) textAngle = -(-Math.PI - textAngle);

          const label = link.name || '';
          const fontSize = 10 / globalScale;
          const pad = 2 / globalScale;
          ctx.font = `${fontSize}px Sans-Serif`;

          ctx.save();
          ctx.translate(textPos.x, textPos.y);
          ctx.rotate(textAngle);
          
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          const textWidth = ctx.measureText(label).width;
          ctx.fillRect(-textWidth/2 - pad, -fontSize/2 - pad, textWidth + pad*2, fontSize + pad*2);
          
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.fillText(label, 0, 0);
          ctx.restore();
        });
      }

      if (this.options.showArrows) {
        this.graphInstance.linkDirectionalArrowLength?.(3.5)?.linkDirectionalArrowRelPos?.(1);
      }

      if (this.pendingData) {
        this.graphInstance.graphData(this.pendingData);
        this.pendingData = null;
      }
    }
    
    // We do NOT call applyDataAndZoom here anymore. setMode will call render.
  }

  public setMode(mode: '2d' | '3d') {
    if (this.options.mode !== mode) {
      this.options.mode = mode;
      this.graphInstance = null;
      this.initGraph();
      if (this.lastCypherResult) {
        this.render(this.lastCypherResult);
      }
    }
  }

  public render(cypherResult: CypherVisualizerResult | null | undefined) {
    this.lastCypherResult = cypherResult;
    
    if (!cypherResult || !cypherResult.rows) {
      this.applyDataAndZoom({ nodes: [], links: [] });
      return;
    }

    const freshData = this.extractGraphData(cypherResult.rows);
    this.applyDataAndZoom(freshData);
  }

  private applyDataAndZoom(data: VisualizerGraphData) {
    if (!this.graphInstance) {
      this.pendingData = data;
      return;
    }
    this.graphInstance.graphData(data);
  }

  private extractGraphData(rows: ReadonlyArray<Readonly<Record<string, unknown>>>): VisualizerGraphData {
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
            data: val
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
            data: val
          });
        }
        return;
      }

      // For any other object, recurse into its values (might be nested)
      Object.values(val).forEach(processValue);
    };

    rows.forEach(row => {
      Object.values(row).forEach(processValue);
    });

    return {
      nodes: Array.from(nodesMap.values()),
      links: Array.from(edgesMap.values())
    };
  }

  private escapeHtml(unsafe: string): string {
    if (typeof unsafe !== 'string') return String(unsafe);
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
  }

  private getNodeLabel(node: VisualizerNode): string {
    const rawLabel = String(node.label || node.id || '');
    if (!this.options.showHoverData) return this.escapeHtml(rawLabel);
    
    const props = node.data?.properties || {};
    const hasProps = Object.keys(props).length > 0;
    
    return `<div style="padding: 2px;">
      <strong style="color: #ffffff;">${this.escapeHtml(rawLabel)}</strong>
      ${hasProps ? `<pre style="margin: 4px 0 0 0; padding: 6px; font-size: 0.85em; background: #2d3748; color: #e2e8f0; border: 1px solid #4a5568; border-radius: 4px;">${this.escapeHtml(JSON.stringify(props, null, 2))}</pre>` : ''}
    </div>`;
  }

  private getLinkLabel(link: VisualizerLink): string {
    const rawName = String(link.name || '');
    if (!this.options.showHoverData) return this.escapeHtml(rawName);
    
    const props = link.data?.properties || {};
    const hasProps = Object.keys(props).length > 0;
    
    return `<div style="padding: 2px;">
      <strong style="color: #ffffff;">${this.escapeHtml(rawName)}</strong>
      ${hasProps ? `<pre style="margin: 4px 0 0 0; padding: 6px; font-size: 0.85em; background: #2d3748; color: #e2e8f0; border: 1px solid #4a5568; border-radius: 4px;">${this.escapeHtml(JSON.stringify(props, null, 2))}</pre>` : ''}
    </div>`;
  }
}
