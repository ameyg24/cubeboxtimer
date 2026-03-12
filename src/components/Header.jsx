import { useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { useTheme } from "./ThemeContext.jsx";
import "./Header.css";

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
  sessionBestMs = null,
}) => {
  const { user, login, logout } = useAuth();
  const { dark, toggleDark } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopyScramble = () => {
    const scramble = scrambles[selectedScrambleIdx];
    if (!scramble) return;
    navigator.clipboard.writeText(scramble).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handlePrev = () =>
    setSelectedScrambleIdx((i) => (i > 0 ? i - 1 : scrambles.length - 1));
  const handleNext = () =>
    setSelectedScrambleIdx((i) => (i < scrambles.length - 1 ? i + 1 : 0));

  return (
    <header className="header-bar">
      {/* Left */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
        <button className="icon-btn" onClick={() => setSidebarOpen((o) => !o)} title="Menu">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect y="2" width="16" height="1.5" rx="0.75" />
            <rect y="7.25" width="16" height="1.5" rx="0.75" />
            <rect y="12.5" width="16" height="1.5" rx="0.75" />
          </svg>
        </button>
        <span className="logo">CubeBoxTimer</span>

        <select
          className="ctrl"
          value={cubeDimension}
          onChange={(e) => setCubeDimension(e.target.value)}
        >
          {["2x2x2", "3x3x3", "4x4x4", "5x5x5"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <select
          className="ctrl"
          value={scrambleType}
          onChange={(e) => setScrambleType(e.target.value)}
        >
          {["WCA", "Other"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Center — scramble */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "center", minWidth: 0 }}>
        <button className="icon-btn" onClick={handlePrev} title="Previous scramble">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 11L5 7l4-4" />
          </svg>
        </button>
        <span className="scramble-string">
          {scrambles[selectedScrambleIdx] || ""}
        </span>
        {scrambles[selectedScrambleIdx] && (
          <span style={{ fontSize: "0.72rem", color: "var(--text-faint)", fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap" }}>
            {scrambles[selectedScrambleIdx].split(" ").filter(Boolean).length}M
          </span>
        )}
        <button
          className="icon-btn"
          onClick={handleCopyScramble}
          title="Copy scramble"
          style={{ color: copied ? "var(--success)" : undefined, fontSize: "0.75rem", padding: "4px 7px" }}
        >
          {copied ? "✓" : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
        <button className="icon-btn" onClick={handleNext} title="Next scramble">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 3l4 4-4 4" />
          </svg>
        </button>
      </div>

      {/* Right */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        {sessionBestMs !== null && (
          <span style={{
            fontSize: "0.75rem", fontWeight: 700, fontFamily: "monospace",
            background: "var(--accent-bg)", color: "var(--accent)",
            border: "1px solid var(--accent)", borderRadius: 12,
            padding: "2px 10px", letterSpacing: "0.02em",
          }} title="Session best">
            ★ {(sessionBestMs / 1000).toFixed(2)}s
          </span>
        )}
        <select
          className="ctrl"
          value={activeSessionId}
          onChange={(e) => setActiveSessionId(e.target.value)}
          disabled={showSessionPlaceholder}
        >
          {showSessionPlaceholder ? (
            <option value="" disabled>No sessions</option>
          ) : (
            sessions.map((s) => {
              const count = (s.solves?.[cubeDimension] || []).length;
              return <option key={s.id} value={s.id}>{s.name} ({count})</option>;
            })
          )}
        </select>

        <button className="icon-btn" onClick={addSession} title="New session">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
        </button>

        <button
          className="icon-btn"
          onClick={() => removeSession(activeSessionId)}
          title="Delete session"
          disabled={sessions.length <= 1 || showSessionPlaceholder}
          style={{ opacity: sessions.length <= 1 ? 0.4 : 1 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="3" x2="11" y2="11" />
            <line x1="11" y1="3" x2="3" y2="11" />
          </svg>
        </button>

        {/* Dark mode toggle */}
        <button className="icon-btn" onClick={toggleDark} title={dark ? "Light mode" : "Dark mode"}>
          {dark ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
            </svg>
          )}
        </button>

        {/* Settings */}
        <button className="icon-btn" onClick={onShowSettings} title="Settings">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>

        {/* Auth */}
        {user ? (
          <button className="icon-btn" onClick={logout} title="Sign out" style={{ fontSize: "0.8rem", padding: "4px 10px" }}>
            Sign out
          </button>
        ) : (
          <button className="icon-btn" onClick={login} title="Sign in" style={{ fontSize: "0.8rem", padding: "4px 10px", color: "var(--accent)", borderColor: "var(--accent)" }}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
