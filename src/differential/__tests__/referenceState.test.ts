import { describe, it, expect } from "vitest";
import { applyOperation, emptyReferenceState, flattenForAnalytics } from "../referenceState";
import { createEmptySolves } from "../../storage/normalize";

const session = (id: string) => ({
  type: "AddSession" as const,
  session: { id, name: `Session ${id}`, createdAt: 1000, solves: createEmptySolves() },
});

const solve = (id: string, overrides = {}) => ({
  id,
  millis: 10000,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: 1000,
  ...overrides,
});

const addSolve = (sessionId: string, solveId: string, overrides = {}) => ({
  type: "AddSolve" as const,
  sessionId,
  cubeDimension: "3x3x3",
  solve: solve(solveId, overrides),
});

const competition = (id: string, date: string) => ({
  type: "AddCompetitionResult" as const,
  competition: {
    id,
    competitionName: `Comp ${id}`,
    date,
    event: "3x3x3",
    bestMs: 9000,
    averageMs: 11000,
    source: "manual",
    wcaCompetitionId: null,
    wcaRoundId: null,
    roundLabel: null,
    wcaId: null,
  },
});

describe("applyOperation", () => {
  it("starts from an empty state and builds sessions with solves", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, session("s1"));
    state = applyOperation(state, addSolve("s1", "a"));
    state = applyOperation(state, addSolve("s1", "b", { penalty: "+2" }));
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].solves["3x3x3"].map((s) => s.id)).toEqual(["a", "b"]);
    expect(state.sessions[0].solves["3x3x3"][1].penalty).toBe("+2");
  });

  it("UpdateSolve merges the patch into exactly the matching solve", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, session("s1"));
    state = applyOperation(state, addSolve("s1", "a"));
    state = applyOperation(state, addSolve("s1", "b"));
    state = applyOperation(state, {
      type: "UpdateSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "b",
      patch: { penalty: "DNF" },
    });
    expect(state.sessions[0].solves["3x3x3"][0].penalty).toBeNull();
    expect(state.sessions[0].solves["3x3x3"][1].penalty).toBe("DNF");
    expect(state.sessions[0].solves["3x3x3"][1].millis).toBe(10000); // untouched fields survive
  });

  it("UpdateSolve on a missing solve is a no-op, mirroring the hook", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, session("s1"));
    state = applyOperation(state, addSolve("s1", "a"));
    const next = applyOperation(state, {
      type: "UpdateSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "ghost",
      patch: { penalty: "DNF" },
    });
    expect(next.sessions[0].solves["3x3x3"]).toEqual(state.sessions[0].solves["3x3x3"]);
  });

  it("DeleteSolve removes only the matching solve", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, session("s1"));
    state = applyOperation(state, addSolve("s1", "a"));
    state = applyOperation(state, addSolve("s1", "b"));
    state = applyOperation(state, {
      type: "DeleteSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "a",
    });
    expect(state.sessions[0].solves["3x3x3"].map((s) => s.id)).toEqual(["b"]);
  });

  it("keeps events separate: a 2x2x2 solve never appears under 3x3x3", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, session("s1"));
    state = applyOperation(state, {
      type: "AddSolve", sessionId: "s1", cubeDimension: "2x2x2",
      solve: solve("two", { cubeDimension: "2x2x2" }),
    });
    expect(state.sessions[0].solves["2x2x2"].map((s) => s.id)).toEqual(["two"]);
    expect(state.sessions[0].solves["3x3x3"] || []).toEqual([]);
    const flat = flattenForAnalytics(state);
    expect(flat.solvesByEvent["2x2x2"].map((s) => s.id)).toEqual(["two"]);
    expect(flat.solvesByEvent["3x3x3"]).toEqual([]);
  });

  it("AddCompetitionResult keeps competitions sorted by date, like the hook", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, competition("late", "2026-06-01T00:00:00.000Z"));
    state = applyOperation(state, competition("early", "2026-01-01T00:00:00.000Z"));
    expect(state.competitions.map((c) => c.id)).toEqual(["early", "late"]);
  });

  it("UpdateCompetitionResult merges by id; DeleteCompetitionResult filters by id", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, competition("c1", "2026-01-01T00:00:00.000Z"));
    state = applyOperation(state, competition("c2", "2026-02-01T00:00:00.000Z"));
    state = applyOperation(state, {
      type: "UpdateCompetitionResult", competitionId: "c1", patch: { averageMs: 9999 },
    });
    expect(state.competitions.find((c) => c.id === "c1")?.averageMs).toBe(9999);
    state = applyOperation(state, { type: "DeleteCompetitionResult", competitionId: "c1" });
    expect(state.competitions.map((c) => c.id)).toEqual(["c2"]);
  });

  it("RemoveSession drops the session and its solves", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, session("s1"));
    state = applyOperation(state, session("s2"));
    state = applyOperation(state, addSolve("s2", "a"));
    state = applyOperation(state, { type: "RemoveSession", sessionId: "s2" });
    expect(state.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(flattenForAnalytics(state).solvesByEvent["3x3x3"]).toEqual([]);
  });

  it("never mutates the input state", () => {
    let state = emptyReferenceState();
    state = applyOperation(state, session("s1"));
    state = applyOperation(state, addSolve("s1", "a"));
    const snapshot = structuredClone(state);
    applyOperation(state, addSolve("s1", "b"));
    applyOperation(state, {
      type: "UpdateSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "a",
      patch: { penalty: "DNF" },
    });
    applyOperation(state, { type: "DeleteSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "a" });
    applyOperation(state, competition("c1", "2026-01-01T00:00:00.000Z"));
    expect(state).toEqual(snapshot);
  });

  it("rejects malformed operations with a clear error", () => {
    const state = emptyReferenceState();
    expect(() => applyOperation(state, null)).toThrow(/invalid operation/);
    expect(() => applyOperation(state, { type: "SetPenalty", solveId: "a" })).toThrow(/invalid operation/);
    expect(() => applyOperation(state, { type: "AddSolve", cubeDimension: "3x3x3", solve: solve("x") }))
      .toThrow(/invalid operation/);
  });

  it("rejects AddSolve targeting a session that does not exist", () => {
    expect(() => applyOperation(emptyReferenceState(), addSolve("ghost", "a"))).toThrow(
      /unknown session/
    );
  });
});
