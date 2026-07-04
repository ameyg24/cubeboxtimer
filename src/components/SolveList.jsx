// SolveList.jsx - Scrollable solve list with CS Timer-style interactions
import { useId, useMemo, useState } from "react";
import { effectiveMillis, isValidSolve } from "../analytics";
import { CUBE_DIMENSIONS, createSolveId } from "../hooks/useSolveSessions.js";
import CsTimerImportModal from "./CsTimerImport.jsx";
import { Modal } from "./Modal.jsx";

const MAX_REASONABLE_SECONDS = 3600;

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

      {/* Always-visible delete, not just on hover/focus - the full actions
          bar below covers +2/DNF/delete together once revealed, but touch
          devices have no hover state at all, so without this a delete
          control would be effectively unreachable without a keyboard. This
          intentionally uses a different accessible name ("Delete solve N")
          than the hover-revealed one ("Delete solve") so both can coexist
          without ambiguity for assistive tech. */}
      {!showActions && (
        <button
          title="Delete solve"
          aria-label={`Delete solve ${idx + 1}`}
          onClick={() => deleteSolve && deleteSolve(idx)}
          style={{
            padding: "2px 6px",
            fontSize: "0.78rem",
            background: "transparent",
            color: "var(--text-faint)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          ×
        </button>
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

// Requires a time unless the penalty is DNF (a DNF has no meaningful time to
// validate), a valid date, and a realistic positive time - same
// "no impossible values" bar as the competition-result form.
function validateAddSolveForm(form) {
  const errors = {};
  if (!form.date) {
    errors.date = "Date is required.";
  } else if (Number.isNaN(Date.parse(form.date))) {
    errors.date = "Enter a valid date.";
  }
  if (form.penalty !== "DNF") {
    const t = parseFloat(form.timeSeconds);
    if (form.timeSeconds.trim() === "" || Number.isNaN(t)) {
      errors.timeSeconds = "Time is required.";
    } else if (t <= 0 || t > MAX_REASONABLE_SECONDS) {
      errors.timeSeconds = "Enter a realistic time, in seconds.";
    }
  }
  return errors;
}

// Backfills a past solve - e.g. practice that happened before this session
// existed, or before the user started using CubeBox at all, needed to give
// the competition prediction model something to compare an imported WCA
// result against. Goes through the exact same addSolve the live timer
// uses (src/hooks/useSolveSessions.js), just with an explicit event and a
// user-chosen date instead of "now" - never a second storage path.
function AddSolveModal({ titleId, defaultEvent, onClose, onSubmit }) {
  const [form, setForm] = useState({ timeSeconds: "", date: "", event: defaultEvent, penalty: "none" });
  const [errors, setErrors] = useState({});
  const eventId = useId();
  const dateId = useId();
  const penaltyId = useId();
  const timeId = useId();
  const dateErrId = useId();
  const timeErrId = useId();

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextErrors = validateAddSolveForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    // DNF's millis is unused (matches how the live timer records a DNF:
    // App.jsx's handleSolveComplete always writes millis: 0 for one), and
    // +2's raw time is stored as-is - the 2000ms penalty is applied at read
    // time by effectiveMillis(), never added in here.
    const millis = form.penalty === "DNF" ? 0 : Math.round(parseFloat(form.timeSeconds) * 1000);
    onSubmit(
      {
        id: createSolveId(),
        millis,
        penalty: form.penalty === "none" ? null : form.penalty,
        reviewed: true,
        cubeDimension: form.event,
        localCreatedAt: new Date(form.date).getTime(),
      },
      form.event
    );
  };

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <h2 id={titleId} style={{ color: "var(--text)", marginBottom: 16, fontSize: "1.1rem", textAlign: "left" }}>
        Add Past Solve
      </h2>
      <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
        <div className="form-field">
          <label className="form-label" htmlFor={eventId}>Event</label>
          <select id={eventId} className="ctrl" value={form.event} onChange={(e) => updateField("event", e.target.value)}>
            {CUBE_DIMENSIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor={dateId}>Date</label>
          <input
            id={dateId}
            className="ctrl"
            type="date"
            value={form.date}
            onChange={(e) => updateField("date", e.target.value)}
            aria-invalid={Boolean(errors.date)}
            aria-describedby={errors.date ? dateErrId : undefined}
          />
          {errors.date && <span className="form-error" id={dateErrId} role="alert">{errors.date}</span>}
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor={penaltyId}>Penalty</label>
          <select
            id={penaltyId}
            className="ctrl"
            value={form.penalty}
            onChange={(e) => updateField("penalty", e.target.value)}
          >
            <option value="none">None</option>
            <option value="+2">+2</option>
            <option value="DNF">DNF</option>
          </select>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor={timeId}>
            Time (seconds){form.penalty === "DNF" ? " — not needed for a DNF" : ""}
          </label>
          <input
            id={timeId}
            className="ctrl"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={form.timeSeconds}
            onChange={(e) => updateField("timeSeconds", e.target.value)}
            disabled={form.penalty === "DNF"}
            aria-invalid={Boolean(errors.timeSeconds)}
            aria-describedby={errors.timeSeconds ? timeErrId : undefined}
          />
          {errors.timeSeconds && <span className="form-error" id={timeErrId} role="alert">{errors.timeSeconds}</span>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="dash-btn" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="dash-btn"
            style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}
          >
            Add
          </button>
        </div>
      </form>
    </Modal>
  );
}

const SolveList = ({ solves, updateSolve, deleteSolve, addSolve, cubeDimension, sessions }) => {
  const [focusedId, setFocusedId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCsTimerImport, setShowCsTimerImport] = useState(false);
  const addModalTitleId = useId();
  const csTimerModalTitleId = useId();

  const handleAddSolve = (solveObj, dimension) => {
    addSolve?.(solveObj, dimension);
    setShowAddModal(false);
  };

  // csTimer import needs existing solves for whatever event the user picks
  // in that modal, which may not be the currently active cubeDimension -
  // duplicate detection has to check the right event's history, not just
  // the one showing on screen right now. Derived from `sessions` (every
  // session's solves for every event) the same way useSolveSessions.js's
  // own allSolves is, just parameterized by an arbitrary dimension instead
  // of a fixed one.
  const getExistingSolvesForDimension = (dimension) =>
    (sessions || []).flatMap((s) => (Array.isArray(s.solves?.[dimension]) ? s.solves[dimension] : []));

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
      <>
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
          <div>No solves yet</div>
          {addSolve && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button className="dash-btn" onClick={() => setShowAddModal(true)}>
                + Add past solve
              </button>
              <button className="dash-btn" onClick={() => setShowCsTimerImport(true)}>
                Import csTimer solves
              </button>
            </div>
          )}
        </div>
        {showAddModal && (
          <AddSolveModal
            titleId={addModalTitleId}
            defaultEvent={CUBE_DIMENSIONS.includes(cubeDimension) ? cubeDimension : CUBE_DIMENSIONS[0]}
            onClose={() => setShowAddModal(false)}
            onSubmit={handleAddSolve}
          />
        )}
        {showCsTimerImport && (
          <CsTimerImportModal
            titleId={csTimerModalTitleId}
            defaultDimension={cubeDimension}
            getExistingSolvesForDimension={getExistingSolvesForDimension}
            addSolve={addSolve}
            onClose={() => setShowCsTimerImport(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
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
          {addSolve && (
            <button
              title="Add a past solve"
              onClick={() => setShowAddModal(true)}
              style={{
                background: "none", border: "1px solid var(--border)", borderRadius: 5,
                padding: "2px 7px", fontSize: "0.75rem", cursor: "pointer",
                color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3,
              }}
            >
              + Add past solve
            </button>
          )}
          {addSolve && (
            <button
              title="Import solves exported from csTimer"
              onClick={() => setShowCsTimerImport(true)}
              style={{
                background: "none", border: "1px solid var(--border)", borderRadius: 5,
                padding: "2px 7px", fontSize: "0.75rem", cursor: "pointer",
                color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3,
              }}
            >
              Import csTimer
            </button>
          )}
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
    {showAddModal && (
      <AddSolveModal
        titleId={addModalTitleId}
        defaultEvent={CUBE_DIMENSIONS.includes(cubeDimension) ? cubeDimension : CUBE_DIMENSIONS[0]}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddSolve}
      />
    )}
    {showCsTimerImport && (
      <CsTimerImportModal
        titleId={csTimerModalTitleId}
        defaultDimension={cubeDimension}
        getExistingSolvesForDimension={getExistingSolvesForDimension}
        addSolve={addSolve}
        onClose={() => setShowCsTimerImport(false)}
      />
    )}
    </>
  );
};

export default SolveList;
