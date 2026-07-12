import { describe, it, expect, beforeEach } from "vitest";
import type { StorageRepository } from "../repository";
import type { PersistedCompetition, PersistedSession } from "../types";

const session = (id: string, overrides: Partial<PersistedSession> = {}): PersistedSession => ({
  id,
  name: `Session ${id}`,
  createdAt: 1000,
  solves: {
    "2x2x2": [],
    "3x3x3": [
      { id: `${id}-a`, millis: 12340, penalty: null, reviewed: false, cubeDimension: "3x3x3", localCreatedAt: 1000 },
      { id: `${id}-b`, millis: 9990, penalty: "+2", reviewed: true, cubeDimension: "3x3x3", localCreatedAt: 2000, scramble: "R U R' U'" },
    ],
    "4x4x4": [],
    "5x5x5": [],
  },
  ...overrides,
});

const competition = (id: string, overrides: Partial<PersistedCompetition> = {}): PersistedCompetition => ({
  id,
  competitionName: `Comp ${id}`,
  date: "2026-05-01T00:00:00.000Z",
  event: "3x3x3",
  bestMs: 9500,
  averageMs: 11200,
  source: "wca-import",
  wcaCompetitionId: "Nationals2026",
  wcaRoundId: 1,
  roundLabel: "First round",
  wcaId: "2019GABA01",
  ...overrides,
});

// Every repository implementation must pass this suite; the memory and
// IndexedDB test files run it against their own factory.
export function describeRepositoryContract(
  name: string,
  makeRepository: () => Promise<StorageRepository> | StorageRepository
) {
  describe(`${name} repository contract`, () => {
    let repo: StorageRepository;

    beforeEach(async () => {
      repo = await makeRepository();
    });

    it("returns empty arrays from empty storage", async () => {
      expect(await repo.loadSessions()).toEqual([]);
      expect(await repo.loadCompetitions()).toEqual([]);
    });

    it("round-trips sessions with every field intact, including unknown extras", async () => {
      const sessions = [session("s1"), session("s2", { extraField: "kept" })];
      await repo.saveSessions(sessions);
      expect(await repo.loadSessions()).toEqual(sessions);
    });

    it("round-trips competitions with WCA identity fields intact", async () => {
      const competitions = [competition("c1"), competition("c2", { notes: "pb day" })];
      await repo.saveCompetitions(competitions);
      expect(await repo.loadCompetitions()).toEqual(competitions);
    });

    it("save replaces the previous snapshot: removed records do not resurface", async () => {
      await repo.saveSessions([session("s1"), session("s2")]);
      await repo.saveSessions([session("s1")]);
      const loaded = await repo.loadSessions();
      expect(loaded.map((s) => s.id)).toEqual(["s1"]);
    });

    it("save updates existing records in place by id", async () => {
      await repo.saveCompetitions([competition("c1")]);
      await repo.saveCompetitions([competition("c1", { bestMs: 9000 })]);
      const loaded = await repo.loadCompetitions();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].bestMs).toBe(9000);
    });

    it("preserves array order deterministically across repeated loads", async () => {
      const sessions = [session("older", { createdAt: 1 }), session("newer", { createdAt: 2 })];
      await repo.saveSessions(sessions);
      const first = await repo.loadSessions();
      const second = await repo.loadSessions();
      expect(first.map((s) => s.id)).toEqual(["older", "newer"]);
      expect(second).toEqual(first);
    });

    it("does not mutate its inputs", async () => {
      const sessions = [session("s1")];
      const snapshot = structuredClone(sessions);
      await repo.saveSessions(sessions);
      expect(sessions).toEqual(snapshot);
    });

    it("returned records are not live references to stored state", async () => {
      await repo.saveSessions([session("s1")]);
      const loaded = await repo.loadSessions();
      loaded[0].name = "mutated by caller";
      expect((await repo.loadSessions())[0].name).toBe("Session s1");
    });

    it("sessions and competitions are independent stores", async () => {
      await repo.saveSessions([session("s1")]);
      await repo.saveCompetitions([competition("c1")]);
      await repo.saveSessions([]);
      expect(await repo.loadSessions()).toEqual([]);
      expect((await repo.loadCompetitions()).map((c) => c.id)).toEqual(["c1"]);
    });

    it("rapid unawaited saves settle on the last call's snapshot, never an older one", async () => {
      // The hooks fire saveSessions once per state change without awaiting;
      // consecutive calls must not complete out of order. For IndexedDB this
      // holds because transaction creation order follows call order (the
      // awaits resolve in microtask FIFO) and readwrite transactions on one
      // store are serialized in creation order.
      const snapshots = Array.from({ length: 8 }, (_, i) => [session(`snap-${i}`)]);
      await Promise.all(snapshots.map((snapshot) => repo.saveSessions(snapshot)));
      expect((await repo.loadSessions()).map((s) => s.id)).toEqual(["snap-7"]);

      const competitionSnapshots = Array.from({ length: 8 }, (_, i) => [competition(`comp-${i}`)]);
      await Promise.all(competitionSnapshots.map((snapshot) => repo.saveCompetitions(snapshot)));
      expect((await repo.loadCompetitions()).map((c) => c.id)).toEqual(["comp-7"]);
    });

    it("a shrinking snapshot issued after a larger one wins (no resurrection)", async () => {
      const larger = [session("s1"), session("s2"), session("s3")];
      const smaller = [session("s2")];
      await Promise.all([repo.saveSessions(larger), repo.saveSessions(smaller)]);
      expect((await repo.loadSessions()).map((s) => s.id)).toEqual(["s2"]);
    });

    it("solve IDs, timestamps, penalties, and import metadata survive unchanged", async () => {
      const source = session("s1");
      await repo.saveSessions([source]);
      const [loaded] = await repo.loadSessions();
      const solve = loaded.solves["3x3x3"][1];
      expect(solve.id).toBe("s1-b");
      expect(solve.localCreatedAt).toBe(2000);
      expect(solve.penalty).toBe("+2");
      expect(solve.scramble).toBe("R U R' U'");
    });
  });
}
