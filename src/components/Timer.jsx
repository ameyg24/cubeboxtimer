// Timer.js - WCA-compliant timer component (DEPRECATED)
// This file is no longer needed and should be removed to avoid confusion and import errors.
// Timer.jsx is now the correct file for the Timer component.

import React, { useState, useRef, useEffect } from "react";

const Timer = ({
  onSolveComplete,
  timerRunning,
  setTimerRunning,
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

  // Accurate timer using performance.now()
  const startTimer = () => {
    setRunning(true);
    runningRef.current = true;
    setIdle(false);
    setStopped(false);
    setTimerRunning && setTimerRunning(true);
    startTimeRef.current = performance.now();
    setDisplayTime(0);
    rafRef.current = requestAnimationFrame(updateTime);
  };

  // Improved: show a visual countdown before timer starts
  useEffect(() => {
    if (!pendingStart) return;
    let countdown = 0;
    let interval;
    const showCountdown = () => {
      setShowInstructions(false);
      countdown = 3;
      setDisplayTime(0);
      interval = setInterval(() => {
        setDisplayTime(countdown);
        countdown--;
        if (countdown < 0) {
          clearInterval(interval);
          setShowInstructions(true);
        }
      }, 400);
    };
    showCountdown();
    return () => clearInterval(interval);
  }, [pendingStart]);

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
    setTimerRunning && setTimerRunning(false); // Return to main page
    onSolveComplete(Math.round(elapsed)); // ms
    // Do not reset displayTime here; keep until next start
  };

  // Listen for spacebar globally (start on release, not press)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        if (!runningRef.current && !pendingStart) {
          setPendingStart(true); // Wait for keyup to start
        } else if (runningRef.current) {
          stopTimer();
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === "Space") {
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
  }, [pendingStart]);

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

  // Color logic
  let timerColor = "#111";
  if (running) timerColor = "#43a047"; // green
  else if (stopped) timerColor = "#e53935"; // red
  else if (idle) timerColor = "#111"; // black

  return (
    <div
      className="timer"
      id="main-timer"
      tabIndex={0}
      style={{ outline: "none" }}
    >
      <h1 style={{ color: timerColor, transition: "color 0.2s" }}>
        {(displayTime / 1000).toFixed(2)}
      </h1>
      <button
        onClick={running ? stopTimer : startTimer}
        style={{ marginTop: "1.5rem" }}
        aria-label={running ? "Stop timer" : "Start timer"}
      >
        {running ? "Stop" : "Start"}
      </button>
      {showInstructions && (
        <div className="timer-instructions">
          Press <b>Space</b> (release) or click <b>Start</b> to begin.
          <br />
          Press <b>Space</b> or click <b>Stop</b> to stop.
        </div>
      )}
    </div>
  );
};

export default Timer;
