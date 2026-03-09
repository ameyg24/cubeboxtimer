// SolveList.jsx - Scrollable solve list with CS Timer-style interactions
import { useState } from "react";

const fmtTime = (solve) => {
  if (solve.penalty === "DNF") return "DNF";
  const millis = solve.millis + (solve.penalty === "+2" ? 2000 : 0);
  const secs = millis / 1000;
  if (secs >= 60) {
    const mins = Math.floor(secs / 60);
    const remaining = (secs % 60).toFixed(2).padStart(5, "0");
    return `${mins}:${remaining}${solve.penalty === "+2" ? "+" : ""}`;
  }
  return secs.toFixed(2) + (solve.penalty === "+2" ? "+" : "");
};

const SolveList = ({ solves, updateSolve, deleteSolve }) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  if (!solves || solves.length === 0) {
    return (
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "2rem",
          color: "var(--text-faint)",
          textAlign: "center",
          fontSize: "0.88rem",
        }}
      >
        No solves yet
      </div>
    );
  }

  // Show most recent first
  const reversed = [...solves].map((s, origIdx) => ({ ...s, origIdx })).reverse();

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        maxHeight: 520,
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.7rem 1rem",
          borderBottom: "1px solid var(--border)",
          fontWeight: 700,
          fontSize: "0.88rem",
          color: "var(--text)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--surface-alt)",
        }}
      >
        <span>Solves</span>
        <span style={{ color: "var(--text-faint)", fontWeight: 500, fontSize: "0.82rem" }}>
          {solves.length} total
        </span>
      </div>

      {/* Solve rows */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {reversed.map((solve, revIdx) => {
          const idx = solve.origIdx;
          const isHovered = hoveredIdx === revIdx;
          const isDNF = solve.penalty === "DNF";
          const isPlus2 = solve.penalty === "+2";

          return (
            <div
              key={solve.id || revIdx}
              onMouseEnter={() => setHoveredIdx(revIdx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 10px",
                background: isHovered ? "var(--accent-bg)" : "transparent",
                borderBottom: "1px solid var(--border)",
                gap: 6,
                minHeight: 36,
                transition: "background 0.1s",
              }}
            >
              {/* Index */}
              <span
                style={{
                  color: "var(--text-faint)",
                  minWidth: 28,
                  fontSize: "0.78rem",
                  fontWeight: 500,
                  fontFamily: "monospace",
                  userSelect: "none",
                }}
              >
                {idx + 1}
              </span>

              {/* Time */}
              <span
                style={{
                  flex: 1,
                  fontWeight: 700,
                  fontSize: "0.92rem",
                  color: isDNF ? "var(--danger)" : isPlus2 ? "var(--warning)" : "var(--text)",
                  fontFamily: "monospace",
                }}
              >
                {fmtTime(solve)}
              </span>

              {/* Penalty badge (when not hovered) */}
              {!isHovered && isDNF && (
                <span
                  style={{
                    background: "#ffeaea",
                    color: "#c62828",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 4,
                  }}
                >
                  DNF
                </span>
              )}
              {!isHovered && isPlus2 && (
                <span
                  style={{
                    background: "#fff3e0",
                    color: "#e65100",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 4,
                  }}
                >
                  +2
                </span>
              )}

              {/* Hover actions */}
              {isHovered && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    title="Toggle +2 penalty"
                    onClick={() =>
                      updateSolve(idx, {
                        penalty: isPlus2 ? null : "+2",
                      })
                    }
                    style={{
                      padding: "2px 7px",
                      fontSize: "0.75rem",
                      background: isPlus2 ? "#e65100" : "#f0f0f0",
                      color: isPlus2 ? "#fff" : "#555",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    +2
                  </button>
                  <button
                    title="Toggle DNF"
                    onClick={() =>
                      updateSolve(idx, {
                        penalty: isDNF ? null : "DNF",
                      })
                    }
                    style={{
                      padding: "2px 7px",
                      fontSize: "0.75rem",
                      background: isDNF ? "#c62828" : "#f0f0f0",
                      color: isDNF ? "#fff" : "#555",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    DNF
                  </button>
                  <button
                    title="Delete solve"
                    onClick={() => deleteSolve && deleteSolve(idx)}
                    style={{
                      padding: "2px 7px",
                      fontSize: "0.75rem",
                      background: "#f0f0f0",
                      color: "#c62828",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SolveList;
