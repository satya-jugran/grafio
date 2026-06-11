---
sidebar_position: 2
title: "@grafio/visualizer"
description: Official Cypher graph renderer
---

# @grafio/visualizer

`@grafio/visualizer` is the official graph rendering library for Grafio. It provides the `CypherVisualizer` class, which is an aesthetic, highly interactive wrapper around `force-graph` and `3d-force-graph` designed to seamlessly consume and render Cypher execution results natively in the browser.

## Installation

```bash
npm install @grafio/visualizer
```

> **Note:** If you are using this package in a server-side rendered (SSR) framework like Next.js or Docusaurus, rest assured it uses dynamic imports to ensure window/document dependencies do not crash your server build!

## Initialization

To create a visualizer, instantiate the `CypherVisualizer` class by passing it a DOM container and an optional configuration object. The visualizer automatically uses a `ResizeObserver` to sync the canvas dimensions strictly with the flex container.

```typescript
import { CypherVisualizer } from '@grafio/visualizer';

// Grab your container element
const container = document.getElementById('graph-container');

// Initialize the visualizer
const visualizer = new CypherVisualizer(container, {
  mode: '3d', // or '2d'
  showArrows: true,
  showHoverData: true,
  showPermanentLabels: false,
  showEdgeLabels: false
});
```

## Configuration Options

The `CypherVisualizer` constructor accepts a `VisualizerOptions` object:

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'2d' \| '3d'` | `'2d'` | The rendering mode. |
| `showArrows` | `boolean` | `false` | Shows directional arrows on the relationship links. |
| `showHoverData` | `boolean` | `true` | Displays rich HTML tooltips with the node/link properties on hover. |
| `showPermanentLabels` | `boolean` | `false` | Permanently displays text labels over the nodes instead of points. |
| `showEdgeLabels` | `boolean` | `false` | Displays the relationship type labels on the links. |
| `onNodeClick` | `(node: any) => void` | `undefined` | Callback fired when a node is clicked. |
| `onLinkClick` | `(link: any) => void` | `undefined` | Callback fired when a relationship link is clicked. |

## Methods

### `render(cypherResult: any)`
The most powerful feature of the visualizer. It accepts a raw `CypherResult` object returned directly from `@grafio/browser` or `@grafio/core` engine. It automatically extracts all nodes and relationships from the `rows` and updates the physics simulation immediately!

```typescript
// Pass the result directly from engine.execute()
visualizer.render(result);
```

### `setMode(mode: '2d' | '3d')`
Switches the rendering engine between 2D and 3D dynamically on the fly while retaining the currently loaded graph data.

```typescript
visualizer.setMode('2d');
```

### `destroy()`
Cleans up the internal WebGL instances, `ResizeObserver`, event listeners, and empties the DOM container to prevent memory leaks when a component unmounts.

```typescript
visualizer.destroy();
```

## Complete Usage Example

Below is an example showing how seamlessly `@grafio/visualizer` connects to a `CypherEngine` execution result:

```typescript
import { CypherEngine } from '@grafio/browser';
import { CypherVisualizer } from '@grafio/visualizer';

async function visualizeResults() {
  // 1. Run a query that returns nodes and edges
  const engine = new CypherEngine({ /* ... */ });
  const result = await engine.execute(`MATCH (n)-[r]->(m) RETURN n, r, m`);

  // 2. Grab container and initialize visualizer
  const container = document.getElementById('my-container');
  const visualizer = new CypherVisualizer(container, { mode: '2d' });
  
  // 3. Render the result instantly!
  visualizer.render(result);
}
```
