// WCA-compliant timer: renders the running time and reports the final solve.
import React, { useState, useRef, useEffect } from "react";

const Timer = ({
  onSolveComplete,
  setTimerRunning,
  hideStartButton,
  showMainButtons,
  startSignal,
  pendingPenalty,
  inspectionActive,
}) => {
  const [displayTime, setDisplayTime] = useState(0); // ms
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false); // true if just stopped
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const prevStartSignal = useRef(startSignal);

  // Accurate timer using performance.now()
  const startTimer = () => {
    // If inspection still active, do not start (safety)
    if (inspectionActive) return;
    setRunning(true);
    runningRef.current = true;
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
    setTimerRunning && setTimerRunning(false);
    onSolveComplete({ millis: Math.round(elapsed), penalty: pendingPenalty || null });
    // Do not reset displayTime here; keep until next start
  };

  // Spacebar: only handle stop when timer is running
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Space" && !e.repeat && runningRef.current) {
        e.preventDefault();
        stopTimer();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Color logic using CSS variables
  let timerColor = "var(--text)";
  if (running) timerColor = "var(--success)";
  else if (stopped) timerColor = "var(--danger)";

  return (
    <div
      className="timer"
      id="main-timer"
      tabIndex={0}
      style={{ background: "transparent", boxShadow: "none", border: "none" }}
    >
      <div className="timer-value" style={{ color: timerColor, transition: "color 0.15s" }}>
        {(displayTime / 1000).toFixed(2)}
      </div>
      {/* Only show Start/Stop button if hideStartButton and showMainButtons are NOT true */}
      {(!hideStartButton && !showMainButtons) && (
        <button
          className={running ? "timer-stop" : "timer-start"}
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
