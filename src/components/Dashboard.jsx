// Dashboard.jsx - session performance overview built on the analytics engine.
import { useState, useMemo } from "react";
import StatsChart from "./StatsChart";
import { computeSessionStats, effectiveMillis, isValidSolve } from "../analytics";

// ok -> seconds, dnf -> "DNF", insufficient -> null.
const toDisplay = (r) =>
  r.status === "ok" ? r.valueMs / 1000 : r.status === "dnf" ? "DNF" : null;

// Pull just the values the dashboard shows out of the shared analytics engine.
function computeStats(solvesRaw) {
  const st = computeSessionStats(solvesRaw);
  return {
    best: toDisplay(st.best),
    mean: toDisplay(st.mean),
    ao5: toDisplay(st.ao5),
    ao12: toDisplay(st.ao12),
    ao100: toDisplay(st.ao100),
    bestAo5: toDisplay(st.bestAo5),
    bestAo12: toDisplay(st.bestAo12),
    stddev: st.stddevMs === null ? null : st.stddevMs / 1000,
    count: st.count,
    dnfCount: st.dnfCount,
    plus2Count: st.plus2Count,
  };
}

function computeDailyStats(solvesRaw) {
  const days = {};
  solvesRaw.forEach((s) => {
    const ts = typeof s.id === "number" ? s.id : s.localCreatedAt || Date.now();
    const date = new Date(ts);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (!days[dayKey]) days[dayKey] = [];
    days[dayKey].push(s);
  });

  return Object.entries(days)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, solves]) => {
      const st = computeSessionStats(solves);
      const [year, month, dayNum] = day.split("-");
      const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
      const label = dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return {
        day,
        label,
        count: solves.length,
        best: toDisplay(st.best),
        mean: toDisplay(st.mean),
        ao5: toDisplay(st.ao5),
        dnfCount: st.dnfCount,
      };
    });
}

const fmt = (v) => {
  if (v === "DNF") return "DNF";
  if (v === null || v === undefined) return "-";
  return v.toFixed(2) + "s";
};

const StatTile = ({ label, value }) => (
  <div className="stat-tile">
    <span className="stat-tile-label">{label}</span>
    <span className="stat-tile-value">{value}</span>
  </div>
);

const StatStrip = ({ stats }) => (
  <div className="stat-strip">
    <StatTile label="Best" value={fmt(stats.best)} />
    <StatTile label="Mean" value={fmt(stats.mean)} />
    <StatTile label="ao5" value={fmt(stats.ao5)} />
    <StatTile label="ao12" value={fmt(stats.ao12)} />
    <StatTile label="Solves" value={stats.count} />
  </div>
);

const SummaryRow = ({ label, value, tone }) => (
  <div className="summary-row">
    <span>{label}</span>
    <span className={tone ? `val val-${tone}` : "val"}>{value}</span>
  </div>
);

