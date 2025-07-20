import React, { useState, useEffect } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Timer from "./components/Timer.jsx";
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

function SettingsModal({ onClose }) {
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
        <div style={{ fontSize: 16, color: "#888", marginTop: 18 }}>
          Settings coming soon!
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
  const { user } = useAuth();

    useEffect(() => {
    if (!user) {
      // Try to load from localStorage
      const local = localStorage.getItem("cubeboxtimer_sessions");
      let loaded = null;
      try {
        loaded = local ? JSON.parse(local) : null;
      } catch (e) {
        loaded = null;
      }
      if (loaded && Array.isArray(loaded) && loaded.length > 0) {
        setSessions(loaded);
        setActiveSessionId(loaded[0].id);
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
      setSessions(loadedSessions);
      setActiveSessionId((prev) =>
        prev && loadedSessions.some((s) => s.id === prev)
          ? prev
          : loadedSessions[0]?.id || ""
      );
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      localStorage.setItem("cubeboxtimer_sessions", JSON.stringify(sessions));
      return;
    }
    const saveSessions = async () => {
      const sessionsCol = collection(db, "users", user.uid, "sessions");
      for (const session of sessions) {
        const sessionRef = doc(sessionsCol, session.id);
        await setDoc(
          sessionRef,
          {
            name: session.name,
            solves: session.solves,
            createdAt: session.createdAt || serverTimestamp(),
          },
          { merge: true }
        );
      }
    };
    saveSessions();
  }, [sessions, user]);

  // Add session: also create in Firestore if logged in
  const addSession = async () => {
    const newId = Date.now().toString();
    const newSession = {
      id: newId,
      name: `Session ${sessions.length + 1}`,
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

  useEffect(() => {
    const newScrambles = Array.from({ length: 5 }, () =>
      generateScramble(scrambleType, cubeDimension)
    );
    setScrambles(newScrambles);
    setSelectedScrambleIdx(0);
  }, [scrambleType, cubeDimension]);

  // Update: add solve to correct event
  const handleSolveComplete = async (time) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              solves: {
                ...s.solves,
                [cubeDimension]: [...(s.solves[cubeDimension] || []), time],
              },
            }
          : s
      )
    );
    setTimerRunning(false); // Show main page after timer stops
  };

  // Get solves for current event
  const activeSession = sessions.find((s) => s.id === activeSessionId) ||
    sessions[0] || { solves: { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] } };
  const eventSolves = activeSession.solves[cubeDimension] || [];

  // Aggregate all solves across all sessions for all-time stats (per event)
  const allSolves = sessions.flatMap((s) =>
    Array.isArray(s.solves?.[cubeDimension]) ? s.solves[cubeDimension] : []
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
  const sessionTimes = eventSolves.map((s) => s / 1000);
  const sessionStats = computeStats(sessionTimes);
  // All-time stats
  const allTimes = allSolves.map((s) => s / 1000);
  const allTimeStats = computeStats(allTimes);

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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showProfile && (
        <ProfileModal user={user} onClose={() => setShowProfile(false)} />
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
              justifyContent: "center",
              alignItems: "center",
              flex: "0 0 340px",
              minHeight: 340,
              margin: 0,
              padding: "2rem 0 1.5rem 0",
            }}
          >
            <Timer
              key={activeSessionId + cubeDimension}
              onSolveComplete={handleSolveComplete}
              scramble={scrambles[selectedScrambleIdx] || ""}
              timerRunning={timerRunning}
              setTimerRunning={setTimerRunning}
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
                  sessionSolves={eventSolves}
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
                <SolveList solves={eventSolves} />
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
