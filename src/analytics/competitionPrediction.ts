// CubeBox analytics - competition performance prediction (pure).
//
// For every past competition where both the practice average leading up to
// it and the official result are known, compute how far off practice was
// ("the gap"). The average of those gaps is a personal "competition
// adjustment factor" - applied to current practice data, it becomes the
// prediction. Built on mean()/rollingAverageOfN()/computeSessionStats()
// from this module. See docs/architecture/overview.md.

import type { Solve } from "./types";
import { best, mean, rollingAverageOfN } from "./averages";
import { computeSessionStats } from "./sessionStats";

export type ConfidenceLevel = "insufficient" | "low" | "medium" | "high";

/** The minimal solve shape this module needs beyond {millis, penalty}. */
export interface TimedPracticeSolve extends Solve {
  localCreatedAt?: number;
}

/**
 * An official WCA competition result, reduced to what the prediction model
 * needs. Mirrors the persisted CompetitionResult shape (see
 * useCompetitionResults.js) but only requires the fields used here, so
 * tests can construct minimal fixtures.
 */
export interface CompetitionResultInput {
  id: string;
  /** ISO date string. */
  date: string;
  event: string;
  averageMs: number | null;
  bestMs?: number | null;
}

export interface PracticeWindow {
  event: string;
  startMs: number;
  endMs: number;
  solves: TimedPracticeSolve[];
}

/** One past competition's practice-average-vs-official-average pairing. */
export interface PracticeVsOfficial {
  competitionId: string;
  practiceAverageMs: number;
  officialAverageMs: number;
}

export interface CompetitionComparison extends PracticeVsOfficial {
  /** (officialAverageMs - practiceAverageMs) / practiceAverageMs */
  gapPct: number;
}

export interface AdjustmentFactorResult {
  /** Average gapPct across all usable comparisons; null if there are none. */
  adjustmentFactorPct: number | null;
  comparisons: CompetitionComparison[];
  /** Population variance of gapPct across comparisons; null if fewer than 2. */
  variance: number | null;
}

export interface PredictionResult {
  event: string;

  practiceAverageMs: number | null;
  /** Population stddev of the current practice window's valid solves, ms. */
  practiceConsistencyMs: number | null;
  /** Rolling ao5 as of the most recent practice solve in the window. */
  recentFormMs: number | null;
  practiceDnfRatePct: number | null;
  practiceSolveCount: number;

  predictedAverageMs: number | null;
  confidenceRangeMs: [number, number] | null;
  confidenceLevel: ConfidenceLevel;
  adjustmentFactorPct: number | null;
  competitionsUsed: number;
  /** Per-competition practice-vs-official breakdown, in `pastResultsForEvent` order. */
  comparisons: CompetitionComparison[];
}

