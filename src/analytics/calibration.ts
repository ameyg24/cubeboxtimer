// CubeBox analytics - interval calibration (pure).
//
// Measures whether predicted confidence intervals actually contained the
// results they claimed to cover, over walk-forward cases: of N intervals,
// how many held the actual value, and how wide were they. Units are the
// caller's (ms everywhere in this codebase).

import type { BacktestCase } from "./backtesting";

export interface CalibrationCase {
  predicted: number;
  lower: number;
  upper: number;
  actual: number;
}

export interface CalibrationReport {
  evaluatedCount: number;
  /** Cases where lower <= actual <= upper (bounds inclusive). */
  coveredCount: number;
  coveragePct: number | null;
  meanIntervalWidth: number | null;
  meanAbsoluteError: number | null;
  /** actual above the interval - the prediction ran low. */
  underPredictionCount: number;
  /** actual below the interval - the prediction ran high. */
  overPredictionCount: number;
}

export function computeCalibrationReport(cases: CalibrationCase[]): CalibrationReport {
  const list = Array.isArray(cases) ? cases : [];
  if (list.length === 0) {
    return {
      evaluatedCount: 0,
      coveredCount: 0,
      coveragePct: null,
      meanIntervalWidth: null,
      meanAbsoluteError: null,
      underPredictionCount: 0,
      overPredictionCount: 0,
    };
  }

  const covered = list.filter((c) => c.actual >= c.lower && c.actual <= c.upper);
  return {
    evaluatedCount: list.length,
    coveredCount: covered.length,
    coveragePct: (covered.length / list.length) * 100,
    meanIntervalWidth: list.reduce((sum, c) => sum + (c.upper - c.lower), 0) / list.length,
    meanAbsoluteError: list.reduce((sum, c) => sum + Math.abs(c.actual - c.predicted), 0) / list.length,
    underPredictionCount: list.filter((c) => c.actual > c.upper).length,
    overPredictionCount: list.filter((c) => c.actual < c.lower).length,
  };
}

/** Adapts backtest cases (dropping any without an interval) so runBacktest output feeds straight in. */
export function toCalibrationCases(backtestCases: BacktestCase[]): CalibrationCase[] {
  return (Array.isArray(backtestCases) ? backtestCases : [])
    .filter((c) => c.confidenceRangeMs !== null)
    .map((c) => ({
      predicted: c.predictedAverageMs,
      lower: (c.confidenceRangeMs as [number, number])[0],
      upper: (c.confidenceRangeMs as [number, number])[1],
      actual: c.actualAverageMs,
    }));
}
