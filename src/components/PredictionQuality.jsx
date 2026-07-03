// PredictionQuality.jsx - "How accurate have our predictions actually been?"
// Runs the pure backtesting engine (analytics/backtesting.ts) over the
// user's own competition history and displays the result. This file only
// formats and lays out numbers runBacktest already computed - see that
// module for the actual evaluation math. Chart.js is only needed once this
// section renders, so PredictionErrorChart is lazy-loaded exactly like
// StatsChart is for the Trend tab.
import { lazy, Suspense, useMemo } from "react";
import { runBacktest } from "../analytics";
import { logger } from "../logger.js";

const PredictionErrorChart = lazy(() => {
  const startedAt = performance.now();
  logger.debug("Loading prediction error chart module...");
  return import("./PredictionErrorChart.jsx")
    .then((mod) => {
      logger.info("Prediction error chart module loaded.", {
        durationMs: Math.round(performance.now() - startedAt),
      });
      return mod;
    })
    .catch((error) => {
      logger.error("Failed to load prediction error chart module.", {
        error,
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw error;
    });
});

const CONFIDENCE_LABELS = { insufficient: "Insufficient", low: "Low", medium: "Medium", high: "High" };
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
const fmtPct = (v) => `${v.toFixed(1)}%`;
const fmtSignedPct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";

// Runs the pure backtest and logs around it (start, finish, evaluation
// count, duration) — analytics/backtesting.ts itself stays framework- and
// logger-free, matching every other module in src/analytics.
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

// Never fabricates a metric: explains why there isn't one instead.
function backtestEmptyMessage(competitionCount, backtest) {
  if (competitionCount < 2) {
    return "Backtesting needs at least 2 competitions for this event — add another result to see how predictions have performed.";
  }
  if (backtest.summary.evaluatedCount === 0) {
    return "None of your competitions had enough matching practice data at the time to backtest yet.";
  }
  return null;
}

const StatTile = ({ label, value }) => (
  <div className="stat-tile">
    <span className="stat-tile-label">{label}</span>
    <span className="stat-tile-value">{value}</span>
  </div>
);

const SummaryCards = ({ summary }) => (
  <div className="stat-strip">
    <StatTile label="Average Error" value={fmtPct(summary.averageAbsoluteErrorPct)} />
    <StatTile label="Median Error" value={fmtPct(summary.medianAbsoluteErrorPct)} />
    <StatTile label="RMSE" value={fmtPct(summary.rmsePct)} />
    <StatTile label="Predictions Evaluated" value={summary.evaluatedCount} />
    <StatTile label="Bias" value={fmtSignedPct(summary.averageBiasPct)} />
  </div>
);

function PredictionHistoryTable({ cases, competitionsById }) {
  const rows = useMemo(
    () => [...cases].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)),
    [cases]
  );

  return (
    <div className="section-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table aria-label="Prediction history" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th scope="col" style={{ ...th, textAlign: "left" }}>Competition</th>
              <th scope="col" style={th}>Predicted</th>
              <th scope="col" style={th}>Actual</th>
              <th scope="col" style={th}>Error</th>
              <th scope="col" style={th}>Bias</th>
              <th scope="col" style={{ ...th, textAlign: "left" }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const comp = competitionsById.get(c.competitionId);
              return (
                <tr key={c.competitionId} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 600, color: "var(--text)" }}>
                    {comp?.competitionName || "Competition"}
                    <div style={{ fontSize: "0.7rem", color: "var(--text-faint)", fontWeight: 400 }}>
                      {fmtDate(c.date)}
                    </div>
                  </td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>{fmtSeconds(c.predictedAverageMs)}</td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>{fmtSeconds(c.actualAverageMs)}</td>
                  <td style={{ ...td, color: "var(--text)", fontWeight: 600 }}>{fmtPct(c.percentErrorPct)}</td>
                  <td style={{ ...td, color: "var(--text)" }}>{fmtSignedPct(c.biasPct)}</td>
                  <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>
                    <span className={`confidence-badge confidence-badge-${c.confidenceLevelUsed}`}>
                      {CONFIDENCE_LABELS[c.confidenceLevelUsed]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PredictionQuality = ({ cubeDimension, practiceSolves, competitionsForEvent, competitionsById }) => {
  const backtest = useMemo(
    () => computeBacktest(practiceSolves, competitionsForEvent, cubeDimension),
    [practiceSolves, competitionsForEvent, cubeDimension]
  );

  const emptyMessage = backtestEmptyMessage(competitionsForEvent.length, backtest);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div className="section-title">Prediction Quality</div>

      <div aria-live="polite">
        {emptyMessage ? (
          <div className="section-card" style={EMPTY_STYLE}>{emptyMessage}</div>
        ) : (
          <SummaryCards summary={backtest.summary} />
        )}
      </div>

      {!emptyMessage && (
        <>
          <div className="section-card">
            <div className="section-title">Prediction Error Over Time</div>
            <Suspense
              fallback={
                <div
                  className="chart-container"
                  style={{ height: 220, background: "var(--surface-alt)", borderRadius: "var(--radius-md)", animation: "skeletonPulse 1.2s ease-in-out infinite" }}
                />
              }
            >
              <PredictionErrorChart cases={backtest.cases} />
            </Suspense>
          </div>

          <div>
            <div className="section-title">Prediction History</div>
            <PredictionHistoryTable cases={backtest.cases} competitionsById={competitionsById} />
          </div>
        </>
      )}
    </div>
  );
};

export default PredictionQuality;
