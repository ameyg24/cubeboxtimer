// PeerComparison.jsx - "Compare With Another Cuber", in the Competition
// tab. CubeBox only has practice data for the local user, so another
// competitor's estimate comes from their official result history alone
// (see usePeerComparison.js / analytics/peerComparison.ts) - never
// persisted, always a fresh fetch on each Compare click. Both sides show
// average and best single, computed independently of each other.
import { useId, useState } from "react";
import { WCA_ID_EXAMPLE } from "../analytics";
import { usePeerComparison } from "../hooks/usePeerComparison.js";

const CONFIDENCE_LABELS = { insufficient: "Insufficient", low: "Low", medium: "Medium", high: "High" };
const fmtSeconds = (ms) => (ms / 1000).toFixed(2);

// Mirrors WcaImport.jsx's ImportProgress - the metadata-fetch phase can
// take a while on a prolific competitor's ID for the same rate-limit
// reasons documented in wcaApi.js's createRateLimitState.
function ComparisonProgress({ progress }) {
  if (!progress) {
    return (
      <div role="status" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Fetching their WCA results…
      </div>
    );
  }

  const { completed, total } = progress;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 100;

  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Checking competition details… {completed} of {total}
      </div>
      <div
        role="progressbar"
        aria-label="Comparison progress"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        style={{ height: 6, borderRadius: 999, background: "var(--surface-alt)", overflow: "hidden" }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--accent)",
            borderRadius: 999,
            transition: "width 0.2s ease",
          }}
        />
      </div>
    </div>
  );
}

// One metric's row within a mini card - `metric` is always shaped as
// {predictedMs, confidenceRangeMs, confidenceLevel}, whether it came from
// this app's own average/best prediction (adapted at the call site) or a
// peer's PeerMetricPrediction (already this shape).
function MetricRow({ label, metric }) {
  if (metric.predictedMs === null) {
    return (
      <div style={{ marginTop: 10 }}>
        <div className="summary-title" style={{ fontSize: "0.68rem" }}>{label}</div>
        <div style={{ color: "var(--text-faint)", fontSize: "0.8rem" }}>Not enough history for a prediction.</div>
      </div>
    );
  }

  const [lo, hi] = metric.confidenceRangeMs;
  const marginMs = (hi - lo) / 2;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="summary-title" style={{ fontSize: "0.68rem" }}>{label}</div>
      <div>
        <span className="prediction-value" style={{ fontSize: "1.5rem" }}>{fmtSeconds(metric.predictedMs)}</span>
        <span className="prediction-margin" style={{ fontSize: "0.85rem" }}>±{fmtSeconds(marginMs)}</span>
      </div>
      <div className="prediction-confidence">
        <span>Confidence:</span>
        <span className={`confidence-badge confidence-badge-${metric.confidenceLevel}`}>
          {CONFIDENCE_LABELS[metric.confidenceLevel]}
        </span>
      </div>
    </div>
  );
}

function PredictionMiniCard({ title, average, best, caption }) {
  return (
    <div className="summary-card">
      <div className="summary-title">{title}</div>
      <MetricRow label="AVERAGE" metric={average} />
      <MetricRow label="BEST SINGLE" metric={best} />
      {caption && <div className="prediction-basis" style={{ marginTop: 10 }}>{caption}</div>}
    </div>
  );
}

// Describes the peer's own average trend in plain language - "trending
// faster/slower" reads more naturally than a raw signed ms/competition
// slope. Notes the total available when the estimate only used a recent
// subset of it (see analytics/peerComparison.ts's DEFAULT_RECENT_WINDOW),
// so it's clear an old, much-slower era of their history wasn't included.
function peerCaption(peer) {
  const count =
    peer.totalCompetitionsAvailable > peer.competitionsUsed
      ? `${peer.competitionsUsed} of ${peer.totalCompetitionsAvailable} competitions`
      : `${peer.competitionsUsed} competition${peer.competitionsUsed === 1 ? "" : "s"}`;
  if (peer.competitionsUsed === 0) return "No competition history found for this event.";
  if (peer.average.trendMsPerCompetition === null) return `Based on their last ${count}.`;
  const direction = peer.average.trendMsPerCompetition < 0 ? "faster" : "slower";
  return `Based on their last ${count} - trending ${fmtSeconds(Math.abs(peer.average.trendMsPerCompetition))}s ${direction} each competition.`;
}

const PeerComparison = ({ cubeDimension, yourPrediction, yourBestPrediction }) => {
  const [wcaId, setWcaId] = useState("");
  const { status, result, errorMessage, progress, compare } = usePeerComparison();
  const inputId = useId();
  const errorId = useId();

  const handleSubmit = (e) => {
    e.preventDefault();
    compare(wcaId, cubeDimension);
  };

  const yourCaption =
    yourPrediction.competitionsUsed > 0
      ? `Based on your last ${yourPrediction.competitionsUsed} competition${yourPrediction.competitionsUsed === 1 ? "" : "s"}.`
      : "No competition history yet.";

  return (
    <div className="section-card">
      <div className="section-title">Compare With Another Cuber</div>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 10 }}>
        Estimates their next {cubeDimension} competition average and best single from their official result history
        alone - CubeBox only has practice data for you, so their side factors in recent results and how much they've
        been improving instead.
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="form-field" style={{ flex: "1 1 200px" }}>
          <label className="form-label" htmlFor={inputId}>Their WCA ID</label>
          <input
            id={inputId}
            className="ctrl"
            type="text"
            placeholder={WCA_ID_EXAMPLE}
            value={wcaId}
            onChange={(e) => setWcaId(e.target.value)}
            aria-invalid={status === "error"}
            aria-describedby={status === "error" ? errorId : undefined}
          />
        </div>
        <button className="dash-btn" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Comparing…" : "Compare"}
        </button>
      </form>
      <div aria-live="polite" style={{ marginTop: 10 }}>
        {status === "loading" && <ComparisonProgress progress={progress} />}
        {status === "error" && (
          <span className="form-error" id={errorId} role="alert">{errorMessage}</span>
        )}
      </div>
      {status === "success" && result && (
        <div className="summary-grid" style={{ marginTop: 14 }}>
          <PredictionMiniCard
            title="You"
            average={{
              predictedMs: yourPrediction.predictedAverageMs,
              confidenceRangeMs: yourPrediction.confidenceRangeMs,
              confidenceLevel: yourPrediction.confidenceLevel,
            }}
            best={{
              predictedMs: yourBestPrediction.predictedBestMs,
              confidenceRangeMs: yourBestPrediction.confidenceRangeMs,
              confidenceLevel: yourBestPrediction.confidenceLevel,
            }}
            caption={yourCaption}
          />
          <PredictionMiniCard
            title={result.personName || result.wcaId}
            average={result.average}
            best={result.best}
            caption={peerCaption(result)}
          />
        </div>
      )}
    </div>
  );
};

export default PeerComparison;
