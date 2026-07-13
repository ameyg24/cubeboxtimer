import { useState, useEffect, useRef, useCallback } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { logger } from "../logger.js";
import { firestoreRestRequest } from "./firestoreRest.js";
import {
  createCompetitionId,
  normalizeCompetitionDoc,
  normalizeCompetitionsShape,
  byDateAscending,
} from "../storage/normalize";
import { createIndexedDbRepository } from "../storage/indexedDb";
import { migrateIfNeeded, MIGRATION_KEY } from "../storage/migration";

// Normalization moved to src/storage/normalize.ts (shared with the
// migration); createCompetitionId stays exported from here so existing
// imports keep working.
export { createCompetitionId };

// Offline-first persistence for CompetitionResult, mirroring
// useSolveSessions.js's architecture: optimistic local state, a
// localStorage-persisted write queue, and a Firestore REST flush of that
// queue when online + authenticated. Competitions aren't scoped to a
// session (there's no session-equivalent concept for an official result),
// so this is a flat collection rather than solves' session/solve nesting -
// but the offline/sync mechanics are identical.

const WRITE_QUEUE_KEY = "cbt_competition_write_queue";
const VALID_QUEUE_TYPES = ["createCompetition", "updateCompetition", "deleteCompetition"];

function readWriteQueue() {
  try {
    const stored = localStorage.getItem(WRITE_QUEUE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    const sanitized = parsed.filter(
      (item) => item && VALID_QUEUE_TYPES.includes(item.type) && item.competitionId
    );
    if (sanitized.length !== parsed.length) {
      writeWriteQueue(sanitized);
    }
    return sanitized;
  } catch (error) {
    logger.warn("Failed to read the local competition write queue; treating it as empty.", { error });
    return [];
  }
}

function writeWriteQueue(queue) {
  localStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(queue));
}

function queueCompetitionWrite(item) {
  const queue = readWriteQueue();
  writeWriteQueue([...queue, item]);
}

function queueCompetitionUpdate(item) {
  const queue = readWriteQueue();
  const nextQueue = queue.map((queuedItem) => {
    if (
      queuedItem.type === "createCompetition" &&
      String(queuedItem.competitionId) === String(item.competitionId)
    ) {
      return { ...queuedItem, competition: { ...queuedItem.competition, ...item.patch } };
    }
    if (
      queuedItem.type === "updateCompetition" &&
      String(queuedItem.competitionId) === String(item.competitionId)
    ) {
      return { ...queuedItem, patch: { ...queuedItem.patch, ...item.patch }, ts: item.ts };
    }
    return queuedItem;
  });
  const alreadyQueued = nextQueue.some(
    (queuedItem) =>
      (queuedItem.type === "createCompetition" || queuedItem.type === "updateCompetition") &&
      String(queuedItem.competitionId) === String(item.competitionId)
  );
  writeWriteQueue(alreadyQueued ? nextQueue : [...nextQueue, item]);
}

function queueCompetitionDelete(item) {
  const queue = readWriteQueue();
  let removedPendingCreate = false;
  const nextQueue = queue.filter((queuedItem) => {
    if (String(queuedItem.competitionId) !== String(item.competitionId)) return true;
    if (queuedItem.type === "createCompetition") {
      removedPendingCreate = true;
    }
    return false;
  });
  writeWriteQueue(removedPendingCreate ? nextQueue : [...nextQueue, item]);
}

function removeQueuedWrite(queueItem) {
  const queue = readWriteQueue();
  writeWriteQueue(
    queue.filter(
      (item) => !(item.type === queueItem.type && item.competitionId === queueItem.competitionId)
    )
  );
}

function applyPendingQueueToCompetitions(competitions, queue = readWriteQueue()) {
  if (queue.length === 0) return competitions;
  const map = new Map(competitions.map((c) => [c.id, c]));

  queue.forEach((item) => {
    if (item.type === "createCompetition" && !map.has(item.competitionId)) {
      map.set(item.competitionId, normalizeCompetitionDoc(item.competition, item.competitionId));
    }
    if (item.type === "updateCompetition" && map.has(item.competitionId)) {
      map.set(item.competitionId, { ...map.get(item.competitionId), ...item.patch });
    }
    if (item.type === "deleteCompetition") {
      map.delete(item.competitionId);
    }
  });

  return Array.from(map.values()).sort(byDateAscending);
}

