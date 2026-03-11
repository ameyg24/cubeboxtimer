// Dashboard.jsx - CS Timer-style statistics with session, all-time, and daily breakdown
import { useState, useMemo } from "react";
import StatsChart from "./StatsChart";

// WCA-compliant trimmed average of N
function wcaAvgN(solvesSlice) {
  if (!solvesSlice || solvesSlice.length < 3) return null;
  const dnfCount = solvesSlice.filter((s) => s.penalty === "DNF").length;
  if (dnfCount >= 2) return "DNF";
  const ts = solvesSlice
    .filter((s) => s.penalty !== "DNF")
    .map((s) => (s.millis + (s.penalty === "+2" ? 2000 : 0)) / 1000);
  if (ts.length < solvesSlice.length - 1) return "DNF";
  const sorted = [...ts].sort((a, b) => a - b);
  const middle = sorted.slice(1, -1);
  if (middle.length === 0) return null;
  return middle.reduce((a, b) => a + b, 0) / middle.length;
}

function computeFullStats(solvesRaw) {
  const empty = {
    best: null, worst: null, mean: null, stddev: null,
    ao5: null, ao12: null, ao50: null, ao100: null,
    bestAo5: null, bestAo12: null,
    count: 0, validCount: 0, dnfCount: 0, plus2Count: 0,
  };
  if (!solvesRaw || solvesRaw.length === 0) return empty;

  const validSolves = solvesRaw.filter(
    (s) => typeof s.millis === "number" && s.penalty !== "DNF"
  );
  const times = validSolves.map(
    (s) => (s.millis + (s.penalty === "+2" ? 2000 : 0)) / 1000
  );
  const dnfCount = solvesRaw.filter((s) => s.penalty === "DNF").length;
  const plus2Count = solvesRaw.filter((s) => s.penalty === "+2").length;

  if (times.length === 0) {
    return { ...empty, count: solvesRaw.length, validCount: 0, dnfCount, plus2Count };
  }

  const best = Math.min(...times);
  const worst = Math.max(...times);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance =
    times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length;
  const stddev = Math.sqrt(variance);

  const ao5 = solvesRaw.length >= 5 ? wcaAvgN(solvesRaw.slice(-5)) : null;
  const ao12 = solvesRaw.length >= 12 ? wcaAvgN(solvesRaw.slice(-12)) : null;
  const ao50 = solvesRaw.length >= 50 ? wcaAvgN(solvesRaw.slice(-50)) : null;
  const ao100 = solvesRaw.length >= 100 ? wcaAvgN(solvesRaw.slice(-100)) : null;

  let bestAo5 = null;
  let bestAo12 = null;
  for (let i = 4; i < solvesRaw.length; i++) {
    const avg = wcaAvgN(solvesRaw.slice(i - 4, i + 1));
    if (avg !== null && avg !== "DNF") {
      if (bestAo5 === null || avg < bestAo5) bestAo5 = avg;
    }
  }
  for (let i = 11; i < solvesRaw.length; i++) {
    const avg = wcaAvgN(solvesRaw.slice(i - 11, i + 1));
    if (avg !== null && avg !== "DNF") {
      if (bestAo12 === null || avg < bestAo12) bestAo12 = avg;
    }
  }

  return {
    best, worst, mean, stddev,
    ao5, ao12, ao50, ao100,
    bestAo5, bestAo12,
    count: solvesRaw.length,
    validCount: times.length,
    dnfCount, plus2Count,
  };
}

function computeDailyStats(solvesRaw) {
  const days = {};
  solvesRaw.forEach((s) => {
    const ts = typeof s.id === "number" ? s.id : Date.now();
    const date = new Date(ts);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (!days[dayKey]) days[dayKey] = [];
    days[dayKey].push(s);
  });

  return Object.entries(days)
    .sort(([a], [b]) => b.localeCompare(a)) // most recent first
    .map(([day, solves]) => {
      const valid = solves.filter(
        (s) => typeof s.millis === "number" && s.penalty !== "DNF"
      );
      const times = valid.map(
        (s) => (s.millis + (s.penalty === "+2" ? 2000 : 0)) / 1000
      );
      const best = times.length ? Math.min(...times) : null;
      const mean = times.length
        ? times.reduce((a, b) => a + b, 0) / times.length
        : null;
      const ao5 = solves.length >= 5 ? wcaAvgN(solves.slice(-5)) : null;
      const dnfCount = solves.filter((s) => s.penalty === "DNF").length;
      const [year, month, dayNum] = day.split("-");
      const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
      const label = dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return { day, label, count: solves.length, best, mean, ao5, dnfCount };
    });
}

const fmt = (v) => {
  if (v === "DNF") return "DNF";
  if (v === null || v === undefined) return "-";
  return v.toFixed(2) + "s";
};

const StatRow = ({ label, value, highlight }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "5px 2px",
      borderBottom: "1px solid var(--border)",
      fontSize: "0.88rem",
    }}
  >
    <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
    <span style={{ fontWeight: 700, color: highlight || "var(--text)", fontFamily: "monospace" }}>
      {value}
    </span>
  </div>
);

