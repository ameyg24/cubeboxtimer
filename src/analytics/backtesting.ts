// CubeBox analytics — prediction backtesting (pure).
//
// Answers "how accurate have our predictions actually been?" by replaying
// history: for every competition, simulate the exact prediction
// predictCompetitionResult would have produced immediately before that
// competition happened, using only competitions strictly earlier than it,
// then compare that simulated prediction to what actually happened.
//
// No prediction math is re-implemented here: predictCompetitionResult is
// called once per competition with `now` pinned to that competition's own
// date and `pastResultsForEvent` restricted to strictly earlier
// competitions — the same function, replayed at an earlier point in time.

import type { ConfidenceLevel, CompetitionResultInput, TimedPracticeSolve } from "./competitionPrediction";
import { DEFAULT_PRACTICE_WINDOW_DAYS, predictCompetitionResult } from "./competitionPrediction";
import { median } from "./mlEvaluation";

export interface BacktestCase {
  competitionId: string;
  /** ISO date string, as supplied on the competition result. */
  date: string;
  predictedAverageMs: number;
  /** The prediction's confidence interval at the time, for calibration.ts. Set whenever the prediction itself is. */
  confidenceRangeMs: [number, number] | null;
  actualAverageMs: number;
  absoluteErrorMs: number;
  /** |predicted - actual| / actual, as a percent. Always >= 0. */
  percentErrorPct: number;
  /** (actual - predicted) / actual, as a percent. Positive = prediction was optimistic (too fast); negative = pessimistic (too slow). */
  biasPct: number;
  adjustmentFactorPctUsed: number | null;
  confidenceLevelUsed: ConfidenceLevel;
}

export interface BacktestSummary {
  evaluatedCount: number;
  averageAbsoluteErrorPct: number | null;
  medianAbsoluteErrorPct: number | null;
  rmsePct: number | null;
  /** Mean of biasPct across evaluated cases. Positive = predictions trended optimistic; negative = pessimistic. */
  averageBiasPct: number | null;
  /** Smallest percentErrorPct. */
  bestCase: BacktestCase | null;
  /** Largest percentErrorPct. */
  worstCase: BacktestCase | null;
}

export interface BacktestResult {
  event: string;
  /** Chronological order, oldest first. Reverse for "newest first" display. */
  cases: BacktestCase[];
  summary: BacktestSummary;
}

function numericMean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function summarizeBacktest(cases: BacktestCase[]): BacktestSummary {
  if (cases.length === 0) {
    return {
      evaluatedCount: 0,
      averageAbsoluteErrorPct: null,
      medianAbsoluteErrorPct: null,
      rmsePct: null,
      averageBiasPct: null,
      bestCase: null,
      worstCase: null,
    };
  }

  const percentErrors = cases.map((c) => c.percentErrorPct);

  return {
    evaluatedCount: cases.length,
    averageAbsoluteErrorPct: numericMean(percentErrors),
    medianAbsoluteErrorPct: median(percentErrors),
    rmsePct: Math.sqrt(numericMean(percentErrors.map((e) => e ** 2))),
    averageBiasPct: numericMean(cases.map((c) => c.biasPct)),
    bestCase: cases.reduce((a, b) => (b.percentErrorPct < a.percentErrorPct ? b : a)),
    worstCase: cases.reduce((a, b) => (b.percentErrorPct > a.percentErrorPct ? b : a)),
  };
}

/**
 * Replays history and scores every eligible competition. A competition is
 * eligible only when predictCompetitionResult, run as of that competition's
 * own date with strictly earlier competitions as its only history, actually
 * produces a numeric prediction — the same "don't fabricate a prediction"
 * rule the live prediction already follows. A competition with no earlier
 * competitions (nothing to learn an adjustment factor from) or no matching
 * practice data at that point in time is simply not included in `cases`.
 *
 * `allSolvesForEvent` should be every known solve for the target event, not
 * just recent ones — early competitions in the backtest need practice
 * windows from far enough back in solve history.
 */
export function runBacktest(
  allSolvesForEvent: TimedPracticeSolve[],
  allResultsForEvent: CompetitionResultInput[],
  event: string,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): BacktestResult {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const results = Array.isArray(allResultsForEvent) ? allResultsForEvent : [];

  const usable = results
    .filter((r) => r.averageMs !== null && Number.isFinite(r.averageMs) && Number.isFinite(Date.parse(r.date)))
    .map((r) => ({ ...r, dateMs: Date.parse(r.date) }))
    .sort((a, b) => a.dateMs - b.dateMs);

  const cases: BacktestCase[] = [];

  for (let i = 0; i < usable.length; i++) {
    const target = usable[i];
    // Strictly earlier only — a same-day tie must not count as "prior".
    const priorResults = usable.slice(0, i).filter((r) => r.dateMs < target.dateMs);
    if (priorResults.length === 0) continue;

    const prediction = predictCompetitionResult(solves, priorResults, event, target.dateMs, windowDays);
    if (prediction.predictedAverageMs === null) continue;

    const predictedAverageMs = prediction.predictedAverageMs;
    const actualAverageMs = target.averageMs as number;
    const absoluteErrorMs = Math.abs(predictedAverageMs - actualAverageMs);

    cases.push({
      competitionId: target.id,
      date: target.date,
      predictedAverageMs,
      confidenceRangeMs: prediction.confidenceRangeMs,
      actualAverageMs,
      absoluteErrorMs,
      percentErrorPct: (absoluteErrorMs / actualAverageMs) * 100,
      biasPct: ((actualAverageMs - predictedAverageMs) / actualAverageMs) * 100,
      adjustmentFactorPctUsed: prediction.adjustmentFactorPct,
      confidenceLevelUsed: prediction.confidenceLevel,
    });
  }

  return { event, cases, summary: summarizeBacktest(cases) };
}
