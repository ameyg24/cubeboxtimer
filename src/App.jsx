import { useState, useEffect, useRef } from "react";
import Header from "./components/Header";
import Timer from "./components/Timer.jsx";
import InspectionTimer from "./components/InspectionTimer.jsx";
import { AuthProvider, useAuth } from "./components/AuthContext.jsx";
import { ThemeProvider } from "./components/ThemeContext.jsx";
import { ao5 } from "./analytics";
import "./App.css";
import Dashboard from "./components/Dashboard.jsx";
import SolveList from "./components/SolveList.jsx";
import ScrambleBar from "./components/ScrambleBar.jsx";
import { useSolveSessions, createSolveId } from "./hooks/useSolveSessions.js";

const SHORTCUTS = [
  { key: "Space", desc: "Start / stop timer" },
  { key: "Space (hold)", desc: "Start inspection (if enabled)" },
  { key: "Escape", desc: "Cancel inspection" },
  { key: "?", desc: "Toggle this shortcuts panel" },
];

function ShortcutsModal({ onClose }) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "var(--overlay)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={modalStyle}>
        <button onClick={onClose} style={modalCloseStyle}>×</button>
        <h2 style={{ color: "var(--text)", marginBottom: 16, fontSize: "1.1rem", textAlign: "left" }}>Keyboard Shortcuts</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <tbody>
            {SHORTCUTS.map(({ key, desc }) => (
              <tr key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 12px 8px 0", fontFamily: "monospace", fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap", fontSize: "0.88rem" }}>{key}</td>
                <td style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: "0.88rem" }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfileModal({ user, onClose }) {
  if (!user) return null;
  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
        background: "var(--overlay)", zIndex: 2000, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={modalStyle}>
        <button onClick={onClose} style={modalCloseStyle}>×</button>
        <h2 style={{ color: "var(--accent)", marginBottom: 16, fontSize: "1.1rem" }}>Profile</h2>
        <div style={{ marginBottom: 8, color: "var(--text)" }}><b>Name:</b> {user.displayName || "Anonymous"}</div>
        <div style={{ marginBottom: 8, color: "var(--text)" }}><b>Email:</b> {user.email}</div>
        <div style={{ color: "var(--text-muted)", marginTop: 18, fontSize: "0.9rem" }}>More profile features coming soon!</div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, inspectionModeEnabled, setInspectionModeEnabled, spaceStartsInspection, setSpaceStartsInspection }) {
  const row = { display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 14, color: "var(--text)", fontSize: "0.92rem" };
  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "var(--overlay)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={modalStyle}>
        <button onClick={onClose} style={modalCloseStyle}>×</button>
        <h2 style={{ color: "var(--text)", marginBottom: 20, fontSize: "1.1rem" }}>Settings</h2>
        <label style={row}>
          <input type="checkbox" checked={inspectionModeEnabled} onChange={e => setInspectionModeEnabled(e.target.checked)} style={{ width: 16, height: 16 }} />
          WCA inspection (15s before each solve)
        </label>
        <label style={{ ...row, opacity: inspectionModeEnabled ? 1 : 0.4, pointerEvents: inspectionModeEnabled ? "auto" : "none" }}>
          <input type="checkbox" checked={spaceStartsInspection} onChange={e => setSpaceStartsInspection(e.target.checked)} style={{ width: 16, height: 16 }} disabled={!inspectionModeEnabled} />
          Space bar starts inspection
        </label>
      </div>
    </div>
  );
}

const modalStyle = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)",
  padding: "2rem", minWidth: 300, maxWidth: "90vw",
  textAlign: "center", position: "relative",
};
const modalCloseStyle = {
  position: "absolute", top: 12, right: 12, background: "none",
  border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted)",
};

const SCRAMBLE_TYPES = ["WCA", "Other"];

