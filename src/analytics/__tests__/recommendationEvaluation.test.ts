import { describe, it, expect } from "vitest";
import { evaluateRecommendations } from "../recommendationEvaluation";
import type { CoachSolve } from "../trainingSignals";
import type { Penalty } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);

let idCounter = 0;
const solveAt = (daysBeforeBase: number, millis: number, penalty: Penalty = null): CoachSolve => ({
  id: `s-${idCounter++}`,
  millis,
  penalty,
  localCreatedAt: BASE - daysBeforeBase * DAY,
});

describe("evaluateRecommendations", () => {
  it("detects a rule that triggered historically and later resolved within the horizon", () => {
    // 2 DNFs alone at day 40 -> 100% DNF rate once inside the practice
    // window. 20 clean solves at day 33 dilute the same window to ~9%,
    // resolving the rule 7 days after onset - by dilution, not by the DNF
    // solves aging out (keeps this independent of the window-size boundary).
    const solves: CoachSolve[] = [
      solveAt(40, 0, "DNF"),
      solveAt(40, 0, "DNF"),
      ...Array.from({ length: 20 }, (_, i) => solveAt(33, 9000 + i)),
    ];

    const result = evaluateRecommendations(solves, "3x3x3", [], BASE);
    const cleanUp = result.cases.find((c) => c.ruleId === "clean-up-solves");

    expect(cleanUp).toBeDefined();
    expect(cleanUp!.metricAtTrigger).toBeGreaterThan(10);
    expect(cleanUp!.resolved).toBe(true);
    expect(cleanUp!.daysToResolution).toBe(7);
    expect(cleanUp!.metricAtHorizon).not.toBeNull();
    expect(cleanUp!.metricAtHorizon as number).toBeLessThanOrEqual(10);
  });

  it("marks a rule still active when the metric never crosses back within the horizon", () => {
    // A DNF every day from day 19 down to day 5 keeps the 14-day window at
    // 100% DNF for far longer than the 14-day evaluation horizon.
    const solves: CoachSolve[] = Array.from({ length: 15 }, (_, i) => solveAt(19 - i, 0, "DNF"));

    const result = evaluateRecommendations(solves, "3x3x3", [], BASE);
    const cleanUp = result.cases.find((c) => c.ruleId === "clean-up-solves");

    expect(cleanUp).toBeDefined();
    expect(cleanUp!.resolved).toBe(false);
    expect(cleanUp!.metricAtHorizon).not.toBeNull();
    expect(cleanUp!.metricAtHorizon as number).toBeGreaterThan(10);
    expect(result.summary.activeCount).toBeGreaterThan(0);
  });

  it("marks insufficient follow-up when a rule triggered too recently to have a full horizon of later data", () => {
    const solves: CoachSolve[] = [solveAt(2, 0, "DNF"), solveAt(1, 0, "DNF"), solveAt(0, 0, "DNF")];

    const result = evaluateRecommendations(solves, "3x3x3", [], BASE);
    const cleanUp = result.cases.find((c) => c.ruleId === "clean-up-solves");

    expect(cleanUp).toBeDefined();
    expect(cleanUp!.metricAtHorizon).toBeNull();
    expect(cleanUp!.resolved).toBe(false);
    expect(cleanUp!.daysToResolution).toBeNull();
    expect(result.summary.insufficientFollowupCount).toBeGreaterThan(0);
  });

  it("reports no cases when no rule ever triggered in the lookback window", () => {
    // Dense (4/day, clears the volume target), gently and monotonically
    // improving toward "now" (keeps setting new PBs, so daysSinceLastPb
    // never goes stale, and momentum never reads as "getting slower"), no
    // DNF/+2, low variance, no competitions - nothing should ever fire.
    const solves: CoachSolve[] = [];
    for (let daysBeforeBase = 0; daysBeforeBase <= 90; daysBeforeBase++) {
      for (let i = 0; i < 4; i++) {
        solves.push(solveAt(daysBeforeBase, 9000 + daysBeforeBase));
      }
    }
    const result = evaluateRecommendations(solves, "3x3x3", [], BASE);
    expect(result.cases).toEqual([]);
    expect(result.summary).toEqual({
      evaluatedCount: 0,
      resolvedCount: 0,
      activeCount: 0,
      insufficientFollowupCount: 0,
    });
  });

  it("summary counts add up to evaluatedCount", () => {
    const solves: CoachSolve[] = [
      solveAt(40, 0, "DNF"),
      solveAt(40, 0, "DNF"),
      ...Array.from({ length: 20 }, (_, i) => solveAt(33, 9000 + i)),
      ...Array.from({ length: 15 }, (_, i) => solveAt(19 - i, 0, "DNF")),
    ];
    const result = evaluateRecommendations(solves, "3x3x3", [], BASE);
    expect(result.summary.resolvedCount + result.summary.activeCount + result.summary.insufficientFollowupCount).toBe(
      result.summary.evaluatedCount
    );
  });

  it("never includes a free-text field that could carry a causal claim", () => {
    const solves: CoachSolve[] = [solveAt(2, 0, "DNF"), solveAt(1, 0, "DNF")];
    const result = evaluateRecommendations(solves, "3x3x3", [], BASE);
    const keys = result.cases.length > 0 ? Object.keys(result.cases[0]).sort() : [];
    if (keys.length > 0) {
      expect(keys).toEqual(
        ["daysToResolution", "metricAtHorizon", "metricAtTrigger", "resolved", "ruleId", "triggeredAt"].sort()
      );
    }
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const solves: CoachSolve[] = [solveAt(40, 0, "DNF"), solveAt(40, 0, "DNF"), solveAt(5, 9000)];
    const a = evaluateRecommendations(solves, "3x3x3", [], BASE);
    const b = evaluateRecommendations(solves, "3x3x3", [], BASE);
    expect(a).toEqual(b);
  });

  it("handles empty solves and competitions without throwing", () => {
    const result = evaluateRecommendations([], "3x3x3", [], BASE);
    expect(result.cases).toBeInstanceOf(Array);
    expect(result.summary.evaluatedCount).toBe(result.cases.length);
  });
});
