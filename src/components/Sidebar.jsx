import React from "react";
import "./Sidebar.css";

const Sidebar = ({
  sessions,
  activeSessionId,
  setActiveSessionId,
  addSession,
  removeSession,
  solves,
  sidebarOpen,
}) => {
  // Calculate stats
  const times = solves.map((s) => s / 1000);
  const best = times.length ? Math.min(...times) : null;
  const mean = times.length
    ? times.reduce((a, b) => a + b, 0) / times.length
    : null;
  const solveCount = times.length;
  const lastSolve = solveCount ? times[solveCount - 1] : null;
  const ao5 =
    times.length >= 5 ? times.slice(-5).reduce((a, b) => a + b, 0) / 5 : null;
  const ao12 =
    times.length >= 12
      ? times.slice(-12).reduce((a, b) => a + b, 0) / 12
      : null;

  return (
    <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
      <div className="sidebar-header">
        <select
          value={activeSessionId}
          onChange={(e) => setActiveSessionId(e.target.value)}
          style={{
            fontWeight: "bold",
            fontSize: "1.1rem",
            borderRadius: 6,
            border: "1.5px solid #1a73e8",
            padding: "0.3rem 0.7rem",
            background: "#fff",
            color: "#1a73e8",
            marginRight: 8,
          }}
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.name}
            </option>
          ))}
        </select>
        <button
          className="icon-btn"
          onClick={addSession}
          title="Add Session"
          style={{ color: "#43a047", borderColor: "#43a047" }}
        >
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </button>
        <button
          className="close-btn"
          onClick={() => removeSession(activeSessionId)}
          title="Delete Session"
          disabled={sessions.length === 1}
          style={{
            color: "#e53935",
            borderColor: "#e53935",
            opacity: sessions.length === 1 ? 0.5 : 1,
          }}
        >
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </button>
      </div>
      <div className="session-stats">
        <div className="stats-row">
          <span>Current</span>
          <span>Best</span>
        </div>
        <div className="stats-row">
          <span>{lastSolve ? lastSolve.toFixed(2) + "s" : "-"}</span>
          <span>{best ? best.toFixed(2) + "s" : "-"}</span>
        </div>
        <div className="solve-info">
          <span>solve: {solveCount}</span>
          <br />
          <span>mean: {mean ? mean.toFixed(2) + "s" : "-"}</span>
        </div>
      </div>
      <div className="solve-links">
        <span className="solve-link">
          ao5: {ao5 ? ao5.toFixed(2) + "s" : "-"}
        </span>
        <span className="solve-link">
          ao12: {ao12 ? ao12.toFixed(2) + "s" : "-"}
        </span>
      </div>
      {/* --- Show all solves in sidebar only if there are solves --- */}
      {solves.length > 0 && (
        <div style={{ marginTop: "1.2rem" }}>
          <h4
            style={{
              margin: 0,
              color: "#1a73e8",
              fontWeight: 700,
              fontSize: "1.1rem",
            }}
          >
            All Solves
          </h4>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {[...solves]
              .reverse()
              .map((s, i) => (
                <li
                  key={solves.length - 1 - i}
                  style={{
                    fontSize: "1.05rem",
                    color: "#222",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      color: "#ff4081",
                      fontWeight: 700,
                      minWidth: 28,
                    }}
                  >
                    #{solves.length - i}
                  </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      color: "#1a73e8",
                      minWidth: 60,
                    }}
                  >
                    {(s / 1000).toFixed(2)}s
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
