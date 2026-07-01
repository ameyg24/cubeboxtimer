import { useState, useEffect, useRef, useCallback } from "react";
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
import { db, firebaseProjectId } from "../firebase/config";

const CUBE_DIMENSIONS = ["2x2x2", "3x3x3", "4x4x4", "5x5x5"];
const WRITE_QUEUE_KEY = "cbt_write_queue";
const SYNC_WRITE_TIMEOUT_MS = 10000;

export function createEmptySolves() {
  return CUBE_DIMENSIONS.reduce((acc, dimension) => {
    acc[dimension] = [];
    return acc;
  }, {});
}

export function createSolveId() {
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

// Owns per-session solve state plus its offline-first Firestore/localStorage sync.
export function useSolveSessions({ user, cubeDimension }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [firestoreLoading, setFirestoreLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [pendingWriteCount, setPendingWriteCount] = useState(() => readWriteQueue().length);
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);

  const sessionsRef = useRef([]);
  const flushingQueueRef = useRef(false);
  const migratingSessionsRef = useRef(new Set());
  const didCreateDefaultRemoteSessionRef = useRef(false);

  // Prevent continuous refresh: only sync sessions after initial load
  const didLoadSessions = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const refreshPendingWriteCount = useCallback(() => {
    setPendingWriteCount(readWriteQueue().length);
  }, []);

  const flushQueue = useCallback(async () => {
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

  // Ensure didLoadSessions is set to true on mount (fixes persistence bug)
  useEffect(() => {
    if (!user && !didLoadSessions.current) {
      didLoadSessions.current = true;
    }
  }, [user]);

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

  // Get solves for current event (all), and valid solves (for stats/count)
  const activeSession = sessions.find((s) => s.id === activeSessionId) ||
    sessions[0] || { id: "local", name: "Session", createdAt: Date.now(), solves: createEmptySolves() };
  const eventSolves = activeSession.solves[cubeDimension] || [];

  // Aggregate all solves across all sessions for all-time stats (per event)
  const allSolves = sessions.flatMap((s) =>
    Array.isArray(s.solves?.[cubeDimension]) ? s.solves[cubeDimension] : []
  );

  // Append a completed solve to the active event and queue the write.
  const addSolve = (solveObj) => {
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
  };

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

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    eventSolves,
    allSolves,
    firestoreLoading,
    syncStatus,
    addSession,
    removeSession,
    addSolve,
    deleteSolve,
    updateSolve,
  };
}
