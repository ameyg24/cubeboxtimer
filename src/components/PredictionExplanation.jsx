// PredictionExplanation.jsx - "Prediction Breakdown" and "Prediction
// Factors", the Competition tab's explainability sections. Every number
// here comes from analytics/predictionExplanation.ts (explainPrediction),
// which only interprets an already-computed PredictionResult and
// BacktestSummary - this file recomputes nothing, it only formats and lays
// them out. The bars in "Prediction Factors" reuse the exact same
// track/fill markup as Dashboard.jsx's Distribution tab (the only existing
// percentage-visualization pattern in the app), not a new visual language.
const CONFIDENCE_LABELS = { insufficient: "Insufficient", low: "Low", medium: "Medium", high: "High" };
const EMPTY_STYLE = { color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" };

const fmtSeconds = (ms) => (ms / 1000).toFixed(2);
const fmtPct = (v) => `${v.toFixed(1)}%`;
const fmtSignedPct = (fraction) => `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)}%`;

export function PredictionBreakdown({ explanation, show }) {
  if (!show) return null;

  if (!explanation.factors) {
    return (
      <div className="section-card" style={EMPTY_STYLE}>
        Not enough data yet for a detailed breakdown.
      </div>
    );
  }

  const [lo, hi] = explanation.confidenceIntervalMs;

  return (
    <div className="section-card">
      <div className="section-title">Prediction Breakdown</div>
      <div className="summary-row">
        <span>Practice average</span>
        <span className="val">{fmtSeconds(explanation.practiceAverageMs)}</span>
      </div>
      <div className="summary-row">
        <span>Adjustment factor</span>
        <span className="val">{fmtSignedPct(explanation.adjustmentFactorPct)}</span>
      </div>
      <div className="summary-row">
        <span>Predicted average</span>
        <span className="val">{fmtSeconds(explanation.predictedAverageMs)}</span>
      </div>
      <div className="summary-row">
        <span>Confidence interval</span>
        <span className="val">{fmtSeconds(lo)} – {fmtSeconds(hi)}</span>
      </div>
      <div className="summary-row">
        <span>Confidence level</span>
        <span className={`confidence-badge confidence-badge-${explanation.confidenceLevel}`}>
          {CONFIDENCE_LABELS[explanation.confidenceLevel]}
        </span>
      </div>
      <div className="summary-row">
        <span>Competitions used</span>
        <span className="val">{explanation.competitionsUsed}</span>
      </div>
      <div className="summary-row">
        <span>DNF probability</span>
        <span className="val">{fmtPct(explanation.dnfProbabilityPct)}</span>
      </div>
      <div className="summary-row">
        <span>Historical average error</span>
        <span className="val">
          {explanation.historicalAverageErrorPct !== null
            ? fmtPct(explanation.historicalAverageErrorPct)
            : "Not enough backtest history"}
        </span>
      </div>
    </div>
  );
}

const FACTOR_LABELS = [
  ["practicePerformancePct", "Practice performance"],
  ["historicalAdjustmentPct", "Historical adjustment"],
  ["consistencyPct", "Consistency"],
  ["dnfHistoryPct", "DNF history"],
  ["competitionHistoryPct", "Competition history"],
];

export function PredictionFactors({ factors, show }) {
  if (!show) return null;

  if (!factors) {
    return (
      <div className="section-card" style={EMPTY_STYLE}>
        Not enough data yet to break down prediction factors.
      </div>
    );
  }

  return (
    <div className="section-card">
      <div className="section-title">Prediction Factors</div>
      <p className="prediction-basis" style={{ margin: "0 0 var(--space-3)" }}>
        A transparent, rule-based breakdown of what shaped this prediction — not a machine-learning
        model or a fitted score.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {FACTOR_LABELS.map(([key, label]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ minWidth: 150, fontSize: "0.8rem", color: "var(--text-muted)" }}>{label}</span>
            <div style={{ flex: 1, background: "var(--surface-alt)", borderRadius: 4, height: 16, overflow: "hidden" }}>
              <div
                style={{
                  width: `${factors[key]}%`,
                  height: "100%",
                  background: "var(--accent)",
                  borderRadius: 4,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <span
              style={{ minWidth: 44, fontSize: "0.78rem", fontFamily: "monospace", color: "var(--text-faint)", textAlign: "right" }}
            >
              {factors[key].toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
