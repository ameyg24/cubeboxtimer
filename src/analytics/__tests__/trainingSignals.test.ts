import { describe, it, expect } from "vitest";
import { computeTrainingSignals } from "../trainingSignals";
import type { CoachSolve } from "../trainingSignals";
import { buildFeatureVector } from "../predictionFeatures";
import type { PredictionResult } from "../competitionPrediction";
import type { BacktestSummary } from "../backtesting";
import type { Penalty } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);

let solveCounter = 0;
const solveAt = (daysBeforeBase: number, millis: number, penalty: Penalty = null): CoachSolve => ({
  id: `s-${solveCounter++}`,
  millis,
  penalty,
  localCreatedAt: BASE - daysBeforeBase * DAY,
});

const basePrediction = (overrides: Partial<PredictionResult> = {}): PredictionResult => ({
  event: "3x3x3",
  practiceAverageMs: 10000,
  practiceConsistencyMs: 500,
  recentFormMs: 10000,
  practiceDnfRatePct: 10,
  practiceSolveCount: 10,
  predictedAverageMs: 11000,
  confidenceRangeMs: [10500, 11500],
  confidenceLevel: "medium",
  adjustmentFactorPct: 0.1,
  competitionsUsed: 3,
  comparisons: [],
  ...overrides,
});

const baseBacktestSummary = (overrides: Partial<BacktestSummary> = {}): BacktestSummary => ({
  evaluatedCount: 4,
  averageAbsoluteErrorPct: 5.5,
  medianAbsoluteErrorPct: 5.0,
  rmsePct: 6.2,
  averageBiasPct: -1.5,
  bestCase: null,
  worstCase: null,
  ...overrides,
});

describe("computeTrainingSignals", () => {
  it("reads practice mean/stddev/DNF/+2 rate/count directly off buildFeatureVector, not a second computation", () => {
    const solves = [solveAt(5, 10000), solveAt(3, 0, "DNF"), solveAt(1, 9800, "+2")];
    const signals = computeTrainingSignals(solves, "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    const features = buildFeatureVector(solves, "3x3x3", BASE, []);

    expect(signals.practiceMeanMs).toBe(features.practiceMeanMs);
    expect(signals.practiceStddevMs).toBe(features.practiceStddevMs);
    expect(signals.dnfRatePct).toBe(features.dnfRatePct);
    expect(signals.plus2RatePct).toBe(features.plus2RatePct);
    expect(signals.practiceCount).toBe(features.practiceCount);
  });

  it("never recomputes the competition gap - competitionGapPct equals prediction.adjustmentFactorPct exactly", () => {
    const prediction = basePrediction({ adjustmentFactorPct: 0.0734829 });
    const signals = computeTrainingSignals([], "3x3x3", [], prediction, baseBacktestSummary(), BASE);
    expect(signals.competitionGapPct).toBe(prediction.adjustmentFactorPct);
  });

  it("passes confidenceLevel and backtest average error straight through", () => {
    const prediction = basePrediction({ confidenceLevel: "high" });
    const backtest = baseBacktestSummary({ averageAbsoluteErrorPct: 7.25 });
    const signals = computeTrainingSignals([], "3x3x3", [], prediction, backtest, BASE);
    expect(signals.competitionConfidence).toBe("high");
    expect(signals.backtestErrorPct).toBe(7.25);
  });

  it("computes momentum as recentMean - earlierMean over two adjacent 7-day windows", () => {
    const solves = [
      solveAt(12, 10000), solveAt(10, 10000), // earlier window (7-14 days back), mean 10000
      solveAt(5, 11000), solveAt(2, 11000), // recent window (0-7 days back), mean 11000
    ];
    const signals = computeTrainingSignals(solves, "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    expect(signals.momentumMs).toBeCloseTo(1000, 5);
  });

  it("reports negative momentum when recent practice is faster than the prior window", () => {
    const solves = [
      solveAt(12, 11000), solveAt(10, 11000),
      solveAt(5, 10000), solveAt(2, 10000),
    ];
    const signals = computeTrainingSignals(solves, "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    expect(signals.momentumMs).toBeCloseTo(-1000, 5);
  });

  it("leaves momentum null without a valid solve in both adjacent windows", () => {
    const solves = [solveAt(5, 10000)]; // only the recent window has data
    const signals = computeTrainingSignals(solves, "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    expect(signals.momentumMs).toBeNull();
  });

  it("counts distinct calendar days practiced in the last 14 days, not raw solve count", () => {
    const solves = [
      solveAt(10, 10000), solveAt(10, 9900), solveAt(10, 9800), // same day
      solveAt(3, 10000),
    ];
    const signals = computeTrainingSignals(solves, "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    expect(signals.practiceCount).toBe(4);
    expect(signals.practiceDaysInLast14).toBe(2);
  });

  it("computes days since the most recent PB across any record type", () => {
    const solves = [solveAt(40, 12000), solveAt(20, 9000), solveAt(5, 9500)];
    const signals = computeTrainingSignals(solves, "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    // Most recent single PB is the 9000ms solve at day 20 (9500 at day 5 is not a new PB).
    expect(signals.daysSinceLastPb).toBeCloseTo(20, 5);
  });

  it("leaves daysSinceLastPb null with no solves at all", () => {
    const signals = computeTrainingSignals([], "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    expect(signals.daysSinceLastPb).toBeNull();
  });

  it("handles a fully empty input without throwing, with well-defined defaults", () => {
    const signals = computeTrainingSignals(
      [],
      "3x3x3",
      [],
      basePrediction({ adjustmentFactorPct: null, confidenceLevel: "insufficient", competitionsUsed: 0 }),
      baseBacktestSummary({ evaluatedCount: 0, averageAbsoluteErrorPct: null }),
      BASE
    );
    expect(signals.practiceMeanMs).toBeNull();
    expect(signals.practiceCount).toBe(0);
    expect(signals.dnfRatePct).toBe(0);
    expect(signals.plus2RatePct).toBe(0);
    expect(signals.momentumMs).toBeNull();
    expect(signals.competitionGapPct).toBeNull();
    expect(signals.competitionConfidence).toBe("insufficient");
    expect(signals.daysSinceLastPb).toBeNull();
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const solves = [solveAt(10, 10000), solveAt(3, 9800)];
    const prediction = basePrediction();
    const backtest = baseBacktestSummary();
    const a = computeTrainingSignals(solves, "3x3x3", [], prediction, backtest, BASE);
    const b = computeTrainingSignals(solves, "3x3x3", [], prediction, backtest, BASE);
    expect(a).toEqual(b);
  });

  it("scopes practice signals to the event solves it was given, not a mixed pool", () => {
    const threeByThree = [solveAt(5, 10000), solveAt(2, 10000)];
    const fourByFour = [solveAt(5, 40000), solveAt(2, 40000), solveAt(1, 40000)];

    const signals3 = computeTrainingSignals(threeByThree, "3x3x3", [], basePrediction(), baseBacktestSummary(), BASE);
    const signals4 = computeTrainingSignals(fourByFour, "4x4x4", [], basePrediction(), baseBacktestSummary(), BASE);

    expect(signals3.event).toBe("3x3x3");
    expect(signals3.practiceCount).toBe(2);
    expect(signals4.event).toBe("4x4x4");
    expect(signals4.practiceCount).toBe(3);
  });
});
