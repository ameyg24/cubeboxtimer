import React, { useState, useEffect } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Timer from "./components/Timer.jsx";
import InspectionTimer from "./components/InspectionTimer.jsx";
import { db } from "./firebase/config";
import {
  collection,
  query,
  orderBy,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { AuthProvider, useAuth } from "./components/AuthContext.jsx";
import { ThemeProvider } from "./components/ThemeContext.jsx";
import "./App.css";
import Dashboard from "./components/Dashboard.jsx";
import SolveList from "./components/SolveList.jsx";

const SHORTCUTS = [
  { key: "Space", desc: "Start / stop timer" },
  { key: "Space (hold)", desc: "Start inspection (if enabled)" },
  { key: "Escape", desc: "Cancel inspection" },
  { key: "?", desc: "Toggle this shortcuts panel" },
];

function ShortcutsModal({ onClose }) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
        background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex",
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
    <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
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

const modalOverlayStyle = {
  position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
  background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex",
  alignItems: "center", justifyContent: "center",
};
const modalStyle = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 12, boxShadow: "var(--shadow-md)",
  padding: "2rem", minWidth: 300, maxWidth: "90vw",
  textAlign: "center", position: "relative",
};
const modalCloseStyle = {
  position: "absolute", top: 12, right: 12, background: "none",
  border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted)",
};

