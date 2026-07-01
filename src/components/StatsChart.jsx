// StatsChart.jsx - Chart.js integration with ao5/ao12 rolling average overlays
import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeContext.jsx";
import Chart from "chart.js/auto";
import {
  effectiveMillis,
  isValidSolve,
  mean as meanOf,
  rollingAverageOfN,
} from "../analytics";

// Charts plot valid solves on the x-axis and map non-ok averages to null gaps.
const resultToSeconds = (r) => (r.status === "ok" ? r.valueMs / 1000 : null);

function buildChartData(solvesRaw) {
  const valid = (solvesRaw || []).filter(isValidSolve);

  const labels = valid.map((_, i) => `#${i + 1}`);
  const times = valid.map((s) => effectiveMillis(s) / 1000);

  // Rolling overlays are computed across the plotted (valid) solves.
  const ao5Data = rollingAverageOfN(valid, 5).map(resultToSeconds);
  const ao12Data = rollingAverageOfN(valid, 12).map(resultToSeconds);

  const meanResult = meanOf(valid);
  const mean = resultToSeconds(meanResult);
  const meanData = times.map(() => mean);
  return { labels, times, ao5Data, ao12Data, meanData };
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
    const { labels, times, ao5Data, ao12Data, meanData } = buildChartData(solves || []);

    const styles = getComputedStyle(document.body);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const solveColor = token("--chart-solve", "#ff4081");
    const ao5Color = token("--chart-ao5", "#1a73e8");
    const ao12Color = token("--chart-ao12", "#43a047");
    const meanColor = token("--chart-mean", "rgba(180,180,180,0.6)");

    chartInstance.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Solve Time",
            data: times,
            borderColor: solveColor,
            backgroundColor: "rgba(255, 64, 129, 0.08)",
            pointBackgroundColor: "#fff",
            pointBorderColor: solveColor,
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
            borderColor: ao5Color,
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
            borderColor: ao12Color,
            backgroundColor: "transparent",
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            tension: 0.4,
            fill: false,
            spanGaps: false,
            order: 1,
          },
          {
            label: "mean",
            data: meanData,
            borderColor: meanColor,
            backgroundColor: "transparent",
            pointRadius: 0,
            pointHoverRadius: 0,
            borderWidth: 1.5,
            borderDash: [6, 4],
            tension: 0,
            fill: false,
            spanGaps: true,
            order: 0,
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
    const { labels, times, ao5Data, ao12Data, meanData } = buildChartData(solves || []);
    chartInstance.current.data.labels = labels;
    chartInstance.current.data.datasets[0].data = times;
    chartInstance.current.data.datasets[1].data = ao5Data;
    chartInstance.current.data.datasets[2].data = ao12Data;
    chartInstance.current.data.datasets[3].data = meanData;
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