// Owns CompetitionResult state plus its offline-first Firestore/IndexedDB
// sync. Deliberately has no session/event-scoping parameter: callers filter
// the returned `competitions` array by `event` themselves (e.g. before
// passing them to the pure prediction functions in analytics/).
export function useCompetitionResults({ user } = {}) {
  const [competitions, setCompetitions] = useState([]);
  const [firestoreLoading, setFirestoreLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [pendingWriteCount, setPendingWriteCount] = useState(() => readWriteQueue().length);
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  // Mirrors hydratedRef as renderable state; see useSolveSessions.js.
  const [hydrated, setHydrated] = useState(false);

  const flushingQueueRef = useRef(false);
  const didLoadCompetitions = useRef(false);

  // Durable local storage for the signed-out path; see useSolveSessions.js
  // for the identical pattern and the hydration-gate rationale.
  const repositoryRef = useRef(null);
  const getRepository = useCallback(() => {
    if (!repositoryRef.current) repositoryRef.current = createIndexedDbRepository();
    return repositoryRef.current;
  }, []);
  const hydratedRef = useRef(false);

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
      logger.debug("Competition sync flush started.", { pendingWrites: queue.length });
      for (const item of queue) {
        if (!VALID_QUEUE_TYPES.includes(item.type)) continue;
        const path = `users/${user.uid}/competitions/${item.competitionId}`;
        if (item.type === "createCompetition") {
          await firestoreRestRequest(user, path, {
            data: { ...item.competition, id: item.competitionId },
            timeoutMessage: "Timed out creating competition result in Firestore REST API.",
          });
        }
        if (item.type === "updateCompetition") {
          await firestoreRestRequest(user, path, {
            data: { ...item.patch, id: item.competitionId },
            fieldPaths: [...Object.keys(item.patch), "id"],
            timeoutMessage: "Timed out updating competition result in Firestore REST API.",
          });
        }
        if (item.type === "deleteCompetition") {
          await firestoreRestRequest(user, path, {
            method: "DELETE",
            timeoutMessage: "Timed out deleting competition result in Firestore REST API.",
          });
        }
        removeQueuedWrite(item);
        refreshPendingWriteCount();
      }
      logger.info("Competition sync flush completed.", {
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      setSyncError(error?.message || "Sync failed.");
      logger.warn("Competition sync flush failed; will retry later.", {
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
      // Hydrate from IndexedDB ONCE on mount only; the one-time
      // localStorage-to-IndexedDB migration runs first.
      if (!didLoadCompetitions.current) {
        didLoadCompetitions.current = true;
        let cancelled = false;
        (async () => {
          const startedAt = performance.now();
          let loaded = [];
          let hydrationFailed = false;
          try {
            await migrateIfNeeded(getRepository());
            loaded = await getRepository().loadCompetitions();
          } catch (error) {
            logger.error("Failed to hydrate competition results from IndexedDB; starting fresh.", {
              error,
            });
            hydrationFailed = true;
            loaded = [];
          }
          if (cancelled) return;
          const merged = applyPendingQueueToCompetitions(normalizeCompetitionsShape(loaded));
          setCompetitions(merged);
          // A failed read must not unlock writes; see useSolveSessions.js.
          if (!hydrationFailed) {
            hydratedRef.current = true;
            setHydrated(true);
          }
          logger.info("Competition results load completed from IndexedDB.", {
            competitionCount: merged.length,
            durationMs: Math.round(performance.now() - startedAt),
          });
        })();
        return () => {
          cancelled = true;
          // If hydration had not landed yet (StrictMode's double effect,
          // or a sign-in racing the load), let the next run redo it.
          if (!hydratedRef.current) didLoadCompetitions.current = false;
        };
      }
      return;
    }
    // With a signed-in user the Firestore listener owns the state; see
    // useSolveSessions.js for why this opens the persist gate.
    hydratedRef.current = true;
    setHydrated(true);

    const loadStartedAt = performance.now();
    const competitionsCol = collection(db, "users", user.uid, "competitions");
    const q = query(competitionsCol, orderBy("date"));
    setFirestoreLoading(true);
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const loaded = [];
        querySnapshot.forEach((docSnap) => {
          loaded.push(normalizeCompetitionDoc(docSnap.data(), docSnap.id));
        });
        didLoadCompetitions.current = true;
        setFirestoreLoading(false);
        setCompetitions(applyPendingQueueToCompetitions(loaded));
        logger.info("Competition results load completed from Firestore.", {
          competitionCount: loaded.length,
          durationMs: Math.round(performance.now() - loadStartedAt),
        });
      },
      (error) => {
        logger.warn("Failed to listen for Firestore competition results.", { error });
        setFirestoreLoading(false);
        setCompetitions((prev) => applyPendingQueueToCompetitions(normalizeCompetitionsShape(prev)));
      }
    );
    return () => unsubscribe();
  }, [user, getRepository]);

  // Persist to IndexedDB on any change (if not logged in). Gated on
  // hydration so the initial empty state never overwrites stored data; the
  // migration marker confirmation mirrors useSolveSessions.js.
  useEffect(() => {
    if (!user && hydratedRef.current) {
      getRepository()
        .saveCompetitions(competitions)
        .then(() => localStorage.setItem(MIGRATION_KEY, "complete"))
        .catch((error) => {
          logger.error("Failed to persist competition results to IndexedDB.", { error });
        });
    }
  }, [competitions, user, getRepository]);

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

  // Add a competition result (local + queued Firestore write).
  const addCompetitionResult = (input) => {
    const id = createCompetitionId();
    const competition = normalizeCompetitionDoc(input, id);
    setCompetitions((prev) => [...prev, competition].sort(byDateAscending));
    queueCompetitionWrite({
      type: "createCompetition",
      competitionId: id,
      competition,
      ts: Date.now(),
    });
    refreshPendingWriteCount();
    if (user && isOnline) {
      flushQueue();
    }
    return id;
  };

  // Patch a competition result by id (local + queued Firestore write).
  const updateCompetitionResult = (id, patch) => {
    setCompetitions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    queueCompetitionUpdate({
      type: "updateCompetition",
      competitionId: String(id),
      patch,
      ts: Date.now(),
    });
    refreshPendingWriteCount();
    if (user && isOnline) {
      flushQueue();
    }
  };

  // Delete a competition result by id (local + queued Firestore write).
  const deleteCompetitionResult = (id) => {
    setCompetitions((prev) => prev.filter((c) => c.id !== id));
    queueCompetitionDelete({
      type: "deleteCompetition",
      competitionId: String(id),
      ts: Date.now(),
    });
    refreshPendingWriteCount();
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
    competitions,
    hydrated,
    firestoreLoading,
    syncStatus,
    addCompetitionResult,
    updateCompetitionResult,
    deleteCompetitionResult,
  };
}
