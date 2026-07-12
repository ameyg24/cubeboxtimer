// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  migrateIfNeeded,
  MIGRATION_KEY,
  LEGACY_SESSIONS_KEY,
  LEGACY_COMPETITIONS_KEY,
} from "../migration";
import { createMemoryRepository } from "../repository";
import type { StorageRepository } from "../repository";

const legacySessions = [
  {
    id: "s1",
    name: "Morning",
    createdAt: 1000,
    solves: {
      "2x2x2": [],
      "3x3x3": [
        { id: "a", millis: 12340, penalty: null, cubeDimension: "3x3x3", localCreatedAt: 1000 },
        { id: "b", millis: 9990, penalty: "+2", cubeDimension: "3x3x3", localCreatedAt: 2000 },
      ],
      "4x4x4": [],
      "5x5x5": [],
    },
  },
];

const legacyCompetitions = [
  {
    id: "c1",
    competitionName: "Nationals 2026",
    date: "2026-05-01T00:00:00.000Z",
    event: "3x3x3",
    bestMs: 9500,
    averageMs: 11200,
    source: "wca-import",
    wcaCompetitionId: "Nationals2026",
    wcaRoundId: 1,
    roundLabel: "First round",
    wcaId: "2019GABA01",
  },
];

function seedLegacy() {
  localStorage.setItem(LEGACY_SESSIONS_KEY, JSON.stringify(legacySessions));
  localStorage.setItem(LEGACY_COMPETITIONS_KEY, JSON.stringify(legacyCompetitions));
}

beforeEach(() => {
  localStorage.clear();
});

