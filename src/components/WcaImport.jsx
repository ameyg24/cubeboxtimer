// WcaImport.jsx - "Import from WCA" controls, shown near Competition
// Results in the Competition tab. All fetch/convert/dedupe orchestration
// lives in useWcaImport (src/hooks) and the pure analytics/wcaImport.ts
// module — this file only renders the form and the resulting status/summary.
import { useId, useState } from "react";
import { WCA_ID_EXAMPLE } from "../analytics";
import { useWcaImport } from "../hooks/useWcaImport.js";

const fmtSeconds = (ms) => (ms / 1000).toFixed(2);

// Builds the itemized breakdown lines for a finished import - every
// category a result can land in gets its own line, shown only when it's
// non-zero, so a real result never collapses into an unexplained "skipped
// N" (see wcaImport.ts's SkipReason / ImportDecision for where each count
// comes from).
function buildSummaryLines(summary) {
  const {
    createdCount,
    updatedCount,
    alreadyImportedCount,
    duplicateCount,
    conflictCount,
    unsupportedEventCount,
    noAverageCount,
    dnfOrDnsCount,
    metadataFailureCount,
  } = summary;

  const totalDuplicates = alreadyImportedCount + duplicateCount;
  const totalInvalidAverages = noAverageCount + dnfOrDnsCount;

  const lines = [`Imported ${createdCount} new result${createdCount === 1 ? "" : "s"}`];
  if (updatedCount > 0) {
    lines.push(`Updated ${updatedCount} existing imported result${updatedCount === 1 ? "" : "s"}`);
  }
  if (totalDuplicates > 0) {
    lines.push(`Skipped ${totalDuplicates} duplicate${totalDuplicates === 1 ? "" : "s"}`);
  }
  if (unsupportedEventCount > 0) {
    lines.push(`Skipped ${unsupportedEventCount} unsupported event${unsupportedEventCount === 1 ? "" : "s"}`);
  }
  if (totalInvalidAverages > 0) {
    lines.push(`Skipped ${totalInvalidAverages} missing/invalid average${totalInvalidAverages === 1 ? "" : "s"}`);
  }
  if (metadataFailureCount > 0) {
    lines.push(
      `Skipped ${metadataFailureCount} result${metadataFailureCount === 1 ? "" : "s"} — competition details unavailable`
    );
  }
  if (conflictCount > 0) {
    lines.push(`Conflicts: ${conflictCount}`);
  }
  return lines;
}

function ImportSummary({ summary }) {
  const {
    createdCount,
    updatedCount,
    alreadyImportedCount,
    duplicateCount,
    conflictCount,
    unsupportedEventCount,
    noAverageCount,
    dnfOrDnsCount,
    metadataFailureCount,
    conflicts,
  } = summary;
  const totalSkipped =
    alreadyImportedCount + duplicateCount + unsupportedEventCount + noAverageCount + dnfOrDnsCount + metadataFailureCount;

  if (createdCount === 0 && updatedCount === 0 && totalSkipped === 0 && conflictCount === 0) {
    return (
      <div role="status" style={{ fontSize: "0.85rem", color: "var(--text-faint)" }}>
        No 2x2x2–5x5x5 results found for this WCA ID.
      </div>
    );
  }

  return (
    <div role="status" style={{ fontSize: "0.85rem", color: "var(--text)", display: "flex", flexDirection: "column", gap: 6 }}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
        {buildSummaryLines(summary).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {conflictCount > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--warning)" }}>
          {conflicts.map(({ candidate, reason }) => (
            <li key={`${candidate.wcaCompetitionId}-${candidate.event}`}>
              {candidate.competitionName} ({candidate.event}, {fmtSeconds(candidate.averageMs)}) — {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const WcaImport = ({ competitions, addCompetitionResult, updateCompetitionResult }) => {
  const [wcaId, setWcaId] = useState("");
  const { status, summary, errorMessage, runImport } = useWcaImport({
    competitions,
    addCompetitionResult,
    updateCompetitionResult,
  });
  const inputId = useId();
  const errorId = useId();

  const handleSubmit = (e) => {
    e.preventDefault();
    runImport(wcaId);
  };

  return (
    <div className="section-card">
      <div className="section-title">Import from WCA</div>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 10 }}>
        For each competition and event, CubeBox imports the final/deepest WCA round result.
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="form-field" style={{ flex: "1 1 200px" }}>
          <label className="form-label" htmlFor={inputId}>WCA ID</label>
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
          {status === "loading" ? "Importing…" : "Import"}
        </button>
      </form>
      <div aria-live="polite" style={{ marginTop: 10 }}>
        {status === "error" && (
          <span className="form-error" id={errorId} role="alert">{errorMessage}</span>
        )}
        {status === "success" && summary && <ImportSummary summary={summary} />}
      </div>
    </div>
  );
};

export default WcaImport;
