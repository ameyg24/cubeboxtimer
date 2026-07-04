// PeerComparison.jsx - "Compare With Another Cuber", in the Competition
// tab. CubeBox only has practice data for the local user, so another
// competitor's estimate comes from their official result history alone
// (see usePeerComparison.js / analytics/peerComparison.ts) - never
// persisted, always a fresh fetch on each Compare click.
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

function PredictionMiniCard({ title, predictedAverageMs, confidenceRangeMs, confidenceLevel, caption }) {
  if (predictedAverageMs === null) {
    return (
      <div className="summary-card">
        <div className="summary-title">{title}</div>
        <div style={{ color: "var(--text-faint)", fontSize: "0.85rem", padding: "0.75rem 0" }}>
          Not enough competition history for a prediction.
        </div>
      </div>
    );
  }

  const [lo, hi] = confidenceRangeMs;
  const marginMs = (hi - lo) / 2;

  return (
    <div className="summary-card">
      <div className="summary-title">{title}</div>
      <div>
        <span className="prediction-value">{fmtSeconds(predictedAverageMs)}</span>
        <span className="prediction-margin">±{fmtSeconds(marginMs)}</span>
      </div>
      <div className="prediction-confidence">
        <span>Confidence:</span>
        <span className={`confidence-badge confidence-badge-${confidenceLevel}`}>
          {CONFIDENCE_LABELS[confidenceLevel]}
        </span>
      </div>
      {caption && <div className="prediction-basis">{caption}</div>}
    </div>
  );
}

// Describes the peer's own trend in plain language - "trending faster/
// slower" reads more naturally than a raw signed ms/competition slope. Notes
// the total available when the estimate only used a recent subset of it
// (see analytics/peerComparison.ts's DEFAULT_RECENT_WINDOW), so it's clear
// an old, much-slower era of their history wasn't included.
function peerCaption(peer) {
  const count =
    peer.totalCompetitionsAvailable > peer.competitionsUsed
      ? `${peer.competitionsUsed} of ${peer.totalCompetitionsAvailable} competitions`
      : `${peer.competitionsUsed} competition${peer.competitionsUsed === 1 ? "" : "s"}`;
  if (peer.competitionsUsed === 0) return "No competition history found for this event.";
  if (peer.trendMsPerCompetition === null) return `Based on their last ${count}.`;
  const direction = peer.trendMsPerCompetition < 0 ? "faster" : "slower";
  return `Based on their last ${count} - trending ${fmtSeconds(Math.abs(peer.trendMsPerCompetition))}s ${direction} each competition.`;
}

const PeerComparison = ({ cubeDimension, yourPrediction }) => {
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
        Estimates their next {cubeDimension} competition average from their official result history alone - CubeBox
        only has practice data for you, so their side factors in recent results and how much they've been improving
        instead.
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
            predictedAverageMs={yourPrediction.predictedAverageMs}
            confidenceRangeMs={yourPrediction.confidenceRangeMs}
            confidenceLevel={yourPrediction.confidenceLevel}
            caption={yourCaption}
          />
          <PredictionMiniCard
            title={result.personName || result.wcaId}
            predictedAverageMs={result.predictedAverageMs}
            confidenceRangeMs={result.confidenceRangeMs}
            confidenceLevel={result.confidenceLevel}
            caption={peerCaption(result)}
          />
        </div>
      )}
    </div>
  );
};

export default PeerComparison;