function generateScramble(type, dimension) {
  // Simple scramble generator for demo; replace with a real one for production
  const moves = {
    "2x2x2": ["R", "U", "F", "L", "D", "B"],
    "3x3x3": ["R", "U", "F", "L", "D", "B"],
    "4x4x4": ["Rw", "Uw", "Fw", "Lw", "Dw", "Bw", "R", "U", "F", "L", "D", "B"],
    "5x5x5": [
      "3Rw",
      "3Uw",
      "3Fw",
      "3Lw",
      "3Dw",
      "3Bw",
      "Rw",
      "Uw",
      "Fw",
      "Lw",
      "Dw",
      "Bw",
      "R",
      "U",
      "F",
      "L",
      "D",
      "B",
    ],
  };
  const len = dimension === "2x2x2" ? 9 : dimension === "3x3x3" ? 20 : 40;
  const scrambleMoves = moves[dimension] || moves["3x3x3"];
  let scramble = [];
  let last = "";
  for (let i = 0; i < len; i++) {
    let move;
    do {
      move = scrambleMoves[Math.floor(Math.random() * scrambleMoves.length)];
    } while (move[0] === last[0]);
    last = move;
    scramble.push(move + ["", "'", "2"][Math.floor(Math.random() * 3)]);
  }
  return scramble.join(" ");
}


