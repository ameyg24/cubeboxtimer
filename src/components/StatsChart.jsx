// StatsChart.jsx - Chart.js integration with ao5/ao12 rolling average overlays
import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeContext.jsx";
import Chart from "chart.js/auto";

// WCA-compliant average of N for chart overlay
function wcaAvgN(solvesSlice) {
  if (!solvesSlice || solvesSlice.length < 3) return null;
  const dnfCount = solvesSlice.filter((s) => s.penalty === "DNF").length;
  if (dnfCount >= 2) return null; // treat as null for chart (can't plot DNF line)
  const ts = solvesSlice
    .filter((s) => s.penalty !== "DNF")
    .map((s) => (s.millis + (s.penalty === "+2" ? 2000 : 0)) / 1000);
  if (ts.length < solvesSlice.length - 1) return null;
  const sorted = [...ts].sort((a, b) => a - b);
  const middle = sorted.slice(1, -1);
  if (middle.length === 0) return null;
  return middle.reduce((a, b) => a + b, 0) / middle.length;
}

function buildChartData(solvesRaw) {
  const valid = solvesRaw.filter(
    (s) => s && typeof s.millis === "number" && s.penalty !== "DNF"
  );

  const labels = valid.map((_, i) => `#${i + 1}`);
  const times = valid.map((s) => (s.millis + (s.penalty === "+2" ? 2000 : 0)) / 1000);

  // Rolling ao5: at position i in the valid array, look back in full solvesRaw
  // We compute per-valid-solve index for simplicity (using valid solve indices)
  const ao5Data = valid.map((_, i) => {
    if (i < 4) return null;
    return wcaAvgN(valid.slice(i - 4, i + 1));
  });

  const ao12Data = valid.map((_, i) => {
    if (i < 11) return null;
    return wcaAvgN(valid.slice(i - 11, i + 1));
  });

  return { labels, times, ao5Data, ao12Data };
}

const StatsChart = ({ solves }) => {
  const chartRef = useRef();
  const chartInstance = useRef();
  const { dark } = useTheme();

  const gridColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const textColor = dark ? "#94a3b8" : "#6b7280";

  useEffect(() => {
    if (!chartRef.current) return;
    const ctx = chartRef.current.getContext("2d");
    const { labels, times, ao5Data, ao12Data } = buildChartData(solves || []);

    chartInstance.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Solve Time",
            data: times,
            borderColor: "#ff4081",
            backgroundColor: "rgba(255, 64, 129, 0.08)",
            pointBackgroundColor: "#fff",
            pointBorderColor: "#ff4081",
            pointRadius: 4,
            pointHoverRadius: 7,
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            order: 3,
          },
          {
            label: "ao5",
            data: ao5Data,
            borderColor: "#1a73e8",
            backgroundColor: "transparent",
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            tension: 0.4,
            fill: false,
            spanGaps: false,
            order: 2,
          },
          {
            label: "ao12",
            data: ao12Data,
            borderColor: "#43a047",
            backgroundColor: "transparent",
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            tension: 0.4,
            fill: false,
            spanGaps: false,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: textColor,
              font: { size: 12 },
              padding: 16,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: dark ? "#1e293b" : "#fff",
            titleColor: dark ? "#f1f5f9" : "#333",
            bodyColor: dark ? "#94a3b8" : "#555",
            borderColor: dark ? "#334155" : "#e0e0e0",
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            titleFont: { size: 13, weight: "bold" },
            bodyFont: { size: 13 },
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y;
                if (val === null || val === undefined) return null;
                return ` ${ctx.dataset.label}: ${val.toFixed(2)}s`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            title: { display: true, text: "Solve #", color: textColor, font: { size: 12 } },
            ticks: { color: textColor, font: { size: 11 }, maxTicksLimit: 15 },
          },
          y: {
            grid: { color: gridColor },
            title: { display: true, text: "Time (s)", color: textColor, font: { size: 12 } },
            ticks: { color: textColor, font: { size: 11 }, callback: (v) => v.toFixed(1) + "s" },
          },
        },
        layout: { padding: { top: 10, right: 10, bottom: 10, left: 10 } },
        animation: { duration: 600, easing: "easeOutQuart" },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [dark]); // re-create chart when theme changes

  useEffect(() => {
    if (!chartInstance.current) return;
    const { labels, times, ao5Data, ao12Data } = buildChartData(solves || []);
    chartInstance.current.data.labels = labels;
    chartInstance.current.data.datasets[0].data = times;
    chartInstance.current.data.datasets[1].data = ao5Data;
    chartInstance.current.data.datasets[2].data = ao12Data;
    chartInstance.current.update();
  }, [solves]);

  return (
    <div
      className="chart-container"
      style={{
        width: "100%",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow)",
        padding: "1rem",
        boxSizing: "border-box",
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      <canvas ref={chartRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
};

export default StatsChart;
