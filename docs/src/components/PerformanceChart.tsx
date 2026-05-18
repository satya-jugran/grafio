import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  Title,
} from 'chart.js';
import { Bubble } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, Tooltip, Legend, Title);

interface DataPoint {
  label: string;
  x: number;
  y: number;
  r?: number;
}

interface ScaleData {
  scale10k: DataPoint[];
  scale50k: DataPoint[];
  scale100k: DataPoint[];
}

interface PerformanceChartProps {
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  data: ScaleData;
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({
  title,
  xAxisLabel,
  yAxisLabel,
  data,
}) => {
  const chartData = {
    datasets: [
      {
        label: '10K Nodes',
        data: data.scale10k,
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 2,
      },
      {
        label: '50K Nodes',
        data: data.scale50k,
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 2,
      },
      {
        label: '100K Nodes',
        data: data.scale100k,
        backgroundColor: 'rgba(255, 99, 132, 0.6)',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: title,
        font: {
          size: 16,
          weight: 'bold' as const,
        },
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const point = context.raw;
            const scaleLabels = { 1: '10K', 2: '50K', 3: '100K' };
            return `${point.label} (${scaleLabels[point.x as keyof typeof scaleLabels]}): ${point.y.toLocaleString()} ops/sec`;
          },
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Scale',
        },
        ticks: {
          callback: (value: string | number) => {
            const labels: { [key: number]: string } = { 1: '10K', 2: '50K', 3: '100K' };
            return labels[Number(value)] || value;
          },
        },
        beginAtZero: true,
        max: 4,
      },
      y: {
        title: {
          display: true,
          text: 'Operations/sec',
        },
        beginAtZero: true,
      },
    },
  };

  return <Bubble options={options} data={chartData} />;
};

export default PerformanceChart;
export type { ScaleData, DataPoint };
