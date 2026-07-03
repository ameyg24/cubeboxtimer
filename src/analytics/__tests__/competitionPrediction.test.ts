import { describe, it, expect } from "vitest";
import {
  computeAdjustmentFactor,
  computeConfidence,
  computePracticeWindow,
  predictCompetitionResult,
} from "../competitionPrediction";
import type {
  CompetitionResultInput,
  PracticeVsOfficial,
  TimedPracticeSolve,
} from "../competitionPrediction";
import type { Penalty } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1); // a fixed, deterministic reference point

// A solve `daysBeforeBase` days before BASE.
const solveAt = (daysBeforeBase: number, millis: number, penalty: Penalty = null): TimedPracticeSolve => ({
  millis,
  penalty,
  localCreatedAt: BASE - daysBeforeBase * DAY,
});

const competition = (
  id: string,
  daysBeforeBase: number,
  averageMs: number | null
): CompetitionResultInput => ({
  id,
  date: new Date(BASE - daysBeforeBase * DAY).toISOString(),
  event: "3x3x3",
  averageMs,
});

describe("computePracticeWindow", () => {
  it("keeps solves inside [referenceDate - windowDays, referenceDate)", () => {
    const solves = [solveAt(20, 1), solveAt(10, 2), solveAt(5, 3), solveAt(0, 4)];
    const window = computePracticeWindow(solves, "3x3x3", BASE, 14);
    expect(window.solves.map((s) => s.millis)).toEqual([2, 3]);
  });

  it("excludes a solve exactly on the reference date (upper bound is exclusive)", () => {
    const solves = [solveAt(0, 1)];
    const window = computePracticeWindow(solves, "3x3x3", BASE, 14);
    expect(window.solves).toHaveLength(0);
  });

  it("includes a solve exactly windowDays before the reference date (lower bound is inclusive)", () => {
    const solves = [solveAt(14, 1)];
    const window = computePracticeWindow(solves, "3x3x3", BASE, 14);
    expect(window.solves).toHaveLength(1);
  });

  it("returns an empty window for an empty solve list", () => {
    const window = computePracticeWindow([], "3x3x3", BASE, 14);
    expect(window.solves).toEqual([]);
  });

  it("excludes solves with no localCreatedAt instead of crashing", () => {
    const solves: TimedPracticeSolve[] = [{ millis: 1000, penalty: null }, solveAt(5, 2000)];
    const window = computePracticeWindow(solves, "3x3x3", BASE, 14);
    expect(window.solves.map((s) => s.millis)).toEqual([2000]);
  });

  it("respects a custom windowDays", () => {
    const solves = [solveAt(10, 1), solveAt(3, 2)];
    expect(computePracticeWindow(solves, "3x3x3", BASE, 5).solves).toHaveLength(1);
    expect(computePracticeWindow(solves, "3x3x3", BASE, 30).solves).toHaveLength(2);
  });

  it("tolerates non-array input", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    const window = computePracticeWindow(null, "3x3x3", BASE, 14);
    expect(window.solves).toEqual([]);
  });
});

