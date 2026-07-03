import { describe, it, expect } from "vitest";
import { runBacktest } from "../backtesting";
import type { CompetitionResultInput, TimedPracticeSolve } from "../competitionPrediction";
import type { Penalty } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1); // a fixed, deterministic reference point

const solveAt = (daysBeforeBase: number, millis: number, penalty: Penalty = null): TimedPracticeSolve => ({
  millis,
  penalty,
  localCreatedAt: BASE - daysBeforeBase * DAY,
});

const competition = (id: string, daysBeforeBase: number, averageMs: number | null): CompetitionResultInput => ({
  id,
  date: new Date(BASE - daysBeforeBase * DAY).toISOString(),
  event: "3x3x3",
  averageMs,
});

// The main multi-competition fixture, exact values precomputed by hand
// (mirrored via a standalone script, not by reading the implementation):
// practice is a flat 10000ms before every competition; c1 is pure seed
// history (never itself scored); c2..c5 are each scored using only the
// competitions strictly before them.
function fullFixture() {
  const solves: TimedPracticeSolve[] = [
    solveAt(108, 10000), solveAt(104, 10000), // window before c1 (100 days back)
    solveAt(78, 10000), solveAt(74, 10000), // window before c2 (70 days back)
    solveAt(48, 10000), solveAt(44, 10000), // window before c3 (40 days back)
    solveAt(28, 10000), solveAt(24, 10000), // window before c4 (20 days back)
    solveAt(12, 10000), solveAt(8, 10000), // window before c5 (5 days back)
  ];
  const results: CompetitionResultInput[] = [
    competition("c1", 100, 11000), // seed only, +10% gap
    competition("c2", 70, 10500),
    competition("c3", 40, 10800),
    competition("c4", 20, 11500),
    competition("c5", 5, 10600),
  ];
  return { solves, results };
}

