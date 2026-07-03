import { describe, it, expect } from "vitest";
import { explainPrediction } from "../predictionExplanation";
import type { PredictionResult } from "../competitionPrediction";
import type { BacktestSummary } from "../backtesting";

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

describe("explainPrediction", () => {
  it("maps every passthrough field directly from the prediction and backtest summary", () => {
    const prediction = basePrediction();
    const backtest = baseBacktestSummary();
    const explanation = explainPrediction(prediction, backtest);

    expect(explanation.practiceAverageMs).toBe(prediction.practiceAverageMs);
    expect(explanation.adjustmentFactorPct).toBe(prediction.adjustmentFactorPct);
    expect(explanation.predictedAverageMs).toBe(prediction.predictedAverageMs);
    expect(explanation.confidenceLevel).toBe(prediction.confidenceLevel);
    expect(explanation.confidenceIntervalMs).toEqual(prediction.confidenceRangeMs);
    expect(explanation.competitionsUsed).toBe(prediction.competitionsUsed);
    expect(explanation.dnfProbabilityPct).toBe(prediction.practiceDnfRatePct);
    expect(explanation.historicalAverageErrorPct).toBe(backtest.averageAbsoluteErrorPct);
  });

  it("returns factors: null when there is no live prediction (insufficient history)", () => {
    const prediction = basePrediction({
      predictedAverageMs: null,
      confidenceRangeMs: null,
      confidenceLevel: "insufficient",
    });
    const explanation = explainPrediction(prediction, baseBacktestSummary());

    expect(explanation.factors).toBeNull();
    // Passthrough fields are still reported even without a live prediction.
    expect(explanation.practiceAverageMs).toBe(prediction.practiceAverageMs);
    expect(explanation.confidenceLevel).toBe("insufficient");
  });

  it("returns factors: null when there are zero competitions used and no prediction", () => {
    const prediction = basePrediction({
      predictedAverageMs: null,
      confidenceRangeMs: null,
      confidenceLevel: "insufficient",
      competitionsUsed: 0,
      adjustmentFactorPct: null,
    });
    const explanation = explainPrediction(prediction, baseBacktestSummary({ evaluatedCount: 0, averageAbsoluteErrorPct: null }));

    expect(explanation.factors).toBeNull();
    expect(explanation.adjustmentFactorPct).toBeNull();
  });

  it("reports historicalAverageErrorPct as null when the backtest has no evaluated cases, even with a valid live prediction", () => {
    const prediction = basePrediction(); // has a real prediction
    const backtest = baseBacktestSummary({ evaluatedCount: 0, averageAbsoluteErrorPct: null });
    const explanation = explainPrediction(prediction, backtest);

    expect(explanation.factors).not.toBeNull();
    expect(explanation.historicalAverageErrorPct).toBeNull();
  });

  it("computes prediction factors that sum to 100%", () => {
    const explanation = explainPrediction(basePrediction(), baseBacktestSummary());
    const f = explanation.factors!;
    const sum =
      f.practicePerformancePct + f.historicalAdjustmentPct + f.consistencyPct + f.dnfHistoryPct + f.competitionHistoryPct;
    expect(sum).toBeCloseTo(100, 8);
  });

  it("matches hand-computed factor percentages for a known input", () => {
    // adjustment=0.1, consistency CoV=1000/10000=0.1, dnf=20%, competitionsUsed=2 (2/5=0.4)
    const prediction = basePrediction({
      adjustmentFactorPct: 0.1,
      practiceConsistencyMs: 1000,
      practiceAverageMs: 10000,
      practiceDnfRatePct: 20,
      competitionsUsed: 2,
    });
    const explanation = explainPrediction(prediction, baseBacktestSummary());
    const f = explanation.factors!;

    expect(f.practicePerformancePct).toBeCloseTo(55.55555555555555, 8);
    expect(f.historicalAdjustmentPct).toBeCloseTo(5.555555555555555, 8);
    expect(f.consistencyPct).toBeCloseTo(5.555555555555555, 8);
    expect(f.dnfHistoryPct).toBeCloseTo(11.11111111111111, 8);
    expect(f.competitionHistoryPct).toBeCloseTo(22.22222222222222, 8);
  });

  it("attributes 100% to practice performance when adjustment, consistency, DNF rate, and competition history are all zero", () => {
    const prediction = basePrediction({
      adjustmentFactorPct: 0,
      practiceConsistencyMs: 0,
      practiceDnfRatePct: 0,
      competitionsUsed: 0,
    });
    const explanation = explainPrediction(prediction, baseBacktestSummary());
    const f = explanation.factors!;

    expect(f.practicePerformancePct).toBeCloseTo(100, 8);
    expect(f.historicalAdjustmentPct).toBeCloseTo(0, 8);
    expect(f.consistencyPct).toBeCloseTo(0, 8);
    expect(f.dnfHistoryPct).toBeCloseTo(0, 8);
    expect(f.competitionHistoryPct).toBeCloseTo(0, 8);
  });

  it("caps the historical adjustment score so an extreme gap doesn't dominate further past 100%", () => {
    const atCap = explainPrediction(basePrediction({ adjustmentFactorPct: 1 }), baseBacktestSummary()).factors!;
    const wayOverCap = explainPrediction(basePrediction({ adjustmentFactorPct: 5 }), baseBacktestSummary()).factors!;

    expect(wayOverCap.historicalAdjustmentPct).toBeCloseTo(atCap.historicalAdjustmentPct, 8);
  });

  it("caps the consistency score at a 100% coefficient of variation", () => {
    const atCap = explainPrediction(
      basePrediction({ practiceConsistencyMs: 10000, practiceAverageMs: 10000 }),
      baseBacktestSummary()
    ).factors!;
    const wayOverCap = explainPrediction(
      basePrediction({ practiceConsistencyMs: 50000, practiceAverageMs: 10000 }),
      baseBacktestSummary()
    ).factors!;

    expect(wayOverCap.consistencyPct).toBeCloseTo(atCap.consistencyPct, 8);
  });

  it("caps the competition history score once competitionsUsed reaches the saturation point", () => {
    const atCap = explainPrediction(basePrediction({ competitionsUsed: 5 }), baseBacktestSummary()).factors!;
    const wayOverCap = explainPrediction(basePrediction({ competitionsUsed: 20 }), baseBacktestSummary()).factors!;

    expect(wayOverCap.competitionHistoryPct).toBeCloseTo(atCap.competitionHistoryPct, 8);
  });

  it("gives DNF history a monotonically larger share as the DNF rate increases", () => {
    const none = explainPrediction(basePrediction({ practiceDnfRatePct: 0 }), baseBacktestSummary()).factors!;
    const some = explainPrediction(basePrediction({ practiceDnfRatePct: 25 }), baseBacktestSummary()).factors!;
    const most = explainPrediction(basePrediction({ practiceDnfRatePct: 90 }), baseBacktestSummary()).factors!;

    expect(none.dnfHistoryPct).toBeLessThan(some.dnfHistoryPct);
    expect(some.dnfHistoryPct).toBeLessThan(most.dnfHistoryPct);
  });

  it("gives competition history a monotonically larger share as more competitions are used, up to the cap", () => {
    const one = explainPrediction(basePrediction({ competitionsUsed: 1 }), baseBacktestSummary()).factors!;
    const three = explainPrediction(basePrediction({ competitionsUsed: 3 }), baseBacktestSummary()).factors!;
    const five = explainPrediction(basePrediction({ competitionsUsed: 5 }), baseBacktestSummary()).factors!;

    expect(one.competitionHistoryPct).toBeLessThan(three.competitionHistoryPct);
    expect(three.competitionHistoryPct).toBeLessThan(five.competitionHistoryPct);
  });

  it("does not divide by zero when practiceAverageMs is zero (degenerate defensive case)", () => {
    const prediction = basePrediction({ practiceAverageMs: 0, practiceConsistencyMs: 100 });
    const explanation = explainPrediction(prediction, baseBacktestSummary());
    const f = explanation.factors!;

    expect(f.consistencyPct).toBeCloseTo(0, 8);
    expect(Number.isFinite(f.consistencyPct)).toBe(true);
    expect(Number.isNaN(f.consistencyPct)).toBe(false);
  });

  it("handles competitionsUsed of 0 alongside a live prediction without crashing (defensive combination)", () => {
    const prediction = basePrediction({ competitionsUsed: 0 });
    const explanation = explainPrediction(prediction, baseBacktestSummary());
    const f = explanation.factors!;

    expect(f.competitionHistoryPct).toBeCloseTo(0, 8);
    const sum =
      f.practicePerformancePct + f.historicalAdjustmentPct + f.consistencyPct + f.dnfHistoryPct + f.competitionHistoryPct;
    expect(sum).toBeCloseTo(100, 8);
  });

  it("still sums to 100% when every factor is simultaneously at its cap", () => {
    const prediction = basePrediction({
      adjustmentFactorPct: 3,
      practiceConsistencyMs: 40000,
      practiceAverageMs: 10000,
      practiceDnfRatePct: 100,
      competitionsUsed: 12,
    });
    const explanation = explainPrediction(prediction, baseBacktestSummary());
    const f = explanation.factors!;
    const sum =
      f.practicePerformancePct + f.historicalAdjustmentPct + f.consistencyPct + f.dnfHistoryPct + f.competitionHistoryPct;
    expect(sum).toBeCloseTo(100, 8);
  });

  it("is deterministic: identical input produces identical output", () => {
    const prediction = basePrediction();
    const backtest = baseBacktestSummary();
    const first = explainPrediction(prediction, backtest);
    const second = explainPrediction(prediction, backtest);
    expect(first).toEqual(second);
  });

  it("does not mutate the input prediction or backtest summary", () => {
    const prediction = basePrediction();
    const backtest = baseBacktestSummary();
    const predictionSnapshot = JSON.parse(JSON.stringify(prediction));
    const backtestSnapshot = JSON.parse(JSON.stringify(backtest));

    explainPrediction(prediction, backtest);

    expect(prediction).toEqual(predictionSnapshot);
    expect(backtest).toEqual(backtestSnapshot);
  });

  it("passes through a negative adjustment factor unchanged (practice faster than competitions historically)", () => {
    const prediction = basePrediction({ adjustmentFactorPct: -0.08 });
    const explanation = explainPrediction(prediction, baseBacktestSummary());

    expect(explanation.adjustmentFactorPct).toBe(-0.08);
    // Magnitude still contributes positively to the factor score regardless of sign.
    expect(explanation.factors!.historicalAdjustmentPct).toBeGreaterThan(0);
  });

  it("passes through the confidence level and interval unchanged for a low-confidence single-competition prediction", () => {
    const prediction = basePrediction({
      confidenceLevel: "low",
      confidenceRangeMs: [9500, 12500],
      competitionsUsed: 1,
    });
    const explanation = explainPrediction(prediction, baseBacktestSummary());

    expect(explanation.confidenceLevel).toBe("low");
    expect(explanation.confidenceIntervalMs).toEqual([9500, 12500]);
    expect(explanation.competitionsUsed).toBe(1);
  });
});
