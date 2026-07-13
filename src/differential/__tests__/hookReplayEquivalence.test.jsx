// @vitest-environment jsdom
//
// The proof this phase exists for: applying captured operations through the
// reference reducer reproduces EXACTLY the state the real hooks build via
// their own mutation paths. Phase 2 explicitly flagged this equivalence as
// unproven; with it, "snapshot + ordered operations" honestly reproduces
// what the application itself would have computed.
//
// Method: drive the real hooks (signed out, IndexedDB-backed), capture the
// vocabulary operation corresponding to each mutation (ids and generated
// values are read back from hook state, exactly as a capture layer would),
// replay from the post-hydration snapshot, and require deep equality with
// the hook's final state.
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSolveSessions } from "../../hooks/useSolveSessions.js";
import { useCompetitionResults } from "../../hooks/useCompetitionResults.js";
import { replayOperations } from "../replay";

const solve = (id, overrides = {}) => ({
  id,
  millis: 10000,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: 1000,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

async function renderSessions() {
  const utils = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
  await waitFor(() => expect(utils.result.current.sessions.length).toBeGreaterThan(0));
  return utils;
}

const sessionsSnapshot = (result) => structuredClone({
  sessions: result.current.sessions,
  competitions: [],
});

describe("hook replay equivalence: solves and sessions", () => {
  it("replay after solve adds (timer, backfill, and csTimer-import shapes) reproduces hook state exactly", async () => {
    const { result } = await renderSessions();
    const snapshot = sessionsSnapshot(result);
    const sessionId = result.current.activeSessionId;

    const timerSolve = solve("t1", { millis: 12340, reviewed: false, localCreatedAt: 2000 });
    const backfill = solve("t2", { millis: 11000, cubeDimension: "4x4x4", localCreatedAt: 3000 });
    const imported = solve("t3", { millis: 9500, reviewed: true, localCreatedAt: 4000, scramble: "R U R' U'" });

    act(() => {
      result.current.addSolve(timerSolve);
    });
    act(() => {
      result.current.addSolve(backfill, "4x4x4"); // the manual "Add past solve" path
    });
    act(() => {
      result.current.addSolve(imported); // the csTimer import path calls addSolve per row
    });

    const operations = [
      { type: "AddSolve", sessionId, cubeDimension: "3x3x3", solve: timerSolve },
      { type: "AddSolve", sessionId, cubeDimension: "4x4x4", solve: backfill },
      { type: "AddSolve", sessionId, cubeDimension: "3x3x3", solve: imported },
    ];
    const replayed = replayOperations(snapshot, operations);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state.sessions).toEqual(result.current.sessions);
  });

  it("replay after penalty edits and DNFs reproduces hook state exactly", async () => {
    const { result } = await renderSessions();
    const snapshot = sessionsSnapshot(result);
    const sessionId = result.current.activeSessionId;

    const a = solve("a", { millis: 10000, localCreatedAt: 2000 });
    const b = solve("b", { millis: 11000, localCreatedAt: 3000 });
    act(() => {
      result.current.addSolve(a);
      result.current.addSolve(b);
    });
    // Hook updates are by index; the operation carries the id, exactly as
    // the write queue records it.
    act(() => {
      result.current.updateSolve(0, { penalty: "+2" });
    });
    act(() => {
      result.current.updateSolve(1, { penalty: "DNF" });
    });
    act(() => {
      result.current.updateSolve(1, { penalty: null });
    });

    const operations = [
      { type: "AddSolve", sessionId, cubeDimension: "3x3x3", solve: a },
      { type: "AddSolve", sessionId, cubeDimension: "3x3x3", solve: b },
      { type: "UpdateSolve", sessionId, cubeDimension: "3x3x3", solveId: "a", patch: { penalty: "+2" } },
      { type: "UpdateSolve", sessionId, cubeDimension: "3x3x3", solveId: "b", patch: { penalty: "DNF" } },
      { type: "UpdateSolve", sessionId, cubeDimension: "3x3x3", solveId: "b", patch: { penalty: null } },
    ];
    const replayed = replayOperations(snapshot, operations);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state.sessions).toEqual(result.current.sessions);
  });

  it("replay after deletes (including the Undo path, which deletes the last solve) reproduces hook state exactly", async () => {
    const { result } = await renderSessions();
    const snapshot = sessionsSnapshot(result);
    const sessionId = result.current.activeSessionId;

    const ids = ["a", "b", "c"];
    act(() => {
      ids.forEach((id, i) => result.current.addSolve(solve(id, { localCreatedAt: 2000 + i })));
    });
    act(() => {
      result.current.deleteSolve(2); // SolveList's Undo button: deleteSolve(last index)
    });
    act(() => {
      result.current.deleteSolve(0);
    });

    const operations = [
      ...ids.map((id, i) => ({
        type: "AddSolve", sessionId, cubeDimension: "3x3x3",
        solve: solve(id, { localCreatedAt: 2000 + i }),
      })),
      { type: "DeleteSolve", sessionId, cubeDimension: "3x3x3", solveId: "c" },
      { type: "DeleteSolve", sessionId, cubeDimension: "3x3x3", solveId: "a" },
    ];
    const replayed = replayOperations(snapshot, operations);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state.sessions).toEqual(result.current.sessions);
  });

  it("replay after session creation and removal reproduces hook state exactly", async () => {
    const { result } = await renderSessions();
    const snapshot = sessionsSnapshot(result);
    const firstSessionId = result.current.activeSessionId;

    await act(async () => {
      await result.current.addSession();
    });
    // The hook generates the id/name/createdAt internally; a capture layer
    // reads them back from state, which is what makes replay deterministic.
    const created = result.current.sessions.find((s) => s.id !== firstSessionId);
    act(() => {
      result.current.addSolve(solve("in-new", { localCreatedAt: 5000 }));
    });
    await act(async () => {
      await result.current.removeSession(firstSessionId);
    });

    const operations = [
      { type: "AddSession", session: structuredClone(created) },
      // addSolve targeted the ACTIVE session, which addSession switched to
      // the new one.
      { type: "AddSolve", sessionId: created.id, cubeDimension: "3x3x3", solve: solve("in-new", { localCreatedAt: 5000 }) },
      { type: "RemoveSession", sessionId: firstSessionId },
    ];
    const replayed = replayOperations(snapshot, operations);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state.sessions).toEqual(result.current.sessions);
  });
});

