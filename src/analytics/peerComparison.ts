// CubeBox analytics — peer competition comparison (pure).
//
// predictCompetitionResult (competitionPrediction.ts) needs practice solves,
// which CubeBox only has for the local user - there's no way to see how
// another competitor practices. So a peer's estimate is built from
// competition history alone: a recency-weighted average of their official
// results (recent results count for more), nudged by the linear trend
// across those same results (their rate of improvement or decline). This
// reuses computeConfidence from competitionPrediction.ts so both models
// report confidence on the same variance scale, even though they're
// computed from entirely different inputs.

import type { ConfidenceLevel } from "./competitionPrediction";
import { computeConfidence } from "./competitionPrediction";

export interface PeerCompetitionResult {
  id: string;
  competitionName: string;
  /** ISO date string. */
  date: string;
  averageMs: number;
}

export interface PeerPredictionResult {
  wcaId: string;
  personName: string | null;
  event: string;
  /** How many of their most recent competitions the estimate is actually based on (<= recentWindowSize). */
  competitionsUsed: number;
  /** Every competition CubeBox found for this event, before windowing to the recent subset. */
  totalCompetitionsAvailable: number;
  /** Recency-weighted mean of their official averages; null with 0 results. */
  weightedAverageMs: number | null;
  /** ms change per competition from a linear fit over their history; null with <2 results. Negative = getting faster. */
  trendMsPerCompetition: number | null;
  predictedAverageMs: number | null;
  confidenceRangeMs: [number, number] | null;
  confidenceLevel: ConfidenceLevel;
  /** Chronological (oldest first), exactly the recent subset the estimate was built from. */
  history: PeerCompetitionResult[];
}

const SINGLE_DATA_POINT_RANGE_FRACTION = 0.15;

// A cuber's full WCA history can span years and skill levels far apart from
// where they are now - folding a beginner-era 30s average into the same
// estimate as this year's 8s average both drags the weighted average down
// and manufactures huge variance (crushing confidence to "low" even for a
// currently-consistent competitor). Capping to their most recent
// competitions keeps the estimate about their *current* form, matching
// "recent competition results" rather than their entire competitive career.
const DEFAULT_RECENT_WINDOW = 10;

/**
 * Linear least-squares slope of averageMs against competition index
 * (0, 1, 2, ...) - "index" rather than elapsed days, so a long gap between
 * two competitions doesn't manufacture an enormous trend. Returns null for
 * fewer than 2 points, where a slope isn't defined.
 */
function linearTrendPerCompetition(averages: number[]): number | null {
  const n = averages.length;
  if (n < 2) return null;
  const xs = averages.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = averages.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (averages[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Population variance of each result's fractional deviation from the
 * weighted average - deliberately the same scale as competitionPrediction's
 * gapPct variance (a small fraction, ~0.0025 is roughly a 5% spread) so
 * computeConfidence's thresholds apply unchanged to a completely different
 * kind of input.
 */
function relativeVariance(averages: number[], referenceMs: number): number | null {
  if (averages.length < 2 || referenceMs <= 0) return null;
  const deviations = averages.map((v) => (v - referenceMs) / referenceMs);
  const meanDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  return deviations.reduce((sum, d) => sum + (d - meanDeviation) ** 2, 0) / deviations.length;
}

/**
 * Builds a peer's "next competition" estimate from their official result
 * history alone. `history` must already be chronological (oldest first) -
 * callers building it from WCA data should sort by competition date first.
 * Only the most recent `recentWindowSize` results are actually used (see
 * DEFAULT_RECENT_WINDOW); `totalCompetitionsAvailable` on the result still
 * reports how many were found in total. Mirrors predictCompetitionResult's
 * empty-data handling: 0 results -> everything null ("insufficient"),
 * exactly 1 result -> no trend is possible so no real prediction is
 * produced either (still "low" confidence, matching the practice model's
 * single-competition case).
 */
export function predictFromCompetitionHistory(
  history: PeerCompetitionResult[],
  event: string,
  wcaId: string,
  personName: string | null,
  recentWindowSize: number = DEFAULT_RECENT_WINDOW
): PeerPredictionResult {
  const fullHistory = Array.isArray(history) ? history : [];
  const list = recentWindowSize > 0 ? fullHistory.slice(-recentWindowSize) : fullHistory;
  const n = list.length;
  const averages = list.map((r) => r.averageMs);

  const shared = {
    wcaId,
    personName,
    event,
    competitionsUsed: n,
    totalCompetitionsAvailable: fullHistory.length,
    history: list,
  };

  if (n === 0) {
    return {
      ...shared,
      weightedAverageMs: null,
      trendMsPerCompetition: null,
      predictedAverageMs: null,
      confidenceRangeMs: null,
      confidenceLevel: computeConfidence(0, null),
    };
  }

  // Weight increases linearly with recency: oldest result gets weight 1,
  // newest gets weight n - recent form matters more than old results, but
  // without the sharp cliff a fixed rolling window would create.
  const weights = averages.map((_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const weightedAverageMs = averages.reduce((sum, avg, i) => sum + avg * weights[i], 0) / weightSum;

  if (n === 1) {
    return {
      ...shared,
      weightedAverageMs,
      trendMsPerCompetition: null,
      predictedAverageMs: null,
      confidenceRangeMs: null,
      confidenceLevel: computeConfidence(1, null),
    };
  }

  const trendMsPerCompetition = linearTrendPerCompetition(averages);
  const variance = relativeVariance(averages, weightedAverageMs);
  const confidenceLevel = computeConfidence(n, variance);

  // Weighted average anchors the estimate; one step of the fitted trend
  // projects it forward to "their next competition" without extrapolating
  // further than that single step.
  const predictedAverageMs = weightedAverageMs + (trendMsPerCompetition ?? 0);
  const spreadFraction = variance !== null ? Math.sqrt(variance) : SINGLE_DATA_POINT_RANGE_FRACTION;
  const halfRangeMs = predictedAverageMs * spreadFraction;
  const confidenceRangeMs: [number, number] = [predictedAverageMs - halfRangeMs, predictedAverageMs + halfRangeMs];

  return {
    ...shared,
    weightedAverageMs,
    trendMsPerCompetition,
    predictedAverageMs,
    confidenceRangeMs,
    confidenceLevel,
  };
}
