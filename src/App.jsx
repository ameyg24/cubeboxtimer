import React, { useState, useEffect, useRef } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Timer from "./components/Timer.jsx";
import InspectionTimer from "./components/InspectionTimer.jsx";
import { db, firebaseProjectId } from "./firebase/config";
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
import { ao5 } from "./analytics";
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
const WRITE_QUEUE_KEY = "cbt_write_queue";
const SYNC_WRITE_TIMEOUT_MS = 10000;

function createEmptySolves() {
  return CUBE_DIMENSIONS.reduce((acc, dimension) => {
    acc[dimension] = [];
    return acc;
  }, {});
}

function createSolveId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readWriteQueue() {
  try {
    const stored = localStorage.getItem(WRITE_QUEUE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    const sanitized = parsed.filter((item) =>
      item &&
      ["createSolve", "updateSolve", "deleteSolve"].includes(item.type) &&
      item.solveId &&
      item.sessionId &&
      item.cubeDimension
    );
    if (sanitized.length !== parsed.length) {
      writeWriteQueue(sanitized);
    }
    return sanitized;
  } catch {
    return [];
  }
}

function writeWriteQueue(queue) {
  localStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(queue));
}

function queueSolveWrite(item) {
  const queue = readWriteQueue();
  writeWriteQueue([...queue, item]);
}

function queueSolveUpdate(item) {
  const queue = readWriteQueue();
  const nextQueue = queue.map((queuedItem) => {
    if (queuedItem.type === "createSolve" && String(queuedItem.solveId) === String(item.solveId)) {
      return { ...queuedItem, solve: { ...queuedItem.solve, ...item.patch } };
    }
    if (queuedItem.type === "updateSolve" && String(queuedItem.solveId) === String(item.solveId)) {
      return { ...queuedItem, patch: { ...queuedItem.patch, ...item.patch }, ts: item.ts };
    }
    return queuedItem;
  });
  const alreadyQueued = nextQueue.some(
    (queuedItem) =>
      (queuedItem.type === "createSolve" || queuedItem.type === "updateSolve") &&
      String(queuedItem.solveId) === String(item.solveId)
  );
  writeWriteQueue(alreadyQueued ? nextQueue : [...nextQueue, item]);
}

function queueSolveDelete(item) {
  const queue = readWriteQueue();
  let removedPendingCreate = false;
  const nextQueue = queue.filter((queuedItem) => {
    if (String(queuedItem.solveId) !== String(item.solveId)) return true;
    if (queuedItem.type === "createSolve") {
      removedPendingCreate = true;
    }
    return false;
  });
  writeWriteQueue(removedPendingCreate ? nextQueue : [...nextQueue, item]);
}

function withTimeout(promise, message, timeoutMs = SYNC_WRITE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, nestedValue]) => [key, toFirestoreValue(nestedValue)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function firestoreRestUrl(path, fieldPaths = []) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const params = new URLSearchParams();
  fieldPaths.forEach((fieldPath) => params.append("updateMask.fieldPaths", fieldPath));
  const query = params.toString();
  return `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/${encodedPath}${query ? `?${query}` : ""}`;
}

