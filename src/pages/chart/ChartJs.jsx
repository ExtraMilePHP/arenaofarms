import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';

const BarChart = ({ labels, data }) => {
  const chartRef = useRef(null);
  const myChart = useRef(null); // Use a ref to persist the chart instance

  useEffect(() => {
    const ctx = chartRef.current.getContext('2d');

    const colors = [
      '#ff5733', '#33c1ff', '#33ff57', '#ffc133', '#ff33b5',
      '#a733ff', '#33ffe0', '#ff8c33', '#b8ff33', '#33ff99'
    ];

    const chartData = data.slice(0, 10);
    const chartLabels = labels.slice(0, 10).map(label => {
      if (label.length > 10) {
        const words = label.split(' ');
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
          if (currentLine.length + word.length + 1 <= 10) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        });

        if (currentLine) {
          lines.push(currentLine);
        }

        return lines;
      }
      return label;
    });

    const selectedColors = colors.slice(0, Math.min(chartLabels.length, 10));

    if (!myChart.current) {
      // Create the chart if it doesn't exist
      myChart.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartLabels,
          datasets: [{
            data: chartData,
            backgroundColor: selectedColors,
            borderRadius: 10,
            borderSkipped: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (context) {
                  return context.raw + '%';
                },
              },
            },
            datalabels: {
              anchor: (context) => context.dataset.data[context.dataIndex] === 100 ? 'start' : 'end',
              align: (context) => context.dataset.data[context.dataIndex] === 100 ? 'bottom' : 'end',
              offset: (context) => context.dataset.data[context.dataIndex] === 100 ? -25 : 0,
              color: '#000',
              formatter: (value) => value + '%',
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: '#000',
                font: { size: 14, weight: 'bold' },
              },
            },
            y: {
              grid: { display: false },
              ticks: { display: false },
              beginAtZero: true,
              max: 100,
            },
          },
          animation: {
            duration: 1000, // Animation duration for updates
            easing: 'easeInOutQuad', // Smooth easing function
          },
        },
        plugins: [ChartDataLabels],
      });
    } else {
      // Update the chart data if it already exists
      myChart.current.data.labels = chartLabels;
      myChart.current.data.datasets[0].data = chartData;
      myChart.current.data.datasets[0].backgroundColor = selectedColors;
      myChart.current.update(); // Trigger an animated update
    }
  }, [labels, data]);

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <canvas ref={chartRef}></canvas>
    </div>
  );
};

export default BarChart;