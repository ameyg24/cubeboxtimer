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
  // Valid solves for stats (exclude DNF)
  const validSolves = solves.filter(
    (s) => typeof s.millis === "number" && !isNaN(s.millis) && s.penalty !== "DNF"
  );
  // All solves for display (include DNF)
  const allSolves = solves.filter(
    (s) => s && (typeof s.millis === "number" || s.penalty === "DNF")
  );
  const times = validSolves.map((s) => s.millis / 1000);
  const best = times.length ? Math.min(...times) : null;
  const mean = times.length
    ? times.reduce((a, b) => a + b, 0) / times.length
    : null;
  const solveCount = times.length;
  const lastSolve = solveCount ? times[solveCount - 1] : null;

  // WCA-compliant ao5 calculation
  const calculateAverage = (solves, count) => {
    if (allSolves.length < count) return null;
    
    const lastSolves = allSolves.slice(-count);
    const dnfCount = lastSolves.filter(s => s.penalty === "DNF").length;
    
    // If 2 or more DNFs, the average is DNF
    if (dnfCount >= 2) return "DNF";
    
    // Get times (including +2 penalties) for non-DNF solves
    const solveTimes = lastSolves
      .filter(s => s.penalty !== "DNF")
      .map(s => s.millis + (s.penalty === "+2" ? 2000 : 0));
    
    if (solveTimes.length < count - 1) return "DNF";
    
    // Remove best and worst, then average the middle times
    solveTimes.sort((a, b) => a - b);
    const middleTimes = solveTimes.slice(1, -1);
    const avgMillis = middleTimes.reduce((a, b) => a + b, 0) / middleTimes.length;
    
    return avgMillis / 1000; // Convert to seconds
  };

  const ao5 = calculateAverage(allSolves, 5);
  const ao12 = calculateAverage(allSolves, 12);

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
          <span>solve: {allSolves.length}</span>
          <br />
          <span>mean: {mean ? mean.toFixed(2) + "s" : "-"}</span>
        </div>
      </div>
      <div className="solve-links">
        <span className="solve-link">
          ao5: {ao5 === "DNF" ? "DNF" : ao5 ? ao5.toFixed(2) + "s" : "-"}
        </span>
        <span className="solve-link">
          ao12: {ao12 === "DNF" ? "DNF" : ao12 ? ao12.toFixed(2) + "s" : "-"}
        </span>
      </div>
      {/* --- Show all solves in sidebar only if there are solves --- */}
      {allSolves.length > 0 && (
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
            {[...allSolves]
              .reverse()
              .map((s, i) => (
                <li
                  key={allSolves.length - 1 - i}
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
                    #{allSolves.length - i}
                  </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      color: s.penalty === "DNF" ? "#e53935" : "#1a73e8",
                      minWidth: 60,
                      fontWeight: s.penalty === "DNF" ? 700 : 400,
                    }}
                  >
                    {s.penalty === "DNF" 
                      ? "DNF" 
                      : s.millis 
                        ? (s.millis / 1000).toFixed(2) + "s" + (s.penalty === "+2" ? " (+2)" : "")
                        : "-"
                    }
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