const SCRAMBLE_TYPES = ["WCA", "Other"];
const CUBE_DIMENSIONS = ["2x2x2", "3x3x3", "4x4x4", "5x5x5"];
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
  const [solves, setSolves] = useState([]);
  // Update: solves are now per event (cubeDimension)
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [scrambleType, setScrambleType] = useState("WCA");
  const [cubeDimension, setCubeDimension] = useState("3x3x3");
  const [scrambles, setScrambles] = useState([]);
  const [selectedScrambleIdx, setSelectedScrambleIdx] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false); // NEW: track timer running state
  const [inspectionVisible, setInspectionVisible] = useState(false);
  const [pendingPenalty, setPendingPenalty] = useState(null);
  const [firestoreLoading, setFirestoreLoading] = useState(false);
  const { user } = useAuth();
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

  // Prevent continuous refresh: only sync sessions after initial load
  const didLoadSessions = React.useRef(false);

  useEffect(() => {
    if (!user) {
      // Try to load from localStorage ONCE on mount only
      if (!didLoadSessions.current) {
        const local = localStorage.getItem("cubeboxtimer_sessions");
        let loaded = null;
        try {
          loaded = local ? JSON.parse(local) : null;
        } catch (e) {
          loaded = null;
        }
        if (loaded && Array.isArray(loaded) && loaded.length > 0) {
          setSessions(loaded);
          // Restore last active session if possible
          const lastActive = localStorage.getItem("cubeboxtimer_activeSessionId");
          if (lastActive && loaded.some(s => s.id === lastActive)) {
            setActiveSessionId(lastActive);
          } else {
            setActiveSessionId(loaded[0].id);
          }
        } else {
          setSessions([
            {
              id: "local",
              name: "Session",
              solves: { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] },
              createdAt: Date.now(),
            },
          ]);
          setActiveSessionId("local");
        }
      }
      didLoadSessions.current = true;
      return;
    }
    const sessionsCol = collection(db, "users", user.uid, "sessions");
    const q = query(sessionsCol, orderBy("createdAt"));

    setFirestoreLoading(true);
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const loadedSessions = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        let solves = data.solves;
        if (!solves || Array.isArray(solves)) {
          solves = { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] };
          solves["3x3x3"] = Array.isArray(data.solves) ? data.solves : [];
        }
        loadedSessions.push({
          id: docSnap.id,
          name: data.name,
          solves,
          createdAt: data.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : Date.now(),
        });
      });
      didLoadSessions.current = true;
      setFirestoreLoading(false);
      setSessions(loadedSessions);
      setActiveSessionId((prev) =>
        prev && loadedSessions.some((s) => s.id === prev)
          ? prev
          : loadedSessions[0]?.id || ""
      );
    });
    return () => unsubscribe();
  }, [user]);

  // Persist sessions and active session id to localStorage on any change (if not logged in)
  useEffect(() => {
    if (!user) {
      localStorage.setItem("cubeboxtimer_sessions", JSON.stringify(sessions));
      localStorage.setItem("cubeboxtimer_activeSessionId", activeSessionId);
    }
  }, [sessions, activeSessionId, user]);

  // Add session: also create in Firestore if logged in
  const addSession = async () => {
    // Find the next available unique session number
    const existingNames = new Set(sessions.map((s) => s.name));
    let num = 1;
    let newName = `Session ${sessions.length + 1}`;
    while (existingNames.has(newName)) {
      num++;
      newName = `Session ${num}`;
    }
    const newId = Date.now().toString();
    const newSession = {
      id: newId,
      name: newName,
      solves: { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] },
      createdAt: Date.now(),
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
    if (user) {
      const sessionsCol = collection(db, "users", user.uid, "sessions");
      await setDoc(doc(sessionsCol, newId), {
        name: newSession.name,
        solves: newSession.solves,
        createdAt: serverTimestamp(),
      });
    }
  };

  // Remove session: also delete from Firestore if logged in
  const removeSession = async (id) => {
    if (sessions.length === 1) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id && sessions.length > 1) {
      setActiveSessionId(sessions[0].id);
    }
    if (user) {
      const sessionsCol = collection(db, "users", user.uid, "sessions");
      await deleteDoc(doc(sessionsCol, id));
    }
  };

  // --- END SESSION LOGIC ---

  // Ensure didLoadSessions is set to true on mount (fixes persistence bug)
  useEffect(() => {
    if (!user && !didLoadSessions.current) {
      didLoadSessions.current = true;
    }
  }, [user]);

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
        solveObj = { millis: 0, penalty: "DNF", reviewed: false, id: Date.now() };
      } else {
        return;
      }
    } else {
      let explicitPenalty = (typeof time === "object" && time !== null) ? time.penalty : undefined;
      const finalPenalty = explicitPenalty === undefined || explicitPenalty === null ? pendingPenalty : explicitPenalty;
      solveObj = {
        millis,
        penalty: finalPenalty || null,
        reviewed: (typeof time === "object" && time !== null ? time.reviewed : false) ?? false,
        id: (typeof time === "object" && time !== null ? time.id : undefined) ?? Date.now(),
      };
    }
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

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              solves: {
                ...s.solves,
                [cubeDimension]: [...(s.solves[cubeDimension] || []), solveObj],
              },
            }
          : s
      )
    );
    setTimerRunning(false);
    setPendingPenalty(null); // Clear after use
  };

  // Get solves for current event (all), and valid solves (for stats/count)
  const activeSession = sessions.find((s) => s.id === activeSessionId) ||
    sessions[0] || { solves: { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] } };
  const eventSolves = activeSession.solves[cubeDimension] || [];

  // Aggregate all solves across all sessions for all-time stats (per event)
  const allSolves = sessions.flatMap((s) =>
    Array.isArray(s.solves?.[cubeDimension]) ? s.solves[cubeDimension] : []
  );

  const lastAo5 = (() => {
    if (eventSolves.length < 5) return null;
    const slice = eventSolves.slice(-5);
    const dnfCount = slice.filter(s => s.penalty === "DNF").length;
    if (dnfCount >= 2) return "DNF";
    const ts = slice.filter(s => s.penalty !== "DNF").map(s => (s.millis + (s.penalty === "+2" ? 2000 : 0)) / 1000).sort((a, b) => a - b).slice(1, -1);
    return ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null;
  })();

  // Delete a solve by index (local and Firestore)
  const deleteSolve = async (idx) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              solves: {
                ...s.solves,
                [cubeDimension]: s.solves[cubeDimension].filter((_, i) => i !== idx),
              },
            }
          : s
      )
    );
    if (user) {
      const sessionsCol = collection(db, "users", user.uid, "sessions");
      const session = sessions.find((s) => s.id === activeSessionId);
      if (session) {
        const newSolves = { ...session.solves };
        newSolves[cubeDimension] = newSolves[cubeDimension].filter((_, i) => i !== idx);
        await setDoc(doc(sessionsCol, activeSessionId), { solves: newSolves }, { merge: true });
      }
    }
  };

  // Helper to update a solve (local and Firestore)
  const updateSolve = async (idx, patch) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              solves: {
                ...s.solves,
                [cubeDimension]: s.solves[cubeDimension].map((solve, i) =>
                  i === idx ? { ...solve, ...patch } : solve
                ),
              },
            }
          : s
      )
    );
    if (user) {
      const sessionsCol = collection(db, "users", user.uid, "sessions");
      const sessionRef = doc(sessionsCol, activeSessionId);
      const session = sessions.find((s) => s.id === activeSessionId);
      if (session) {
        const newSolves = session.solves;
        newSolves[cubeDimension] = newSolves[cubeDimension].map((solve, i) =>
          i === idx ? { ...solve, ...patch } : solve
        );
        await setDoc(sessionRef, { solves: newSolves }, { merge: true });
      }
    }
  };

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
        scrambles={scrambles}
        selectedScrambleIdx={selectedScrambleIdx}
        setSelectedScrambleIdx={setSelectedScrambleIdx}
        sessions={sessions}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        addSession={addSession}
        removeSession={removeSession}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        onShowSettings={() => setShowSettings(true)}
        onShowProfile={() => setShowProfile(true)}
        showSessionPlaceholder={sessions.length === 0}
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
        {sidebarOpen && !timerRunning && (
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            setActiveSessionId={setActiveSessionId}
            addSession={addSession}
            removeSession={removeSession}
            solves={eventSolves}
            sidebarOpen={sidebarOpen}
          />
        )}
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
          <div
            className="timer-area"
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              flex: "0 0 340px",
              minHeight: 340,
              margin: 0,
              padding: "2rem 0 1.5rem 0",
              position: "relative",
              gap: 16,
              background: timerRunning ? "rgba(22, 163, 74, 0.04)" : undefined,
              transition: "background 0.4s",
            }}
          >
            {/* Only show Start button (no Start Inspection) when timer is not running, inspection is not visible, and timer is reset (0.00) */}
            {!timerRunning && !inspectionVisible && scrambles[selectedScrambleIdx] && (
              <div style={{ display: "flex", flexDirection: "row", gap: 16, position: "absolute", left: "50%", top: "65%", transform: "translate(-50%, -50%)", zIndex: 10 }}>
                <button
                  style={{
                    padding: "9px 28px",
                    fontSize: "1rem",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                  }}
                  onClick={() => {
                    if (inspectionModeEnabled) {
                      setInspectionVisible(true);
                    } else {
                      setPendingPenalty(null);
                      setStartSignal((s) => s + 1);
                      setTimerRunning(true);
                    }
                  }}
                >
                  Start
                </button>
              </div>
            )}
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
              onSpacePressIdle={inspectionModeEnabled && spaceStartsInspection ? () => setInspectionVisible(true) : undefined}
            />
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
          {!timerRunning && (
            <div
              style={{
                flex: 1,
                width: "100%",
                display: "flex",
                flexDirection: "row",
                alignItems: "stretch",
                justifyContent: "space-between",
                gap: "2.5rem",
                padding: "0 2vw 2vw 2vw",
                boxSizing: "border-box",
                height: "100%",
                maxWidth: "100vw",
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
