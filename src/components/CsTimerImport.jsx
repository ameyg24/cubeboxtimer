// CsTimerImport.jsx - "Import csTimer solves" modal, next to "Add past
// solve" in SolveList.jsx. Lets the user paste or upload a csTimer
// (cstimer.net) "Export to file" download and bulk-add the parsed practice
// solves through the exact same addSolve path a single manual backfill
// uses - see useCsTimerImport.js / analytics/cstimerImport.ts for the
// parse/dedupe/persist pipeline this wraps.
import { useId, useRef, useState } from "react";
import { CUBE_DIMENSIONS } from "../hooks/useSolveSessions.js";
import { useCsTimerImport } from "../hooks/useCsTimerImport.js";
import { Modal } from "./Modal.jsx";

function ImportSummary({ summary }) {
  const { importedCount, duplicateCount, invalidRowCount } = summary;
  return (
    <div role="status" style={{ fontSize: "0.85rem", color: "var(--text)", display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
      <div>Imported {importedCount} solve{importedCount === 1 ? "" : "s"}</div>
      {duplicateCount > 0 && <div>Skipped {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"}</div>}
      {invalidRowCount > 0 && <div>Skipped {invalidRowCount} invalid row{invalidRowCount === 1 ? "" : "s"}</div>}
    </div>
  );
}

const CsTimerImportModal = ({
  titleId,
  defaultDimension,
  getExistingSolvesForDimension,
  addSolve,
  onClose,
}) => {
  const [text, setText] = useState("");
  const [dimension, setDimension] = useState(
    CUBE_DIMENSIONS.includes(defaultDimension) ? defaultDimension : CUBE_DIMENSIONS[0]
  );
  const { status, summary, errorMessage, runImport } = useCsTimerImport({
    getExistingSolvesForDimension,
    addSolve,
  });
  const fileInputRef = useRef(null);
  const dimensionId = useId();
  const textareaId = useId();
  const fileId = useId();
  const errorId = useId();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    runImport(text, dimension);
  };

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <h2 id={titleId} style={{ color: "var(--text)", marginBottom: 16, fontSize: "1.1rem", textAlign: "left" }}>
        Import csTimer Solves
      </h2>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 14, textAlign: "left" }}>
        Paste or upload the file from csTimer's Menu → Export → Export to file. Every solve found is added as a
        practice solve for the event you choose below - csTimer has no concept of official competition results, so
        nothing here ever touches your Competition Results.
      </div>
      <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
        <div className="form-field">
          <label className="form-label" htmlFor={dimensionId}>Event</label>
          <select id={dimensionId} className="ctrl" value={dimension} onChange={(e) => setDimension(e.target.value)}>
            {CUBE_DIMENSIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor={fileId}>Upload export file</label>
          <input id={fileId} type="file" accept=".txt,.json,text/plain,application/json" ref={fileInputRef} onChange={handleFileChange} />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor={textareaId}>Or paste export data</label>
          <textarea
            id={textareaId}
            className="ctrl"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'{"session1": [[[0,9481],"R U R\' U\'","",1700000000], ...]}'}
            style={{ fontFamily: "monospace", fontSize: "0.78rem", resize: "vertical" }}
            aria-invalid={status === "error"}
            aria-describedby={status === "error" ? errorId : undefined}
          />
        </div>

        {status === "error" && (
          <span className="form-error" id={errorId} role="alert">{errorMessage}</span>
        )}
        {status === "success" && summary && <ImportSummary summary={summary} />}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" className="dash-btn" onClick={onClose}>Close</button>
          <button
            type="submit"
            className="dash-btn"
            style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}
          >
            Import
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CsTimerImportModal;
