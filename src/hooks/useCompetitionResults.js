import { useState, useEffect, useRef, useCallback } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { logger } from "../logger.js";
import { firestoreRestRequest } from "./firestoreRest.js";

// Offline-first persistence for CompetitionResult, mirroring
// useSolveSessions.js's architecture: optimistic local state, a
// localStorage-persisted write queue, and a Firestore REST flush of that
// queue when online + authenticated. Competitions aren't scoped to a
// session (there's no session-equivalent concept for an official result),
// so this is a flat collection rather than solves' session/solve nesting -
// but the offline/sync mechanics are identical.

const STORAGE_KEY = "cubeboxtimer_competitions";
const WRITE_QUEUE_KEY = "cbt_competition_write_queue";
const VALID_QUEUE_TYPES = ["createCompetition", "updateCompetition", "deleteCompetition"];

export function createCompetitionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Defensive shape coercion for a persisted CompetitionResult doc - the same
// role normalizeSolveDoc plays for solves. There's no legacy format to
// migrate FROM yet, but this is the seam a future migration would extend.
function normalizeCompetitionDoc(competitionDoc, fallbackId) {
  const source = competitionDoc || {};
  return {
    id: String(source.id || fallbackId || createCompetitionId()),
    competitionName: source.competitionName || "",
    date: source.date || new Date().toISOString(),
    event: source.event || "3x3x3",
    bestMs: typeof source.bestMs === "number" ? source.bestMs : null,
    averageMs: typeof source.averageMs === "number" ? source.averageMs : null,
    source: source.source || "manual",
    notes: source.notes || undefined,
    // Set only for source: "wca-import" records - the stable identifier
    // analytics/wcaImport.ts's duplicate policy matches future imports
    // against, so re-importing never creates a second record for the same
    // WCA competition + event + round.
    wcaCompetitionId: source.wcaCompetitionId || null,
    // The specific WCA round this record is (a competition can have several
    // - First round, Semi Final, Final, ...), each imported as its own
    // record. Combined with wcaCompetitionId + event, this is what lets a
    // re-import tell "update this round" apart from "this is a different
    // round of the same competition."
    wcaRoundId: typeof source.wcaRoundId === "number" ? source.wcaRoundId : null,
    // Human-readable label for wcaRoundId (e.g. "First round", "Final") -
    // shown next to the result in the Competition Results list.
    roundLabel: source.roundLabel || null,
    // The WCA person ID this record was imported from - findLinkedWcaId
    // (analytics/wcaImport.ts) reads this to lock future imports to the
    // same WCA ID, so two different competitors' results can never end up
    // mixed into one history.
    wcaId: source.wcaId || null,
  };
}

function normalizeCompetitionsShape(competitions) {
  return Array.isArray(competitions) ? competitions.map((c) => normalizeCompetitionDoc(c)) : [];
}

function byDateAscending(a, b) {
  return (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
}

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

// Owns CompetitionResult state plus its offline-first Firestore/localStorage
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

  const flushingQueueRef = useRef(false);
  const didLoadCompetitions = useRef(false);

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
      if (!didLoadCompetitions.current) {
        const startedAt = performance.now();
        const local = localStorage.getItem(STORAGE_KEY);
        let loaded = null;
        try {
          loaded = local ? JSON.parse(local) : null;
        } catch (error) {
          logger.warn("Failed to parse locally saved competition results; starting fresh.", { error });
          loaded = null;
        }
        const merged = applyPendingQueueToCompetitions(
          normalizeCompetitionsShape(Array.isArray(loaded) ? loaded : [])
        );
        setCompetitions(merged);
        logger.info("Competition results load completed from localStorage.", {
          competitionCount: merged.length,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }
      didLoadCompetitions.current = true;
      return;
    }

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
  }, [user]);

  // Persist to localStorage on any change (if not logged in).
  useEffect(() => {
    if (!user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(competitions));
    }
  }, [competitions, user]);

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
    firestoreLoading,
    syncStatus,
    addCompetitionResult,
    updateCompetitionResult,
    deleteCompetitionResult,
  };
}
