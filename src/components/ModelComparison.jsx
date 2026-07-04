// ModelComparison.jsx - "Model Comparison", pitting the rule-based
// prediction against two statistical models (analytics/modelComparison.ts)
// on the same walk-forward evaluation Prediction Quality already uses for
// the rule-based model alone. Every number here comes straight out of
// compareModels/explainBestModel - this file only formats and lays it out.
import { DEFAULT_PRACTICE_WINDOW_DAYS, MIN_COMPARABLE_FOR_COMPARISON } from "../analytics";

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
const fmtSignedSeconds = (ms) => `${ms >= 0 ? "+" : ""}${fmtSeconds(ms)}`;

function ModelComparisonEmptyState({ cubeDimension, comparableCompetitionsFound }) {
  return (
    <div className="section-card" style={EMPTY_STYLE}>
      <div>
        Model comparison needs at least {MIN_COMPARABLE_FOR_COMPARISON} comparable competitions with practice solves
        in the {DEFAULT_PRACTICE_WINDOW_DAYS} days before each competition.
      </div>
      <div style={{ marginTop: 12, fontSize: "0.8rem", display: "flex", flexDirection: "column", gap: 2 }}>
        <div>Comparable competitions found: {comparableCompetitionsFound}</div>
        <div>Required minimum: {MIN_COMPARABLE_FOR_COMPARISON}</div>
        <div>Practice window: {DEFAULT_PRACTICE_WINDOW_DAYS} days before each competition</div>
        <div>Active event: {cubeDimension}</div>
      </div>
    </div>
  );
}

function ModelComparisonTable({ metrics, bestModelId }) {
  return (
    <div className="section-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table aria-label="Model comparison" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th scope="col" style={{ ...th, textAlign: "left" }}>Model</th>
              <th scope="col" style={th}>MAE</th>
              <th scope="col" style={th}>RMSE</th>
              <th scope="col" style={th}>Bias</th>
              <th scope="col" style={th}>Evaluated</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const isBest = m.modelId === bestModelId;
              return (
                <tr key={m.modelId} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td
                    style={{
                      ...td,
                      textAlign: "left",
                      fontFamily: "inherit",
                      fontWeight: 600,
                      color: isBest ? "var(--accent)" : "var(--text)",
                    }}
                  >
                    {m.label}
                    {isBest && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          letterSpacing: "0.03em",
                          color: "var(--accent)",
                          border: "1px solid var(--accent)",
                          borderRadius: 999,
                          padding: "1px 7px",
                        }}
                      >
                        BEST
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>
                    {m.maeMs !== null ? `${fmtSeconds(m.maeMs)}s` : "-"}
                  </td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>
                    {m.rmseMs !== null ? `${fmtSeconds(m.rmseMs)}s` : "-"}
                  </td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>
                    {m.biasMs !== null ? `${fmtSignedSeconds(m.biasMs)}s` : "-"}
                  </td>
                  <td style={{ ...td, color: "var(--text)" }}>{m.evaluatedCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ModelComparison = ({ comparison, cubeDimension, explanation }) => {
  const showEmptyState = comparison.comparableCompetitionsFound < MIN_COMPARABLE_FOR_COMPARISON;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div className="section-title">Model Comparison</div>
      {showEmptyState ? (
        <ModelComparisonEmptyState
          cubeDimension={cubeDimension}
          comparableCompetitionsFound={comparison.comparableCompetitionsFound}
        />
      ) : (
        <>
          <ModelComparisonTable metrics={comparison.metrics} bestModelId={comparison.bestModelId} />
          <div className="prediction-basis">{explanation}</div>
        </>
      )}
    </div>
  );
};

export default ModelComparison;