describe("computeAdjustmentFactor", () => {
  it("returns null factor and no comparisons for an empty list", () => {
    const result = computeAdjustmentFactor([]);
    expect(result).toEqual({ adjustmentFactorPct: null, comparisons: [], variance: null });
  });

  it("a single comparison sets the factor with no variance", () => {
    const pairs: PracticeVsOfficial[] = [
      { competitionId: "c1", practiceAverageMs: 10000, officialAverageMs: 11000 },
    ];
    const result = computeAdjustmentFactor(pairs);
    expect(result.adjustmentFactorPct).toBeCloseTo(0.1, 10);
    expect(result.comparisons).toHaveLength(1);
    expect(result.variance).toBeNull();
  });

  it("identical gaps across multiple competitions produce zero variance", () => {
    const pairs: PracticeVsOfficial[] = [
      { competitionId: "c1", practiceAverageMs: 10000, officialAverageMs: 11000 }, // +10%
      { competitionId: "c2", practiceAverageMs: 20000, officialAverageMs: 22000 }, // +10%
      { competitionId: "c3", practiceAverageMs: 5000, officialAverageMs: 5500 }, // +10%
    ];
    const result = computeAdjustmentFactor(pairs);
    expect(result.adjustmentFactorPct).toBeCloseTo(0.1, 10);
    expect(result.variance).toBeCloseTo(0, 10);
  });

  it("varying gaps average correctly and produce nonzero variance", () => {
    const pairs: PracticeVsOfficial[] = [
      { competitionId: "c1", practiceAverageMs: 10000, officialAverageMs: 10000 }, // 0%
      { competitionId: "c2", practiceAverageMs: 10000, officialAverageMs: 12000 }, // +20%
    ];
    const result = computeAdjustmentFactor(pairs);
    expect(result.adjustmentFactorPct).toBeCloseTo(0.1, 10);
    // population variance of [0, 0.2] around mean 0.1 = ((0.1)^2 + (0.1)^2) / 2 = 0.01
    expect(result.variance).toBeCloseTo(0.01, 10);
  });

  it("a negative gap (competition faster than practice) is computed correctly", () => {
    const pairs: PracticeVsOfficial[] = [
      { competitionId: "c1", practiceAverageMs: 10000, officialAverageMs: 9000 },
    ];
    const result = computeAdjustmentFactor(pairs);
    expect(result.adjustmentFactorPct).toBeCloseTo(-0.1, 10);
  });

  it("drops pairs with a non-finite or non-positive practice average", () => {
    const pairs: PracticeVsOfficial[] = [
      { competitionId: "c1", practiceAverageMs: 0, officialAverageMs: 9000 },
      { competitionId: "c2", practiceAverageMs: Number.NaN, officialAverageMs: 9000 },
      { competitionId: "c3", practiceAverageMs: 10000, officialAverageMs: 11000 },
    ];
    const result = computeAdjustmentFactor(pairs);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].competitionId).toBe("c3");
  });

  it("tolerates non-array input", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    const result = computeAdjustmentFactor(null);
    expect(result.adjustmentFactorPct).toBeNull();
  });
});

describe("computeConfidence", () => {
  it("is insufficient with zero competitions", () => {
    expect(computeConfidence(0, null)).toBe("insufficient");
  });

  it("is low with exactly one competition, regardless of variance", () => {
    expect(computeConfidence(1, null)).toBe("low");
    expect(computeConfidence(1, 0.5)).toBe("low");
  });

  it("is medium with 2-3 competitions and low variance", () => {
    expect(computeConfidence(2, 0.0001)).toBe("medium");
    expect(computeConfidence(3, 0.001)).toBe("medium");
  });

  it("is downgraded to low with 2-3 competitions and high variance", () => {
    expect(computeConfidence(2, 0.02)).toBe("low");
  });

  it("is high with 4+ competitions and low variance", () => {
    expect(computeConfidence(4, 0.0001)).toBe("high");
    expect(computeConfidence(10, 0)).toBe("high");
  });

  it("is downgraded from high to medium with 4+ competitions and moderate variance", () => {
    expect(computeConfidence(5, 0.005)).toBe("medium");
  });

  it("is downgraded from high to low with 4+ competitions and high variance", () => {
    expect(computeConfidence(5, 0.02)).toBe("low");
  });

  it("transitions upward as competition count grows, holding variance at zero", () => {
    const levels = [0, 1, 2, 4].map((n) => computeConfidence(n, n >= 2 ? 0 : null));
    expect(levels).toEqual(["insufficient", "low", "medium", "high"]);
  });
});