describe("runBacktest", () => {
  it("produces no cases with zero competitions", () => {
    const result = runBacktest([], [], "3x3x3");
    expect(result.cases).toEqual([]);
    expect(result.summary).toEqual({
      evaluatedCount: 0,
      averageAbsoluteErrorPct: null,
      medianAbsoluteErrorPct: null,
      rmsePct: null,
      averageBiasPct: null,
      bestCase: null,
      worstCase: null,
    });
  });

  it("produces no cases with a single competition (nothing prior to predict from)", () => {
    const solves = [solveAt(10, 10000), solveAt(5, 10000)];
    const results = [competition("only", 8, 11000)];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toEqual([]);
    expect(result.summary.evaluatedCount).toBe(0);
  });

  it("evaluates every competition that has at least one earlier competition and matching practice data", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases.map((c) => c.competitionId)).toEqual(["c2", "c3", "c4", "c5"]);
    expect(result.summary.evaluatedCount).toBe(4);
  });

  it("returns cases in chronological order, oldest first", () => {
    const { solves, results } = fullFixture();
    // Shuffle the input order — the backtest must still evaluate and
    // return cases chronologically regardless of input order.
    const shuffled = [results[3], results[0], results[4], results[1], results[2]];
    const result = runBacktest(solves, shuffled, "3x3x3");
    expect(result.cases.map((c) => c.competitionId)).toEqual(["c2", "c3", "c4", "c5"]);
  });

  it("computes predicted, actual, absolute error and percent error correctly for a single prior competition", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");
    const c2 = result.cases.find((c) => c.competitionId === "c2")!;

    expect(c2.predictedAverageMs).toBeCloseTo(11000, 6); // 10000 * (1 + 0.10)
    expect(c2.actualAverageMs).toBe(10500);
    expect(c2.absoluteErrorMs).toBeCloseTo(500, 6);
    expect(c2.percentErrorPct).toBeCloseTo(4.761904761904762, 8);
    expect(c2.adjustmentFactorPctUsed).toBeCloseTo(0.1, 10);
  });

  it("averages multiple prior gaps into the adjustment factor used for a later competition", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");
    const c4 = result.cases.find((c) => c.competitionId === "c4")!;

    // factor = mean(0.10, 0.05, 0.08) = 0.07666...7
    expect(c4.adjustmentFactorPctUsed).toBeCloseTo(0.07666666666666667, 10);
    expect(c4.predictedAverageMs).toBeCloseTo(10766.666666666666, 4);
    expect(c4.percentErrorPct).toBeCloseTo(6.376811594202904, 6);
  });

  it("computes bestCase and worstCase by smallest and largest percent error", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");

    expect(result.summary.bestCase?.competitionId).toBe("c3"); // smallest error, ~0.46%
    expect(result.summary.worstCase?.competitionId).toBe("c4"); // largest error, ~6.38%
  });

  it("computes the average absolute error percentage across evaluated cases", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.summary.averageAbsoluteErrorPct).toBeCloseTo(3.7258915278808646, 6);
  });

  it("computes the median absolute error for an odd number of cases (middle value)", () => {
    const { solves, results } = fullFixture();
    const threeCaseResults = results.slice(0, 4); // c1 seed + c2, c3, c4 (drop c5, leaving 3 evaluated cases)
    const result = runBacktest(solves, threeCaseResults, "3x3x3");
    expect(result.cases).toHaveLength(3);
    // sorted percent errors: [0.4629..., 4.7619..., 6.3768...] -> median is the middle value
    expect(result.summary.medianAbsoluteErrorPct).toBeCloseTo(4.761904761904762, 6);
  });

  it("computes the median absolute error for an even number of cases (average of the two middle values)", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toHaveLength(4);
    // sorted percent errors: [0.4629..., 3.3018..., 4.7619..., 6.3768...] -> median = mean(3.3018..., 4.7619...)
    expect(result.summary.medianAbsoluteErrorPct).toBeCloseTo(4.031895777178796, 6);
  });

  it("computes RMSE as the square root of the mean squared percent error", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.summary.rmsePct).toBeCloseTo(4.314401875250546, 6);
  });

  it("RMSE reacts more strongly to a single large outlier than the average absolute error does", () => {
    const solves = [
      solveAt(108, 10000), solveAt(104, 10000),
      solveAt(78, 10000), solveAt(74, 10000),
      solveAt(48, 10000), solveAt(44, 10000),
      solveAt(28, 10000), solveAt(24, 10000),
    ];
    const results = [
      competition("seed", 100, 11000), // +10% gap, seed only
      competition("c1", 70, 10891.089108910892), // ~1% error
      competition("c2", 40, 10730.92603377985), // ~2% error
      competition("c3", 20, 7249.33669837572), // 50% error (outlier)
    ];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toHaveLength(3);
    expect(result.summary.averageAbsoluteErrorPct).toBeCloseTo(17.666666666666668, 4);
    expect(result.summary.rmsePct).toBeCloseTo(28.896366553599787, 4);
    // RMSE must exceed the plain average once an outlier is present.
    expect(result.summary.rmsePct as number).toBeGreaterThan(result.summary.averageAbsoluteErrorPct as number);
    expect(result.summary.worstCase?.competitionId).toBe("c3");
  });

  it("computes identical percent errors across cases as equal average, median, and RMSE", () => {
    const solves = [
      solveAt(108, 10000), solveAt(104, 10000),
      solveAt(78, 10000), solveAt(74, 10000),
      solveAt(48, 10000), solveAt(44, 10000),
    ];
    const results = [
      competition("seed", 100, 11000), // +10% gap
      competition("c1", 70, 10891.089108910892), // ~1% error
      competition("c2", 40, 10837.172826193511), // ~1% error, matching c1
    ];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toHaveLength(2);
    const [pctErr1, pctErr2] = result.cases.map((c) => c.percentErrorPct);
    expect(pctErr1).toBeCloseTo(pctErr2, 4);
    expect(result.summary.averageAbsoluteErrorPct).toBeCloseTo(pctErr1, 4);
    expect(result.summary.medianAbsoluteErrorPct).toBeCloseTo(pctErr1, 4);
    expect(result.summary.rmsePct).toBeCloseTo(pctErr1, 4);
  });

  it("gives a positive bias when predictions were optimistic (predicted faster than actual)", () => {
    const solves = [solveAt(108, 10000), solveAt(104, 10000), solveAt(78, 10000), solveAt(74, 10000)];
    const results = [
      competition("seed", 100, 10500), // +5% gap
      competition("target", 70, 11000), // predicted (10500) < actual (11000) -> optimistic
    ];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].predictedAverageMs).toBeCloseTo(10500, 6);
    expect(result.cases[0].biasPct).toBeGreaterThan(0);
    expect(result.cases[0].biasPct).toBeCloseTo(4.545454545454546, 6);
    expect(result.summary.averageBiasPct).toBeCloseTo(4.545454545454546, 6);
  });

  it("gives a negative bias when predictions were pessimistic (predicted slower than actual)", () => {
    const solves = [solveAt(108, 10000), solveAt(104, 10000), solveAt(78, 10000), solveAt(74, 10000)];
    const results = [
      competition("seed", 100, 10500), // +5% gap
      competition("target", 70, 10000), // predicted (10500) > actual (10000) -> pessimistic
    ];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].predictedAverageMs).toBeCloseTo(10500, 6);
    expect(result.cases[0].biasPct).toBeLessThan(0);
    expect(result.cases[0].biasPct).toBeCloseTo(-5, 6);
    expect(result.summary.averageBiasPct).toBeCloseTo(-5, 6);
  });

  it("never lets a competition's own official result influence its own simulated prediction", () => {
    const solves = [solveAt(108, 10000), solveAt(104, 10000), solveAt(78, 10000), solveAt(74, 10000)];
    const results = [
      competition("seed", 100, 11000), // +10% gap — the only real history
      // An extreme, self-inflating official average. If this were mistakenly
      // folded into its own adjustment factor, the predicted value would be
      // wildly different from 11000.
      competition("target", 70, 50000),
    ];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].predictedAverageMs).toBeCloseTo(11000, 6); // driven only by "seed"
    expect(result.cases[0].adjustmentFactorPctUsed).toBeCloseTo(0.1, 10);
  });

  it("does not treat a same-day competition as prior history for another competition on the same day", () => {
    const solves = [
      solveAt(108, 10000), solveAt(104, 10000), // window before day-100 competitions
      solveAt(48, 10000), solveAt(44, 10000), // window before the day-40 competition
    ];
    const sameDay = new Date(BASE - 100 * DAY).toISOString();
    const results: CompetitionResultInput[] = [
      { id: "same-day-a", date: sameDay, event: "3x3x3", averageMs: 11000 },
      { id: "same-day-b", date: sameDay, event: "3x3x3", averageMs: 10800 },
      competition("later", 40, 10900),
    ];
    const result = runBacktest(solves, results, "3x3x3");
    // Neither same-day competition has anything strictly earlier than it.
    expect(result.cases.some((c) => c.competitionId === "same-day-a" || c.competitionId === "same-day-b")).toBe(
      false
    );
    // The later, distinct-day competition sees both same-day competitions as valid prior history.
    const later = result.cases.find((c) => c.competitionId === "later");
    expect(later).toBeDefined();
    expect(later?.adjustmentFactorPctUsed).toBeCloseTo(0.09, 10); // mean(0.10, 0.08)
  });

  it("excludes a competition from evaluation when it has no matching practice window", () => {
    const solves = [solveAt(108, 10000), solveAt(104, 10000)]; // only practice before "seed"
    const results = [
      competition("seed", 100, 11000),
      // No solves anywhere near this date's 14-day practice window.
      competition("no-data", 30, 10800),
    ];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases).toEqual([]);
    expect(result.summary.evaluatedCount).toBe(0);
  });

  it("skips a competition with a null or non-finite official average entirely (neither history nor a target)", () => {
    const solves = [solveAt(108, 10000), solveAt(104, 10000), solveAt(78, 10000), solveAt(74, 10000)];
    const results = [
      competition("seed", 100, 11000),
      competition("dnf-competition", 85, null),
      competition("target", 70, 10500),
    ];
    const result = runBacktest(solves, results, "3x3x3");
    expect(result.cases.map((c) => c.competitionId)).toEqual(["target"]);
  });

  it("respects a custom windowDays for both history and target practice windows", () => {
    const solves = [
      solveAt(20, 10000), solveAt(16, 10000), // 20-64 days back from BASE... actually within 14-64 days before day-0 target
      solveAt(80, 10000), solveAt(76, 10000), // window before the day-70 seed (14 days: [84,70))
    ];
    const results = [competition("seed", 70, 11000), competition("target", 0, 10800)];

    const narrow = runBacktest(solves, results, "3x3x3", 14);
    const wide = runBacktest(solves, results, "3x3x3", 30);

    expect(narrow.cases).toEqual([]); // target's 14-day window [14,0) has no solves
    expect(wide.cases).toHaveLength(1); // target's 30-day window [30,0) includes the day-20/16 solves
  });

  it("tolerates non-array input defensively", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    const result = runBacktest(null, null, "3x3x3");
    expect(result.cases).toEqual([]);
    expect(result.summary.evaluatedCount).toBe(0);
  });

  it("carries the confidence level actually used at the time of each simulated prediction", () => {
    const { solves, results } = fullFixture();
    const result = runBacktest(solves, results, "3x3x3");
    const c2 = result.cases.find((c) => c.competitionId === "c2")!; // 1 prior -> "low"
    const c4 = result.cases.find((c) => c.competitionId === "c4")!; // 3 priors -> "medium" or "high" depending on variance

    expect(c2.confidenceLevelUsed).toBe("low");
    expect(["low", "medium", "high"]).toContain(c4.confidenceLevelUsed);
  });
});
