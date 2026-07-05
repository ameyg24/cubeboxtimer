// CoachTab.jsx - Practice Coach, the Dashboard's "Coach" tab. Deterministic
// and explainable: every number here comes from computeTrainingSignals /
// computePracticeCoachResult (src/analytics) - this file only formats and
// lays them out, mirroring how CompetitionTab.jsx relates to
// predictCompetitionResult. No LLM, no narration layer, nothing generated
// per render.
import { useMemo } from "react";
import {
  collapseRoundsToReference,
  computePracticeCoachResult,
  computeTrainingSignals,
  predictCompetitionResult,
  runBacktest,
} from "../analytics";
import { logger } from "../logger.js";

const EMPTY_STYLE = { color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" };
const READINESS_BADGE_CLASS = { ready: "high", mixed: "medium", "needs-work": "low" };
const READINESS_LABELS = { ready: "Ready", mixed: "Mixed", "needs-work": "Needs Work" };
const CONFIDENCE_LABELS = { low: "Low", medium: "Medium", high: "High" };

const fmtSeconds = (ms) => (ms / 1000).toFixed(2);
const fmtSignedSeconds = (ms) => `${ms >= 0 ? "+" : ""}${fmtSeconds(ms)}`;
const fmtSignedPct = (fraction) => `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)}%`;

function computeCoachResult(solves, event, competitionResults) {
  const startedAt = performance.now();
  const referencePoints = collapseRoundsToReference(competitionResults.filter((c) => c.event === event));
  const prediction = predictCompetitionResult(solves, referencePoints, event, Date.now());
  const backtest = runBacktest(solves, referencePoints, event);
  const signals = computeTrainingSignals(solves, event, referencePoints, prediction, backtest.summary);
  const result = computePracticeCoachResult(signals);
  logger.debug("Practice coach computed.", {
    event,
    readiness: result.readiness.score,
    focusAreaCount: result.focusAreas.length,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return { signals, result };
}

function CoachSummary({ result }) {
  return (
    <div className="section-card">
      <div className="section-title">Coach Summary</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span className="prediction-value">{result.readiness.score}</span>
        <span className={`confidence-badge confidence-badge-${READINESS_BADGE_CLASS[result.readiness.label]}`}>
          {READINESS_LABELS[result.readiness.label]}
        </span>
      </div>
      <p style={{ margin: "var(--space-2) 0 0", color: "var(--text)", fontSize: "0.92rem" }}>{result.summary}</p>
      <div className="prediction-confidence" style={{ marginTop: 8 }}>
        <span>Confidence:</span>
        <span className={`confidence-badge confidence-badge-${result.confidence}`}>
          {CONFIDENCE_LABELS[result.confidence]}
        </span>
      </div>
    </div>
  );
}

function FocusAreaCard({ area }) {
  return (
    <div className="section-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>{area.title}</div>
        <span className={`confidence-badge confidence-badge-${area.priority}`}>{area.priority}</span>
      </div>
      <p style={{ margin: "var(--space-2) 0", color: "var(--text)", fontSize: "0.88rem" }}>{area.reason}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: "var(--space-2)" }}>
        {area.evidence.map((e) => (
          <div className="summary-row" key={e.label}>
            <span>{e.label}</span>
            <span className="val">{e.value}</span>
          </div>
        ))}
      </div>
      <div className="prediction-basis">Drill: {area.suggestedDrill}</div>
      <div className="prediction-basis">Target: {area.target}</div>
    </div>
  );
}

function TopFocusAreas({ focusAreas }) {
  if (focusAreas.length === 0) {
    return <div className="section-card" style={EMPTY_STYLE}>No focus areas flagged right now.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {focusAreas.map((area) => (
        <FocusAreaCard key={area.id} area={area} />
      ))}
    </div>
  );
}

const StatTile = ({ label, value }) => (
  <div className="stat-tile">
    <span className="stat-tile-label">{label}</span>
    <span className="stat-tile-value">{value}</span>
  </div>
);

function EvidenceSnapshot({ signals }) {
  return (
    <div className="section-card">
      <div className="section-title">Evidence Snapshot</div>
      <div className="stat-strip">
        <StatTile
          label="Consistency (σ)"
          value={signals.practiceStddevMs !== null ? `${fmtSeconds(signals.practiceStddevMs)}s` : "-"}
        />
        <StatTile label="Volume (14d)" value={`${signals.practiceCount} solves`} />
        <StatTile label="Momentum" value={signals.momentumMs !== null ? `${fmtSignedSeconds(signals.momentumMs)}s` : "-"} />
        <StatTile label="DNF Rate" value={`${signals.dnfRatePct.toFixed(1)}%`} />
        <StatTile
          label="Competition Gap"
          value={signals.competitionGapPct !== null ? fmtSignedPct(signals.competitionGapPct) : "-"}
        />
      </div>
    </div>
  );
}

function Limitations({ limitations }) {
  if (limitations.length === 0) return null;
  return (
    <div className="section-card">
      <div className="section-title">Limitations</div>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        {limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

const CoachTab = ({ cubeDimension, practiceSolves, competitions }) => {
  const { signals, result } = useMemo(
    () => computeCoachResult(practiceSolves, cubeDimension, competitions),
    [practiceSolves, cubeDimension, competitions]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <CoachSummary result={result} />
      <div>
        <div className="section-title">Top Focus Areas</div>
        <TopFocusAreas focusAreas={result.focusAreas} />
      </div>
      <EvidenceSnapshot signals={signals} />
      <Limitations limitations={result.limitations} />
    </div>
  );
};

export default CoachTab;
