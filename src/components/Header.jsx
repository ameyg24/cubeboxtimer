import React, { useState } from "react";
import "./Header.css";
import { useAuth } from "./AuthContext.jsx";

const Header = ({
  scrambleType,
  setScrambleType,
  cubeDimension,
  setCubeDimension,
  scrambles = [],
  selectedScrambleIdx = 0,
  setSelectedScrambleIdx = () => {},
  sessions = [],
  activeSessionId,
  setActiveSessionId = () => {},
  addSession = () => {},
  removeSession = () => {},
  sidebarOpen,
  setSidebarOpen,
  onShowSettings = () => {},
  onShowProfile = () => {},
  showSessionPlaceholder = false,
}) => {
  const { user, login, logout } = useAuth();

  const handlePrev = () => {
    setSelectedScrambleIdx((idx) => (idx > 0 ? idx - 1 : scrambles.length - 1));
  };
  const handleNext = () => {
    setSelectedScrambleIdx((idx) => (idx < scrambles.length - 1 ? idx + 1 : 0));
  };

  return (
    <header
      className="header-bar"
      style={{ boxShadow: "0 2px 12px #ffd6df", marginBottom: 24 }}
    >
      <div
        className="header-left"
        style={{ gap: 12, display: "flex", alignItems: "center" }}
      >
        <button
          className="icon-btn"
          title="Menu"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect y="3" width="20" height="2" rx="1" fill="currentColor" />
            <rect y="9" width="20" height="2" rx="1" fill="currentColor" />
            <rect y="15" width="20" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>
        <div
          className="logo"
          style={{
            background: "linear-gradient(90deg,#ff4081 0%,#1a73e8 100%)",
            color: "#fff",
            fontSize: "1.3rem",
            fontWeight: 800,
            padding: "0.1rem 1rem",
            borderRadius: 6,
            letterSpacing: "1.2px",
            boxShadow: "0 2px 8px #ffd6df",
            marginLeft: 12,
            marginRight: 18,
          }}
        >
          CubeBoxTimer
        </div>
      </div>
      <div className="scramble-controls" style={{ gap: 12, marginRight: 24 }}>
        <select
          className="scramble-type"
          value={scrambleType}
          onChange={(e) => setScrambleType(e.target.value)}
          style={{
            background: "linear-gradient(90deg,#ffecb3 0%,#ffd6df 100%)",
            color: "#d84315",
            fontWeight: 700,
            border: "2px solid #ff4081",
            borderRadius: 8,
            padding: "0.3rem 0.9rem",
            fontSize: "1.1rem",
            marginRight: 8,
          }}
        >
          {["WCA", "Other"].map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          className="scramble-type"
          value={cubeDimension}
          onChange={(e) => setCubeDimension(e.target.value)}
          style={{
            background: "linear-gradient(90deg,#b3e5fc 0%,#e1bee7 100%)",
            color: "#1a237e",
            fontWeight: 700,
            border: "2px solid #1a73e8",
            borderRadius: 8,
            padding: "0.3rem 0.9rem",
            fontSize: "1.1rem",
          }}
        >
          {["2x2x2", "3x3x3", "4x4x4", "5x5x5"].map((dim) => (
            <option key={dim} value={dim}>
              {dim}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          className="icon-btn"
          onClick={handlePrev}
          title="Previous scramble"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M13 16L7 10L13 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div
          className="scramble-string"
          style={{
            fontSize: "1.2rem",
            fontFamily: "monospace",
            fontWeight: 700,
            background: "#e3f2fd",
            color: "#1a73e8",
            borderRadius: 4,
            padding: "4px 10px",
            border: "1.5px solid #1a73e8",
            minWidth: 0,
            maxWidth: "60vw",
            overflowWrap: "break-word",
            textAlign: "center",
          }}
        >
          Scramble {selectedScrambleIdx + 1}:{" "}
          {scrambles[selectedScrambleIdx] || ""}
        </div>
        <button className="icon-btn" onClick={handleNext} title="Next scramble">
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M7 4L13 10L7 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div
        className="header-right"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginLeft: 24,
        }}
      >
        <select
          value={activeSessionId}
          onChange={(e) => setActiveSessionId(Number(e.target.value))}
          style={{
            fontWeight: "bold",
            fontSize: "1.1rem",
            borderRadius: 6,
            border: "1.5px solid #1a73e8",
            padding: "0.3rem 0.7rem",
            background: "#fff",
            color: "#1a73e8",
            marginRight: 8,
          }}
          disabled={showSessionPlaceholder}
        >
          {showSessionPlaceholder ? (
            <option value="" disabled>
              No sessions yet
            </option>
          ) : (
            sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))
          )}
        </select>
        <button
          className="icon-btn"
          onClick={addSession}
          title="Add Session"
          style={{ color: "#43a047", borderColor: "#43a047" }}
        >
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={() => removeSession(activeSessionId)}
          title="Delete Session"
          disabled={sessions.length === 1 || showSessionPlaceholder}
          style={{
            color: "#e53935",
            borderColor: "#e53935",
            opacity: sessions.length === 1 || showSessionPlaceholder ? 0.5 : 1,
          }}
        >
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </button>
        {user ? (
          <>
            <span style={{ marginRight: 12, fontWeight: 500, color: "#222" }}>
              {user.displayName || user.email}
            </span>
            <button className="icon-btn" onClick={logout} title="Logout">
              <span role="img" aria-label="logout">
                🚪
              </span>
            </button>
            <button
              className="icon-btn"
              onClick={onShowProfile}
              title="Profile"
            >
              <span role="img" aria-label="profile">
                👤
              </span>
            </button>
          </>
        ) : (
          <button className="icon-btn" onClick={login} title="Sign in">
            <span role="img" aria-label="login">
              🔑 Login
            </span>
          </button>
        )}
        <button className="icon-btn" title="Settings" onClick={onShowSettings}>
          <span role="img" aria-label="settings">
            ⚙️
          </span>
        </button>
      </div>
    </header>
  );
};

export default Header;