describe("hook replay equivalence: competitions", () => {
  it("replay after manual entry, WCA-import add/update, and delete reproduces hook state exactly", async () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));
    await act(async () => {});
    const snapshot = { sessions: [], competitions: structuredClone(result.current.competitions) };

    let manualId;
    act(() => {
      manualId = result.current.addCompetitionResult({
        competitionName: "Manual Open", date: "2026-03-01T00:00:00.000Z", event: "3x3x3",
        bestMs: 9000, averageMs: 11000, source: "manual",
      });
    });
    let importedId;
    act(() => {
      importedId = result.current.addCompetitionResult({
        competitionName: "Imported Champs", date: "2026-01-10T00:00:00.000Z", event: "3x3x3",
        bestMs: 9100, averageMs: 11200, source: "wca-import",
        wcaCompetitionId: "ImportedChamps2026", wcaRoundId: 1, roundLabel: "Final", wcaId: "2019GABA01",
      });
    });
    // Re-import updating the existing round, then a delete.
    act(() => {
      result.current.updateCompetitionResult(importedId, { averageMs: 10900, bestMs: 8900 });
    });
    act(() => {
      result.current.deleteCompetitionResult(manualId);
    });

    // The hook normalizes inputs on add; a capture layer records the
    // normalized record, which is exactly what hook state holds. The
    // update happened after, so reconstruct the added record from the
    // final state plus the inverse of the patch.
    const imported = result.current.competitions.find((c) => c.id === importedId);
    const importedAsAdded = { ...structuredClone(imported), averageMs: 11200, bestMs: 9100 };
    const manualAsAdded = {
      id: manualId, competitionName: "Manual Open", date: "2026-03-01T00:00:00.000Z", event: "3x3x3",
      bestMs: 9000, averageMs: 11000, source: "manual", notes: undefined,
      wcaCompetitionId: null, wcaRoundId: null, roundLabel: null, wcaId: null,
    };

    const operations = [
      { type: "AddCompetitionResult", competition: manualAsAdded },
      { type: "AddCompetitionResult", competition: importedAsAdded },
      { type: "UpdateCompetitionResult", competitionId: importedId, patch: { averageMs: 10900, bestMs: 8900 } },
      { type: "DeleteCompetitionResult", competitionId: manualId },
    ];
    const replayed = replayOperations(snapshot, operations);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.state.competitions).toEqual(result.current.competitions);
  });
});

describe("hook replay equivalence: mixed sequence determinism", () => {
  it("a mixed 12-step sequence replays identically on repeated runs and matches the hook", async () => {
    const { result } = await renderSessions();
    const snapshot = sessionsSnapshot(result);
    const sessionId = result.current.activeSessionId;

    const steps = [
      () => result.current.addSolve(solve("m1", { localCreatedAt: 2001 })),
      () => result.current.addSolve(solve("m2", { millis: 8000, localCreatedAt: 2002 })),
      () => result.current.updateSolve(1, { penalty: "+2" }),
      () => result.current.addSolve(solve("m3", { cubeDimension: "2x2x2", localCreatedAt: 2003 }), "2x2x2"),
      () => result.current.updateSolve(0, { penalty: "DNF" }),
      () => result.current.deleteSolve(0),
      () => result.current.addSolve(solve("m4", { millis: 7500, localCreatedAt: 2004 })),
    ];
    for (const step of steps) {
      act(() => {
        step();
      });
    }

    const operations = [
      { type: "AddSolve", sessionId, cubeDimension: "3x3x3", solve: solve("m1", { localCreatedAt: 2001 }) },
      { type: "AddSolve", sessionId, cubeDimension: "3x3x3", solve: solve("m2", { millis: 8000, localCreatedAt: 2002 }) },
      { type: "UpdateSolve", sessionId, cubeDimension: "3x3x3", solveId: "m2", patch: { penalty: "+2" } },
      { type: "AddSolve", sessionId, cubeDimension: "2x2x2", solve: solve("m3", { cubeDimension: "2x2x2", localCreatedAt: 2003 }) },
      { type: "UpdateSolve", sessionId, cubeDimension: "3x3x3", solveId: "m1", patch: { penalty: "DNF" } },
      { type: "DeleteSolve", sessionId, cubeDimension: "3x3x3", solveId: "m1" },
      { type: "AddSolve", sessionId, cubeDimension: "3x3x3", solve: solve("m4", { millis: 7500, localCreatedAt: 2004 }) },
    ];
    const first = replayOperations(snapshot, operations);
    const second = replayOperations(structuredClone(snapshot), structuredClone(operations));
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (first.ok) expect(first.state.sessions).toEqual(result.current.sessions);
  });
});
