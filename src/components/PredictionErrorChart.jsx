// PredictionErrorChart.jsx - "Prediction Error Over Time" line chart for the
// Prediction Quality section. Mirrors StatsChart.jsx's Chart.js conventions
// exactly (canvas ref, dark-mode-aware CSS token colors, dashed zero-line,
// tooltip formatting) rather than introducing a second charting approach.
import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeContext.jsx";
import Chart from "chart.js/auto";

function buildChartData(cases) {
  const sorted = [...cases].sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  const labels = sorted.map((c) =>
    new Date(c.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  );
  const biasData = sorted.map((c) => c.biasPct);
  const zeroData = sorted.map(() => 0);
  return { labels, biasData, zeroData };
}

const PredictionErrorChart = ({ cases }) => {
  const chartRef = useRef();
  const chartInstance = useRef();
  const { dark } = useTheme();
  const hasData = (cases || []).length > 0;

  const gridColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const textColor = dark ? "#94a3b8" : "#6b7280";

  useEffect(() => {
    if (!chartRef.current) return;
    const ctx = chartRef.current.getContext("2d");
    const { labels, biasData, zeroData } = buildChartData(cases || []);

    const styles = getComputedStyle(document.body);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const biasColor = token("--chart-ao5", "#1a73e8");
    const zeroColor = token("--chart-mean", "rgba(180,180,180,0.6)");

    chartInstance.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Bias",
            data: biasData,
            borderColor: biasColor,
            backgroundColor: "transparent",
            pointBackgroundColor: biasColor,
            pointBorderColor: biasColor,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
            tension: 0.3,
            fill: false,
            order: 1,
          },
          {
            label: "Zero (no bias)",
            data: zeroData,
            borderColor: zeroColor,
            backgroundColor: "transparent",
            pointRadius: 0,
            pointHoverRadius: 0,
            borderWidth: 1.5,
            borderDash: [6, 4],
            tension: 0,
            fill: false,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
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
                return ` ${ctx.dataset.label}: ${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 11 }, maxTicksLimit: 12 },
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 11 }, callback: (v) => `${v}%` },
          },
        },
        layout: { padding: { top: 6, right: 10, bottom: 4, left: 4 } },
        animation: { duration: 600, easing: "easeOutQuart" },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [dark, hasData]);

  useEffect(() => {
    if (!chartInstance.current) return;
    const { labels, biasData, zeroData } = buildChartData(cases || []);
    chartInstance.current.data.labels = labels;
    chartInstance.current.data.datasets[0].data = biasData;
    chartInstance.current.data.datasets[1].data = zeroData;
    chartInstance.current.update();
  }, [cases]);

  if (!hasData) {
    return (
      <div style={{ color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" }}>
        Not enough evaluated predictions yet to chart error over time.
      </div>
    );
  }

  return (
    <div className="chart-container" style={{ height: 220 }}>
      <canvas ref={chartRef} role="img" aria-label="Prediction bias over time, in percent. Positive is optimistic, negative is pessimistic." />
    </div>
  );
};

export default PredictionErrorChart;
