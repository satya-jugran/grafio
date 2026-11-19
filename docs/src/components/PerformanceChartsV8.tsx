import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import PerformanceChart, { ScaleData } from './PerformanceChart';

ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  Tooltip,
  Legend,
  Title,
);

// 100K-node speedup factor (v8.0.0 vs v7.15.1 mean latency)
const speedup100kData = {
  labels: [
    'Get nodes by property',
    'Var-length traversal (1..5)',
    'Traversal with types',
    'Get edges between nodes',
    'Get Edges to node',
    'Traversal wildcard w/ types',
    'Get nodes by id',
    'Get Node by ID',
    'Get Edges from node',
    'Get all Nodes',
    'Aggregate across two joins',
    'Aggregate by type',
    'Graph Construction',
    'addNode (single)',
    'addEdge (single)',
  ],
  datasets: [
    {
      label: 'Speedup Factor vs v7.15.1 (log scale)',
      data: [
        149.0,
        77.6,
        67.2,
        57.0,
        53.2,
        43.7,
        34.5,
        33.7,
        29.9,
        21.3,
        18.4,
        16.2,
        8.6,
        8.5,
        7.0,
      ],
      backgroundColor: 'rgba(16, 185, 129, 0.7)',
      borderColor: 'rgba(5, 150, 105, 1)',
      borderWidth: 1.5,
    },
  ],
};

const speedupOptions = {
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      position: 'top' as const,
    },
    title: {
      display: true,
      text: 'Grafio v8.0.0 vs v7.15.1 Speedup at 100K Nodes / 300K Edges (Get nodes by type = ~39,667x)',
      font: {
        size: 14,
        weight: 'bold' as const,
      },
    },
    tooltip: {
      callbacks: {
        label: (context: any) => `${context.parsed.x}x faster than v7.15.1`,
      },
    },
  },
  scales: {
    x: {
      type: 'logarithmic' as const,
      title: {
        display: true,
        text: 'Speedup Factor (x faster, log scale)',
      },
      min: 1,
    },
  },
};

// v8.0.0 Write Performance Data (ops/sec)
const writeChartData: ScaleData = {
  scale10k: [
    { label: 'Graph Construction', x: 1, y: 2200 },
    { label: 'addNode', x: 1, y: 296700 },
    { label: 'addEdge', x: 1, y: 327100 },
  ],
  scale50k: [
    { label: 'Graph Construction', x: 2, y: 5100 },
    { label: 'addNode', x: 2, y: 618800 },
    { label: 'addEdge', x: 2, y: 580700 },
  ],
  scale100k: [
    { label: 'Graph Construction', x: 3, y: 6200 },
    { label: 'addNode', x: 3, y: 567100 },
    { label: 'addEdge', x: 3, y: 420500 },
  ],
};

// v8.0.0 Read Performance Data (ops/sec)
const readChartData: ScaleData = {
  scale10k: [
    { label: 'Get Node by ID', x: 1, y: 248500 },
    { label: 'Get nodes by id', x: 1, y: 369400 },
    { label: 'Get nodes by type', x: 1, y: 275600 },
    { label: 'Get nodes by property', x: 1, y: 1900 },
    { label: 'Get all Nodes', x: 1, y: 187800 },
  ],
  scale50k: [
    { label: 'Get Node by ID', x: 2, y: 384800 },
    { label: 'Get nodes by id', x: 2, y: 300700 },
    { label: 'Get nodes by type', x: 2, y: 345400 },
    { label: 'Get nodes by property', x: 2, y: 407 },
    { label: 'Get all Nodes', x: 2, y: 281700 },
  ],
  scale100k: [
    { label: 'Get Node by ID', x: 3, y: 342000 },
    { label: 'Get nodes by id', x: 3, y: 240200 },
    { label: 'Get nodes by type', x: 3, y: 299200 },
    { label: 'Get nodes by property', x: 3, y: 226 },
    { label: 'Get all Nodes', x: 3, y: 261400 },
  ],
};

// v8.0.0 Navigation Performance Data (ops/sec)
const navigationChartData: ScaleData = {
  scale10k: [
    { label: 'Get Edges from node', x: 1, y: 125100 },
    { label: 'Get Edges to node', x: 1, y: 184800 },
    { label: 'Get edges between nodes', x: 1, y: 151400 },
  ],
  scale50k: [
    { label: 'Get Edges from node', x: 2, y: 199500 },
    { label: 'Get Edges to node', x: 2, y: 173800 },
    { label: 'Get edges between nodes', x: 2, y: 127300 },
  ],
  scale100k: [
    { label: 'Get Edges from node', x: 3, y: 105500 },
    { label: 'Get Edges to node', x: 3, y: 157000 },
    { label: 'Get edges between nodes', x: 3, y: 219000 },
  ],
};

// v8.0.0 Traversal Performance Data (ops/sec)
const traversalChartData: ScaleData = {
  scale10k: [
    { label: 'Var-length (1..5)', x: 1, y: 4600 },
    { label: 'Traversal with types', x: 1, y: 88900 },
    { label: 'Wildcard with types', x: 1, y: 39800 },
  ],
  scale50k: [
    { label: 'Var-length (1..5)', x: 2, y: 6800 },
    { label: 'Traversal with types', x: 2, y: 65100 },
    { label: 'Wildcard with types', x: 2, y: 50800 },
  ],
  scale100k: [
    { label: 'Var-length (1..5)', x: 3, y: 8500 },
    { label: 'Traversal with types', x: 3, y: 25900 },
    { label: 'Wildcard with types', x: 3, y: 104200 },
  ],
};

// v8.0.0 Aggregation Performance Data (ops/sec)
const aggregationChartData: ScaleData = {
  scale10k: [
    { label: 'Aggregate by type', x: 1, y: 2100 },
    { label: 'Aggregate joined', x: 1, y: 1000 },
  ],
  scale50k: [
    { label: 'Aggregate by type', x: 2, y: 983 },
    { label: 'Aggregate joined', x: 2, y: 175 },
  ],
  scale100k: [
    { label: 'Aggregate by type', x: 3, y: 555 },
    { label: 'Aggregate joined', x: 3, y: 54 },
  ],
};

const PerformanceChartsV8: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '60px' }}>
      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>v8.0.0 vs v7.15.1 Speedup (100K Scale)</h3>
        <Bar options={speedupOptions} data={speedup100kData} />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>v8.0.0 Write Operations Throughput</h3>
        <PerformanceChart
          title="v8 Write Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={writeChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>v8.0.0 Read Operations Throughput</h3>
        <PerformanceChart
          title="v8 Read Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={readChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>v8.0.0 Navigation Operations Throughput</h3>
        <PerformanceChart
          title="v8 Navigation Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={navigationChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>v8.0.0 Traversal Operations Throughput</h3>
        <PerformanceChart
          title="v8 Traversal Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={traversalChartData}
        />
      </div>

      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
        <h3>v8.0.0 Aggregation Operations Throughput</h3>
        <PerformanceChart
          title="v8 Aggregation Performance Across Scales"
          xAxisLabel="Scale"
          yAxisLabel="Operations/sec"
          data={aggregationChartData}
        />
      </div>
    </div>
  );
};

export default PerformanceChartsV8;
