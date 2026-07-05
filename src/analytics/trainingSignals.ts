// CubeBox analytics — training signals for the practice coach (pure).
//
// Aggregates numbers, not language: every field here is either a direct
// read of an existing analytics output (buildFeatureVector, a
// predictCompetitionResult call, a runBacktest call, computeRecordHistory)
// or a small derived count/comparison over them. The only genuinely new
// computation is momentum — a comparison between two adjacent practice
// windows. See practiceCoach.ts for scoring/rules built on top of this.

import type { CompetitionResultInput, ConfidenceLevel, PredictionResult, TimedPracticeSolve } from "./competitionPrediction";
import { computePracticeWindow } from "./competitionPrediction";
import { buildFeatureVector } from "./predictionFeatures";
import type { BacktestSummary } from "./backtesting";
import { computeRecordHistory, RECORD_TYPES, toChronological } from "./records";
import type { TimedSolve } from "./records";
import { mean } from "./averages";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Solves passed to the coach need an id (record detection is keyed on it) on top of the usual timed-practice-solve fields. */
export type CoachSolve = TimedPracticeSolve & TimedSolve;

export interface TrainingSignals {
  event: string;

  practiceMeanMs: number | null;
  practiceStddevMs: number | null;
  dnfRatePct: number;
  plus2RatePct: number;
  practiceCount: number;
  practiceDaysInLast14: number;

  /** recentMeanMs - earlierMeanMs over two adjacent 7-day windows; negative = getting faster. Null without a full valid solve in each window. */
  momentumMs: number | null;

  /** Same value as predictCompetitionResult's adjustmentFactorPct — never recomputed. */
  competitionGapPct: number | null;
  competitionConfidence: ConfidenceLevel;
  /** BacktestSummary.averageAbsoluteErrorPct, passed through. */
  backtestErrorPct: number | null;

  /** Days since the most recent PB across any record type; null with no records yet. */
  daysSinceLastPb: number | null;
}

const MOMENTUM_WINDOW_DAYS = 7;

function computeMomentumMs(solves: CoachSolve[], event: string, now: number): number | null {
  const recent = computePracticeWindow(solves, event, now, MOMENTUM_WINDOW_DAYS);
  const earlier = computePracticeWindow(solves, event, now - MOMENTUM_WINDOW_DAYS * MS_PER_DAY, MOMENTUM_WINDOW_DAYS);
  const recentMean = mean(recent.solves);
  const earlierMean = mean(earlier.solves);
  if (recentMean.status !== "ok" || earlierMean.status !== "ok") return null;
  return recentMean.valueMs - earlierMean.valueMs;
}

function countDistinctPracticeDays(solves: CoachSolve[], event: string, now: number): number {
  const window = computePracticeWindow(solves, event, now, 14);
  const days = new Set(
    window.solves
      .filter((s) => typeof s.localCreatedAt === "number")
      .map((s) => new Date(s.localCreatedAt as number).toISOString().slice(0, 10))
  );
  return days.size;
}

function computeDaysSinceLastPb(solves: CoachSolve[], now: number): number | null {
  const history = computeRecordHistory(toChronological(solves));
  const timestamps = RECORD_TYPES.map((type) => history.currentRecords[type]?.timestamp).filter(
    (t): t is number => typeof t === "number"
  );
  if (timestamps.length === 0) return null;
  return (now - Math.max(...timestamps)) / MS_PER_DAY;
}

/**
 * `prediction` and `backtestSummary` are accepted pre-computed rather than
 * re-derived here — same division of labor as explainPrediction, which
 * also takes both as already-computed arguments instead of recomputing
 * predictCompetitionResult/runBacktest a second time.
 */
export function computeTrainingSignals(
  allSolvesForEvent: CoachSolve[],
  event: string,
  competitionResults: CompetitionResultInput[],
  prediction: PredictionResult,
  backtestSummary: BacktestSummary,
  now: number = Date.now()
): TrainingSignals {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const features = buildFeatureVector(solves, event, now, competitionResults);

  return {
    event,
    practiceMeanMs: features.practiceMeanMs,
    practiceStddevMs: features.practiceStddevMs,
    dnfRatePct: features.dnfRatePct,
    plus2RatePct: features.plus2RatePct,
    practiceCount: features.practiceCount,
    practiceDaysInLast14: countDistinctPracticeDays(solves, event, now),
    momentumMs: computeMomentumMs(solves, event, now),
    competitionGapPct: prediction.adjustmentFactorPct,
    competitionConfidence: prediction.confidenceLevel,
    backtestErrorPct: backtestSummary.averageAbsoluteErrorPct,
    daysSinceLastPb: computeDaysSinceLastPb(solves, now),
  };
}
