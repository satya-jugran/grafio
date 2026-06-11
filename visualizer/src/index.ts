import ForceGraph3D from '3d-force-graph';
import ForceGraph from 'force-graph';
import SpriteText from 'three-spritetext';

export interface VisualizerOptions {
  mode?: '2d' | '3d';
  showArrows?: boolean;
  showHoverData?: boolean;
  showPermanentLabels?: boolean;
  showEdgeLabels?: boolean;
  onNodeClick?: (node: any) => void;
  onLinkClick?: (link: any) => void;
}

export class CypherVisualizer {
  private container: HTMLElement;
  private options: VisualizerOptions;
  private graphInstance: any;
  private lastCypherResult: any = null;
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

  private getNodeColor(node: any): string {
    const label = node.label || 'Unknown';
    if (!this.labelColorMap.has(label)) {
      this.labelColorMap.set(label, this.colorPalette[this.nextColorIndex % this.colorPalette.length]);
      this.nextColorIndex++;
    }
    return this.labelColorMap.get(label)!;
  }

  private initGraph() {
    this.container.innerHTML = ''; // clear
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    if (this.options.mode === '3d') {
      this.graphInstance = (ForceGraph3D as any)()(this.container)
        .width(width).height(height)
        .nodeColor((node: any) => this.getNodeColor(node))
        .nodeLabel((node: any) => this.options.showHoverData ? this.getNodeLabel(node) : null)
        .linkLabel((link: any) => this.options.showHoverData ? this.getLinkLabel(link) : null)
        .onNodeClick((node: any) => { if (this.options.onNodeClick) this.options.onNodeClick(node); })
        .onLinkClick((link: any) => { if (this.options.onLinkClick) this.options.onLinkClick(link); });

      if (this.options.showPermanentLabels) {
        this.graphInstance.nodeThreeObject((node: any) => {
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
        this.graphInstance.linkThreeObjectExtend(true);
        this.graphInstance.linkThreeObject((link: any) => {
          const sprite = new SpriteText(link.name || '');
          sprite.color = 'lightgrey';
          sprite.textHeight = 2.5;
          return sprite;
        });
        this.graphInstance.linkPositionUpdate((sprite: any, { start, end }: any) => {
          const middlePos = {
            x: start.x + (end.x - start.x) / 2,
            y: start.y + (end.y - start.y) / 2,
            z: start.z + (end.z - start.z) / 2
          };
          Object.assign(sprite.position, middlePos);
        });
      }

      if (this.options.showArrows) {
        this.graphInstance.linkDirectionalArrowLength(3.5).linkDirectionalArrowRelPos(1);
      }
    } else {
      this.graphInstance = (ForceGraph as any)()(this.container)
        .width(width).height(height)
        .nodeColor((node: any) => this.getNodeColor(node))
        .nodeLabel((node: any) => this.options.showHoverData ? this.getNodeLabel(node) : null)
        .linkLabel((link: any) => this.options.showHoverData ? this.getLinkLabel(link) : null)
        .onNodeClick((node: any) => { if (this.options.onNodeClick) this.options.onNodeClick(node); })
        .onLinkClick((link: any) => { if (this.options.onLinkClick) this.options.onLinkClick(link); });

      if (this.options.showPermanentLabels) {
        this.graphInstance.nodeCanvasObject((node: any, ctx: any, globalScale: number) => {
          const label = node.label || node.id;
          const text = `${label}\n${node.id}`;
          const fontSize = 12/globalScale;
          ctx.font = `${fontSize}px Sans-Serif`;
          
          const lines = text.split('\n');
          const maxTextWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
          
          const bckgDimensions = [maxTextWidth, fontSize * lines.length].map(n => n + fontSize * 0.2); // padding
          
          ctx.fillStyle = this.getNodeColor(node);
          ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          lines.forEach((line, i) => {
             ctx.fillText(line, node.x, node.y - (bckgDimensions[1]/2) + (i + 0.5) * fontSize + fontSize * 0.1);
          });
          
          node.__bckgDimensions = bckgDimensions; // save for hover interaction if needed
        });
        
        // Disable node point rendering so only the canvas card shows
        this.graphInstance.nodePointerAreaPaint((node: any, color: string, ctx: any) => {
          if (!node.__bckgDimensions) return;
          ctx.fillStyle = color;
          const bckgDimensions = node.__bckgDimensions;
          ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
        });
      }

      if (this.options.showEdgeLabels) {
        this.graphInstance.linkCanvasObjectMode(() => 'after');
        this.graphInstance.linkCanvasObject((link: any, ctx: any, globalScale: number) => {
          const start = link.source;
          const end = link.target;
          if (!start || !end || typeof start.x !== 'number' || typeof end.x !== 'number') return;
          
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
        this.graphInstance.linkDirectionalArrowLength(3.5).linkDirectionalArrowRelPos(1);
      }
    }
    
    // We do NOT call applyDataAndZoom here anymore. setMode will call render.
  }

  public setMode(mode: '2d' | '3d') {
    if (this.options.mode !== mode) {
      this.options.mode = mode;
      this.initGraph();
      if (this.lastCypherResult) {
        this.render(this.lastCypherResult);
      }
    }
  }

  public render(cypherResult: any) {
    this.lastCypherResult = cypherResult;
    
    if (!cypherResult || !cypherResult.rows) {
      this.applyDataAndZoom({ nodes: [], links: [] });
      return;
    }

    const freshData = this.extractGraphData(cypherResult.rows);
    this.applyDataAndZoom(freshData);
  }

  private applyDataAndZoom(data: {nodes: any[], links: any[]}) {
    this.graphInstance.graphData(data);
  }

  private extractGraphData(rows: any[]) {
    const nodesMap = new Map();
    const edgesMap = new Map();

    const processValue = (val: any) => {
      if (!val || typeof val !== 'object') return;

      if (Array.isArray(val)) {
        val.forEach(processValue);
        return;
      }

      // Check if Edge: must have id, sourceId, targetId, type
      if ('id' in val && 'sourceId' in val && 'targetId' in val && 'type' in val) {
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
      if ('id' in val && 'labels' in val && Array.isArray(val.labels) && !('sourceId' in val)) {
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

  private getNodeLabel(node: any): string {
    const rawLabel = String(node.label || node.id || '');
    if (!this.options.showHoverData) return this.escapeHtml(rawLabel);
    
    const props = node.data?.properties || {};
    const hasProps = Object.keys(props).length > 0;
    
    return `<div style="padding: 2px;">
      <strong style="color: #ffffff;">${this.escapeHtml(rawLabel)}</strong>
      ${hasProps ? `<pre style="margin: 4px 0 0 0; padding: 6px; font-size: 0.85em; background: #2d3748; color: #e2e8f0; border: 1px solid #4a5568; border-radius: 4px;">${this.escapeHtml(JSON.stringify(props, null, 2))}</pre>` : ''}
    </div>`;
  }

  private getLinkLabel(link: any): string {
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
