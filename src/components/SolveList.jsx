// SolveList.js - List of solves
import React from "react";

// This file is deprecated. Use SolveList.jsx instead for the SolveList component.

const SolveList = ({ solves }) => (
  <div
    className="solve-list"
    style={{
      padding: 0,
      width: "100%",
      maxWidth: 700,
      marginBottom: 0,
    }}
  >
    {/*  */}
    <ul
      style={{
        paddingLeft: 0,
        margin: 0,
        width: "100%",
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "0.7rem",
      }}
    >
      {/* Solves list removed entirely as per user request */}
    </ul>
  </div>
);

export default SolveList;
