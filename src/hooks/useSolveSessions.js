import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { db } from "../firebase/config";
import { logger } from "../logger.js";
import { firestoreRestRequest } from "./firestoreRest.js";
import {
  CUBE_DIMENSIONS,
  createEmptySolves,
  createSolveId,
  normalizeSolveDoc,
  normalizeSolvesShape,
  normalizeSessionsShape,
} from "../storage/normalize";
import { createIndexedDbRepository } from "../storage/indexedDb";
import { migrateIfNeeded, MIGRATION_KEY } from "../storage/migration";

// Normalization moved to src/storage/normalize.ts (shared with the
// migration); the identifiers below stay exported from here so existing
// imports keep working.
export { CUBE_DIMENSIONS, createEmptySolves, createSolveId };

const WRITE_QUEUE_KEY = "cbt_write_queue";

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
  } catch (error) {
    logger.warn("Failed to read the local write queue; treating it as empty.", { error });
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


function removeQueuedWrite(queueItem) {
  const queue = readWriteQueue();
  writeWriteQueue(
    queue.filter((item) => !(item.type === queueItem.type && item.solveId === queueItem.solveId))
  );
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
  // Mirrors hydratedRef as renderable state - the async-hydration analog of
  // firestoreLoading, so consumers (and tests) can tell "empty" from "not
  // loaded yet".
  const [hydrated, setHydrated] = useState(false);

  const sessionsRef = useRef([]);
  const flushingQueueRef = useRef(false);
  const migratingSessionsRef = useRef(new Set());
  const didCreateDefaultRemoteSessionRef = useRef(false);

  // Prevent continuous refresh: only sync sessions after initial load
  const didLoadSessions = useRef(false);

  // Durable local storage for the signed-out path. One repository (and one
  // IndexedDB connection) per hook instance; opened lazily on first use.
  const repositoryRef = useRef(null);
  const getRepository = useCallback(() => {
    if (!repositoryRef.current) repositoryRef.current = createIndexedDbRepository();
    return repositoryRef.current;
  }, []);

  // Blocks the persist effect until state holds real data (hydrated from
  // IndexedDB, or owned by the Firestore listener). Without this, the
  // persist effect's first run - which sees the initial empty state -
  // would overwrite the stored snapshot before hydration lands.
  const hydratedRef = useRef(false);

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
    const startedAt = performance.now();
    try {
      setSyncError("");
      const queue = readWriteQueue();
      logger.debug("Firestore sync flush started.", { pendingWrites: queue.length });
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
      logger.info("Firestore sync flush completed.", {
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      setSyncError(error?.message || "Sync failed.");
      logger.warn("Firestore sync flush failed; will retry later.", {
        error,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } finally {
      flushingQueueRef.current = false;
      setSyncing(false);
      refreshPendingWriteCount();
    }
  }, [refreshPendingWriteCount, user]);

  useEffect(() => {
    if (!user) {
      // Hydrate from IndexedDB ONCE on mount only. The one-time
      // localStorage-to-IndexedDB migration runs first, so a pre-existing
      // localStorage snapshot is picked up transparently.
      if (!didLoadSessions.current) {
        didLoadSessions.current = true;
        let cancelled = false;
        (async () => {
          const startedAt = performance.now();
          let loaded = [];
          let hydrationFailed = false;
          try {
            await migrateIfNeeded(getRepository());
            loaded = await getRepository().loadSessions();
          } catch (error) {
            logger.error("Failed to hydrate sessions from IndexedDB; starting fresh.", { error });
            hydrationFailed = true;
            loaded = [];
          }
          if (cancelled) return;
          if (loaded.length > 0) {
            const mergedLocalSessions = applyPendingQueueToSessions(normalizeSessionsShape(loaded));
            setSessions(mergedLocalSessions);
            // Restore last active session if possible
            const lastActive = localStorage.getItem("cubeboxtimer_activeSessionId");
            setActiveSessionId(pickActiveSessionId(lastActive, mergedLocalSessions));
            logger.info("Session load completed from IndexedDB.", {
              sessionCount: mergedLocalSessions.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
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
            logger.info("Session load completed with a fresh default session (no local data found).", {
              durationMs: Math.round(performance.now() - startedAt),
            });
          }
          // A failed read must not unlock writes: persisting the fallback
          // state could overwrite a store the app was unable to read. New
          // solves still reach the localStorage write queue, so the next
          // healthy launch replays them.
          if (!hydrationFailed) {
            hydratedRef.current = true;
            setHydrated(true);
          }
        })();
        return () => {
          cancelled = true;
          // If hydration had not landed yet (StrictMode's double effect,
          // or a sign-in racing the load), let the next run redo it.
          if (!hydratedRef.current) didLoadSessions.current = false;
        };
      }
      return;
    }
    // With a signed-in user the Firestore listener owns the state, so any
    // later signed-out persist writes a complete snapshot, not the initial
    // empty one.
    hydratedRef.current = true;
    setHydrated(true);
    const sessionLoadStartedAt = performance.now();
    let loggedInitialFirestoreLoad = false;
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
              .then(() => {
                logger.debug("Migrated embedded solves to top-level documents.", { sessionId: docSnap.id });
              })
              .catch((error) => {
                logger.error("Failed to migrate embedded solves.", { sessionId: docSnap.id, error });
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
          if (!loggedInitialFirestoreLoad) {
            loggedInitialFirestoreLoad = true;
            logger.info("Session load completed from Firestore (no remote sessions found).", {
              durationMs: Math.round(performance.now() - sessionLoadStartedAt),
            });
          }
          if (!didCreateDefaultRemoteSessionRef.current && navigator.onLine) {
            didCreateDefaultRemoteSessionRef.current = true;
            setDoc(
              doc(sessionsCol, defaultSession.id),
              { name: defaultSession.name, createdAt: serverTimestamp() },
              { merge: true }
            ).catch((error) => {
              logger.warn("Failed to create default session.", { error });
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
              logger.warn(`Failed to listen for solves in session ${session.id}.`, { error });
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
        if (!loggedInitialFirestoreLoad) {
          loggedInitialFirestoreLoad = true;
          logger.info("Session load completed from Firestore.", {
            sessionCount: loadedSessions.length,
            durationMs: Math.round(performance.now() - sessionLoadStartedAt),
          });
        }
      },
      (error) => {
        logger.warn("Failed to listen for Firestore sessions.", { error });
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
  }, [user, getRepository]);

  // Persist sessions (IndexedDB) and active session id (localStorage, a
  // synchronous UI preference) on any change while not logged in. Gated on
  // hydration so the initial empty state never overwrites stored data. The
  // migration marker is confirmed after each successful write: on the
  // sign-out path this is what hands ownership to IndexedDB (mirroring how
  // the old code overwrote the localStorage blob), and everywhere else it
  // is already "complete".
  useEffect(() => {
    if (!user && hydratedRef.current) {
      getRepository()
        .saveSessions(sessions)
        .then(() => localStorage.setItem(MIGRATION_KEY, "complete"))
        .catch((error) => {
          logger.error("Failed to persist sessions to IndexedDB.", { error });
        });
      localStorage.setItem("cubeboxtimer_activeSessionId", activeSessionId);
    }
  }, [sessions, activeSessionId, user, getRepository]);

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
      try {
        const sessionsCol = collection(db, "users", user.uid, "sessions");
        await setDoc(doc(sessionsCol, newId), {
          name: newSession.name,
          createdAt: serverTimestamp(),
        });
        logger.debug("Created session in Firestore.", { sessionId: newId });
      } catch (error) {
        logger.warn("Failed to create session in Firestore; it still exists locally.", { sessionId: newId, error });
      }
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
      try {
        const sessionsCol = collection(db, "users", user.uid, "sessions");
        await deleteDoc(doc(sessionsCol, id));
        logger.debug("Deleted session from Firestore.", { sessionId: id });
      } catch (error) {
        logger.warn("Failed to delete session from Firestore; it was removed locally.", { sessionId: id, error });
      }
    }
  };

  // Get solves for current event (all), and valid solves (for stats/count).
  // Memoized so the array/object identity only changes when the underlying
  // session data does, not on every render (e.g. sync status polling) -
  // consumers like Dashboard and StatsChart rely on that stability to skip
  // recomputing derived stats and re-rendering the chart.
  const activeSession = useMemo(
    () =>
      sessions.find((s) => s.id === activeSessionId) ||
      sessions[0] || { id: "local", name: "Session", createdAt: Date.now(), solves: createEmptySolves() },
    [sessions, activeSessionId]
  );
  const eventSolves = useMemo(
    () => activeSession.solves[cubeDimension] || [],
    [activeSession, cubeDimension]
  );

  // Aggregate all solves across all sessions for all-time stats (per event)
  const allSolves = useMemo(
    () =>
      sessions.flatMap((s) =>
        Array.isArray(s.solves?.[cubeDimension]) ? s.solves[cubeDimension] : []
      ),
    [sessions, cubeDimension]
  );

  // Append a solve to an event and queue the write. Defaults to the
  // currently active cubeDimension (the live timer's case), but accepts an
  // explicit override so a manually backfilled past solve can target a
  // different event than whatever's currently selected in the header - the
  // same session, same write-queue path, just a different array key.
  const addSolve = (solveObj, dimensionOverride) => {
    const dimension = CUBE_DIMENSIONS.includes(dimensionOverride) ? dimensionOverride : cubeDimension;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              solves: {
                ...s.solves,
                [dimension]: [...(s.solves[dimension] || []), solveObj],
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
      cubeDimension: dimension,
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
    hydrated,
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
