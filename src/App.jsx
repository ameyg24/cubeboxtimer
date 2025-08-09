import React, { useState, useEffect } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Timer from "./components/Timer.jsx";
import InspectionTimer from "./components/InspectionTimer.jsx";
import { db } from "./firebase/config";
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  enableIndexedDbPersistence,
} from "firebase/firestore";
import { AuthProvider, useAuth } from "./components/AuthContext.jsx";
import "./App.css";
import Dashboard from "./components/Dashboard.jsx";
import SolveList from "./components/SolveList.jsx";

function ProfileModal({ user, onClose }) {
  if (!user) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.25)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 4px 32px #ffd6df",
          padding: "2.5rem 2.5rem 2rem 2.5rem",
          minWidth: 320,
          maxWidth: "90vw",
          textAlign: "center",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            fontSize: 24,
            cursor: "pointer",
            color: "#e53935",
          }}
        >
          ×
        </button>
        <h2 style={{ color: "#1a73e8", marginBottom: 16 }}>Profile</h2>
        <div style={{ fontSize: 18, marginBottom: 8 }}>
          <b>Name:</b> {user.displayName || "Anonymous"}
        </div>
        <div style={{ fontSize: 18, marginBottom: 8 }}>
          <b>Email:</b> {user.email}
        </div>
        <div style={{ fontSize: 16, color: "#888", marginTop: 18 }}>
          More profile features coming soon!
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, inspectionModeEnabled, setInspectionModeEnabled }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.25)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 4px 32px #ffd6df",
          padding: "2.5rem 2.5rem 2rem 2.5rem",
          minWidth: 320,
          maxWidth: "90vw",
          textAlign: "center",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            fontSize: 24,
            cursor: "pointer",
            color: "#e53935",
          }}
        >
          ×
        </button>
        <h2 style={{ color: "#ff4081", marginBottom: 16 }}>Settings</h2>
        <div style={{ fontSize: 16, color: "#222", margin: "18px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={inspectionModeEnabled}
              onChange={e => setInspectionModeEnabled(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            WCA Inspection Mode (15s inspection before each solve)
          </label>
        </div>
      </div>
    </div>
  );
}

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

if (typeof window !== "undefined" && db && db.app) {
  enableIndexedDbPersistence(db).catch(() => {});
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
  const [pendingPenalty, setPendingPenalty] = useState(null); // null | '+2' | 'DNF'
  const { user } = useAuth();
  const [startSignal, setStartSignal] = useState(0); // for external start
  const [inspectionModeEnabled, setInspectionModeEnabled] = useState(() => {
    const local = localStorage.getItem("cubeboxtimer_inspectionModeEnabled");
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
      didLoadSessions.current = true; // Mark as loaded
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
    // Only store valid solves (millis is a number and not NaN, unless DNF)
    if (millis === null || isNaN(millis)) {
      // If DNF, allow millis=0 with penalty DNF
      if (time && time.penalty === "DNF") {
        solveObj = { millis: 0, penalty: "DNF", reviewed: false, id: Date.now() };
      } else {
        // Ignore invalid solve
        return;
      }
    } else {
      solveObj = {
        millis,
        penalty: (typeof time === "object" && time !== null && time.penalty !== undefined) ? time.penalty : pendingPenalty,
        reviewed: (typeof time === "object" && time !== null ? time.reviewed : false) ?? false,
        id: (typeof time === "object" && time !== null ? time.id : undefined) ?? Date.now(),
      };
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
    setPendingPenalty(null); // Only clear after it is used for a solve
  };

  // Get solves for current event (all), and valid solves (for stats/count)
  const activeSession = sessions.find((s) => s.id === activeSessionId) ||
    sessions[0] || { solves: { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] } };
  const eventSolves = activeSession.solves[cubeDimension] || [];
  // Only valid solves (not DNF, millis is a number)
  const validEventSolves = eventSolves.filter(
    (s) => typeof s.millis === "number" && !isNaN(s.millis) && s.penalty !== "DNF"
  );

  // Aggregate all solves across all sessions for all-time stats (per event)
  const allSolves = sessions.flatMap((s) =>
    Array.isArray(s.solves?.[cubeDimension]) ? s.solves[cubeDimension] : []
  );
  const validAllSolves = allSolves.filter(
    (s) => typeof s.millis === "number" && !isNaN(s.millis) && s.penalty !== "DNF"
  );

  // Helper to compute stats (best, worst, mean, ao5, ao12, count)
  function computeStats(times) {
    if (!times.length)
      return {
        best: null,
        worst: null,
        mean: null,
        ao5: null,
        ao12: null,
        count: 0,
      };
    const best = Math.min(...times);
    const worst = Math.max(...times);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const ao5 =
      times.length >= 5 ? times.slice(-5).reduce((a, b) => a + b, 0) / 5 : null;
    const ao12 =
      times.length >= 12
        ? times.slice(-12).reduce((a, b) => a + b, 0) / 12
        : null;
    return { best, worst, mean, ao5, ao12, count: times.length };
  }

  // Session stats
  const sessionTimes = validEventSolves.map((s) => s.millis / 1000);
  const sessionStats = computeStats(sessionTimes);
  // All-time stats
  const allTimes = validAllSolves.map((s) => s.millis / 1000);
  const allTimeStats = computeStats(allTimes);

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
      />
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          inspectionModeEnabled={inspectionModeEnabled}
          setInspectionModeEnabled={setInspectionModeEnabled}
        />
      )}
      {showProfile && (
        <ProfileModal user={user} onClose={() => setShowProfile(false)} />
      )}
      <InspectionTimer
        visible={inspectionVisible}
        onInspectionEnd={(penalty) => {
          setInspectionVisible(false);
          setPendingPenalty(penalty);
          if (penalty === "DNF") {
            handleSolveComplete({ millis: 0, penalty: "DNF", reviewed: false, id: Date.now() });
            setTimerRunning(false);
          } else {
            // For both '+2' and null, start timer and let handleSolveComplete use pendingPenalty
            setTimerRunning(true);
            setStartSignal((s) => s + 1);
            // Do NOT clear pendingPenalty here; it will be cleared after the solve is recorded
          }
        }}
        onPenalty={setPendingPenalty}
        seconds={15}
        onCancel={() => setInspectionVisible(false)}
      />
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
            solves={validEventSolves}
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
              justifyContent: "center",
              alignItems: "center",
              flex: "0 0 340px",
              minHeight: 340,
              margin: 0,
              padding: "2rem 0 1.5rem 0",
              position: "relative",
            }}
          >
            {/* Only show Start button (no Start Inspection) when timer is not running, inspection is not visible, and timer is reset (0.00) */}
            {!timerRunning && !inspectionVisible && scrambles[selectedScrambleIdx] && (
              <div style={{ display: "flex", flexDirection: "row", gap: 16, position: "absolute", left: "50%", top: "65%", transform: "translate(-50%, -50%)", zIndex: 10 }}>
                <button
                  style={{
                    padding: "10px 24px",
                    fontSize: 18,
                    borderRadius: 8,
                    border: "none",
                    background: "#1a73e8",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    if (inspectionModeEnabled) {
                      setInspectionVisible(true);
                    } else {
                      setPendingPenalty(null); // Always clear penalty if not using inspection
                      setStartSignal((s) => s + 1);
                      setTimerRunning(true);
                    }
                  }}
                >
                  Start
                </button>
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
                  sessionStats={sessionStats}
                  allTimeStats={allTimeStats}
                  sessionSolves={validEventSolves.map(s => s.millis)}
                  allSolves={validAllSolves.map(s => s.millis)}
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
                <SolveList solves={eventSolves} updateSolve={updateSolve} />
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
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
