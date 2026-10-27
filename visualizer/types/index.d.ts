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
export interface VisualizerOptions {
    mode?: '2d' | '3d';
    showArrows?: boolean;
    showHoverData?: boolean;
    showPermanentLabels?: boolean;
    showEdgeLabels?: boolean;
    onNodeClick?: (node: VisualizerNode) => void;
    onLinkClick?: (link: VisualizerLink) => void;
}
export declare class CypherVisualizer {
    private container;
    private options;
    private graphInstance;
    private pendingData;
    private lastCypherResult;
    private resizeObserver;
    private readonly colorPalette;
    private labelColorMap;
    private nextColorIndex;
    constructor(container: HTMLElement, options?: VisualizerOptions);
    destroy(): void;
    private getNodeColor;
    private initGraph;
    setMode(mode: '2d' | '3d'): void;
    render(cypherResult: CypherVisualizerResult | null | undefined): void;
    private applyDataAndZoom;
    private extractGraphData;
    private escapeHtml;
    private getNodeLabel;
    private getLinkLabel;
}