describe("predictCompetitionResult", () => {
  it("produces no prediction with zero past competitions (insufficient data)", () => {
    const solves = [solveAt(5, 10000), solveAt(3, 10000)];
    const result = predictCompetitionResult(solves, [], "3x3x3", BASE);
    expect(result.confidenceLevel).toBe("insufficient");
    expect(result.predictedAverageMs).toBeNull();
    expect(result.confidenceRangeMs).toBeNull();
    expect(result.adjustmentFactorPct).toBeNull();
    expect(result.competitionsUsed).toBe(0);
  });

  it("predicts from a single past competition at low confidence", () => {
    // Practice before the competition (30 days back) was 10000ms; official was 11000ms (+10%).
    const solves = [
      solveAt(35, 10000),
      solveAt(32, 10000),
      // current practice window (near BASE): 12000ms
      solveAt(5, 12000),
      solveAt(2, 12000),
    ];
    const pastResults = [competition("c1", 30, 11000)];
    const result = predictCompetitionResult(solves, pastResults, "3x3x3", BASE);

    expect(result.competitionsUsed).toBe(1);
    expect(result.confidenceLevel).toBe("low");
    expect(result.adjustmentFactorPct).toBeCloseTo(0.1, 10);
    expect(result.practiceAverageMs).toBeCloseTo(12000, 10);
    expect(result.predictedAverageMs).toBeCloseTo(13200, 10); // 12000 * 1.1
    expect(result.confidenceRangeMs).not.toBeNull();
  });

  it("exposes the per-competition comparison breakdown alongside the prediction", () => {
    const solves = [
      solveAt(35, 10000),
      solveAt(32, 10000),
      solveAt(5, 12000),
      solveAt(2, 12000),
    ];
    const pastResults = [competition("c1", 30, 11000)];
    const result = predictCompetitionResult(solves, pastResults, "3x3x3", BASE);

    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0]).toMatchObject({
      competitionId: "c1",
      practiceAverageMs: 10000,
      officialAverageMs: 11000,
      gapPct: expect.closeTo(0.1, 10),
    });
  });

  it("applies the averaged adjustment factor from multiple past competitions", () => {
    const solves = [
      // practice window before competition 1 (30 days back): 10000ms
      solveAt(35, 10000),
      solveAt(32, 10000),
      // practice window before competition 2 (60 days back): 20000ms
      solveAt(65, 20000),
      solveAt(62, 20000),
      // current practice window: 10000ms
      solveAt(5, 10000),
      solveAt(2, 10000),
    ];
    const pastResults = [
      competition("c1", 30, 11000), // +10%
      competition("c2", 60, 22000), // +10%
    ];
    const result = predictCompetitionResult(solves, pastResults, "3x3x3", BASE);

    expect(result.competitionsUsed).toBe(2);
    expect(result.adjustmentFactorPct).toBeCloseTo(0.1, 10);
    expect(result.predictedAverageMs).toBeCloseTo(11000, 10); // 10000 * 1.1
  });

  it("returns no numeric prediction when current practice data is missing, even with a known adjustment factor", () => {
    const solves = [solveAt(35, 10000), solveAt(32, 10000)]; // only practice before the past competition
    const pastResults = [competition("c1", 30, 11000)];
    const result = predictCompetitionResult(solves, pastResults, "3x3x3", BASE);

    expect(result.adjustmentFactorPct).toBeCloseTo(0.1, 10);
    expect(result.practiceAverageMs).toBeNull();
    expect(result.predictedAverageMs).toBeNull();
    expect(result.confidenceRangeMs).toBeNull();
  });

  it("excludes a past competition with no practice data in its own window", () => {
    const solves = [
      // nothing in the 14 days before competition c1 (100 days back)
      // current practice window has data
      solveAt(5, 10000),
      solveAt(2, 10000),
    ];
    const pastResults = [competition("c1", 100, 11000)];
    const result = predictCompetitionResult(solves, pastResults, "3x3x3", BASE);

    expect(result.competitionsUsed).toBe(0);
    expect(result.confidenceLevel).toBe("insufficient");
    expect(result.predictedAverageMs).toBeNull();
  });

  it("excludes DNF solves from the practice average and reports the DNF rate", () => {
    const solves = [
      solveAt(5, 10000),
      solveAt(4, 10000, "DNF"),
      solveAt(3, 10000),
      solveAt(2, 10000, "DNF"),
    ];
    const result = predictCompetitionResult(solves, [], "3x3x3", BASE);

    expect(result.practiceAverageMs).toBeCloseTo(10000, 10); // DNFs excluded, not counted as 0
    expect(result.practiceSolveCount).toBe(4);
    expect(result.practiceDnfRatePct).toBeCloseTo(50, 10);
  });

  it("a competition with a null official average (e.g. a DNF round) is excluded from comparisons", () => {
    const solves = [solveAt(35, 10000), solveAt(32, 10000), solveAt(5, 10000), solveAt(2, 10000)];
    const pastResults = [competition("c1", 30, null)];
    const result = predictCompetitionResult(solves, pastResults, "3x3x3", BASE);

    expect(result.competitionsUsed).toBe(0);
    expect(result.confidenceLevel).toBe("insufficient");
  });

  it("editing a competition result changes the prediction on the next call (no stale cache)", () => {
    const solves = [solveAt(35, 10000), solveAt(32, 10000), solveAt(5, 10000), solveAt(2, 10000)];
    const before = predictCompetitionResult(solves, [competition("c1", 30, 11000)], "3x3x3", BASE);
    const after = predictCompetitionResult(solves, [competition("c1", 30, 13000)], "3x3x3", BASE);

    expect(before.adjustmentFactorPct).toBeCloseTo(0.1, 10);
    expect(after.adjustmentFactorPct).toBeCloseTo(0.3, 10);
    expect(before.predictedAverageMs).not.toBeCloseTo(after.predictedAverageMs ?? 0, 0);
  });

  it("deleting a competition reverts the prediction to what fewer competitions would produce", () => {
    const solves = [
      solveAt(35, 10000),
      solveAt(32, 10000),
      solveAt(65, 10000),
      solveAt(62, 10000),
      solveAt(5, 10000),
      solveAt(2, 10000),
    ];
    const twoCompetitions = [competition("c1", 30, 11000), competition("c2", 60, 15000)];
    const oneCompetitionAfterDelete = [competition("c1", 30, 11000)];

    const before = predictCompetitionResult(solves, twoCompetitions, "3x3x3", BASE);
    const after = predictCompetitionResult(solves, oneCompetitionAfterDelete, "3x3x3", BASE);

    expect(before.competitionsUsed).toBe(2);
    expect(after.competitionsUsed).toBe(1);
    expect(after.confidenceLevel).toBe("low");
    expect(after.adjustmentFactorPct).toBeCloseTo(0.1, 10);
  });

  it("computes recent form as the rolling ao5 ending at the most recent practice solve", () => {
    const solves = [solveAt(5, 9000), solveAt(4, 9500), solveAt(3, 10000), solveAt(2, 10500), solveAt(1, 11000)];
    const result = predictCompetitionResult(solves, [], "3x3x3", BASE);
    // ao5 of exactly these 5 solves, WCA-trimmed (drop fastest 9000, slowest 11000): mean(9500,10000,10500) = 10000
    expect(result.recentFormMs).toBeCloseTo(10000, 10);
  });

  it("recentFormMs is null when there are fewer than 5 solves in the practice window", () => {
    const solves = [solveAt(5, 9000), solveAt(3, 9500)];
    const result = predictCompetitionResult(solves, [], "3x3x3", BASE);
    expect(result.recentFormMs).toBeNull();
  });

  it("computes practice consistency as the population stddev of the practice window", () => {
    const solves = [solveAt(5, 9000), solveAt(4, 10000), solveAt(3, 11000)];
    const result = predictCompetitionResult(solves, [], "3x3x3", BASE);
    // mean 10000; variance = (1e6+0+1e6)/3 = 666666.67; stddev ~ 816.5
    expect(result.practiceConsistencyMs).toBeCloseTo(816.4966, 3);
  });

  it("respects a custom windowDays for both past and current practice windows", () => {
    const solves = [
      solveAt(50, 10000), // 30-64 days back: outside a 14-day window before the competition (30 days back), inside a 45-day one
      solveAt(5, 10000),
    ];
    const pastResults = [competition("c1", 30, 11000)];

    const narrow = predictCompetitionResult(solves, pastResults, "3x3x3", BASE, 14);
    const wide = predictCompetitionResult(solves, pastResults, "3x3x3", BASE, 45);

    expect(narrow.competitionsUsed).toBe(0);
    expect(wide.competitionsUsed).toBe(1);
  });

  it("tolerates non-array solve and result input", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    const result = predictCompetitionResult(null, null, "3x3x3", BASE);
    expect(result.predictedAverageMs).toBeNull();
    expect(result.confidenceLevel).toBe("insufficient");
  });

  it("labels the result with the event it was computed for", () => {
    const result = predictCompetitionResult([], [], "2x2x2", BASE);
    expect(result.event).toBe("2x2x2");
  });
});
