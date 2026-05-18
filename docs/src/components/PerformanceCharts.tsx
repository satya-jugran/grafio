import React from 'react';
import PerformanceChart, { ScaleData } from './PerformanceChart';

// Write Performance Data (x = scale index 1,2,3 for 10K,50K,100K, y = ops/sec)
const writeChartData: ScaleData = {
  scale10k: [
    { label: 'Graph Construction', x: 1, y: 1100 },
    { label: 'addNode', x: 1, y: 137000 },
    { label: 'addEdge', x: 1, y: 147300 },
  ],
  scale50k: [
    { label: 'Graph Construction', x: 2, y: 628 },
    { label: 'addNode', x: 2, y: 122600 },
    { label: 'addEdge', x: 2, y: 154800 },
  ],
  scale100k: [
    { label: 'Graph Construction', x: 3, y: 1700 },
    { label: 'addNode', x: 3, y: 141300 },
    { label: 'addEdge', x: 3, y: 186300 },
  ],
};

// Read Performance Data
const readChartData: ScaleData = {
  scale10k: [
    { label: 'Get Node by ID', x: 1, y: 35200 },
    { label: 'Get nodes by id', x: 1, y: 26500 },
    { label: 'Get nodes by type', x: 1, y: 244 },
    { label: 'Get nodes by property', x: 1, y: 53 },
    { label: 'Get all Nodes', x: 1, y: 26300 },
  ],
  scale50k: [
    { label: 'Get Node by ID', x: 2, y: 34500 },
    { label: 'Get nodes by id', x: 2, y: 28400 },
    { label: 'Get nodes by type', x: 2, y: 50 },
    { label: 'Get nodes by property', x: 2, y: 11 },
    { label: 'Get all Nodes', x: 2, y: 38700 },
  ],
  scale100k: [
    { label: 'Get Node by ID', x: 3, y: 32500 },
    { label: 'Get nodes by id', x: 3, y: 22800 },
    { label: 'Get nodes by type', x: 3, y: 25 },
    { label: 'Get nodes by property', x: 3, y: 3 },
    { label: 'Get all Nodes', x: 3, y: 22500 },
  ],
};

// Navigation Performance Data
const navigationChartData: ScaleData = {
  scale10k: [
    { label: 'Get Edges from node', x: 1, y: 13500 },
    { label: 'Get Edges to node', x: 1, y: 16200 },
    { label: 'Get edges between nodes', x: 1, y: 10600 },
  ],
  scale50k: [
    { label: 'Get Edges from node', x: 2, y: 12900 },
    { label: 'Get Edges to node', x: 2, y: 8700 },
    { label: 'Get edges between nodes', x: 2, y: 9900 },
  ],
  scale100k: [
    { label: 'Get Edges from node', x: 3, y: 9300 },
    { label: 'Get Edges to node', x: 3, y: 9100 },
    { label: 'Get edges between nodes', x: 3, y: 8300 },
  ],
};

// Traversal Performance Data
const traversalChartData: ScaleData = {
  scale10k: [
    { label: 'Var-length (1..5)', x: 1, y: 331 },
    { label: 'Traversal with types', x: 1, y: 11600 },
    { label: 'Wildcard with types', x: 1, y: 3200 },
  ],
  scale50k: [
    { label: 'Var-length (1..5)', x: 2, y: 344 },
    { label: 'Traversal with types', x: 2, y: 9200 },
    { label: 'Wildcard with types', x: 2, y: 4100 },
  ],
  scale100k: [
    { label: 'Var-length (1..5)', x: 3, y: 102 },
    { label: 'Traversal with types', x: 3, y: 981 },
    { label: 'Wildcard with types', x: 3, y: 2300 },
  ],
};

// Aggregation Performance Data
const aggregationChartData: ScaleData = {
  scale10k: [
    { label: 'Aggregate by type', x: 1, y: 1050 },
    { label: 'Aggregate joined', x: 1, y: 135 },
  ],
  scale50k: [
    { label: 'Aggregate by type', x: 2, y: 489 },
    { label: 'Aggregate joined', x: 2, y: 31 },
  ],
  scale100k: [
    { label: 'Aggregate by type', x: 3, y: 119 },
    { label: 'Aggregate joined', x: 3, y: 8 },
  ],
};

const PerformanceCharts: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '60px' }}>
      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>Write Operations Performance</h3>
        <PerformanceChart
          title="Write Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={writeChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>Read Operations Performance</h3>
        <PerformanceChart
          title="Read Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={readChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>Navigation Operations Performance</h3>
        <PerformanceChart
          title="Navigation Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={navigationChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>Traversal Operations Performance</h3>
        <PerformanceChart
          title="Traversal Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={traversalChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>Aggregation Operations Performance</h3>
        <PerformanceChart
          title="Aggregation Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={aggregationChartData}
        />
      </div>
    </div>
  );
};

export default PerformanceCharts;