describe("migrateIfNeeded", () => {
  it("with no legacy data, marks complete and leaves storage empty", async () => {
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
    expect(await repo.loadSessions()).toEqual([]);
    expect(await repo.loadCompetitions()).toEqual([]);
  });

  it("moves valid legacy data with IDs, timestamps, penalties, and WCA metadata unchanged", async () => {
    seedLegacy();
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    const sessions = await repo.loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].solves["3x3x3"].map((s) => s.id)).toEqual(["a", "b"]);
    expect(sessions[0].solves["3x3x3"][1].localCreatedAt).toBe(2000);
    expect(sessions[0].solves["3x3x3"][1].penalty).toBe("+2");
    const competitions = await repo.loadCompetitions();
    expect(competitions[0]).toMatchObject({ id: "c1", wcaCompetitionId: "Nationals2026", wcaRoundId: 1 });
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
  });

  it("preserves the legacy localStorage keys after a successful migration", async () => {
    seedLegacy();
    await migrateIfNeeded(createMemoryRepository());
    expect(localStorage.getItem(LEGACY_SESSIONS_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_COMPETITIONS_KEY)).not.toBeNull();
  });

  it("is a no-op when already complete (rerun after success)", async () => {
    seedLegacy();
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    await repo.saveSessions([]); // post-migration state diverges from legacy
    await migrateIfNeeded(repo);
    expect(await repo.loadSessions()).toEqual([]); // legacy did NOT overwrite newer state
  });

  it("is idempotent: an interrupted attempt retried produces no duplicates", async () => {
    seedLegacy();
    const repo = createMemoryRepository();
    // First attempt dies after sessions were written but before verification.
    const failing: StorageRepository = {
      ...repo,
      saveCompetitions: async () => {
        throw new Error("simulated crash");
      },
    };
    await expect(migrateIfNeeded(failing)).rejects.toThrow("simulated crash");
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("in-progress");
    // Retry with a healthy repository.
    await migrateIfNeeded(repo);
    const sessions = await repo.loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].solves["3x3x3"]).toHaveLength(2);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
  });

  it("the inverse partial failure (sessions write fails first) leaves competitions unwritten and retry heals both", async () => {
    seedLegacy();
    const repo = createMemoryRepository();
    const competitionsSpy = vi.spyOn(repo, "saveCompetitions");
    const failing: StorageRepository = {
      ...repo,
      saveSessions: async () => {
        throw new Error("simulated crash");
      },
    };
    await expect(migrateIfNeeded(failing)).rejects.toThrow("simulated crash");
    // The copy is sequential, so nothing was written past the failure.
    expect(competitionsSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("in-progress");
    expect(localStorage.getItem(LEGACY_SESSIONS_KEY)).not.toBeNull();

    await migrateIfNeeded(repo);
    expect((await repo.loadSessions()).map((s) => s.id)).toEqual(["s1"]);
    expect((await repo.loadCompetitions()).map((c) => c.id)).toEqual(["c1"]);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
  });

  it("skips malformed individual competition records but keeps valid ones", async () => {
    localStorage.setItem(
      LEGACY_COMPETITIONS_KEY,
      JSON.stringify([null, 42, "not a competition", ...legacyCompetitions])
    );
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    const competitions = await repo.loadCompetitions();
    // Exactly the valid record - the junk entries must not become invented
    // records via normalizeCompetitionDoc's id fallback.
    expect(competitions.map((c) => c.id)).toEqual(["c1"]);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
    expect(localStorage.getItem(LEGACY_COMPETITIONS_KEY)).not.toBeNull();
  });

  it("does not mark complete if verification reads back different data", async () => {
    seedLegacy();
    const repo = createMemoryRepository();
    const lying: StorageRepository = {
      ...repo,
      loadSessions: async () => [], // simulated write that did not land
    };
    await expect(migrateIfNeeded(lying)).rejects.toThrow(/verification/i);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("in-progress");
    expect(localStorage.getItem(LEGACY_SESSIONS_KEY)).not.toBeNull();
  });

  it("a marker stuck at in-progress (page closed midway) restarts the copy from legacy", async () => {
    seedLegacy();
    localStorage.setItem(MIGRATION_KEY, "in-progress");
    const repo = createMemoryRepository();
    // Partial junk from the interrupted attempt.
    await repo.saveSessions([{ id: "partial", solves: {} }]);
    await migrateIfNeeded(repo);
    const sessions = await repo.loadSessions();
    expect(sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
  });

  it("a marker written too early (complete but marker forged) never re-copies legacy", async () => {
    seedLegacy();
    localStorage.setItem(MIGRATION_KEY, "complete");
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    // Legacy is NOT copied: complete means IndexedDB owns the data now,
    // even if it is empty. Copying would resurrect deleted records.
    expect(await repo.loadSessions()).toEqual([]);
  });

  it("skips malformed individual session records but keeps valid ones", async () => {
    localStorage.setItem(
      LEGACY_SESSIONS_KEY,
      JSON.stringify([null, "not a session", ...legacySessions])
    );
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    const sessions = await repo.loadSessions();
    expect(sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
  });

  it("treats an unparseable legacy blob like the current loader does: starts fresh, keeps the blob", async () => {
    localStorage.setItem(LEGACY_SESSIONS_KEY, "{corrupted");
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    expect(await repo.loadSessions()).toEqual([]);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("complete");
    expect(localStorage.getItem(LEGACY_SESSIONS_KEY)).toBe("{corrupted");
  });

  it("normalizes legacy records through the shared normalization rules", async () => {
    // Array-shaped solves are the oldest legacy format: plain 3x3x3 list.
    localStorage.setItem(
      LEGACY_SESSIONS_KEY,
      JSON.stringify([{ id: "s1", name: "Old", createdAt: 1, solves: [{ id: "x", millis: 5000 }] }])
    );
    const repo = createMemoryRepository();
    await migrateIfNeeded(repo);
    const [session] = await repo.loadSessions();
    expect(session.solves["3x3x3"][0]).toMatchObject({ id: "x", cubeDimension: "3x3x3" });
    expect(session.solves["2x2x2"]).toEqual([]);
  });

  it("concurrent calls migrate once (single in-flight promise)", async () => {
    seedLegacy();
    const repo = createMemoryRepository();
    const spy = vi.spyOn(repo, "saveSessions");
    await Promise.all([migrateIfNeeded(repo), migrateIfNeeded(repo)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
