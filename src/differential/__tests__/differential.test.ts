import { describe, it, expect } from "vitest";
import {
  runDifferential,
  createProductionAnalytics,
  firstDifference,
  describeFailure,
} from "../differential";
import type { ProductionAnalytics } from "../differential";

// Seed count is env-tunable so long local runs can sweep many seeds while
// CI stays fast: DIFFERENTIAL_SEEDS=50 npx vitest run src/differential
const SEED_COUNT = Number(process.env.DIFFERENTIAL_SEEDS || 6);
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);

describe("firstDifference", () => {
  it("finds the first differing path in nested structures", () => {
    expect(firstDifference({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toEqual({
      path: "$.a.b.1",
      expected: 2,
      actual: 3,
    });
    expect(firstDifference({ a: 1 }, { a: 1 })).toBeNull();
    expect(firstDifference([1], { 0: 1 })?.path).toBe("$");
    expect(firstDifference({ a: undefined }, {})).toBeNull(); // key-presence-only differences are not value differences
    expect(firstDifference(NaN, NaN)).toBeNull(); // Object.is semantics
  });
});

describe("randomized differential testing", { timeout: 120000 }, () => {
  it("production analytics equals the reference for every operation of every seed", () => {
    for (const seed of SEEDS) {
      const outcome = runDifferential({ seed, operationCount: 40 });
      if (!outcome.ok) throw new Error(describeFailure(outcome.failure));
      expect(outcome.operationCount).toBe(40);
    }
  });

  it("is reproducible: rerunning a seed yields an identical outcome object", () => {
    const first = runDifferential({ seed: 1, operationCount: 30 });
    const second = runDifferential({ seed: 1, operationCount: 30 });
    expect(second).toEqual(first);
  });

  it("holds from the empty state (zero operations)", () => {
    const outcome = runDifferential({ seed: 5, operationCount: 0 });
    expect(outcome.ok).toBe(true);
  });

  it("a long single-seed run stays equal through heavy mixed edits and deletes", () => {
    const outcome = runDifferential({ seed: 99, operationCount: 120 });
    if (!outcome.ok) throw new Error(describeFailure(outcome.failure));
    // The run must have actually exercised mutation variety.
    const counts = outcome.operationTypeCounts;
    expect(counts.AddSolve).toBeGreaterThan(0);
    expect((counts.UpdateSolve || 0) + (counts.DeleteSolve || 0)).toBeGreaterThan(0);
    expect(counts.AddCompetitionResult).toBeGreaterThan(0);
  });
});

describe("failure reporting", () => {
  // A production implementation that corrupts one node at one step: the
  // harness must localize it and the failure must replay identically.
  function tamperedProduction(tamperAtVersion: number): ProductionAnalytics {
    const real = createProductionAnalytics();
    return {
      initialize: (state, version) => real.initialize(state, version),
      compute: (event, now, version) => {
        const results = real.compute(event, now, version);
        if (version === tamperAtVersion) {
          const records = structuredClone(results.recordHistory) as { history: unknown[] };
          records.history = [...records.history, { forged: true }];
          return { ...results, recordHistory: records };
        }
        return results;
      },
    };
  }

  it("reports seed, operation index, operation, prior state, and a minimal diff", () => {
    const outcome = runDifferential({ seed: 8, operationCount: 10, production: tamperedProduction(4) });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const { failure } = outcome;
    expect(failure.seed).toBe(8);
    expect(failure.operationIndex).toBe(3); // version = index + 1
    expect(failure.node).toBe("recordHistory");
    expect(failure.operation.type).toBeDefined();
    expect(failure.previousState.sessions).toBeDefined();
    expect(failure.diff.path).toMatch(/history/);
    expect(describeFailure(failure)).toContain("seed=8");
    expect(describeFailure(failure)).toContain("replay: runDifferential({ seed: 8");
  });

  it("a failing seed replays to the identical failure", () => {
    const first = runDifferential({ seed: 8, operationCount: 10, production: tamperedProduction(4) });
    const second = runDifferential({ seed: 8, operationCount: 10, production: tamperedProduction(4) });
    expect(second).toEqual(first);
  });
});
