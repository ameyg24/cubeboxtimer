// CubeBox analytics - feature engineering for the ML-style prediction
// models (pure). Turns solve history + competition history, as of a single
// point in time, into a fixed-shape numeric feature vector. Every feature
// is computed only from data strictly before `referenceDateMs` - this file
// is the one place that invariant is enforced, so predictionModels.ts and
// modelComparison.ts never have to re-derive it.

import type { CompetitionResultInput, TimedPracticeSolve } from "./competitionPrediction";
import { computePracticeWindow, DEFAULT_PRACTICE_WINDOW_DAYS } from "./competitionPrediction";
import { ao5, ao12, ao50, best } from "./averages";
import { computeSessionStats } from "./sessionStats";
import { runBacktest } from "./backtesting";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface FeatureVector {
  practiceMeanMs: number | null;
  practiceAo5Ms: number | null;
  practiceAo12Ms: number | null;
  practiceAo50Ms: number | null;
  practiceCount: number;
  /** Population stddev of the practice window's valid solves, ms. */
  practiceStddevMs: number | null;
  dnfRatePct: number;
  plus2RatePct: number;
  practiceBestMs: number | null;
  /** Null with no prior competition to measure from. */
  daysSincePreviousCompetition: number | null;
  /** Mean gap between consecutive prior competitions, days. Null with fewer than 2 prior. */
  averageCompetitionGapDays: number | null;
  priorCompetitionCount: number;
  /**
   * Rule-based model's absolute error (ms) on the most recent prior
   * competition it could actually score - i.e. the last entry runBacktest
   * produces over `priorResults`. Null when there isn't one (fewer than 2
   * prior competitions, or no practice data existed at the time).
   */
  priorPredictionErrorMs: number | null;
}

/**
 * Builds a feature vector as of `referenceDateMs`, using only solves and
 * competitions strictly before it - `priorResults` is filtered defensively
 * here rather than trusting the caller, so a leakage bug elsewhere can't
 * silently corrupt training data. `allSolvesForEvent` should be every known
 * solve for the event (not just recent ones); computePracticeWindow already
 * only looks backward from `referenceDateMs`, so no equivalent solve-side
 * filter is needed.
 */
export function buildFeatureVector(
  allSolvesForEvent: TimedPracticeSolve[],
  event: string,
  referenceDateMs: number,
  priorResults: CompetitionResultInput[],
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): FeatureVector {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const priors = (Array.isArray(priorResults) ? priorResults : [])
    .filter((r) => Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) < referenceDateMs)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const window = computePracticeWindow(solves, event, referenceDateMs, windowDays);
  const stats = computeSessionStats(window.solves);

  const practiceMeanMs = stats.mean.status === "ok" ? stats.mean.valueMs : null;
  const ao5Result = ao5(window.solves);
  const practiceAo5Ms = ao5Result.status === "ok" ? ao5Result.valueMs : null;
  const ao12Result = ao12(window.solves);
  const practiceAo12Ms = ao12Result.status === "ok" ? ao12Result.valueMs : null;
  const ao50Result = ao50(window.solves);
  const practiceAo50Ms = ao50Result.status === "ok" ? ao50Result.valueMs : null;
  const bestResult = best(window.solves);
  const practiceBestMs = bestResult.status === "ok" ? bestResult.valueMs : null;

  const dnfRatePct = stats.count > 0 ? (stats.dnfCount / stats.count) * 100 : 0;
  const plus2RatePct = stats.count > 0 ? (stats.plus2Count / stats.count) * 100 : 0;

  let daysSincePreviousCompetition: number | null = null;
  let averageCompetitionGapDays: number | null = null;
  if (priors.length > 0) {
    const mostRecentMs = Date.parse(priors[priors.length - 1].date);
    daysSincePreviousCompetition = (referenceDateMs - mostRecentMs) / MS_PER_DAY;
  }
  if (priors.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < priors.length; i++) {
      gaps.push((Date.parse(priors[i].date) - Date.parse(priors[i - 1].date)) / MS_PER_DAY);
    }
    averageCompetitionGapDays = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }

  // Reuses runBacktest rather than re-deriving "what would the rule-based
  // model have predicted" - the last case it produces over `priors` is, by
  // construction, the most recent prior competition the model could score.
  const priorBacktest = runBacktest(solves, priors, event, windowDays);
  const lastCase = priorBacktest.cases.length > 0 ? priorBacktest.cases[priorBacktest.cases.length - 1] : null;
  const priorPredictionErrorMs = lastCase ? lastCase.absoluteErrorMs : null;

  return {
    practiceMeanMs,
    practiceAo5Ms,
    practiceAo12Ms,
    practiceAo50Ms,
    practiceCount: window.solves.length,
    practiceStddevMs: stats.stddevMs,
    dnfRatePct,
    plus2RatePct,
    practiceBestMs,
    daysSincePreviousCompetition,
    averageCompetitionGapDays,
    priorCompetitionCount: priors.length,
    priorPredictionErrorMs,
  };
}
