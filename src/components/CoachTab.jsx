// CoachTab.jsx - Practice Coach, the Dashboard's "Coach" tab. Deterministic
// and explainable: every number here comes from computeTrainingSignals /
// computePracticeCoachResult (src/analytics) - this file only formats and
// lays them out, mirroring how CompetitionTab.jsx relates to
// predictCompetitionResult. No LLM, no narration layer, nothing generated
// per render.
import { useMemo } from "react";
import { createAnalyticsContext, FOCUS_RULES } from "../analytics";
import { logger } from "../logger.js";

const EMPTY_STYLE = { color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" };
const READINESS_BADGE_CLASS = { ready: "high", mixed: "medium", "needs-work": "low" };
const READINESS_LABELS = { ready: "Ready", mixed: "Mixed", "needs-work": "Needs Work" };
const CONFIDENCE_LABELS = { low: "Low", medium: "Medium", high: "High" };
const MAX_REVIEW_CASES = 3;

const fmtSeconds = (ms) => (ms / 1000).toFixed(2);
const fmtSignedSeconds = (ms) => `${ms >= 0 ? "+" : ""}${fmtSeconds(ms)}`;
const fmtSignedPct = (fraction) => `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)}%`;
const ruleTitle = (ruleId) => FOCUS_RULES.find((r) => r.id === ruleId)?.title || ruleId;

// Builds the shared analytics context and logs after forcing the parts
// this tab always renders. nextCompetitionDateMs stays unset - no
// persisted "next competition" date exists yet in CubeBox, and
// buildTrainingPlan already explains the empty bucket itself.
function buildCoachAnalytics(solves, event, competitionResults) {
  const startedAt = performance.now();
  const ctx = createAnalyticsContext({
    event,
    allSolvesForEvent: solves,
    competitionResults,
    now: Date.now(),
  });
  const result = ctx.practiceCoach();
  const review = ctx.recommendationEvaluation();
  logger.debug("Practice coach computed.", {
    event,
    readiness: result.readiness.score,
    focusAreaCount: result.focusAreas.length,
    reviewEvaluatedCount: review.summary.evaluatedCount,
    durationMs: Math.round(performance.now() - startedAt),
  });
  return ctx;
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

function PlanBucket({ title, areas }) {
  if (areas.length === 0) return null;
  return (
    <div style={{ marginBottom: "var(--space-2)" }}>
      <div className="prediction-basis" style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {areas.map((a) => (
        <div key={a.id} style={{ marginBottom: 4 }}>
          <div style={{ color: "var(--text)", fontSize: "0.88rem", fontWeight: 600 }}>{a.title}</div>
          <div className="prediction-basis">{a.suggestedDrill}</div>
        </div>
      ))}
    </div>
  );
}

function TrainingPlanSection({ plan }) {
  const hasAnyBucket = plan.actNow.length > 0 || plan.thisWeek.length > 0 || plan.beforeNextCompetition.length > 0;
  return (
    <div className="section-card">
      <div className="section-title">Training Plan</div>
      {hasAnyBucket ? (
        <>
          <PlanBucket title="Act now" areas={plan.actNow} />
          <PlanBucket title="This week" areas={plan.thisWeek} />
          <PlanBucket title="Before competition" areas={plan.beforeNextCompetition} />
        </>
      ) : (
        <div style={EMPTY_STYLE}>No plan items right now.</div>
      )}
      {plan.limitations.map((l) => (
        <div className="prediction-basis" key={l}>{l}</div>
      ))}
    </div>
  );
}

const REVIEW_STATUS_BADGE = { resolved: "high", active: "medium", "insufficient-followup": "low" };
const REVIEW_STATUS_LABELS = { resolved: "Resolved", active: "Still active", "insufficient-followup": "Needs follow-up" };

function reviewStatus(c) {
  if (c.resolved) return "resolved";
  if (c.metricAtHorizon === null) return "insufficient-followup";
  return "active";
}

// Neutral, non-causal copy - a rule's own metric crossed back past its
// trigger condition, not "the recommendation worked."
function reviewText(c) {
  const status = reviewStatus(c);
  const title = ruleTitle(c.ruleId);
  if (status === "resolved") return `${title} crossed its target ${c.daysToResolution} days after being flagged.`;
  if (status === "insufficient-followup") return `Not enough later data to evaluate ${title}.`;
  return `${title} is still active.`;
}

function CoachReview({ review }) {
  const cases = [...review.cases].sort((a, b) => b.triggeredAt - a.triggeredAt).slice(0, MAX_REVIEW_CASES);
  return (
    <div className="section-card">
      <div className="section-title">Coach Review</div>
      {cases.length === 0 ? (
        <div style={EMPTY_STYLE}>No prior recommendations to review yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {cases.map((c) => {
            const status = reviewStatus(c);
            return (
              <div key={c.ruleId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text)" }}>{reviewText(c)}</span>
                <span className={`confidence-badge confidence-badge-${REVIEW_STATUS_BADGE[status]}`}>
                  {REVIEW_STATUS_LABELS[status]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CoachTab = ({ cubeDimension, practiceSolves, competitions }) => {
  const analytics = useMemo(
    () => buildCoachAnalytics(practiceSolves, cubeDimension, competitions),
    [practiceSolves, cubeDimension, competitions]
  );
  const signals = analytics.trainingSignals();
  const result = analytics.practiceCoach();
  const plan = analytics.trainingPlan();
  const review = analytics.recommendationEvaluation();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <CoachSummary result={result} />
      <div>
        <div className="section-title">Top Focus Areas</div>
        <TopFocusAreas focusAreas={result.focusAreas} />
      </div>
      <TrainingPlanSection plan={plan} />
      <EvidenceSnapshot signals={signals} />
      <CoachReview review={review} />
      <Limitations limitations={result.limitations} />
    </div>
  );
};

export default CoachTab;