const StatsCard = ({ title, stats }) => (
  <div
    style={{
      flex: 1,
      minWidth: 190,
      background: "var(--surface)",
      borderRadius: 10,
      padding: "1rem 1.1rem",
      boxShadow: "var(--shadow)",
      border: "1px solid var(--border)",
      transition: "background 0.2s, border-color 0.2s",
    }}
  >
    <div
      style={{
        fontWeight: 700,
        fontSize: "0.9rem",
        marginBottom: 10,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: "var(--text)",
      }}
    >
      <span>{title}</span>
      <span style={{ fontSize: "0.78rem", color: "var(--text-faint)", fontWeight: 500 }}>
        {stats.count} solves
      </span>
    </div>
    <StatRow label="Best" value={fmt(stats.best)} highlight="var(--success)" />
    <StatRow label="Worst" value={fmt(stats.worst)} highlight="var(--danger)" />
    <StatRow label="Mean" value={fmt(stats.mean)} />
    <StatRow label="Std Dev" value={fmt(stats.stddev)} />
    <div style={{ height: 6 }} />
    <StatRow label="ao5" value={fmt(stats.ao5)} highlight="var(--accent)" />
    <StatRow label="ao12" value={fmt(stats.ao12)} highlight="var(--accent)" />
    <StatRow label="ao50" value={fmt(stats.ao50)} highlight="var(--accent)" />
    <StatRow label="ao100" value={fmt(stats.ao100)} highlight="var(--accent)" />
    <div style={{ height: 6 }} />
    <StatRow label="Best ao5" value={fmt(stats.bestAo5)} highlight="var(--accent)" />
    <StatRow label="Best ao12" value={fmt(stats.bestAo12)} highlight="var(--accent)" />
    <div style={{ height: 6 }} />
    <StatRow label="DNFs" value={stats.dnfCount} highlight={stats.dnfCount > 0 ? "var(--danger)" : undefined} />
    <StatRow label="+2s" value={stats.plus2Count} highlight={stats.plus2Count > 0 ? "var(--warning)" : undefined} />
  </div>
);

const DailyStatsTab = ({ dailyStats }) => {
  if (dailyStats.length === 0) {
    return (
      <div
        style={{
          color: "var(--text-faint)",
          textAlign: "center",
          padding: "3rem",
          background: "var(--surface)",
          borderRadius: 10,
          border: "1px solid var(--border)",
        }}
      >
        No solves yet. Start solving!
      </div>
    );
  }

  const thStyle = {
    padding: "10px 12px",
    textAlign: "left",
    fontWeight: 700,
    fontSize: "0.88rem",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: "2px solid var(--border)",
  };
  const tdStyle = {
    padding: "9px 12px",
    fontSize: "0.93rem",
    fontFamily: "monospace",
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        borderRadius: 10,
        boxShadow: "var(--shadow)",
        border: "1px solid var(--border)",
        overflow: "hidden",
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-alt)" }}>
              <th style={{ ...thStyle, fontFamily: "inherit" }}>Date</th>
              <th style={{ ...thStyle, fontFamily: "inherit" }}>Solves</th>
              <th style={{ ...thStyle, fontFamily: "inherit" }}>Best</th>
              <th style={{ ...thStyle, fontFamily: "inherit" }}>Mean</th>
              <th style={{ ...thStyle, fontFamily: "inherit" }}>ao5</th>
              <th style={{ ...thStyle, fontFamily: "inherit" }}>DNFs</th>
            </tr>
          </thead>
          <tbody>
            {dailyStats.map((day, i) => (
              <tr
                key={day.day}
                style={{
                  background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <td style={{ ...tdStyle, fontFamily: "inherit", fontWeight: 600, color: "var(--text)" }}>
                  {day.label}
                </td>
                <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{day.count}</td>
                <td style={{ ...tdStyle, color: "var(--success)", fontWeight: 700 }}>{fmt(day.best)}</td>
                <td style={{ ...tdStyle, color: "var(--text)" }}>{fmt(day.mean)}</td>
                <td style={{ ...tdStyle, color: "var(--accent)" }}>{fmt(day.ao5)}</td>
                <td
                  style={{
                    ...tdStyle,
                    color: day.dnfCount > 0 ? "var(--danger)" : "var(--text-faint)",
                    fontWeight: day.dnfCount > 0 ? 700 : 400,
                  }}
                >
                  {day.dnfCount || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Dashboard = ({ eventSolves, allSolves }) => {
  const [tab, setTab] = useState("stats");

  const sessionStats = useMemo(() => computeFullStats(eventSolves), [eventSolves]);
  const allTimeStats = useMemo(() => computeFullStats(allSolves), [allSolves]);
  const dailyStats = useMemo(() => computeDailyStats(allSolves), [allSolves]);

  const tabStyle = (active) => ({
    padding: "7px 16px",
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: active ? "var(--accent)" : "var(--text-muted)",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    fontSize: "0.88rem",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    transition: "color 0.15s, border-color 0.15s",
    fontFamily: "inherit",
  });

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: "1.5px solid var(--border)",
          gap: 0,
        }}
      >
        <button style={tabStyle(tab === "stats")} onClick={() => setTab("stats")}>
          Stats
        </button>
        <button style={tabStyle(tab === "chart")} onClick={() => setTab("chart")}>
          Chart
        </button>
        <button style={tabStyle(tab === "daily")} onClick={() => setTab("daily")}>
          Daily
        </button>
      </div>

      {tab === "stats" && (
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <StatsCard title="Session" stats={sessionStats} />
          <StatsCard title="All-Time" stats={allTimeStats} />
        </div>
      )}

      {tab === "chart" && <StatsChart solves={allSolves} />}

      {tab === "daily" && <DailyStatsTab dailyStats={dailyStats} />}
    </div>
  );
};

export default Dashboard;
