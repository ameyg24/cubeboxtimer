// CubeBox analytics — prediction explainability (pure).
//
// Turns a PredictionResult and a BacktestSummary — both already fully
// computed elsewhere — into a structured explanation of how the prediction
// was produced and how much each input contributed to it. This module
// never recomputes prediction math: every field is either a direct
// passthrough of an already-computed value, or a plain arithmetic
// interpretation of one. See PREDICTION_FACTORS below for exactly what
// "contribution" means and why.
//
// No ML, no fitting, no hidden weights: everything here is a documented,
// deterministic formula over fields predictCompetitionResult and
// runBacktest already produced.

import type { ConfidenceLevel, PredictionResult } from "./competitionPrediction";
import type { BacktestSummary } from "./backtesting";

export interface PredictionFactors {
  practicePerformancePct: number;
  historicalAdjustmentPct: number;
  consistencyPct: number;
  dnfHistoryPct: number;
  competitionHistoryPct: number;
}

export interface PredictionExplanation {
  practiceAverageMs: number | null;
  adjustmentFactorPct: number | null;
  predictedAverageMs: number | null;
  confidenceLevel: ConfidenceLevel;
  confidenceIntervalMs: [number, number] | null;
  competitionsUsed: number;
  /** Renamed passthrough of practiceDnfRatePct — the DNF rate in the current practice window, read as an estimated probability. */
  dnfProbabilityPct: number | null;
  /** BacktestSummary.averageAbsoluteErrorPct. Independent of the live prediction: can be null (not enough backtest history) even when a live prediction exists. */
  historicalAverageErrorPct: number | null;
  /** null whenever there is no live prediction to explain the composition of (predictedAverageMs === null). */
  factors: PredictionFactors | null;
}

// PREDICTION_FACTORS — what "relative contribution" means here
// -----------------------------------------------------------------------
// predictCompetitionResult's point-value formula has exactly two real
// terms: predicted = practiceAverage * (1 + adjustmentFactor). Consistency,
// DNF history, and competition-history sample size don't appear in that
// formula at all — they only widen or narrow the confidence range and the
// confidence level. There is no mathematically exact way to split a
// two-term product into five independent percentages.
//
// So this is NOT a decomposition of the arithmetic. It's a transparent,
// fixed-weight scoring of how much *signal* each factor is contributing to
// this specific prediction and its reliability, normalized so the five
// scores sum to 100%. Each raw score is a plain, disclosed formula over
// fields already present on PredictionResult:
//
//   practicePerformanceScore = 1 (constant)
//     Every prediction is unconditionally anchored to the practice
//     average — even a prediction with a zero adjustment factor still
//     depends entirely on it. This is the one factor that's always fully
//     present, so it gets a fixed baseline score of 1.
//
//   historicalAdjustmentScore = min(|adjustmentFactorPct|, 1)
//     The magnitude of the historical gap being applied. A zero
//     adjustment means this factor did no work reshaping the practice
//     number; capped at 100% since a gap beyond that is already an
//     extreme outlier not meaningfully differentiable further.
//
//   consistencyScore = min(practiceConsistencyMs / practiceAverageMs, 1)
//     Coefficient of variation of the current practice window. More
//     variable recent practice means the point estimate itself is less
//     reliable, so consistency carries more explanatory weight. Capped at
//     100% relative variability for the same reason as above.
//
//   dnfHistoryScore = (practiceDnfRatePct ?? 0) / 100
//     The DNF rate in the current practice window, as a 0-1 fraction.
//
//   competitionHistoryScore = min(competitionsUsed / 5, 1)
//     How much competition history backs the adjustment factor. Capped at
//     5 competitions — the same point at which computeConfidence's own
//     thresholds stop treating sample size as a limiting factor (4+ past
//     competitions unlocks its "high" base confidence), reused here rather
//     than inventing a second threshold.
//
// The five raw scores are then normalized (score / sum-of-all-scores) so
// they sum to exactly 100% (up to floating-point rounding). Because
// practicePerformanceScore is a constant 1, the sum of scores is always
// >= 1, so this normalization can never divide by zero.
const MAX_ADJUSTMENT_SCORE = 1;
const MAX_CONSISTENCY_SCORE = 1;
const COMPETITION_HISTORY_SATURATION = 5;

function computeFactors(prediction: PredictionResult): PredictionFactors {
  const practicePerformanceScore = 1;

  const historicalAdjustmentScore = Math.min(
    Math.abs(prediction.adjustmentFactorPct ?? 0),
    MAX_ADJUSTMENT_SCORE
  );

  const coefficientOfVariation =
    prediction.practiceConsistencyMs !== null &&
    prediction.practiceAverageMs !== null &&
    prediction.practiceAverageMs > 0
      ? prediction.practiceConsistencyMs / prediction.practiceAverageMs
      : 0;
  const consistencyScore = Math.min(coefficientOfVariation, MAX_CONSISTENCY_SCORE);

  const dnfHistoryScore = (prediction.practiceDnfRatePct ?? 0) / 100;

  const competitionHistoryScore = Math.min(
    prediction.competitionsUsed / COMPETITION_HISTORY_SATURATION,
    1
  );

  const total =
    practicePerformanceScore +
    historicalAdjustmentScore +
    consistencyScore +
    dnfHistoryScore +
    competitionHistoryScore;

  return {
    practicePerformancePct: (practicePerformanceScore / total) * 100,
    historicalAdjustmentPct: (historicalAdjustmentScore / total) * 100,
    consistencyPct: (consistencyScore / total) * 100,
    dnfHistoryPct: (dnfHistoryScore / total) * 100,
    competitionHistoryPct: (competitionHistoryScore / total) * 100,
  };
}

/**
 * Interprets an already-computed PredictionResult and BacktestSummary into
 * a structured explanation. Recomputes nothing: every field is a
 * passthrough or a plain arithmetic reading of fields those two functions
 * already produced. Returns factors: null whenever there's no live
 * prediction to explain (predictedAverageMs === null) — never fabricates a
 * breakdown for a prediction that doesn't exist.
 */
export function explainPrediction(
  prediction: PredictionResult,
  backtestSummary: BacktestSummary
): PredictionExplanation {
  const shared = {
    practiceAverageMs: prediction.practiceAverageMs,
    adjustmentFactorPct: prediction.adjustmentFactorPct,
    predictedAverageMs: prediction.predictedAverageMs,
    confidenceLevel: prediction.confidenceLevel,
    confidenceIntervalMs: prediction.confidenceRangeMs,
    competitionsUsed: prediction.competitionsUsed,
    dnfProbabilityPct: prediction.practiceDnfRatePct,
    historicalAverageErrorPct: backtestSummary.averageAbsoluteErrorPct,
  };

  if (prediction.predictedAverageMs === null) {
    return { ...shared, factors: null };
  }

  return { ...shared, factors: computeFactors(prediction) };
}
