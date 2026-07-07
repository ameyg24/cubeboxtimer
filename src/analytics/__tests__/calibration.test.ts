import { describe, it, expect } from "vitest";
import { computeCalibrationReport, toCalibrationCases } from "../calibration";
import { runBacktest } from "../backtesting";
import type { BacktestCase } from "../backtesting";
import type { CompetitionResultInput, TimedPracticeSolve } from "../competitionPrediction";

const kase = (predicted: number, lower: number, upper: number, actual: number) => ({
  predicted,
  lower,
  upper,
  actual,
});

describe("computeCalibrationReport", () => {
  it("returns an all-empty report for no cases", () => {
    expect(computeCalibrationReport([])).toEqual({
      evaluatedCount: 0,
      coveredCount: 0,
      coveragePct: null,
      meanIntervalWidth: null,
      meanAbsoluteError: null,
      underPredictionCount: 0,
      overPredictionCount: 0,
    });
  });

  it("computes exact coverage for a hand-computed fixture", () => {
    const report = computeCalibrationReport([
      kase(10000, 9500, 10500, 10200), // covered
      kase(10000, 9500, 10500, 10800), // above: under-prediction
      kase(10000, 9500, 10500, 9200), // below: over-prediction
      kase(10000, 9500, 10500, 9600), // covered
    ]);
    expect(report.evaluatedCount).toBe(4);
    expect(report.coveredCount).toBe(2);
    expect(report.coveragePct).toBe(50);
    expect(report.meanIntervalWidth).toBe(1000);
    expect(report.meanAbsoluteError).toBeCloseTo((200 + 800 + 800 + 400) / 4, 8);
    expect(report.underPredictionCount).toBe(1);
    expect(report.overPredictionCount).toBe(1);
  });

  it("treats interval bounds as inclusive", () => {
    const report = computeCalibrationReport([
      kase(10000, 9500, 10500, 9500), // exactly on the lower bound
      kase(10000, 9500, 10500, 10500), // exactly on the upper bound
    ]);
    expect(report.coveredCount).toBe(2);
    expect(report.underPredictionCount).toBe(0);
    expect(report.overPredictionCount).toBe(0);
  });

  it("splits misses into under- and over-prediction, never both", () => {
    const report = computeCalibrationReport([
      kase(10000, 9500, 10500, 11000),
      kase(10000, 9500, 10500, 12000),
      kase(10000, 9500, 10500, 9000),
    ]);
    expect(report.underPredictionCount).toBe(2);
    expect(report.overPredictionCount).toBe(1);
    expect(report.coveredCount + report.underPredictionCount + report.overPredictionCount).toBe(
      report.evaluatedCount
    );
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const cases = [kase(10000, 9500, 10500, 10200), kase(10000, 9500, 10500, 11000)];
    expect(computeCalibrationReport(cases)).toEqual(computeCalibrationReport(cases));
  });
});

describe("toCalibrationCases", () => {
  const backtestCase = (overrides: Partial<BacktestCase>): BacktestCase => ({
    competitionId: "c1",
    date: "2026-01-01T00:00:00.000Z",
    predictedAverageMs: 10000,
    confidenceRangeMs: [9500, 10500],
    actualAverageMs: 10200,
    absoluteErrorMs: 200,
    percentErrorPct: 1.96,
    biasPct: 1.96,
    adjustmentFactorPctUsed: 0.05,
    confidenceLevelUsed: "medium",
    ...overrides,
  });

  it("maps backtest cases onto calibration cases", () => {
    expect(toCalibrationCases([backtestCase({})])).toEqual([
      { predicted: 10000, lower: 9500, upper: 10500, actual: 10200 },
    ]);
  });

  it("drops cases without an interval", () => {
    expect(toCalibrationCases([backtestCase({ confidenceRangeMs: null })])).toEqual([]);
  });

  it("feeds real runBacktest output end to end", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const BASE = Date.UTC(2026, 0, 1);
    const solveAt = (daysBeforeBase: number, millis: number): TimedPracticeSolve => ({
      millis,
      penalty: null,
      localCreatedAt: BASE - daysBeforeBase * DAY,
    });
    const competition = (id: string, daysBeforeBase: number, averageMs: number): CompetitionResultInput => ({
      id,
      date: new Date(BASE - daysBeforeBase * DAY).toISOString(),
      event: "3x3x3",
      averageMs,
    });

    const solves = [
      solveAt(96, 10000), solveAt(94, 10000),
      solveAt(66, 10000), solveAt(64, 10000),
      solveAt(12, 10000), solveAt(8, 10000),
    ];
    const results = [competition("c1", 90, 11000), competition("c2", 60, 10500), competition("c3", 5, 10800)];

    const backtest = runBacktest(solves, results, "3x3x3");
    const report = computeCalibrationReport(toCalibrationCases(backtest.cases));

    expect(backtest.cases.every((c) => c.confidenceRangeMs !== null)).toBe(true);
    expect(report.evaluatedCount).toBe(backtest.summary.evaluatedCount);
    expect(report.coveredCount + report.underPredictionCount + report.overPredictionCount).toBe(
      report.evaluatedCount
    );
  });
});
