// Dashboard.js - Shows stats and charts
import React from "react";
import StatsChart from "./StatsChart";

const Dashboard = ({
  sessionStats,
  allTimeStats,
  sessionSolves,
  allSolves,
}) => {
  // Helper to format stat values
  const fmt = (v) => {
    if (v === "DNF") return "DNF";
    return v != null ? v.toFixed(2) + "s" : "-";
  };

  return (
    <div
      className="dashboard"
      style={{
        width: "100%",
        maxWidth: 700,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <h2
        style={{
          marginBottom: "1.2rem",
          fontWeight: 700,
          fontSize: "2.2rem",
          color: "#222",
          letterSpacing: "0.5px",
          textAlign: "center",
        }}
      >
        Solve Statistics
      </h2>
      <div
        style={{
          display: "flex",
          gap: "2rem",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "2rem",
          flexWrap: "wrap",
          width: "100%",
        }}
      >
        {/* Session Stats */}
        <div
          style={{
            background: "#ffe3ef",
            borderRadius: 12,
            padding: "1.2rem 1.5rem",
            minWidth: 180,
            flex: 1,
            boxShadow: "0 1px 4px #ffd6df",
            fontWeight: 600,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "left",
            maxWidth: 220,
          }}
        >
          <div
            style={{
              color: "#ff4081",
              fontSize: "1.15rem",
              fontWeight: 700,
              marginBottom: 8,
              alignSelf: "center",
            }}
          >
            Session
          </div>
          <div style={{ width: "100%" }}>
            Best: <b>{fmt(sessionStats.best)}</b>
          </div>
          <div style={{ width: "100%" }}>
            Worst: <b>{fmt(sessionStats.worst)}</b>
          </div>
          <div style={{ width: "100%" }}>
            Mean: <b>{fmt(sessionStats.mean)}</b>
          </div>
          <div style={{ width: "100%" }}>
            ao5: <b>{fmt(sessionStats.ao5)}</b>
          </div>
          <div style={{ width: "100%" }}>
            ao12: <b>{fmt(sessionStats.ao12)}</b>
          </div>
          <div style={{ width: "100%" }}>
            Total: <b>{sessionStats.count}</b>
          </div>
        </div>
        {/* All-Time Stats */}
        <div
          style={{
            background: "#e3f2fd",
            borderRadius: 12,
            padding: "1.2rem 1.5rem",
            minWidth: 180,
            flex: 1,
            boxShadow: "0 1px 4px #e3e3e3",
            fontWeight: 600,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "left",
            maxWidth: 220,
          }}
        >
          <div
            style={{
              color: "#1a73e8",
              fontSize: "1.15rem",
              fontWeight: 700,
              marginBottom: 8,
              alignSelf: "center",
            }}
          >
            All-Time
          </div>
          <div style={{ width: "100%" }}>
            Best: <b>{fmt(allTimeStats.best)}</b>
          </div>
          <div style={{ width: "100%" }}>
            Worst: <b>{fmt(allTimeStats.worst)}</b>
          </div>
          <div style={{ width: "100%" }}>
            Mean: <b>{fmt(allTimeStats.mean)}</b>
          </div>
          <div style={{ width: "100%" }}>
            ao5: <b>{fmt(allTimeStats.ao5)}</b>
          </div>
          <div style={{ width: "100%" }}>
            ao12: <b>{fmt(allTimeStats.ao12)}</b>
          </div>
          <div style={{ width: "100%" }}>
            Total: <b>{allTimeStats.count}</b>
          </div>
        </div>
      </div>
      {/* Chart for all-time progress */}
      <StatsChart solves={allSolves} />
    </div>
  );
};

export default Dashboard;

// This file is deprecated. Use Dashboard.jsx instead for the Dashboard component.
