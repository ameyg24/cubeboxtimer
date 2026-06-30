import "./Sidebar.css";
import {
  ao5 as ao5Of,
  ao12 as ao12Of,
  ao50 as ao50Of,
  ao100 as ao100Of,
  best as bestOf,
  effectiveMillis,
  isValidSolve,
  mean as meanOf,
} from "../analytics";

// Map an AverageResult to this sidebar's display value:
// ok -> seconds, dnf -> "DNF", insufficient -> null.
const toDisplay = (r) =>
  r.status === "ok" ? r.valueMs / 1000 : r.status === "dnf" ? "DNF" : null;

const Sidebar = ({ sessions, activeSessionId, setActiveSessionId, addSession, removeSession, solves, sidebarOpen }) => {
  const allSolves = solves.filter(
    (s) => s && (typeof s.millis === "number" || s.penalty === "DNF")
  );
  const validSolves = allSolves.filter(isValidSolve);
  const lastValid = validSolves.length ? validSolves[validSolves.length - 1] : null;
  const lastSolve = lastValid ? effectiveMillis(lastValid) / 1000 : null;

  const best = toDisplay(bestOf(solves));
  const mean = toDisplay(meanOf(solves));
  const ao5 = toDisplay(ao5Of(solves));
  const ao12 = toDisplay(ao12Of(solves));
  const ao50 = toDisplay(ao50Of(solves));
  const ao100 = toDisplay(ao100Of(solves));
  const fmt = (v) => (v === "DNF" ? "DNF" : v ? v.toFixed(2) + "s" : "-");

  return (
    <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
      <div className="sidebar-header">
        <select
          className="ctrl"
          value={activeSessionId}
          onChange={(e) => setActiveSessionId(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button className="icon-btn" onClick={addSession} title="New session">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="1" x2="6" y2="11" /><line x1="1" y1="6" x2="11" y2="6" />
          </svg>
        </button>
        <button
          className="close-btn"
          onClick={() => removeSession(activeSessionId)}
          disabled={sessions.length === 1}
          style={{ opacity: sessions.length === 1 ? 0.4 : 1 }}
          title="Delete session"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
          </svg>
        </button>
      </div>

      <div className="session-stats">
        <div className="stats-row"><span>Last</span><span>{fmt(lastSolve)}</span></div>
        <div className="stats-row"><span>Best</span><span>{fmt(best)}</span></div>
        <div className="stats-row"><span>Mean</span><span>{fmt(mean)}</span></div>
        <div className="stats-row"><span>ao5</span><span style={{ color: "var(--accent)" }}>{fmt(ao5)}</span></div>
        <div className="stats-row"><span>ao12</span><span style={{ color: "var(--accent)" }}>{fmt(ao12)}</span></div>
        <div className="stats-row"><span>ao50</span><span style={{ color: "var(--accent)" }}>{fmt(ao50)}</span></div>
        <div className="stats-row"><span>ao100</span><span style={{ color: "var(--accent)" }}>{fmt(ao100)}</span></div>
        <div className="stats-row"><span>Solves</span><span>{allSolves.length}</span></div>
      </div>

      {allSolves.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Recent
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflowY: "auto" }}>
            {[...allSolves].reverse().slice(0, 30).map((s, i) => {
              const origIdx = allSolves.length - 1 - i;
              const isDNF = s.penalty === "DNF";
              const t = isDNF ? null : (s.millis + (s.penalty === "+2" ? 2000 : 0)) / 1000;
              return (
                <div key={origIdx} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "2px 0" }}>
                  <span style={{ color: "var(--text-faint)" }}>#{origIdx + 1}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 600, color: isDNF ? "var(--danger)" : s.penalty === "+2" ? "var(--warning)" : "var(--text)" }}>
                    {isDNF ? "DNF" : t.toFixed(2) + (s.penalty === "+2" ? "+" : "")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
