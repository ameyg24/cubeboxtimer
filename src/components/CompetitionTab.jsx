// CompetitionTab.jsx - Competition Performance Prediction, the Dashboard's
// "Competition" tab. All numbers shown here come straight out of
// predictCompetitionResult (src/analytics/competitionPrediction.ts); this
// file only formats and lays them out. CRUD for CompetitionResult goes
// through useCompetitionResults (src/hooks), passed down as props exactly
// like SolveList receives addSolve/updateSolve/deleteSolve from App.jsx.
import { useId, useMemo, useState } from "react";
import { checkForDuplicateOrConflict, explainPrediction, predictCompetitionResult, runBacktest } from "../analytics";
import { CUBE_DIMENSIONS } from "../hooks/useSolveSessions.js";
import { Modal } from "./Modal.jsx";
import PredictionQuality from "./PredictionQuality.jsx";
import { PredictionBreakdown, PredictionFactors } from "./PredictionExplanation.jsx";
import WcaImport from "./WcaImport.jsx";
import { logger } from "../logger.js";

const CONFIDENCE_LABELS = { insufficient: "Insufficient", low: "Low", medium: "Medium", high: "High" };
const MAX_REASONABLE_SECONDS = 3600;

const EMPTY_STYLE = { color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" };
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

const fmtSeconds = (ms) => (ms / 1000).toFixed(2);
const fmtSignedPct = (fraction) => `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)}%`;
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";

// Decides what the Prediction card (and the Why? section, which explains the
// same number) should show instead of a number - never invents a prediction
// the underlying data doesn't support.
function predictionEmptyMessage(competitionCount, prediction) {
  if (competitionCount === 0) return "No competition history yet.";
  if (competitionCount === 1) return "More competition history is needed before a reliable prediction can be made.";
  if (prediction.confidenceLevel === "insufficient" || prediction.predictedAverageMs === null) {
    return "Not enough matching practice data yet to make a reliable prediction.";
  }
  return null;
}

// Runs the pure backtest and logs around it (start, finish, evaluation
// count, duration) — analytics/backtesting.ts itself stays framework- and
// logger-free, matching every other module in src/analytics. Computed once
// here so PredictionQuality and PredictionBreakdown/Factors share the same
// result instead of each re-running the backtest independently.
function computeBacktest(practiceSolves, competitionsForEvent, event) {
  const startedAt = performance.now();
  logger.debug("Backtest started.", { event, competitionCount: competitionsForEvent.length });
  const result = runBacktest(practiceSolves, competitionsForEvent, event);
  logger.info("Backtest finished.", {
    event,
    evaluatedCount: result.summary.evaluatedCount,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return result;
}

function PredictionCard({ prediction, emptyMessage }) {
  if (emptyMessage) {
    return (
      <div className="section-card" style={EMPTY_STYLE}>
        {emptyMessage}
      </div>
    );
  }

  const [lo, hi] = prediction.confidenceRangeMs;
  const marginMs = (hi - lo) / 2;

  return (
    <div className="section-card prediction-card">
      <div className="section-title">Predicted Competition Average</div>
      <div>
        <span className="prediction-value">{fmtSeconds(prediction.predictedAverageMs)}</span>
        <span className="prediction-margin">±{fmtSeconds(marginMs)}</span>
      </div>
      <div className="prediction-confidence">
        <span>Confidence:</span>
        <span className={`confidence-badge confidence-badge-${prediction.confidenceLevel}`}>
          {CONFIDENCE_LABELS[prediction.confidenceLevel]}
        </span>
      </div>
      <div className="prediction-basis">
        Based on your last {prediction.competitionsUsed} competition{prediction.competitionsUsed === 1 ? "" : "s"}.
      </div>
    </div>
  );
}

function WhySection({ prediction, show }) {
  if (!show) return null;

  const direction = prediction.adjustmentFactorPct >= 0 ? "slower" : "faster";
  const pctAbs = Math.abs(prediction.adjustmentFactorPct * 100).toFixed(1);

  return (
    <div className="section-card">
      <div className="section-title">Why?</div>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text)", fontSize: "0.92rem", lineHeight: 1.5 }}>
        Your competition averages have historically been {pctAbs}% {direction} than your practice averages.
      </p>
      <div className="summary-row">
        <span>Recent practice average</span>
        <span className="val">{fmtSeconds(prediction.practiceAverageMs)}</span>
      </div>
      <div className="summary-row">
        <span>Predicted competition average</span>
        <span className="val">{fmtSeconds(prediction.predictedAverageMs)}</span>
      </div>
      <div className="summary-row">
        <span>Historical adjustment</span>
        <span className="val">{fmtSignedPct(prediction.adjustmentFactorPct)}</span>
      </div>
    </div>
  );
}

function CalibrationTable({ comparisons, competitionsById }) {
  const rows = useMemo(
    () =>
      comparisons
        .map((c) => {
          const comp = competitionsById.get(c.competitionId);
          return {
            id: c.competitionId,
            name: comp?.competitionName || "Competition",
            date: comp?.date || null,
            practiceAverageMs: c.practiceAverageMs,
            officialAverageMs: c.officialAverageMs,
            gapPct: c.gapPct,
          };
        })
        .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)),
    [comparisons, competitionsById]
  );

  if (rows.length === 0) {
    return (
      <div className="section-card" style={EMPTY_STYLE}>
        No comparable competition data yet.
      </div>
    );
  }

  return (
    <div className="section-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th scope="col" style={{ ...th, textAlign: "left" }}>Competition</th>
              <th scope="col" style={th}>Practice Average</th>
              <th scope="col" style={th}>Official Average</th>
              <th scope="col" style={th}>Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 600, color: "var(--text)" }}>
                  {row.name}
                </td>
                <td style={{ ...td, color: "var(--text-muted)" }}>{fmtSeconds(row.practiceAverageMs)}</td>
                <td style={{ ...td, color: "var(--text-muted)" }}>{fmtSeconds(row.officialAverageMs)}</td>
                <td style={{ ...td, color: row.gapPct >= 0 ? "var(--danger)" : "var(--success)", fontWeight: 600 }}>
                  {fmtSignedPct(row.gapPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompetitionResultsList({ competitions, onEdit, onDelete }) {
  const sorted = useMemo(
    () => [...competitions].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)),
    [competitions]
  );

  if (sorted.length === 0) {
    return (
      <div className="section-card" style={EMPTY_STYLE}>
        No competition results entered yet.
      </div>
    );
  }

  return (
    <div className="section-card" style={{ padding: 0, overflow: "hidden" }}>
      <div role="list" aria-label="Competition results">
        {sorted.map((c) => (
          <div key={c.id} role="listitem" className="competition-row">
            <div>
              <div style={{ fontWeight: 600, color: "var(--text)", fontSize: "0.9rem" }}>{c.competitionName}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-faint)", fontFamily: "monospace" }}>
                {fmtDate(c.date)} · {c.event}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--text)" }}>
                  {fmtSeconds(c.averageMs)}
                </div>
                {c.bestMs !== null && (
                  <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-faint)" }}>
                    best {fmtSeconds(c.bestMs)}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="dash-btn" aria-label={`Edit ${c.competitionName}`} onClick={() => onEdit(c)}>
                  Edit
                </button>
                <button
                  className="dash-btn"
                  aria-label={`Delete ${c.competitionName}`}
                  style={{ color: "var(--danger)" }}
                  onClick={() => onDelete(c.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const emptyForm = (defaultEvent) => ({
  competitionName: "",
  date: "",
  event: defaultEvent,
  averageSeconds: "",
  bestSeconds: "",
});

const competitionToForm = (c) => ({
  competitionName: c.competitionName,
  date: c.date ? c.date.slice(0, 10) : "",
  event: c.event,
  averageSeconds: c.averageMs != null ? String(c.averageMs / 1000) : "",
  bestSeconds: c.bestMs != null ? String(c.bestMs / 1000) : "",
});

function validate(form) {
  const errors = {};
  if (!form.competitionName.trim()) errors.competitionName = "Competition name is required.";

  if (!form.date) {
    errors.date = "Date is required.";
  } else if (Number.isNaN(Date.parse(form.date))) {
    errors.date = "Enter a valid date.";
  }

  const avg = parseFloat(form.averageSeconds);
  if (form.averageSeconds.trim() === "" || Number.isNaN(avg)) {
    errors.averageSeconds = "Official average is required.";
  } else if (avg <= 0 || avg > MAX_REASONABLE_SECONDS) {
    errors.averageSeconds = "Enter a realistic average, in seconds.";
  }

  if (form.bestSeconds.trim() !== "") {
    const best = parseFloat(form.bestSeconds);
    if (Number.isNaN(best) || best <= 0 || best > MAX_REASONABLE_SECONDS) {
      errors.bestSeconds = "Enter a realistic time, in seconds.";
    } else if (!errors.averageSeconds && best > avg) {
      errors.bestSeconds = "Best single can't be slower than the average.";
    }
  }

  return errors;
}

function CompetitionFormModal({ titleId, title, initialForm, competitions, editingId, onClose, onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  // A conflict (similar competition name, same event/date, different times)
  // is a warning, not a hard block - a second submit with the form
  // unchanged confirms it. conflictWarning being non-null already carries
  // "the user has seen this exact warning"; updateField clears it on any
  // field change, so a stale confirmation can never slip through with
  // different data than what was actually reviewed.
  const [conflictWarning, setConflictWarning] = useState(null);
  const nameId = useId();
  const dateId = useId();
  const eventId = useId();
  const avgId = useId();
  const bestId = useId();
  const nameErrId = useId();
  const dateErrId = useId();
  const avgErrId = useId();
  const bestErrId = useId();
  const conflictWarningId = useId();

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setConflictWarning(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextErrors = validate(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setConflictWarning(null);
      return;
    }

    const candidate = {
      competitionName: form.competitionName.trim(),
      date: new Date(form.date).toISOString(),
      event: form.event,
      averageMs: Math.round(parseFloat(form.averageSeconds) * 1000),
      bestMs: form.bestSeconds.trim() === "" ? null : Math.round(parseFloat(form.bestSeconds) * 1000),
    };

    const duplicateCheck = checkForDuplicateOrConflict(candidate, competitions || [], editingId || null);
    if (duplicateCheck.type === "duplicate") {
      setErrors({ duplicate: duplicateCheck.reason });
      setConflictWarning(null);
      return;
    }
    if (duplicateCheck.type === "conflict" && conflictWarning === null) {
      setErrors({});
      setConflictWarning(duplicateCheck.reason);
      return;
    }

    setErrors({});
    onSubmit(candidate);
  };

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <h2 id={titleId} style={{ color: "var(--text)", marginBottom: 16, fontSize: "1.1rem", textAlign: "left" }}>
        {title}
      </h2>
      <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
        <div className="form-field">
          <label className="form-label" htmlFor={nameId}>Competition Name</label>
          <input
            id={nameId}
            className="ctrl"
            type="text"
            value={form.competitionName}
            onChange={(e) => updateField("competitionName", e.target.value)}
            aria-invalid={Boolean(errors.competitionName)}
            aria-describedby={errors.competitionName ? nameErrId : undefined}
          />
          {errors.competitionName && (
            <span className="form-error" id={nameErrId} role="alert">{errors.competitionName}</span>
          )}
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
          <label className="form-label" htmlFor={eventId}>Event</label>
          <select
            id={eventId}
            className="ctrl"
            value={form.event}
            onChange={(e) => updateField("event", e.target.value)}
          >
            {CUBE_DIMENSIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor={avgId}>Official Average (seconds)</label>
          <input
            id={avgId}
            className="ctrl"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={form.averageSeconds}
            onChange={(e) => updateField("averageSeconds", e.target.value)}
            aria-invalid={Boolean(errors.averageSeconds)}
            aria-describedby={errors.averageSeconds ? avgErrId : undefined}
          />
          {errors.averageSeconds && (
            <span className="form-error" id={avgErrId} role="alert">{errors.averageSeconds}</span>
          )}
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor={bestId}>Official Best Single (seconds, optional)</label>
          <input
            id={bestId}
            className="ctrl"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={form.bestSeconds}
            onChange={(e) => updateField("bestSeconds", e.target.value)}
            aria-invalid={Boolean(errors.bestSeconds)}
            aria-describedby={errors.bestSeconds ? bestErrId : undefined}
          />
          {errors.bestSeconds && (
            <span className="form-error" id={bestErrId} role="alert">{errors.bestSeconds}</span>
          )}
        </div>

        {errors.duplicate && (
          <span className="form-error" role="alert">{errors.duplicate}</span>
        )}
        {conflictWarning && (
          <span className="form-error" id={conflictWarningId} role="alert" style={{ color: "var(--warning)" }}>
            {conflictWarning} Submit again to add it anyway.
          </span>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="dash-btn" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="dash-btn"
            style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}
          >
            {title.startsWith("Edit")
              ? conflictWarning
                ? "Save anyway"
                : "Save"
              : conflictWarning
              ? "Add anyway"
              : "Add"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const CompetitionTab = ({
  cubeDimension,
  practiceSolves,
  competitions,
  addCompetitionResult,
  updateCompetitionResult,
  deleteCompetitionResult,
}) => {
  const [formMode, setFormMode] = useState(null); // null | "add" | the competition being edited

  const competitionsForEvent = useMemo(
    () => competitions.filter((c) => c.event === cubeDimension),
    [competitions, cubeDimension]
  );

  const competitionsById = useMemo(
    () => new Map(competitionsForEvent.map((c) => [c.id, c])),
    [competitionsForEvent]
  );

  const prediction = useMemo(
    () => predictCompetitionResult(practiceSolves, competitionsForEvent, cubeDimension, Date.now()),
    [practiceSolves, competitionsForEvent, cubeDimension]
  );

  const backtest = useMemo(
    () => computeBacktest(practiceSolves, competitionsForEvent, cubeDimension),
    [practiceSolves, competitionsForEvent, cubeDimension]
  );

  const explanation = useMemo(
    () => explainPrediction(prediction, backtest.summary),
    [prediction, backtest]
  );

  const emptyMessage = predictionEmptyMessage(competitionsForEvent.length, prediction);

  const handleAdd = (values) => {
    const startedAt = performance.now();
    addCompetitionResult({ ...values, source: "manual" });
    logger.debug("Added a competition result.", {
      event: values.event,
      durationMs: Math.round(performance.now() - startedAt),
    });
    setFormMode(null);
  };

  const handleEditSubmit = (values) => {
    // Deliberately doesn't force source: "manual" here - editing a
    // previously-imported record's date/time typo shouldn't strip its
    // wca-import identity, or a future re-import of the same WCA result
    // would create a duplicate instead of updating it in place.
    updateCompetitionResult(formMode.id, values);
    logger.debug("Updated a competition result.", { competitionId: formMode.id });
    setFormMode(null);
  };

  const handleDelete = (id) => {
    deleteCompetitionResult(id);
    logger.debug("Deleted a competition result.", { competitionId: id });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div aria-live="polite">
        <PredictionCard prediction={prediction} emptyMessage={emptyMessage} />
      </div>

      <WhySection prediction={prediction} show={emptyMessage === null} />

      <div aria-live="polite">
        <PredictionBreakdown explanation={explanation} show={emptyMessage === null} />
      </div>

      <PredictionFactors factors={explanation.factors} show={emptyMessage === null} />

      <div>
        <div className="section-title">Historical Calibration</div>
        <CalibrationTable comparisons={prediction.comparisons} competitionsById={competitionsById} />
      </div>

      <WcaImport
        competitions={competitions}
        addCompetitionResult={addCompetitionResult}
        updateCompetitionResult={updateCompetitionResult}
      />

      <div>
        <div className="dash-actions" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Competition Results</div>
          <button className="dash-btn" onClick={() => setFormMode("add")}>Add competition</button>
        </div>
        <CompetitionResultsList
          competitions={competitionsForEvent}
          onEdit={(c) => setFormMode(c)}
          onDelete={handleDelete}
        />
      </div>

      <PredictionQuality
        backtest={backtest}
        competitionCount={competitionsForEvent.length}
        competitionsById={competitionsById}
      />

      {formMode === "add" && (
        <CompetitionFormModal
          key="add"
          titleId="add-competition-title"
          title="Add Competition Result"
          initialForm={emptyForm(cubeDimension)}
          competitions={competitions}
          editingId={null}
          onClose={() => setFormMode(null)}
          onSubmit={handleAdd}
        />
      )}
      {formMode && formMode !== "add" && (
        <CompetitionFormModal
          key={formMode.id}
          titleId="edit-competition-title"
          title="Edit Competition Result"
          initialForm={competitionToForm(formMode)}
          competitions={competitions}
          editingId={formMode.id}
          onClose={() => setFormMode(null)}
          onSubmit={handleEditSubmit}
        />
      )}
    </div>
  );
};

export default CompetitionTab;
