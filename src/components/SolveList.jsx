// SolveList.jsx - Scrollable solve list with CS Timer-style interactions
import { useMemo, useState } from "react";
import { effectiveMillis, isValidSolve } from "../analytics";

const fmtTime = (solve) => {
  if (solve.penalty === "DNF") return "DNF";
  const millis = effectiveMillis(solve);
  const secs = millis / 1000;
  if (secs >= 60) {
    const mins = Math.floor(secs / 60);
    const remaining = (secs % 60).toFixed(2).padStart(5, "0");
    return `${mins}:${remaining}${solve.penalty === "+2" ? "+" : ""}`;
  }
  return secs.toFixed(2) + (solve.penalty === "+2" ? "+" : "");
};

const relativeTime = (id) => {
  if (!id || typeof id !== "number") return null;
  const diffSec = Math.floor((Date.now() - id) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
};

// Hover state lives here, per row, so hovering one row doesn't re-render the
// whole list — only the row whose hover state actually changed. The action
// buttons also show on keyboard focus, not just mouse hover, so they're
// reachable without a mouse.
const SolveRow = ({ solve, idx, isFocused, isPB, isFirst, updateSolve, deleteSolve }) => {
  const [hovered, setHovered] = useState(false);
  const isDNF = solve.penalty === "DNF";
  const isPlus2 = solve.penalty === "+2";
  const showActions = hovered || isFocused;

  return (
    <div
      role="listitem"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 12px",
        background: isFocused || hovered ? "var(--accent-bg)" : isPB ? "var(--pb-bg)" : "transparent",
        outline: isFocused ? "2px solid var(--accent)" : "none",
        borderBottom: "1px solid var(--border)",
        gap: 8,
        minHeight: 36,
        transition: "background 0.1s",
        animation: isFirst ? "solveRowIn 0.22s ease" : undefined,
      }}
    >
      {/* Index */}
      {isPB && (
        <span style={{ fontSize: "0.65rem", color: "var(--pb-fg)", fontWeight: 800, letterSpacing: "0.04em" }}>PB</span>
      )}
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

      {/* Relative time (when hovered) */}
      {hovered && relativeTime(solve.id) && (
        <span style={{ fontSize: "0.72rem", color: "var(--text-faint)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
          {relativeTime(solve.id)}
        </span>
      )}

      {/* Penalty badge (when actions aren't showing) */}
      {!showActions && isDNF && (
        <span
          style={{
            background: "var(--danger-bg)",
            color: "var(--danger)",
            fontSize: "0.72rem",
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: "var(--radius-sm)",
          }}
        >
          DNF
        </span>
      )}
      {!showActions && isPlus2 && (
        <span
          style={{
            background: "var(--warning-bg)",
            color: "var(--warning)",
            fontSize: "0.72rem",
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: "var(--radius-sm)",
          }}
        >
          +2
        </span>
      )}

      {/* Actions (hover or keyboard focus) */}
      {showActions && (
        <div style={{ display: "flex", gap: 4 }}>
          <button
            title="Toggle +2 penalty"
            aria-label="Toggle +2 penalty"
            onClick={() =>
              updateSolve(idx, {
                penalty: isPlus2 ? null : "+2",
              })
            }
            style={{
              padding: "4px 8px",
              fontSize: "0.75rem",
              background: isPlus2 ? "var(--warning)" : "var(--surface-alt)",
              color: isPlus2 ? "#fff" : "var(--text-muted)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            +2
          </button>
          <button
            title="Toggle DNF"
            aria-label="Toggle DNF"
            onClick={() =>
              updateSolve(idx, {
                penalty: isDNF ? null : "DNF",
              })
            }
            style={{
              padding: "4px 8px",
              fontSize: "0.75rem",
              background: isDNF ? "var(--danger)" : "var(--surface-alt)",
              color: isDNF ? "#fff" : "var(--text-muted)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            DNF
          </button>
          <button
            title="Delete solve"
            aria-label="Delete solve"
            onClick={() => deleteSolve && deleteSolve(idx)}
            style={{
              padding: "4px 8px",
              fontSize: "0.75rem",
              background: "var(--surface-alt)",
              color: "var(--danger)",
              border: "none",
              borderRadius: "var(--radius-sm)",
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
};

const SolveList = ({ solves, updateSolve, deleteSolve }) => {
  const [focusedId, setFocusedId] = useState(null);

  const bestMillis = useMemo(() => {
    if (!solves) return null;
    return solves
      .filter(isValidSolve)
      .reduce((best, s) => {
        const t = effectiveMillis(s);
        return best === null ? t : Math.min(best, t);
      }, null);
  }, [solves]);

  const reversed = useMemo(
    () => (solves ? [...solves].map((s, origIdx) => ({ ...s, origIdx })).reverse() : []),
    [solves]
  );

  // Track the focused row by solve id rather than position, so a delete
  // (from the keyboard, the hover buttons, or the undo button) can't leave
  // focus pointing at a stale index or silently disappear.
  const focusedIdx = useMemo(
    () => reversed.findIndex((s) => s.id === focusedId),
    [reversed, focusedId]
  );

  if (!solves || solves.length === 0) {
    return (
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
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

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
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
          padding: "12px 16px",
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--text-faint)", fontWeight: 500, fontSize: "0.82rem" }}>
            {solves.length} total
          </span>
          {solves.length > 0 && deleteSolve && (
            <button
              title="Undo last solve"
              onClick={() => deleteSolve(solves.length - 1)}
              style={{
                background: "none", border: "1px solid var(--border)", borderRadius: 5,
                padding: "2px 7px", fontSize: "0.75rem", cursor: "pointer",
                color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3,
              }}
            >
              ↩ Undo
            </button>
          )}
        </div>
      </div>

      {/* Solve rows */}
      <div
        role="list"
        aria-label="Solve history"
        style={{ overflowY: "auto", flex: 1 }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = Math.min(focusedIdx + 1, reversed.length - 1);
            setFocusedId(reversed[next]?.id ?? null);
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            const prev = focusedIdx === -1 ? reversed.length - 1 : Math.max(focusedIdx - 1, 0);
            setFocusedId(reversed[prev]?.id ?? null);
          }
          if ((e.key === "Delete" || e.key === "Backspace") && focusedIdx !== -1) {
            e.preventDefault();
            const neighborId = reversed[focusedIdx + 1]?.id ?? reversed[focusedIdx - 1]?.id ?? null;
            deleteSolve?.(reversed[focusedIdx].origIdx);
            setFocusedId(neighborId);
          }
        }}
        onBlur={() => setFocusedId(null)}
      >
        {reversed.map((solve, revIdx) => {
          const isPB = solve.penalty !== "DNF" && bestMillis !== null && effectiveMillis(solve) === bestMillis;

          return (
            <SolveRow
              key={solve.id || revIdx}
              solve={solve}
              idx={solve.origIdx}
              isFocused={focusedId === solve.id}
              isPB={isPB}
              isFirst={revIdx === 0}
              updateSolve={updateSolve}
              deleteSolve={deleteSolve}
            />
          );
        })}
      </div>
    </div>
  );
};

export default SolveList;