async function firestoreRestRequest(user, path, options = {}) {
  if (!firebaseProjectId) throw new Error("Missing Firebase project ID.");
  const token = await withTimeout(user.getIdToken(), "Timed out getting Firebase auth token.");
  const response = await withTimeout(
    fetch(firestoreRestUrl(path, options.fieldPaths), {
      method: options.method || "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: options.data
        ? JSON.stringify({
            fields: Object.fromEntries(
              Object.entries(options.data).map(([key, value]) => [key, toFirestoreValue(value)])
            ),
          })
        : undefined,
    }),
    options.timeoutMessage || "Timed out writing to Firestore REST API."
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore REST ${response.status}: ${text}`);
  }
  return response;
}

function removeQueuedWrite(queueItem) {
  const queue = readWriteQueue();
  writeWriteQueue(
    queue.filter((item) => !(item.type === queueItem.type && item.solveId === queueItem.solveId))
  );
}

function normalizeSolvesShape(solves) {
  const normalized = createEmptySolves();
  if (!solves) return normalized;
  if (Array.isArray(solves)) {
    normalized["3x3x3"] = solves.map((solve) => normalizeSolveDoc(solve, undefined, "3x3x3"));
    return normalized;
  }
  CUBE_DIMENSIONS.forEach((dimension) => {
    normalized[dimension] = Array.isArray(solves[dimension])
      ? solves[dimension].map((solve) => normalizeSolveDoc(solve, undefined, dimension))
      : [];
  });
  return normalized;
}

function normalizeSolveDoc(solve, fallbackId, fallbackDimension) {
  const id = String(solve.id || fallbackId || createSolveId());
  return {
    ...solve,
    id,
    cubeDimension: solve.cubeDimension || fallbackDimension || "3x3x3",
  };
}

function groupSolvesByEvent(solves) {
  const grouped = createEmptySolves();
  solves.forEach((solve) => {
    const normalized = normalizeSolveDoc(solve);
    const dimension = CUBE_DIMENSIONS.includes(normalized.cubeDimension)
      ? normalized.cubeDimension
      : "3x3x3";
    grouped[dimension].push(normalized);
  });
  CUBE_DIMENSIONS.forEach((dimension) => {
    grouped[dimension].sort((a, b) => {
      const aTime = a.localCreatedAt || a.id || 0;
      const bTime = b.localCreatedAt || b.id || 0;
      return aTime > bTime ? 1 : aTime < bTime ? -1 : 0;
    });
  });
  return grouped;
}

function normalizeSessionsShape(sessions) {
  return sessions.map((session) => ({
    ...session,
    solves: normalizeSolvesShape(session.solves),
  }));
}

function getEmbeddedSolveDocs(solves, sessionId) {
  const docs = [];
  const eventSolves = Array.isArray(solves)
    ? { ...createEmptySolves(), "3x3x3": solves }
    : solves || {};
  CUBE_DIMENSIONS.forEach((dimension) => {
    const solvesForEvent = Array.isArray(eventSolves[dimension]) ? eventSolves[dimension] : [];
    solvesForEvent.forEach((solve, index) => {
      const solveId = String(solve.id || `legacy-${sessionId}-${dimension}-${index}`);
      docs.push({
        solveId,
        solve: {
          ...solve,
          id: solveId,
          cubeDimension: dimension,
          localCreatedAt: solve.localCreatedAt || (typeof solve.id === "number" ? solve.id : Date.now()),
        },
      });
    });
  });
  return docs;
}

async function migrateEmbeddedSolves(sessionRef, sessionId, data) {
  if (data.solvesMigrated || !data.solves) return;
  const solveDocs = getEmbeddedSolveDocs(data.solves, sessionId);
  for (const { solveId, solve } of solveDocs) {
    await setDoc(doc(sessionRef, "solves", solveId), solve, { merge: true });
  }
  await setDoc(sessionRef, { solvesMigrated: true }, { merge: true });
}

function applyPendingQueueToSessions(sessions, queue = readWriteQueue()) {
  const pendingItems = queue.filter((item) =>
    ["createSolve", "updateSolve", "deleteSolve"].includes(item.type)
  );
  if (pendingItems.length === 0) return sessions;
  const sessionMap = new Map(
    sessions.map((session) => [
      session.id,
      { ...session, solves: normalizeSolvesShape(session.solves) },
    ])
  );

  pendingItems.forEach((item) => {
    const existingSession = sessionMap.get(item.sessionId);
    const session = existingSession || {
      id: item.sessionId,
      name: item.sessionName || "Session",
      createdAt: item.sessionCreatedAt || item.ts || Date.now(),
      solves: createEmptySolves(),
    };
    const solves = normalizeSolvesShape(session.solves);
    const dimension = CUBE_DIMENSIONS.includes(item.cubeDimension) ? item.cubeDimension : "3x3x3";
    const existingIndex = solves[dimension].findIndex(
      (solve) => String(solve.id) === String(item.solveId)
    );
    if (item.type === "createSolve" && existingIndex === -1) {
      solves[dimension] = [
        ...solves[dimension],
        normalizeSolveDoc(item.solve, item.solveId, dimension),
      ];
    }
    if (item.type === "updateSolve" && existingIndex !== -1) {
      solves[dimension] = solves[dimension].map((solve, index) =>
        index === existingIndex ? { ...solve, ...item.patch } : solve
      );
    }
    if (item.type === "deleteSolve") {
      solves[dimension] = solves[dimension].filter(
        (solve) => String(solve.id) !== String(item.solveId)
      );
    }
    sessionMap.set(item.sessionId, { ...session, solves });
  });

  return Array.from(sessionMap.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function pickActiveSessionId(prevId, sessions, fallbackId = "") {
  if (prevId && sessions.some((session) => session.id === prevId)) return prevId;
  const sessionWithSolves = sessions.find((session) =>
    CUBE_DIMENSIONS.some((dimension) => session.solves?.[dimension]?.length > 0)
  );
  return sessionWithSolves?.id || sessions[0]?.id || fallbackId;
}

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
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [pendingWriteCount, setPendingWriteCount] = useState(() => readWriteQueue().length);
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
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

  const inspectionStartTimeRef = useRef(null);
  const inspectionVisibleRef = useRef(false);
  const timerRunningRef = useRef(false);
  const sessionsRef = useRef([]);
  const flushingQueueRef = useRef(false);
  const migratingSessionsRef = useRef(new Set());
  const didCreateDefaultRemoteSessionRef = useRef(false);

  // Prevent continuous refresh: only sync sessions after initial load
  const didLoadSessions = React.useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const refreshPendingWriteCount = React.useCallback(() => {
    setPendingWriteCount(readWriteQueue().length);
  }, []);

  const flushQueue = React.useCallback(async () => {
    if (!user || !db || !navigator.onLine || flushingQueueRef.current) return;
    flushingQueueRef.current = true;
    setSyncing(true);
    try {
      setSyncError("");
      const queue = readWriteQueue();
      for (const item of queue) {
        if (!["createSolve", "updateSolve", "deleteSolve"].includes(item.type)) continue;
        const session = sessionsRef.current.find((s) => s.id === item.sessionId);
        await firestoreRestRequest(user, `users/${user.uid}/sessions/${item.sessionId}`, {
          data: {
            name: item.sessionName || session?.name || "Session",
            createdAt: new Date(item.sessionCreatedAt || session?.createdAt || item.ts || Date.now()),
          },
          fieldPaths: ["name", "createdAt"],
          timeoutMessage: "Timed out writing session metadata to Firestore REST API.",
        });
        const solvePath = `users/${user.uid}/sessions/${item.sessionId}/solves/${item.solveId}`;
        if (item.type === "createSolve") {
          await firestoreRestRequest(user, solvePath, {
            data: {
              ...item.solve,
              id: item.solveId,
              cubeDimension: item.cubeDimension,
              localCreatedAt: item.solve?.localCreatedAt || item.ts || Date.now(),
              createdAt: item.solve?.createdAt || new Date(item.ts || Date.now()),
            },
            timeoutMessage: "Timed out creating solve in Firestore REST API.",
          });
        }
        if (item.type === "updateSolve") {
          await firestoreRestRequest(user, solvePath, {
            data: { ...item.patch, id: item.solveId, cubeDimension: item.cubeDimension },
            fieldPaths: [...Object.keys(item.patch), "id", "cubeDimension"],
            timeoutMessage: "Timed out updating solve in Firestore REST API.",
          });
        }
        if (item.type === "deleteSolve") {
          await firestoreRestRequest(user, solvePath, {
            method: "DELETE",
            timeoutMessage: "Timed out deleting solve in Firestore REST API.",
          });
        }
        removeQueuedWrite(item);
        refreshPendingWriteCount();
      }
    } catch (error) {
      setSyncError(error?.message || "Sync failed.");
      console.warn("Failed to flush solve queue; will retry later.", error);
    } finally {
      flushingQueueRef.current = false;
      setSyncing(false);
      refreshPendingWriteCount();
    }
  }, [refreshPendingWriteCount, user]);

  useEffect(() => {
    if (!user) {
      // Try to load from localStorage ONCE on mount only
      if (!didLoadSessions.current) {
        const local = localStorage.getItem("cubeboxtimer_sessions");
        let loaded = null;
        try {
          loaded = local ? JSON.parse(local) : null;
        } catch {
          loaded = null;
        }
        if (loaded && Array.isArray(loaded) && loaded.length > 0) {
          const mergedLocalSessions = applyPendingQueueToSessions(normalizeSessionsShape(loaded));
          setSessions(mergedLocalSessions);
          // Restore last active session if possible
          const lastActive = localStorage.getItem("cubeboxtimer_activeSessionId");
          setActiveSessionId(pickActiveSessionId(lastActive, mergedLocalSessions));
        } else {
          const mergedLocalSessions = applyPendingQueueToSessions([
            {
              id: "local",
              name: "Session",
              solves: createEmptySolves(),
              createdAt: Date.now(),
            },
          ]);
          setSessions(mergedLocalSessions);
          setActiveSessionId(mergedLocalSessions[0]?.id || "local");
        }
      }
      didLoadSessions.current = true;
      return;
    }
    const sessionsCol = collection(db, "users", user.uid, "sessions");
    const q = query(sessionsCol, orderBy("createdAt"));
    const solveUnsubscribes = new Map();
    const fallbackSolvesBySession = new Map();

    setFirestoreLoading(true);
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const loadedSessions = [];
        const liveSessionIds = new Set();
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const solves = normalizeSolvesShape(data.solves);
          if (data.solves && !data.solvesMigrated && !migratingSessionsRef.current.has(docSnap.id)) {
            migratingSessionsRef.current.add(docSnap.id);
            const sessionRef = doc(sessionsCol, docSnap.id);
            migrateEmbeddedSolves(sessionRef, docSnap.id, data)
              .catch((error) => {
                console.error("Failed to migrate embedded solves", error);
                migratingSessionsRef.current.delete(docSnap.id);
              });
          }
          fallbackSolvesBySession.set(docSnap.id, solves);
          liveSessionIds.add(docSnap.id);
          loadedSessions.push({
            id: docSnap.id,
            name: data.name,
            solves,
            createdAt: data.createdAt?.toMillis
              ? data.createdAt.toMillis()
              : Date.now(),
          });
        });
        if (loadedSessions.length === 0) {
          const defaultSession = {
            id: "default",
            name: "Session",
            solves: createEmptySolves(),
            createdAt: Date.now(),
          };
          const mergedDefaultSessions = applyPendingQueueToSessions([defaultSession]);
          setFirestoreLoading(false);
          setSessions(mergedDefaultSessions);
          setActiveSessionId((prev) => pickActiveSessionId(prev, mergedDefaultSessions, "default"));
          if (!didCreateDefaultRemoteSessionRef.current && navigator.onLine) {
            didCreateDefaultRemoteSessionRef.current = true;
            setDoc(
              doc(sessionsCol, defaultSession.id),
              { name: defaultSession.name, createdAt: serverTimestamp() },
              { merge: true }
            ).catch((error) => {
              console.warn("Failed to create default session.", error);
              didCreateDefaultRemoteSessionRef.current = false;
            });
          }
          return;
        }
        solveUnsubscribes.forEach((solveUnsubscribe, sessionId) => {
          if (!liveSessionIds.has(sessionId)) {
            solveUnsubscribe();
            solveUnsubscribes.delete(sessionId);
            fallbackSolvesBySession.delete(sessionId);
          }
        });
        loadedSessions.forEach((session) => {
          if (solveUnsubscribes.has(session.id)) return;
          const sessionRef = doc(sessionsCol, session.id);
          const unsubscribeSolves = onSnapshot(
            collection(sessionRef, "solves"),
            (solveSnapshot) => {
              const solveDocs = [];
              solveSnapshot.forEach((solveDoc) => {
                solveDocs.push(normalizeSolveDoc(solveDoc.data(), solveDoc.id));
              });
              const hydratedSolves = solveDocs.length > 0
                ? groupSolvesByEvent(solveDocs)
                : fallbackSolvesBySession.get(session.id) || createEmptySolves();
              setSessions((prev) =>
                applyPendingQueueToSessions(
                  prev.map((existing) =>
                    existing.id === session.id ? { ...existing, solves: hydratedSolves } : existing
                  )
                )
              );
            },
            (error) => {
              console.warn(`Failed to listen for solves in session ${session.id}.`, error);
              setSessions((prev) =>
                applyPendingQueueToSessions(
                  prev.map((existing) =>
                    existing.id === session.id
                      ? {
                          ...existing,
                          solves: fallbackSolvesBySession.get(session.id) || existing.solves,
                        }
                      : existing
                  )
                )
              );
            }
          );
          solveUnsubscribes.set(session.id, unsubscribeSolves);
        });
        didLoadSessions.current = true;
        setFirestoreLoading(false);
        setSessions((prev) =>
          applyPendingQueueToSessions(
            loadedSessions.map((session) => {
              const existing = prev.find((current) => current.id === session.id);
              return { ...session, solves: existing?.solves || session.solves };
            })
          )
        );
        setActiveSessionId((prev) =>
          pickActiveSessionId(prev, applyPendingQueueToSessions(loadedSessions))
        );
      },
      (error) => {
        console.warn("Failed to listen for Firestore sessions.", error);
        setFirestoreLoading(false);
        setSessions((prev) => {
          const sessionsWithPending = applyPendingQueueToSessions(normalizeSessionsShape(prev));
          setActiveSessionId((activeId) => pickActiveSessionId(activeId, sessionsWithPending));
          return sessionsWithPending;
        });
      }
    );
    return () => {
      unsubscribe();
      solveUnsubscribes.forEach((solveUnsubscribe) => solveUnsubscribe());
    };
  }, [user]);

  // Persist sessions and active session id to localStorage on any change (if not logged in)
  useEffect(() => {
    if (!user) {
      localStorage.setItem("cubeboxtimer_sessions", JSON.stringify(sessions));
      localStorage.setItem("cubeboxtimer_activeSessionId", activeSessionId);
    }
  }, [sessions, activeSessionId, user]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      refreshPendingWriteCount();
      flushQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshPendingWriteCount();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushQueue, refreshPendingWriteCount]);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      refreshPendingWriteCount();
    };
    const handleStorage = (event) => {
      if (event.key === WRITE_QUEUE_KEY) {
        refreshPendingWriteCount();
      }
    };
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    const intervalId = window.setInterval(refreshPendingWriteCount, 1000);
    return () => {
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.clearInterval(intervalId);
    };
  }, [refreshPendingWriteCount]);

  useEffect(() => {
    refreshPendingWriteCount();
    if (user && isOnline) {
      flushQueue();
    }
  }, [flushQueue, isOnline, refreshPendingWriteCount, user]);

  useEffect(() => {
    if (!user || !isOnline || pendingWriteCount === 0 || syncError) return;
    const retryId = window.setInterval(flushQueue, 5000);
    return () => window.clearInterval(retryId);
  }, [flushQueue, isOnline, pendingWriteCount, syncError, user]);

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
      solves: createEmptySolves(),
      createdAt: Date.now(),
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
    if (user) {
      const sessionsCol = collection(db, "users", user.uid, "sessions");
      await setDoc(doc(sessionsCol, newId), {
        name: newSession.name,
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

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
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
    queueSolveWrite({
      type: "createSolve",
      solveId: solveObj.id,
      sessionId: activeSession.id,
      sessionName: activeSession.name,
      sessionCreatedAt: activeSession.createdAt,
      cubeDimension,
      solve: solveObj,
      ts: Date.now(),
    });
    refreshPendingWriteCount();
    if (user && isOnline) {
      flushQueue();
    }
    setTimerRunning(false);
    setPendingPenalty(null); // Clear after use
  };

  // Get solves for current event (all), and valid solves (for stats/count)
  const activeSession = sessions.find((s) => s.id === activeSessionId) ||
    sessions[0] || { id: "local", name: "Session", createdAt: Date.now(), solves: createEmptySolves() };
  const eventSolves = activeSession.solves[cubeDimension] || [];

  // Aggregate all solves across all sessions for all-time stats (per event)
  const allSolves = sessions.flatMap((s) =>
    Array.isArray(s.solves?.[cubeDimension]) ? s.solves[cubeDimension] : []
  );

  // ao5 of the live event, mapped to the display contract this header uses:
  // null -> hidden, "DNF" -> DNF text, number -> seconds. See src/analytics.
  const lastAo5 = (() => {
    const r = ao5(eventSolves);
    if (r.status === "insufficient") return null;
    if (r.status === "dnf") return "DNF";
    return r.valueMs / 1000;
  })();

  // Delete a solve by index (local and Firestore)
  const deleteSolve = async (idx) => {
    const solveToDelete = eventSolves[idx];
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
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
    if (solveToDelete?.id) {
      queueSolveDelete({
        type: "deleteSolve",
        solveId: String(solveToDelete.id),
        sessionId: activeSession.id,
        sessionName: activeSession.name,
        sessionCreatedAt: activeSession.createdAt,
        cubeDimension,
        ts: Date.now(),
      });
      refreshPendingWriteCount();
    }
    if (user && isOnline) {
      flushQueue();
    }
  };

  // Helper to update a solve (local and Firestore)
  const updateSolve = async (idx, patch) => {
    const solveToUpdate = eventSolves[idx];
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
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
    if (solveToUpdate?.id) {
      queueSolveUpdate({
        type: "updateSolve",
        solveId: String(solveToUpdate.id),
        sessionId: activeSession.id,
        sessionName: activeSession.name,
        sessionCreatedAt: activeSession.createdAt,
        cubeDimension,
        patch,
        ts: Date.now(),
      });
      refreshPendingWriteCount();
    }
    if (user && isOnline) {
      flushQueue();
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

  // Keep refs in sync so the space handler always reads fresh values
  inspectionVisibleRef.current = inspectionVisible;
  timerRunningRef.current = timerRunning;

  const syncStatus = !isOnline
    ? { label: "offline", state: "offline" }
    : !user && pendingWriteCount > 0
    ? { label: "sign in to sync", state: "auth" }
    : syncError && pendingWriteCount > 0
    ? { label: `sync failed: ${syncError.slice(0, 48)}`, state: "error", title: syncError }
    : syncing && pendingWriteCount > 0
    ? { label: `syncing ${pendingWriteCount}`, state: "pending" }
    : pendingWriteCount > 0
    ? {
        label: `pending ${pendingWriteCount} change${pendingWriteCount === 1 ? "" : "s"}`,
        state: "pending",
      }
    : { label: "synced", state: "synced" };

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
                    setInspectionVisible(true);
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