const Overview = ({ session, all, eventSolves }) => {
  const [copied, setCopied] = useState(false);

  const exportCsv = () => {
    const header = "solve,time_s,penalty\n";
    const rows = eventSolves
      .map((s, i) => {
        const t = s.penalty === "DNF" ? "DNF" : (effectiveMillis(s) / 1000).toFixed(3);
        return `${i + 1},${t},${s.penalty || ""}`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "session_solves.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyResults = () => {
    const lines = eventSolves.map((s, i) => {
      const t = s.penalty === "DNF" ? "DNF" : (effectiveMillis(s) / 1000).toFixed(2);
      return `${i + 1}. ${t}${s.penalty === "+2" ? "+" : ""}`;
    });
    const { mean, ao5, ao12, best } = session;
    lines.push("", `mean: ${fmt(mean)}  ao5: ${fmt(ao5)}  ao12: ${fmt(ao12)}  best: ${fmt(best)}`);
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div className="summary-grid">
        <div className="summary-card">
          <div className="summary-title">This session</div>
          <SummaryRow label="Consistency (σ)" value={fmt(session.stddev)} />
          <SummaryRow label="Best ao5" value={fmt(session.bestAo5)} />
          <SummaryRow label="Best ao12" value={fmt(session.bestAo12)} />
          <SummaryRow label="DNF" value={session.dnfCount} tone={session.dnfCount > 0 ? "danger" : null} />
          <SummaryRow label="+2" value={session.plus2Count} tone={session.plus2Count > 0 ? "warning" : null} />
        </div>
        <div className="summary-card">
          <div className="summary-title">All-time</div>
          <SummaryRow label="Best" value={fmt(all.best)} />
          <SummaryRow label="Mean" value={fmt(all.mean)} />
          <SummaryRow label="ao12" value={fmt(all.ao12)} />
          <SummaryRow label="ao100" value={fmt(all.ao100)} />
          <SummaryRow label="Solves" value={all.count} />
        </div>
      </div>
      <div className="dash-actions">
        <button className="dash-btn" onClick={exportCsv}>Export CSV</button>
        <button className="dash-btn" onClick={copyResults} aria-live="polite" style={copied ? { color: "var(--success)" } : undefined}>
          {copied ? "Copied" : "Copy results"}
        </button>
      </div>
    </div>
  );
};

const Distribution = ({ solves }) => {
  const validTimes = solves
    .filter(isValidSolve)
    .map((s) => effectiveMillis(s) / 1000);

  if (validTimes.length === 0) {
    return (
      <div className="section-card" style={{ color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" }}>
        No valid solve times to chart yet.
      </div>
    );
  }

  const min = Math.floor(Math.min(...validTimes) * 2) / 2;
  const max = Math.ceil(Math.max(...validTimes) * 2) / 2;
  const bucketSize = Math.max(0.5, Math.ceil((max - min) / 12 * 2) / 2);
  const buckets = [];
  for (let lo = min; lo < max + bucketSize; lo = Math.round((lo + bucketSize) * 100) / 100) {
    const hi = Math.round((lo + bucketSize) * 100) / 100;
    const count = validTimes.filter((t) => t >= lo && t < hi).length;
    buckets.push({ lo, hi, count });
  }
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="section-card">
      <div className="section-title">Distribution · {validTimes.length} solves</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {buckets.filter((b) => b.count > 0).map((b) => (
          <div key={b.lo} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ minWidth: 74, fontSize: "0.78rem", fontFamily: "monospace", color: "var(--text-muted)", textAlign: "right" }}>
              {b.lo.toFixed(1)}–{b.hi.toFixed(1)}s
            </span>
            <div style={{ flex: 1, background: "var(--surface-alt)", borderRadius: 4, height: 16, overflow: "hidden" }}>
              <div style={{ width: `${(b.count / maxCount) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 4, transition: "width 0.3s ease" }} />
            </div>
            <span style={{ minWidth: 22, fontSize: "0.78rem", fontFamily: "monospace", color: "var(--text-faint)" }}>{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Daily = ({ dailyStats }) => {
  if (dailyStats.length === 0) {
    return (
      <div className="section-card" style={{ color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" }}>
        No daily activity yet.
      </div>
    );
  }

  const th = {
    padding: "8px 12px",
    textAlign: "right",
    fontSize: "var(--fs-xs)",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  };
  const td = { padding: "9px 12px", fontSize: "0.9rem", fontFamily: "monospace", textAlign: "right" };

  return (
    <div className="section-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ ...th, textAlign: "left" }}>Date</th>
              <th style={th}>Solves</th>
              <th style={th}>Best</th>
              <th style={th}>Mean</th>
              <th style={th}>ao5</th>
              <th style={th}>DNF</th>
            </tr>
          </thead>
          <tbody>
            {dailyStats.map((day) => (
              <tr key={day.day} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 600, color: "var(--text)" }}>{day.label}</td>
                <td style={{ ...td, color: "var(--text-muted)" }}>{day.count}</td>
                <td style={{ ...td, color: "var(--text)", fontWeight: 600 }}>{fmt(day.best)}</td>
                <td style={{ ...td, color: "var(--text-muted)" }}>{fmt(day.mean)}</td>
                <td style={{ ...td, color: "var(--text-muted)" }}>{fmt(day.ao5)}</td>
                <td style={{ ...td, color: day.dnfCount > 0 ? "var(--danger)" : "var(--text-faint)" }}>
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

const TABS = ["Overview", "Trend", "Distribution", "Daily"];

const Dashboard = ({ eventSolves, allSolves }) => {
  const [tab, setTab] = useState("Overview");

  const sessionStats = useMemo(() => computeStats(eventSolves), [eventSolves]);
  const allTimeStats = useMemo(() => computeStats(allSolves), [allSolves]);
  const dailyStats = useMemo(() => computeDailyStats(allSolves), [allSolves]);

  return (
    <div className="dashboard">
      <StatStrip stats={sessionStats} />

      <div className="dash-tabs" role="tablist" aria-label="Statistics view">
        {TABS.map((t) => (
          <button
            key={t}
            id={`dash-tab-${t}`}
            role="tab"
            aria-selected={tab === t}
            aria-controls={`dash-panel-${t}`}
            className={`dash-tab${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`dash-panel-${tab}`} aria-labelledby={`dash-tab-${tab}`}>
        {tab === "Overview" && (
          <Overview session={sessionStats} all={allTimeStats} eventSolves={eventSolves} />
        )}
        {tab === "Trend" && (
          <div className="section-card">
            <div className="section-title">Trend</div>
            <StatsChart solves={allSolves} />
          </div>
        )}
        {tab === "Distribution" && <Distribution solves={allSolves} />}
        {tab === "Daily" && <Daily dailyStats={dailyStats} />}
      </div>
    </div>
  );
};

export default Dashboard;