function App() {
  const [scrambleType, setScrambleType] = useState("WCA");
  const [cubeDimension, setCubeDimension] = useState("3x3x3");
  const [scrambles, setScrambles] = useState([]);
  const [selectedScrambleIdx, setSelectedScrambleIdx] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false); // NEW: track timer running state
  const [inspectionVisible, setInspectionVisible] = useState(false);
  const [pendingPenalty, setPendingPenalty] = useState(null);
  const { user } = useAuth();
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    eventSolves,
    allSolves,
    firestoreLoading,
    syncStatus,
    addSession,
    removeSession,
    addSolve,
    deleteSolve,
    updateSolve,
  } = useSolveSessions({ user, cubeDimension });
  const [startSignal, setStartSignal] = useState(0); // for external start
  const [lastSolveIsPB, setLastSolveIsPB] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [inspectionModeEnabled, setInspectionModeEnabled] = useState(() => {
    const local = localStorage.getItem("cubeboxtimer_inspectionModeEnabled");
    return local === null ? true : local === "true";
  });
  const [spaceStartsInspection, setSpaceStartsInspection] = useState(() => {
    const local = localStorage.getItem("cubeboxtimer_spaceStartsInspection");
    return local === null ? true : local === "true";
  });

  const inspectionStartTimeRef = useRef(null);
  const inspectionVisibleRef = useRef(false);
  const timerRunningRef = useRef(false);

  useEffect(() => {
    const newScrambles = Array.from({ length: 5 }, () =>
      generateScramble(scrambleType, cubeDimension)
    );
    setScrambles(newScrambles);
    setSelectedScrambleIdx(0);
  }, [scrambleType, cubeDimension]);

  // Update: add solve to correct event, with penalty if present
  const handleSolveComplete = async (time) => {
    let solveObj;
    let millis =
      typeof time === "number"
        ? time
        : typeof time === "object" && time !== null && typeof time.millis === "number"
        ? time.millis
        : null;
    if (millis === null || isNaN(millis)) {
      if (time && time.penalty === "DNF") {
        solveObj = { millis: 0, penalty: "DNF", reviewed: false, id: createSolveId() };
      } else {
        return;
      }
    } else {
      let explicitPenalty = (typeof time === "object" && time !== null) ? time.penalty : undefined;
      const finalPenalty = explicitPenalty === undefined || explicitPenalty === null ? pendingPenalty : explicitPenalty;
      const providedId = typeof time === "object" && time !== null ? time.id : undefined;
      solveObj = {
        millis,
        penalty: finalPenalty || null,
        reviewed: (typeof time === "object" && time !== null ? time.reviewed : false) ?? false,
        id: typeof providedId === "string" ? providedId : createSolveId(),
      };
    }
    solveObj = {
      ...solveObj,
      cubeDimension,
      localCreatedAt: solveObj.localCreatedAt || Date.now(),
    };
    // Check if this solve is a new personal best
    if (solveObj.penalty !== "DNF" && solveObj.millis > 0) {
      const currentBestMillis = eventSolves
        .filter((s) => s.penalty !== "DNF" && s.millis > 0)
        .reduce((best, s) => {
          const t = s.millis + (s.penalty === "+2" ? 2000 : 0);
          return best === null ? t : Math.min(best, t);
        }, null);
      const newTime = solveObj.millis + (solveObj.penalty === "+2" ? 2000 : 0);
      if (currentBestMillis === null || newTime < currentBestMillis) {
        setLastSolveIsPB(true);
        setTimeout(() => setLastSolveIsPB(false), 3000);
      }
    }

    addSolve(solveObj);
    setTimerRunning(false);
    setPendingPenalty(null); // Clear after use
  };

  // ao5 of the live event, mapped to the display contract this header uses:
  // null -> hidden, "DNF" -> DNF text, number -> seconds. See src/analytics.
  const lastAo5 = (() => {
    const r = ao5(eventSolves);
    if (r.status === "insufficient") return null;
    if (r.status === "dnf") return "DNF";
    return r.valueMs / 1000;
  })();

  useEffect(() => {
    localStorage.setItem("cubeboxtimer_inspectionModeEnabled", inspectionModeEnabled);
  }, [inspectionModeEnabled]);

  useEffect(() => {
    localStorage.setItem("cubeboxtimer_spaceStartsInspection", spaceStartsInspection);
  }, [spaceStartsInspection]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && e.target.tagName !== "INPUT") {
        setShowShortcuts(s => !s);
      }
      if (e.key === "Escape") setShowShortcuts(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep refs in sync so the space handler always reads fresh values
  inspectionVisibleRef.current = inspectionVisible;
  timerRunningRef.current = timerRunning;

  // Global spacebar handler: idle → inspection → solve start
  useEffect(() => {
    const startSolveFromInspection = () => {
      const elapsed = (Date.now() - inspectionStartTimeRef.current) / 1000;
      let penalty = null;
      if (elapsed > 15 && elapsed <= 17) penalty = "+2";
      if (elapsed > 17) penalty = "DNF";
      setInspectionVisible(false);
      if (penalty === "DNF") {
        setTimerRunning(false);
        handleSolveComplete({ millis: 0, penalty: "DNF", reviewed: false, id: Date.now() });
      } else {
        setPendingPenalty(penalty);
        setTimerRunning(true);
        setStartSignal(s => s + 1);
      }
    };

    const handleKeyDown = (e) => {
      if (e.code !== "Space" || e.repeat) return;
      if (timerRunningRef.current) return;
      e.preventDefault();
      if (!inspectionVisibleRef.current) {
        // Start inspection on press
        inspectionStartTimeRef.current = Date.now();
        setInspectionVisible(true);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code !== "Space") return;
      if (timerRunningRef.current) return;
      if (inspectionVisibleRef.current) {
        // Start solve on release (after inspection)
        e.preventDefault();
        startSolveFromInspection();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []); // empty deps — reads live values via refs

  return (
    <div
      className="app-container"
      style={{
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header
        scrambleType={scrambleType}
        setScrambleType={setScrambleType}
        cubeDimension={cubeDimension}
        setCubeDimension={setCubeDimension}
        sessions={sessions}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        addSession={addSession}
        removeSession={removeSession}
        onShowSettings={() => setShowSettings(true)}
        onShowProfile={() => setShowProfile(true)}
        showSessionPlaceholder={sessions.length === 0}
        syncStatus={syncStatus}
        sessionBestMs={eventSolves.filter(s => s.penalty !== "DNF" && s.millis > 0).reduce((best, s) => {
          const t = s.millis + (s.penalty === "+2" ? 2000 : 0);
          return best === null ? t : Math.min(best, t);
        }, null)}
      />
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          inspectionModeEnabled={inspectionModeEnabled}
          setInspectionModeEnabled={setInspectionModeEnabled}
          spaceStartsInspection={spaceStartsInspection}
          setSpaceStartsInspection={setSpaceStartsInspection}
        />
      )}
      {showProfile && (
        <ProfileModal user={user} onClose={() => setShowProfile(false)} />
      )}
      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
      <div
        className="main-content"
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          width: "100vw",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            justifyContent: "flex-start",
            width: "100%",
            minHeight: 0,
            height: "100%",
          }}
        >
          {!timerRunning && (
            <ScrambleBar
              scrambles={scrambles}
              selectedScrambleIdx={selectedScrambleIdx}
              setSelectedScrambleIdx={setSelectedScrambleIdx}
            />
          )}
          <div
            className="timer-area"
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              flex: "1 1 auto",
              minHeight: "44vh",
              margin: 0,
              padding: "clamp(1.5rem, 5vh, 3.25rem) 1rem",
              position: "relative",
              gap: 20,
              background: timerRunning ? "var(--timer-active-bg)" : undefined,
              transition: "background 0.4s",
            }}
          >
            {lastSolveIsPB && (
              <div style={{
                position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
                background: "var(--success)", color: "#fff", fontWeight: 700,
                fontSize: "0.9rem", padding: "4px 16px", borderRadius: 20,
                letterSpacing: "0.06em", boxShadow: "var(--shadow-md)",
                animation: "solveRowIn 0.25s ease",
                zIndex: 20,
              }}>
                PB!
              </div>
            )}
            <Timer
              key={activeSessionId + cubeDimension}
              onSolveComplete={handleSolveComplete}
              scramble={scrambles[selectedScrambleIdx] || ""}
              timerRunning={timerRunning}
              setTimerRunning={setTimerRunning}
              hideStartButton={!timerRunning ? true : false}
              showMainButtons={!timerRunning && !inspectionVisible && scrambles[selectedScrambleIdx]}
              startSignal={startSignal}
              pendingPenalty={pendingPenalty}
              inspectionActive={inspectionVisible}
            />
            {!timerRunning && !inspectionVisible && scrambles[selectedScrambleIdx] && (
              <button className="timer-start" onClick={() => setInspectionVisible(true)}>
                Start
              </button>
            )}
            {inspectionVisible && (
              <InspectionTimer
                visible={inspectionVisible}
                onInspectionEnd={(penalty) => {
                  setInspectionVisible(false);
                  setPendingPenalty(penalty);
                  if (penalty === "DNF") {
                    handleSolveComplete({ millis: 0, penalty: "DNF", reviewed: false, id: Date.now() });
                    setTimerRunning(false);
                  } else {
                    setTimerRunning(true);
                    setStartSignal((s) => s + 1);
                  }
                }}
                onPenalty={setPendingPenalty}
                seconds={15}
                onCancel={() => setInspectionVisible(false)}
              />
            )}
            {!timerRunning && lastAo5 !== null && (
              <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontFamily: "monospace", letterSpacing: "0.02em" }}>
                ao5 {lastAo5 === "DNF" ? "DNF" : lastAo5.toFixed(2) + "s"}
              </div>
            )}
          </div>
          {!timerRunning && !firestoreLoading && allSolves.length === 0 && (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
              <p className="empty-title">No solves yet</p>
              <p className="empty-sub">Your times and statistics will show up here once you finish your first solve.</p>
            </div>
          )}
          {!timerRunning && (firestoreLoading || allSolves.length > 0) && (
            <div
              className="content-row"
              style={{
                flex: "0 0 auto",
                width: "100%",
                display: "flex",
                alignItems: "stretch",
                justifyContent: "space-between",
                gap: "2rem",
                padding: "0 2vw 2rem",
                boxSizing: "border-box",
                maxWidth: 1440,
                margin: "0 auto",
              }}
            >
              <div
                style={{
                  flex: 2,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                }}
              >
                <Dashboard
                  eventSolves={eventSolves}
                  allSolves={allSolves}
                />
              </div>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                }}
              >
                {firestoreLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[1,2,3,4].map(i => (
                    <div key={i} style={{ height: 36, borderRadius: 6, background: "var(--surface-alt)", animation: "skeletonPulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
              ) : (
                <SolveList solves={eventSolves} updateSolve={updateSolve} deleteSolve={deleteSolve} />
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppWithAuthProvider() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  );
}
