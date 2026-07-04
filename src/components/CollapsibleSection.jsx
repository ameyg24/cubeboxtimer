// CollapsibleSection.jsx - a +/- collapsible header for long sections of a
// tab, e.g. CompetitionTab's Historical Calibration and Competition Results.
// Local, uncontrolled open/closed state - no persistence, since collapsing
// something is a "get it out of my way right now" action, not a saved
// preference.
import { useId, useState } from "react";

const CollapsibleSection = ({ title, defaultOpen = true, actions, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div>
      <div
        className="dash-actions"
        style={{ justifyContent: "space-between", alignItems: "center", marginBottom: open ? "var(--space-2)" : 0 }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={contentId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            font: "inherit",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 18,
              height: 18,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              fontWeight: 700,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {open ? "−" : "+"}
          </span>
          <span className="section-title" style={{ marginBottom: 0 }}>{title}</span>
        </button>
        {actions}
      </div>
      {open && <div id={contentId}>{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
