import "./Sidebar.css";

const Sidebar = ({ sessions, activeSessionId, setActiveSessionId, addSession, removeSession, solves, sidebarOpen }) => {
  const validSolves = solves.filter(
    (s) => typeof s.millis === "number" && !isNaN(s.millis) && s.penalty !== "DNF"
  );
  const allSolves = solves.filter(
    (s) => s && (typeof s.millis === "number" || s.penalty === "DNF")
  );
  const times = validSolves.map((s) => s.millis / 1000);
  const best = times.length ? Math.min(...times) : null;
  const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const lastSolve = times.length ? times[times.length - 1] : null;

  const calcAo = (count) => {
    if (allSolves.length < count) return null;
    const slice = allSolves.slice(-count);
    const dnfs = slice.filter((s) => s.penalty === "DNF").length;
    if (dnfs >= 2) return "DNF";
    const ts = slice.filter((s) => s.penalty !== "DNF").map((s) => s.millis + (s.penalty === "+2" ? 2000 : 0));
    if (ts.length < count - 1) return "DNF";
    ts.sort((a, b) => a - b);
    const mid = ts.slice(1, -1);
    return mid.reduce((a, b) => a + b, 0) / mid.length / 1000;
  };

  const ao5 = calcAo(5);
  const ao12 = calcAo(12);
  const ao50 = calcAo(50);
  const ao100 = calcAo(100);
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
