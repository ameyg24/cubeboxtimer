// FeatureSnapshot.jsx - compact view of the current feature vector feeding
// the ML-style models (analytics/predictionFeatures.ts). Only the fields a
// user would actually recognize as "what's driving this" — the full vector
// also carries competition-gap and prior-error features used by the models
// but not worth surfacing here.
const EMPTY_STYLE = { color: "var(--text-faint)", textAlign: "center", padding: "2.5rem" };
const fmtSeconds = (ms) => (ms / 1000).toFixed(2);

const StatTile = ({ label, value }) => (
  <div className="stat-tile">
    <span className="stat-tile-label">{label}</span>
    <span className="stat-tile-value">{value}</span>
  </div>
);

const FeatureSnapshot = ({ features }) => {
  if (features.practiceMeanMs === null) {
    return (
      <div className="section-card" style={EMPTY_STYLE}>
        Not enough recent practice data for a feature snapshot yet.
      </div>
    );
  }

  return (
    <div className="section-card">
      <div className="section-title">Feature Snapshot</div>
      <div className="stat-strip">
        <StatTile label="Practice Mean" value={`${fmtSeconds(features.practiceMeanMs)}s`} />
        <StatTile label="Solve Count" value={features.practiceCount} />
        <StatTile
          label="Consistency (σ)"
          value={features.practiceStddevMs !== null ? `${fmtSeconds(features.practiceStddevMs)}s` : "-"}
        />
        <StatTile label="DNF Rate" value={`${features.dnfRatePct.toFixed(1)}%`} />
        <StatTile label="Prior Competitions" value={features.priorCompetitionCount} />
      </div>
    </div>
  );
};

export default FeatureSnapshot;
