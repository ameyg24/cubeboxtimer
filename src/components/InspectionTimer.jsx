import React, { useState, useEffect, useRef } from "react";

/**
 * WCA-style Inspection Timer
 */
export default function InspectionTimer({
  seconds = 15,
  onInspectionEnd,
  onPenalty,
  visible = false,
  onCancel,
}) {
  const [remaining, setRemaining] = useState(seconds);
  const [penalty, setPenalty] = useState(null); // null | "+2" | "DNF"
  const [active, setActive] = useState(false);
  const [warning, setWarning] = useState(0); // 0: none, 1: 8s, 2: 12s
  const timerRef = useRef();
  const startTimeRef = useRef();

  useEffect(() => {
    if (!visible) {
      setActive(false);
      setRemaining(seconds);
      setPenalty(null);
      setWarning(0);
      clearInterval(timerRef.current);
      return;
    }
    setActive(true);
    setRemaining(seconds);
    setPenalty(null);
    setWarning(0);
    startTimeRef.current = Date.now();
    
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        const newRemaining = prev - 1;
        const elapsed = seconds - newRemaining;
        
        // Warning at 8 seconds
        if (elapsed >= 8 && warning < 1) setWarning(1);
        // Warning at 12 seconds  
        if (elapsed >= 12 && warning < 2) setWarning(2);
        
        // At 15 seconds (0 remaining), apply +2 penalty
        if (newRemaining <= 0 && newRemaining > -2 && penalty !== "+2") {
          setPenalty("+2");
          if (onPenalty) onPenalty("+2");
        }
        
        // At 17 seconds (-2 remaining), force DNF and auto-record
        if (newRemaining <= -2) {
          clearInterval(timerRef.current);
          setPenalty("DNF");
          if (onPenalty) onPenalty("DNF");
          // Auto-record DNF when inspection time expires
          setTimeout(() => {
            if (onInspectionEnd) onInspectionEnd("DNF");
            setActive(false);
          }, 100);
          return -2;
        }
        
        return newRemaining;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line
  }, [visible, seconds]);

  // Call this when user starts solve (before inspection ends)
  const handleStartSolve = () => {
    if (!active) return;
    
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    let penaltyToApply = null;
    if (elapsed > seconds && elapsed <= seconds + 2) penaltyToApply = "+2";
    if (elapsed > seconds + 2) penaltyToApply = "DNF";
    
    setPenalty(penaltyToApply);
    if (onPenalty) onPenalty(penaltyToApply);
    if (onInspectionEnd) onInspectionEnd(penaltyToApply);
    setActive(false);
    clearInterval(timerRef.current);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "1.2rem 2rem",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        boxShadow: "var(--shadow-md)",
        minWidth: 260,
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Inspection</span>
        <span style={{ fontSize: 36, fontWeight: 700, fontFamily: "monospace", color: penalty === "DNF" ? "var(--danger)" : penalty === "+2" ? "var(--warning)" : "var(--text)", minWidth: 48 }}>
          {remaining > 0 ? remaining : penalty === "DNF" ? "DNF" : "+2"}
        </span>
        {warning === 1 && <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--warning)" }}>8s!</span>}
        {warning === 2 && <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--danger)" }}>12s!</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleStartSolve}
          disabled={!active}
          style={{ padding: "7px 24px", fontSize: "0.95rem", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 600 }}
        >
          Start Solve
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{ padding: "7px 16px", fontSize: "0.95rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-alt)", color: "var(--danger)", cursor: "pointer", fontWeight: 500 }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
