// SolveList.js - List of solves
import React from "react";

// This file is deprecated. Use SolveList.jsx instead for the SolveList component.

const SolveList = ({ solves }) => (
  <div
    className="solve-list"
    style={{
      background: "#fff",
      borderRadius: 14,
      boxShadow: "0 2px 12px #e3e3e3",
      padding: "1.5rem 1.5rem 1.2rem 1.5rem",
      width: "100%",
      maxWidth: 700,
      marginBottom: "1.5rem",
    }}
  >
    <h3
      style={{
        marginTop: 0,
        marginBottom: "1.2rem",
        fontWeight: 700,
        fontSize: "1.5rem",
        color: "#1a73e8",
        letterSpacing: "0.5px",
      }}
    >
      Solves
    </h3>
    <ul style={{ paddingLeft: "1.2rem", margin: 0, width: "100%" }}>
      {[...solves].reverse().map((s, i) => (
        <li
          key={solves.length - 1 - i}
          style={{
            marginBottom: "0.5rem",
            fontSize: "1.13rem",
            fontWeight: 500,
            color: "#222",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ color: "#ff4081", fontWeight: 700, minWidth: 38 }}>
            #{solves.length - i}
          </span>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "1.18rem",
              color: "#1a73e8",
              minWidth: 80,
            }}
          >
            {(s / 1000).toFixed(2)}s
          </span>
        </li>
      ))}
    </ul>
  </div>
);

export default SolveList;
