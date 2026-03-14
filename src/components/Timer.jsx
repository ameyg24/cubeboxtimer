// Timer.js - WCA-compliant timer component (DEPRECATED)
// This file is no longer needed and should be removed to avoid confusion and import errors.
// Timer.jsx is now the correct file for the Timer component.

import React, { useState, useRef, useEffect } from "react";

const Timer = ({
  onSolveComplete,
  timerRunning,
  setTimerRunning,
  hideStartButton,
  showMainButtons,
  scramble,
  startSignal,
  pendingPenalty,
  inspectionActive,
  onSpacePressIdle,
}) => {
  const [displayTime, setDisplayTime] = useState(0); // ms
  const [running, setRunning] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [stopped, setStopped] = useState(false); // true if just stopped
  const [idle, setIdle] = useState(true); // true if not running or stopped
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const [pendingStart, setPendingStart] = useState(false); // for spacebar release logic
  const prevStartSignal = useRef(startSignal);

  // Accurate timer using performance.now()
  const startTimer = () => {
    // If inspection still active, do not start (safety)
    if (inspectionActive) return;
    setRunning(true);
    runningRef.current = true;
    setIdle(false);
    setStopped(false);
    setTimerRunning && setTimerRunning(true);
    startTimeRef.current = performance.now();
    setDisplayTime(0);
    rafRef.current = requestAnimationFrame(updateTime);
  };

  const updateTime = () => {
    if (!runningRef.current) return;
    const now = performance.now();
    setDisplayTime(now - startTimeRef.current);
    rafRef.current = requestAnimationFrame(updateTime);
  };

  const stopTimer = () => {
    setRunning(false);
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const endTime = performance.now();
    const elapsed = endTime - startTimeRef.current;
    setDisplayTime(elapsed);
    setStopped(true);
    setIdle(false);
    setTimerRunning && setTimerRunning(false);
    onSolveComplete({ millis: Math.round(elapsed), penalty: pendingPenalty || null });
    // Do not reset displayTime here; keep until next start
  };

  // Listen for spacebar globally (start on release, not press)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Space" && !e.repeat) {
        if (inspectionActive) return;
        e.preventDefault();
        if (!runningRef.current && !pendingStart) {
          if (onSpacePressIdle) {
            onSpacePressIdle();
          } else {
            setPendingStart(true);
          }
        } else if (runningRef.current) {
          stopTimer();
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === "Space") {
        if (inspectionActive) return; 
        if (pendingStart && !runningRef.current) {
          setPendingStart(false);
          startTimer();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [pendingStart, inspectionActive, onSpacePressIdle]);

  // Start timer if startSignal changes
  useEffect(() => {
    if (startSignal !== undefined && startSignal !== prevStartSignal.current) {
      prevStartSignal.current = startSignal;
      if (!runningRef.current) {
        startTimer();
      }
    }
  }, [startSignal, inspectionActive]);

  useEffect(() => {
    setShowInstructions(true);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Reset timer to idle state when user starts again
  useEffect(() => {
    if (running) {
      setIdle(false);
      setStopped(false);
    } else if (!running && !stopped) {
      setIdle(true);
    }
  }, [running, stopped]);

  // Color logic using CSS variables
  let timerColor = "var(--text)";
  if (running) timerColor = "var(--success)";
  else if (stopped) timerColor = "var(--danger)";

  return (
    <div
      className="timer"
      id="main-timer"
      tabIndex={0}
      style={{ outline: "none", background: "transparent", boxShadow: "none", border: "none" }}
    >
      <h1 style={{ color: timerColor, transition: "color 0.15s" }}>
        {(displayTime / 1000).toFixed(2)}
      </h1>
      {/* Only show Start/Stop button if hideStartButton and showMainButtons are NOT true */}
      {(!hideStartButton && !showMainButtons) && (
        <button
          onClick={running ? stopTimer : startTimer}
          style={{ marginTop: "1.5rem" }}
          aria-label={running ? "Stop timer" : "Start timer"}
        >
          {running ? "Stop" : "Start"}
        </button>
      )}
      <div className="timer-instructions" style={{ opacity: running ? 0 : 1, transition: "opacity 0.2s" }}>
        {stopped ? "Space · click Start for next solve" : "Hold Space then release to start"}
      </div>
    </div>
  );
};

export default Timer;
