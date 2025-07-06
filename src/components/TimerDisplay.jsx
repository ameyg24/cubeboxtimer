import React from "react";
import "./TimerDisplay.css";

const TimerDisplay = () => {
  return (
    <div className="timer-display">
      <div className="timer-digits">0.00</div>
      <div className="timer-averages">
        <div>ao5: -</div>
        <div>ao12: -</div>
      </div>
    </div>
  );
};

export default TimerDisplay;
