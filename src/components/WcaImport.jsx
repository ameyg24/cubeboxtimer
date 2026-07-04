// WcaImport.jsx - "Import from WCA" controls, shown near Competition
// Results in the Competition tab. All fetch/convert/dedupe orchestration
// lives in useWcaImport (src/hooks) and the pure analytics/wcaImport.ts
// module — this file only renders the form and the resulting status/summary.
import { useId, useMemo, useState } from "react";
import { WCA_ID_EXAMPLE, findLinkedWcaId } from "../analytics";
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
            <li key={`${candidate.wcaCompetitionId}-${candidate.event}-${candidate.wcaRoundId}`}>
              {candidate.competitionName} ({candidate.event}, {candidate.roundLabel}, {fmtSeconds(candidate.averageMs)}) — {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Shown in place of the summary while an import is running - real progress
// once competition metadata requests start, since that phase alone can take
// a couple of minutes on accounts with many competitions (WCA rate-limits
// the metadata lookup, see wcaApi.js's createRateLimitState).
function ImportProgress({ progress }) {
  if (!progress) {
    return (
      <div role="status" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Fetching your WCA results…
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
        aria-label="Import progress"
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

// Bulk-remove every previously imported result (across all events, not just
// the currently selected one) - the only way to free up the WCA ID lock
// below for a different competitor. Mirrors CompetitionFormModal's
// click-twice conflict confirmation rather than adding a new modal-based
// confirm pattern to the app: a first click arms it and shows what's about
// to happen, a second click actually deletes.
function DeleteImportedResults({ importedResults, linkedWcaId, deleteCompetitionResult }) {
  const [confirming, setConfirming] = useState(false);

  if (importedResults.length === 0) return null;

  const handleClick = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    importedResults.forEach((c) => deleteCompetitionResult(c.id));
    setConfirming(false);
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <button
        type="button"
        className="dash-btn"
        style={{ color: "var(--danger)" }}
        onClick={handleClick}
      >
        {confirming ? "Click again to permanently delete" : "Delete all imported results"}
      </button>
      {confirming ? (
        <span className="form-error" role="alert" style={{ marginLeft: 8 }}>
          This removes all {importedResults.length} imported result{importedResults.length === 1 ? "" : "s"} across
          every event and unlinks WCA ID {linkedWcaId}.
        </span>
      ) : (
        <span style={{ marginLeft: 8, fontSize: "0.8rem", color: "var(--text-muted)" }}>
          {importedResults.length} imported result{importedResults.length === 1 ? "" : "s"} across all events.
        </span>
      )}
    </div>
  );
}

const WcaImport = ({ competitions, addCompetitionResult, updateCompetitionResult, deleteCompetitionResult }) => {
  const [wcaId, setWcaId] = useState("");
  const { status, summary, errorMessage, progress, runImport } = useWcaImport({
    competitions,
    addCompetitionResult,
    updateCompetitionResult,
  });
  const inputId = useId();
  const errorId = useId();

  // Once any result has been imported, every subsequent import is locked to
  // that same WCA ID (see analytics/wcaImport.ts's findLinkedWcaId) - mixing
  // a second competitor's results into the same history would silently
  // corrupt the prediction model. The ID field becomes read-only instead of
  // free text so there's no way to even attempt a mismatched import; the
  // hook-level check in useWcaImport.js is the actual enforcement.
  const linkedWcaId = useMemo(() => findLinkedWcaId(competitions), [competitions]);
  const importedResults = useMemo(
    () => (competitions || []).filter((c) => c.source === "wca-import"),
    [competitions]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    runImport(linkedWcaId || wcaId);
  };

  return (
    <div className="section-card">
      <div className="section-title">Import from your WCA profile</div>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 10 }}>
        For each competition and event, CubeBox imports every round you competed in.
        {linkedWcaId && " Imports are linked to the WCA ID below - delete all imported results to link a different one."}
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="form-field" style={{ flex: "1 1 200px" }}>
          <label className="form-label" htmlFor={inputId}>WCA ID</label>
          <input
            id={inputId}
            className="ctrl"
            type="text"
            placeholder={WCA_ID_EXAMPLE}
            value={linkedWcaId || wcaId}
            onChange={(e) => setWcaId(e.target.value)}
            readOnly={Boolean(linkedWcaId)}
            aria-invalid={status === "error"}
            aria-describedby={status === "error" ? errorId : undefined}
          />
          {linkedWcaId && (
            <a
              href={`https://www.worldcubeassociation.org/persons/${linkedWcaId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.75rem", marginTop: 4, display: "inline-block" }}
            >
              View WCA profile ↗
            </a>
          )}
        </div>
        <button className="dash-btn" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Importing…" : "Import"}
        </button>
      </form>
      <div aria-live="polite" style={{ marginTop: 10 }}>
        {status === "loading" && <ImportProgress progress={progress} />}
        {status === "error" && (
          <span className="form-error" id={errorId} role="alert">{errorMessage}</span>
        )}
        {status === "success" && summary && <ImportSummary summary={summary} />}
      </div>
      <DeleteImportedResults
        importedResults={importedResults}
        linkedWcaId={linkedWcaId}
        deleteCompetitionResult={deleteCompetitionResult}
      />
    </div>
  );
};

export default WcaImport;
