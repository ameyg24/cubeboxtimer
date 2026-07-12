// One-time copy of the legacy localStorage blobs into the repository.
//
// State machine, tracked in localStorage under MIGRATION_KEY:
//   (absent)      never attempted
//   "in-progress" set before the first IndexedDB write; a page death at any
//                 point leaves this state, and the next launch redoes the
//                 whole copy from legacy (replace-all writes make the retry
//                 idempotent - no duplicates, no partial mixes)
//   "complete"    set only after reading the data back and verifying it
//                 matches what was written; from here on IndexedDB owns the
//                 data and legacy is never consulted again (re-copying
//                 would resurrect records the user has since deleted)
//
// The legacy keys are never removed or rewritten: until "complete" they are
// the source of truth, and after "complete" they stay behind as a frozen
// pre-migration snapshot. Removal is deliberately out of scope.

import { logger } from "../logger.js";
import { normalizeCompetitionsShape, normalizeSessionsShape } from "./normalize";
import type { StorageRepository } from "./repository";
import type { PersistedCompetition, PersistedSession } from "./types";

export const MIGRATION_KEY = "cbt_idb_migration";
export const LEGACY_SESSIONS_KEY = "cubeboxtimer_sessions";
export const LEGACY_COMPETITIONS_KEY = "cubeboxtimer_competitions";

// Mirrors the hooks' current behavior for an unparseable blob: warn and
// start fresh. The blob itself is left in place either way.
function readLegacyArray(key: string): unknown[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logger.warn("Legacy data is unparseable; migrating without it. The blob is kept as-is.", {
      key,
      error,
    });
    return [];
  }
}

// A record that is not a plain object cannot survive normalization; drop it
// with a log line rather than aborting the migration and stranding the
// valid records around it.
function keepPlainObjects<T>(records: unknown[], key: string): T[] {
  const kept = records.filter(
    (record) => typeof record === "object" && record !== null && !Array.isArray(record)
  ) as T[];
  if (kept.length !== records.length) {
    logger.warn("Skipped malformed legacy records during migration.", {
      key,
      skippedCount: records.length - kept.length,
    });
  }
  return kept;
}

// Data arrived via JSON.parse, so JSON equality is exact equality here.
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function runMigration(repository: StorageRepository): Promise<void> {
  const sessions = normalizeSessionsShape(
    keepPlainObjects<PersistedSession>(readLegacyArray(LEGACY_SESSIONS_KEY), LEGACY_SESSIONS_KEY)
  );
  const competitions = normalizeCompetitionsShape(
    keepPlainObjects<PersistedCompetition>(
      readLegacyArray(LEGACY_COMPETITIONS_KEY),
      LEGACY_COMPETITIONS_KEY
    )
  );

  localStorage.setItem(MIGRATION_KEY, "in-progress");
  await repository.saveSessions(sessions);
  await repository.saveCompetitions(competitions);

  const [storedSessions, storedCompetitions] = await Promise.all([
    repository.loadSessions(),
    repository.loadCompetitions(),
  ]);
  if (!sameJson(storedSessions, sessions) || !sameJson(storedCompetitions, competitions)) {
    throw new Error("Migration verification failed: stored data does not match legacy data.");
  }

  localStorage.setItem(MIGRATION_KEY, "complete");
  logger.info("Migrated legacy localStorage data to IndexedDB.", {
    sessionCount: sessions.length,
    competitionCount: competitions.length,
  });
}

// One in-flight migration per repository: both data hooks hydrate at
// startup and must share a single copy attempt. A rejected attempt is
// forgotten so the next hydration retries.
const inFlight = new WeakMap<StorageRepository, Promise<void>>();

export function migrateIfNeeded(repository: StorageRepository): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY) === "complete") return Promise.resolve();
  let pending = inFlight.get(repository);
  if (!pending) {
    pending = runMigration(repository).catch((error) => {
      inFlight.delete(repository);
      throw error;
    });
    inFlight.set(repository, pending);
  }
  return pending;
}
