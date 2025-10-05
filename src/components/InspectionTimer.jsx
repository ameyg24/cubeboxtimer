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
        position: "absolute",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.25)",
        zIndex: 3000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 4px 32px #ffd6df",
          padding: "2.5rem 2.5rem 2rem 2.5rem",
          minWidth: 320,
          maxWidth: "90vw",
          textAlign: "center",
          position: "relative",
        }}
      >
        <h2 style={{ color: "#1a73e8", marginBottom: 16 }}>Inspection</h2>
        <div style={{ fontSize: 48, fontWeight: 700, color: penalty === "DNF" ? "#e53935" : penalty === "+2" ? "#ff9800" : "#222" }}>
          {remaining > 0 ? remaining : penalty === "DNF" ? "DNF" : "+2"}
        </div>
        <div style={{ margin: "18px 0 0 0", color: "#888", fontWeight: 600 }}>
          {warning === 1 && <span style={{ color: '#ff9800' }}>8s warning!</span>}
          {warning === 2 && <span style={{ color: '#e53935' }}>12s warning!</span>}
        </div>
        <div style={{ margin: "8px 0 0 0", color: "#888" }}>
          {penalty === null && "Start your solve before time runs out!"}
          {penalty === "+2" && "+2s penalty if you start now."}
          {penalty === "DNF" && "DNF: Inspection overtime."}
        </div>
        <button
          onClick={handleStartSolve}
          style={{
            marginTop: 32,
            padding: "12px 32px",
            fontSize: 20,
            borderRadius: 8,
            border: "none",
            background: "#1a73e8",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
          disabled={!active}
        >
          Start Solve
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              marginTop: 16,
              marginLeft: 16,
              padding: "8px 20px",
              fontSize: 16,
              borderRadius: 8,
              border: "none",
              background: "#eee",
              color: "#e53935",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
