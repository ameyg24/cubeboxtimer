// StatsChart.js - Chart.js integration for stats
import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

const StatsChart = ({ solves }) => {
  const chartRef = useRef();
  useEffect(() => {
    if (!chartRef.current) return;
    const ctx = chartRef.current.getContext("2d");
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: solves.map((_, i) => `#${i + 1}`),
        datasets: [
          {
            label: "Solve Time (s)",
            data: solves.map((s) => s / 1000),
            borderColor: "#ff4081",
            backgroundColor: "rgba(255, 64, 129, 0.18)",
            pointBackgroundColor: "#fff",
            pointBorderColor: "#ff4081",
            pointRadius: 7,
            pointHoverRadius: 11,
            pointStyle: "circle",
            borderWidth: 4,
            tension: 0.35,
            fill: true,
            shadowOffsetX: 0,
            shadowOffsetY: 4,
            shadowBlur: 10,
            shadowColor: "rgba(255,64,129,0.2)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: "#ff4081",
              font: { size: 18, weight: "bold" },
              padding: 24,
            },
          },
          tooltip: {
            backgroundColor: "#fff",
            titleColor: "#ff4081",
            bodyColor: "#222",
            borderColor: "#ff4081",
            borderWidth: 2,
            padding: 16,
            displayColors: false,
            titleFont: { size: 18, weight: "bold" },
            bodyFont: { size: 16 },
          },
        },
        scales: {
          x: {
            grid: { color: "#ffe3ef" },
            title: {
              display: true,
              text: "Solve #",
              color: "#ff4081",
              font: { weight: "bold", size: 18 },
            },
            ticks: { color: "#ff4081", font: { size: 15 } },
          },
          y: {
            grid: { color: "#ffe3ef" },
            title: {
              display: true,
              text: "Time (s)",
              color: "#ff4081",
              font: { weight: "bold", size: 18 },
            },
            ticks: { color: "#ff4081", font: { size: 15 } },
          },
        },
        layout: {
          padding: 30,
        },
        animation: {
          duration: 1200,
          easing: "easeOutElastic",
        },
      },
    });
    return () => chart.destroy();
  }, [solves]);
  return (
    <div
      style={{
        width: "100%",
        minHeight: 420,
        height: 420,
        background: "linear-gradient(90deg,#ffd6df 0%,#e3f2fd 100%)",
        borderRadius: 18,
        boxShadow: "0 4px 32px #ffd6df",
        margin: "0 auto",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
      }}
    >
      <canvas
        ref={chartRef}
        style={{
          maxWidth: 900,
          width: "100%",
          height: 370,
          background: "transparent",
        }}
      />
    </div>
  );
};

export default StatsChart;

// This file is deprecated. Use StatsChart.jsx instead for the StatsChart component.
