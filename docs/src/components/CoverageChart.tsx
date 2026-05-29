import React from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { useColorMode } from '@docusaurus/theme-common';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function CoverageChart() {
  const { colorMode } = useColorMode();
  const textColor = colorMode === 'dark' ? '#F5F6F7' : '#1C1E21';

  const data = {
    labels: ['Fully supported', 'Partially supported', 'Not supported'],
    datasets: [
      {
        data: [16, 4, 4],
        backgroundColor: [
          'rgba(75, 192, 192, 0.8)',
          'rgba(255, 206, 86, 0.8)',
          'rgba(255, 99, 132, 0.8)',
        ],
        borderColor: [
          'rgba(75, 192, 192, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(255, 99, 132, 1)',
        ],
        borderWidth: 1,
      },
    ],
  };

  const options = {
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: textColor,
        }
      },
    },
    maintainAspectRatio: false,
  };

  return (
    <div style={{ height: '300px', width: '100%', display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
      <Doughnut data={data} options={options} />
    </div>
  );
}
