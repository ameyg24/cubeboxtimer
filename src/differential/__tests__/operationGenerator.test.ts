import { describe, it, expect } from "vitest";
import { createOperationGenerator } from "../operationGenerator";
import { applyOperation, emptyReferenceState } from "../referenceState";
import { validateOperation } from "../../storage/operations";
import type { Operation } from "../../storage/operations";

function generateSequence(seed: number, count: number): Operation[] {
  const generator = createOperationGenerator(seed);
  let state = emptyReferenceState();
  const operations: Operation[] = [];
  for (let i = 0; i < count; i++) {
    const op = generator.next(state);
    operations.push(op);
    state = applyOperation(state, op);
  }
  return operations;
}

describe("createOperationGenerator", () => {
  it("is deterministic: the same seed yields the identical sequence", () => {
    expect(generateSequence(42, 120)).toEqual(generateSequence(42, 120));
  });

  it("different seeds yield different sequences", () => {
    expect(generateSequence(1, 60)).not.toEqual(generateSequence(2, 60));
  });

  it("every generated operation passes validateOperation", () => {
    for (const op of generateSequence(7, 400)) {
      expect(validateOperation(op).ok, JSON.stringify(op)).toBe(true);
    }
  });

  it("applies cleanly: edits and deletes always target records that exist", () => {
    const generator = createOperationGenerator(11);
    let state = emptyReferenceState();
    for (let i = 0; i < 400; i++) {
      const op = generator.next(state);
      if (op.type === "UpdateSolve" || op.type === "DeleteSolve") {
        const session = state.sessions.find((s) => s.id === op.sessionId);
        expect(session, JSON.stringify(op)).toBeDefined();
        const exists = (session?.solves[op.cubeDimension] || []).some(
          (solve) => String(solve.id) === op.solveId
        );
        expect(exists, JSON.stringify(op)).toBe(true);
      }
      if (op.type === "UpdateCompetitionResult" || op.type === "DeleteCompetitionResult") {
        expect(
          state.competitions.some((c) => c.id === op.competitionId),
          JSON.stringify(op)
        ).toBe(true);
      }
      state = applyOperation(state, op);
    }
  });

  it("covers every operation type and both penalty kinds across a long run", () => {
    const operations = generateSequence(3, 600);
    const types = new Set(operations.map((op) => op.type));
    expect([...types].sort()).toEqual([
      "AddCompetitionResult",
      "AddSession",
      "AddSolve",
      "DeleteCompetitionResult",
      "DeleteSolve",
      "RemoveSession",
      "UpdateCompetitionResult",
      "UpdateSolve",
    ]);
    const solves = operations.filter((op) => op.type === "AddSolve").map((op) => op.solve);
    expect(solves.some((s) => s.penalty === "+2")).toBe(true);
    expect(solves.some((s) => s.penalty === "DNF")).toBe(true);
    expect(solves.some((s) => s.penalty === null)).toBe(true);
    const competitions = operations
      .filter((op) => op.type === "AddCompetitionResult")
      .map((op) => op.competition);
    expect(competitions.some((c) => c.source === "wca-import" && c.wcaCompetitionId !== null)).toBe(true);
    expect(competitions.some((c) => c.source === "manual")).toBe(true);
    const events = new Set(solves.map((s) => s.cubeDimension));
    expect(events.size).toBeGreaterThan(1);
  });

  it("never removes the last remaining session", () => {
    const generator = createOperationGenerator(13);
    let state = emptyReferenceState();
    for (let i = 0; i < 400; i++) {
      const op = generator.next(state);
      state = applyOperation(state, op);
      expect(state.sessions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("uses no wall-clock timestamps: everything is derived from the fixed epoch", () => {
    const operations = generateSequence(21, 200);
    const times: number[] = [];
    for (const op of operations) {
      if (op.type === "AddSolve" && typeof op.solve.localCreatedAt === "number") {
        times.push(op.solve.localCreatedAt);
      }
      if (op.type === "AddCompetitionResult") times.push(Date.parse(op.competition.date));
    }
    const min = Date.UTC(2026, 0, 1);
    const max = Date.UTC(2026, 4, 1);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(min);
      expect(t).toBeLessThanOrEqual(max);
    }
  });
});