export const DEFAULT_PRACTICE_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Confidence thresholds are on gapPct variance (a fraction, e.g. 0.0025 is a
// population stddev of ~5 percentage points across past gaps). These are
// plain, documented round numbers - not fitted parameters.
const LOW_VARIANCE_THRESHOLD = 0.0025;
const HIGH_VARIANCE_THRESHOLD = 0.01;

// With exactly one past competition there's no variance to measure at all,
// so ±15% is a wide placeholder range for that single-data-point case.
const SINGLE_DATA_POINT_RANGE_FRACTION = 0.15;

/**
 * Slices a solve list down to the window of `windowDays` immediately before
 * `referenceDateMs` (e.g. a competition date, or "now" for a live
 * prediction). Callers are expected to have already scoped `solves` to a
 * single event - this function does not filter by event, matching how
 * computeRecordHistory and computeSessionStats treat their solve lists.
 */
export function computePracticeWindow(
  solves: TimedPracticeSolve[],
  event: string,
  referenceDateMs: number,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): PracticeWindow {
  const startMs = referenceDateMs - windowDays * MS_PER_DAY;
  const endMs = referenceDateMs;
  const list = Array.isArray(solves) ? solves : [];
  const windowSolves = list.filter((solve) => {
    const t = solve.localCreatedAt;
    return typeof t === "number" && t >= startMs && t < endMs;
  });
  return { event, startMs, endMs, solves: windowSolves };
}

/**
 * Averages the historical gap between practice and official results. This
 * *is* the adjustment factor: a plain mean of `(official - practice) /
 * practice` across every past competition with usable data, plus its
 * variance (used by computeConfidence) and the per-competition breakdown
 * (so a UI can show exactly how the number was derived).
 */
export function computeAdjustmentFactor(pairs: PracticeVsOfficial[]): AdjustmentFactorResult {
  const list = Array.isArray(pairs) ? pairs : [];
  const comparisons: CompetitionComparison[] = list
    .filter((p) => Number.isFinite(p.practiceAverageMs) && p.practiceAverageMs > 0 && Number.isFinite(p.officialAverageMs))
    .map((p) => ({
      ...p,
      gapPct: (p.officialAverageMs - p.practiceAverageMs) / p.practiceAverageMs,
    }));

  if (comparisons.length === 0) {
    return { adjustmentFactorPct: null, comparisons: [], variance: null };
  }

  const gaps = comparisons.map((c) => c.gapPct);
  const adjustmentFactorPct = gaps.reduce((a, b) => a + b, 0) / gaps.length;

  let variance: number | null = null;
  if (gaps.length >= 2) {
    variance = gaps.reduce((sum, g) => sum + (g - adjustmentFactorPct) ** 2, 0) / gaps.length;
  }

  return { adjustmentFactorPct, comparisons, variance };
}

/**
 * Confidence is a fixed, inspectable rule ladder over (a) how many past
 * competitions back the adjustment factor and (b) how consistent those
 * gaps have been - never a fitted score.
 */
export function computeConfidence(competitionsUsed: number, variance: number | null): ConfidenceLevel {
  if (competitionsUsed <= 0) return "insufficient";
  if (competitionsUsed === 1) return "low";

  let level: ConfidenceLevel = competitionsUsed >= 4 ? "high" : "medium";
  if (variance !== null) {
    if (variance >= HIGH_VARIANCE_THRESHOLD) {
      level = "low";
    } else if (variance >= LOW_VARIANCE_THRESHOLD && level === "high") {
      level = "medium";
    }
  }
  return level;
}

/**
 * Ties the model together: builds a practice-vs-official comparison for
 * every past competition, derives the adjustment factor and confidence,
 * then applies that factor to the *current* practice window to produce a
 * prediction. Returns predictedAverageMs = null (no prediction) whenever
 * there isn't enough data to responsibly extrapolate from - either no
 * historical comparisons, or no current practice data to apply them to.
 *
 * `allSolvesForEvent` should be every known solve for the target event
 * (not just recent ones) - past competitions can be far enough back that
 * their practice window falls well outside any "recent" slice.
 */
export function predictCompetitionResult(
  allSolvesForEvent: TimedPracticeSolve[],
  pastResultsForEvent: CompetitionResultInput[],
  event: string,
  now: number,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): PredictionResult {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const pastResults = Array.isArray(pastResultsForEvent) ? pastResultsForEvent : [];

  const pairs: PracticeVsOfficial[] = [];
  for (const result of pastResults) {
    if (result.averageMs === null || !Number.isFinite(result.averageMs)) continue;
    const competitionDateMs = Date.parse(result.date);
    if (!Number.isFinite(competitionDateMs)) continue;

    const window = computePracticeWindow(solves, event, competitionDateMs, windowDays);
    const practiceResult = mean(window.solves);
    if (practiceResult.status !== "ok") continue;

    pairs.push({
      competitionId: result.id,
      practiceAverageMs: practiceResult.valueMs,
      officialAverageMs: result.averageMs,
    });
  }

  const { adjustmentFactorPct, comparisons, variance } = computeAdjustmentFactor(pairs);
  const confidenceLevel = computeConfidence(comparisons.length, variance);

  const currentWindow = computePracticeWindow(solves, event, now, windowDays);
  const currentPracticeResult = mean(currentWindow.solves);
  const practiceAverageMs = currentPracticeResult.status === "ok" ? currentPracticeResult.valueMs : null;

  const currentStats = computeSessionStats(currentWindow.solves);
  const practiceConsistencyMs = currentStats.stddevMs;
  const practiceDnfRatePct = currentStats.count > 0 ? (currentStats.dnfCount / currentStats.count) * 100 : null;

  const rollingAo5 = rollingAverageOfN(currentWindow.solves, 5);
  const lastRolling = rollingAo5.length > 0 ? rollingAo5[rollingAo5.length - 1] : null;
  const recentFormMs = lastRolling && lastRolling.status === "ok" ? lastRolling.valueMs : null;

  const shared = {
    event,
    practiceAverageMs,
    practiceConsistencyMs,
    recentFormMs,
    practiceDnfRatePct,
    practiceSolveCount: currentWindow.solves.length,
    adjustmentFactorPct,
    competitionsUsed: comparisons.length,
    confidenceLevel,
    comparisons,
  };

  if (adjustmentFactorPct === null || practiceAverageMs === null) {
    return { ...shared, predictedAverageMs: null, confidenceRangeMs: null };
  }

  const predictedAverageMs = practiceAverageMs * (1 + adjustmentFactorPct);
  const spreadFraction = variance !== null ? Math.sqrt(variance) : SINGLE_DATA_POINT_RANGE_FRACTION;
  const halfRangeMs = predictedAverageMs * spreadFraction;
  const confidenceRangeMs: [number, number] = [predictedAverageMs - halfRangeMs, predictedAverageMs + halfRangeMs];

  return { ...shared, predictedAverageMs, confidenceRangeMs };
}

export interface BestPredictionResult {
  event: string;
  /** Fastest valid solve in the current practice window. */
  practiceBestMs: number | null;
  predictedBestMs: number | null;
  confidenceRangeMs: [number, number] | null;
  confidenceLevel: ConfidenceLevel;
  adjustmentFactorPct: number | null;
  competitionsUsed: number;
  /** Per-competition practice-best-vs-official-best breakdown. */
  comparisons: CompetitionComparison[];
}

/**
 * The exact same model as predictCompetitionResult, applied to best singles
 * instead of averages: for every past competition where both a practice
 * window best and an official best are known, the gap between them becomes
 * a personal "best-single adjustment factor", applied to the current
 * practice window's best to produce a prediction. Reuses
 * computeAdjustmentFactor/computeConfidence unchanged - they're generic over
 * any practice-vs-official pair, average or best.
 */
export function predictCompetitionBest(
  allSolvesForEvent: TimedPracticeSolve[],
  pastResultsForEvent: CompetitionResultInput[],
  event: string,
  now: number,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): BestPredictionResult {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const pastResults = Array.isArray(pastResultsForEvent) ? pastResultsForEvent : [];

  const pairs: PracticeVsOfficial[] = [];
  for (const result of pastResults) {
    if (result.bestMs == null || !Number.isFinite(result.bestMs)) continue;
    const competitionDateMs = Date.parse(result.date);
    if (!Number.isFinite(competitionDateMs)) continue;

    const window = computePracticeWindow(solves, event, competitionDateMs, windowDays);
    const practiceResult = best(window.solves);
    if (practiceResult.status !== "ok") continue;

    pairs.push({
      competitionId: result.id,
      practiceAverageMs: practiceResult.valueMs,
      officialAverageMs: result.bestMs,
    });
  }

  const { adjustmentFactorPct, comparisons, variance } = computeAdjustmentFactor(pairs);
  const confidenceLevel = computeConfidence(comparisons.length, variance);

  const currentWindow = computePracticeWindow(solves, event, now, windowDays);
  const currentBestResult = best(currentWindow.solves);
  const practiceBestMs = currentBestResult.status === "ok" ? currentBestResult.valueMs : null;

  const shared = {
    event,
    practiceBestMs,
    adjustmentFactorPct,
    competitionsUsed: comparisons.length,
    confidenceLevel,
    comparisons,
  };

  if (adjustmentFactorPct === null || practiceBestMs === null) {
    return { ...shared, predictedBestMs: null, confidenceRangeMs: null };
  }

  const predictedBestMs = practiceBestMs * (1 + adjustmentFactorPct);
  const spreadFraction = variance !== null ? Math.sqrt(variance) : SINGLE_DATA_POINT_RANGE_FRACTION;
  const halfRangeMs = predictedBestMs * spreadFraction;
  const confidenceRangeMs: [number, number] = [predictedBestMs - halfRangeMs, predictedBestMs + halfRangeMs];

  return { ...shared, predictedBestMs, confidenceRangeMs };
}
