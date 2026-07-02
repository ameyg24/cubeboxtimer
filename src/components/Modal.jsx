import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Shared dialog shell: traps Tab focus while open, moves focus in on mount,
// restores it to whatever triggered the modal on close, and closes on Escape
// or a click on the overlay itself.
export function Modal({ titleId, onClose, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const first = dialog.querySelector(FOCUSABLE_SELECTOR);
    (first || dialog).focus();

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = dialog.querySelectorAll(FOCUSABLE_SELECTOR);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} style={modalStyle} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <button onClick={onClose} style={modalCloseStyle} aria-label="Close">×</button>
        {children}
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
  background: "var(--overlay)", zIndex: 2000, display: "flex",
  alignItems: "center", justifyContent: "center",
};
const modalStyle = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)",
  padding: "2rem", minWidth: 300, maxWidth: "90vw",
  textAlign: "center", position: "relative",
};
const modalCloseStyle = {
  position: "absolute", top: 12, right: 12, background: "none",
  border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted)",
};
