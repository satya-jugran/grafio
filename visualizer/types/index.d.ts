export interface VisualizerOptions {
    mode?: '2d' | '3d';
    showArrows?: boolean;
    showHoverData?: boolean;
    showPermanentLabels?: boolean;
    showEdgeLabels?: boolean;
    onNodeClick?: (node: any) => void;
    onLinkClick?: (link: any) => void;
}
export declare class CypherVisualizer {
    private container;
    private options;
    private graphInstance;
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
    render(cypherResult: any): void;
    private applyDataAndZoom;
    private extractGraphData;
    private escapeHtml;
    private getNodeLabel;
    private getLinkLabel;
}
