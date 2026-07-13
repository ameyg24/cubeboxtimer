import { describe, it, expect } from "vitest";
import { replayOperations } from "../replay";
import { applyOperation, emptyReferenceState, flattenForAnalytics } from "../referenceState";
import { createOperationGenerator, ANALYTICS_NOW } from "../operationGenerator";
import { referenceAnalytics, createProductionAnalytics, firstDifference } from "../differential";
import type { Operation } from "../../storage/operations";

// A scripted mixed sequence covering imports (wca-import payloads and
// csTimer-shaped solves), penalties, DNFs, edits, deletes, and sessions.
const scripted: Operation[] = [
  { type: "AddSession", session: { id: "s1", name: "Session 1", createdAt: 1000, solves: { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] } } },
  { type: "AddSolve", sessionId: "s1", cubeDimension: "3x3x3", solve: { id: "a", millis: 12000, penalty: null, reviewed: false, cubeDimension: "3x3x3", localCreatedAt: 2000 } },
  { type: "AddSolve", sessionId: "s1", cubeDimension: "3x3x3", solve: { id: "b", millis: 9000, penalty: null, reviewed: true, cubeDimension: "3x3x3", localCreatedAt: 3000, scramble: "R U R' U'" } },
  { type: "UpdateSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "b", patch: { penalty: "+2" } },
  { type: "AddSolve", sessionId: "s1", cubeDimension: "2x2x2", solve: { id: "c", millis: 3000, penalty: "DNF", reviewed: true, cubeDimension: "2x2x2", localCreatedAt: 4000 } },
  { type: "AddCompetitionResult", competition: { id: "m1", competitionName: "Manual Open", date: "2026-02-01T00:00:00.000Z", event: "3x3x3", bestMs: 8500, averageMs: 10200, source: "manual", wcaCompetitionId: null, wcaRoundId: null, roundLabel: null, wcaId: null } },
  { type: "AddCompetitionResult", competition: { id: "w1", competitionName: "Imported Champs", date: "2026-01-10T00:00:00.000Z", event: "3x3x3", bestMs: 9100, averageMs: 11000, source: "wca-import", wcaCompetitionId: "ImportedChamps2026", wcaRoundId: 1, roundLabel: "Final", wcaId: "2019GABA01" } },
  { type: "UpdateCompetitionResult", competitionId: "w1", patch: { averageMs: 10800 } },
  { type: "DeleteSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "a" },
  { type: "AddSession", session: { id: "s2", name: "Session 2", createdAt: 5000, solves: { "2x2x2": [], "3x3x3": [], "4x4x4": [], "5x5x5": [] } } },
  { type: "AddSolve", sessionId: "s2", cubeDimension: "3x3x3", solve: { id: "d", millis: 8000, penalty: null, reviewed: false, cubeDimension: "3x3x3", localCreatedAt: 6000 } },
  { type: "RemoveSession", sessionId: "s2" },
  { type: "DeleteCompetitionResult", competitionId: "m1" },
];

describe("replayOperations", () => {
  it("snapshot + ordered operations reproduce the step-by-step state exactly", () => {
    let expected = emptyReferenceState();
    for (const op of scripted) expected = applyOperation(expected, op);
    const outcome = replayOperations(emptyReferenceState(), scripted);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.state).toEqual(expected);
  });

  it("is deterministic across repeated runs", () => {
    const first = replayOperations(emptyReferenceState(), scripted);
    const second = replayOperations(emptyReferenceState(), scripted);
    expect(second).toEqual(first);
    expect(structuredClone(first)).toEqual(second); // and serializable
  });

  it("replays from a mid-history snapshot to the same final state as from the start", () => {
    const cut = 6;
    const full = replayOperations(emptyReferenceState(), scripted);
    const prefix = replayOperations(emptyReferenceState(), scripted.slice(0, cut));
    if (!prefix.ok || !full.ok) throw new Error("expected success");
    const resumed = replayOperations(prefix.state, scripted.slice(cut));
    if (!resumed.ok) throw new Error("expected success");
    expect(resumed.state).toEqual(full.state);
  });

  it("does not mutate the initial snapshot", () => {
    const initial = emptyReferenceState();
    const snapshot = structuredClone(initial);
    replayOperations(initial, scripted);
    expect(initial).toEqual(snapshot);
  });

  it("reports the failing index, operation, and prior state on invalid input", () => {
    const operations = [scripted[0], { type: "AddSolve", sessionId: "ghost", cubeDimension: "3x3x3", solve: { id: "x", millis: 1, cubeDimension: "3x3x3" } }];
    const outcome = replayOperations(emptyReferenceState(), operations);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.operationIndex).toBe(1);
    expect(outcome.reason).toMatch(/unknown session/);
    expect(outcome.stateBeforeFailure.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("replays any generated differential sequence to the harness's exact final state", () => {
    for (const seed of [1, 8, 99]) {
      const generator = createOperationGenerator(seed);
      let state = emptyReferenceState();
      const operations: Operation[] = [];
      for (let i = 0; i < 60; i++) {
        const op = generator.next(state);
        operations.push(op);
        state = applyOperation(state, op);
      }
      const replayed = replayOperations(emptyReferenceState(), operations);
      expect(replayed.ok).toBe(true);
      if (replayed.ok) expect(replayed.state).toEqual(state);
    }
  });

  it("a replayed state initializes the worker to analytics identical to direct computation", { timeout: 30000 }, () => {
    const outcome = replayOperations(emptyReferenceState(), scripted);
    if (!outcome.ok) throw new Error("expected success");
    const production = createProductionAnalytics();
    production.initialize(outcome.state, 1);
    for (const event of ["3x3x3", "2x2x2"]) {
      const expected = referenceAnalytics(outcome.state, event, ANALYTICS_NOW);
      const actual = production.compute(event, ANALYTICS_NOW, 1);
      for (const node of Object.keys(expected)) {
        const diff = firstDifference(expected[node], actual[node]);
        expect(diff, `${event}/${node}`).toBeNull();
      }
    }
    // And the worker dataset itself is reconstructed exactly.
    const flat = flattenForAnalytics(outcome.state);
    expect(flat.solvesByEvent["3x3x3"].map((s) => s.id)).toEqual(["b"]);
    expect(flat.solvesByEvent["2x2x2"].map((s) => s.id)).toEqual(["c"]);
    expect(flat.competitions.map((c) => c.id)).toEqual(["w1"]);
  });
});
