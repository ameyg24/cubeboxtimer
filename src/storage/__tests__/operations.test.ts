import { describe, it, expect } from "vitest";
import { validateOperation } from "../operations";
import type { Operation } from "../operations";

// One valid example per operation type, shaped exactly like the mutation
// call sites that will emit them: addSolve/updateSolve/deleteSolve and
// addSession/removeSession in useSolveSessions.js, addCompetitionResult/
// updateCompetitionResult/deleteCompetitionResult in useCompetitionResults.js.
const examples: Operation[] = [
  {
    type: "AddSolve",
    sessionId: "s1",
    cubeDimension: "3x3x3",
    solve: { id: "a", millis: 12340, penalty: null, reviewed: false, cubeDimension: "3x3x3", localCreatedAt: 1000 },
  },
  {
    type: "UpdateSolve",
    sessionId: "s1",
    cubeDimension: "3x3x3",
    solveId: "a",
    patch: { penalty: "+2" },
  },
  { type: "DeleteSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "a" },
  { type: "AddSession", session: { id: "s2", name: "Session 2", createdAt: 2000 } },
  { type: "RemoveSession", sessionId: "s2" },
  {
    type: "AddCompetitionResult",
    competition: {
      id: "c1",
      competitionName: "Nationals 2026",
      date: "2026-05-01T00:00:00.000Z",
      event: "3x3x3",
      bestMs: 9500,
      averageMs: 11200,
      source: "manual",
      wcaCompetitionId: null,
      wcaRoundId: null,
      roundLabel: null,
      wcaId: null,
    },
  },
  { type: "UpdateCompetitionResult", competitionId: "c1", patch: { bestMs: 9400 } },
  { type: "DeleteCompetitionResult", competitionId: "c1" },
];

describe("validateOperation", () => {
  it("accepts every operation shape produced by an existing mutation", () => {
    for (const op of examples) {
      expect(validateOperation(op), `expected valid: ${op.type}`).toEqual({ ok: true, operation: op });
    }
  });

  it("rejects unknown types and malformed payloads deterministically", () => {
    const invalid = [
      null,
      undefined,
      42,
      "AddSolve",
      {},
      { type: "SetPenalty", solveId: "a" },
      { type: "AddSolve", cubeDimension: "3x3x3", solve: { id: "a" } }, // missing sessionId
      { type: "AddSolve", sessionId: "s1", cubeDimension: "3x3x3", solve: { millis: 1 } }, // solve missing id
      { type: "UpdateSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "a" }, // missing patch
      { type: "UpdateSolve", sessionId: "s1", cubeDimension: "3x3x3", solveId: "a", patch: null },
      { type: "DeleteSolve", sessionId: "s1", cubeDimension: "3x3x3" }, // missing solveId
      { type: "AddSession", session: { name: "no id" } },
      { type: "RemoveSession" },
      { type: "AddCompetitionResult", competition: { competitionName: "no id" } },
      { type: "UpdateCompetitionResult", competitionId: "c1" }, // missing patch
      { type: "DeleteCompetitionResult" },
    ];
    for (const op of invalid) {
      const result = validateOperation(op);
      expect(result.ok, `expected invalid: ${JSON.stringify(op)}`).toBe(false);
      if (!result.ok) expect(typeof result.reason).toBe("string");
    }
  });

  it("returns the same verdict for the same input every time", () => {
    const op = examples[0];
    expect(validateOperation(op)).toEqual(validateOperation(op));
    expect(validateOperation({ type: "Nope" })).toEqual(validateOperation({ type: "Nope" }));
  });

  it("operations survive a structured-clone round trip unchanged (worker boundary)", () => {
    for (const op of examples) {
      expect(structuredClone(op)).toEqual(op);
    }
  });

  it("operations survive a JSON round trip unchanged (log/replay boundary)", () => {
    for (const op of examples) {
      expect(JSON.parse(JSON.stringify(op))).toEqual(op);
    }
  });

  it("contains no wall-clock reads: identical inputs at different times validate identically", () => {
    // localCreatedAt/createdAt appear only when the caller supplied them;
    // validation itself never fills in Date.now().
    const withoutTimestamp = {
      type: "AddSolve",
      sessionId: "s1",
      cubeDimension: "3x3x3",
      solve: { id: "a", millis: 1 },
    };
    const first = validateOperation(withoutTimestamp);
    const second = validateOperation(withoutTimestamp);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("localCreatedAt");
  });
});
