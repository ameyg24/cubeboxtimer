// CubeBox analytics - peer competition comparison (pure).
//
// predictCompetitionResult (competitionPrediction.ts) needs practice solves,
// which CubeBox only has for the local user - there's no way to see how
// another competitor practices. So a peer's estimate is built from
// competition history alone: a recency-weighted average of their official
// results (recent results count for more), nudged by the linear trend
// across those same results (their rate of improvement or decline). This
// reuses computeConfidence from competitionPrediction.ts so both models
// report confidence on the same variance scale, even though they're
// computed from entirely different inputs. Both averages and best singles
// get their own estimate, computed identically off their own value series.

import type { ConfidenceLevel } from "./competitionPrediction";
import { computeConfidence } from "./competitionPrediction";

export interface PeerCompetitionResult {
  id: string;
  competitionName: string;
  /** ISO date string. */
  date: string;
  averageMs: number;
  bestMs: number | null;
}

export interface PeerMetricPrediction {
  /** Recency-weighted mean of this metric's values; null with 0 results. */
  weightedMs: number | null;
  /** ms change per competition from a linear fit; null with <2 results. Negative = getting faster. */
  trendMsPerCompetition: number | null;
  predictedMs: number | null;
  confidenceRangeMs: [number, number] | null;
  confidenceLevel: ConfidenceLevel;
  competitionsUsed: number;
}

export interface PeerPredictionResult {
  wcaId: string;
  personName: string | null;
  event: string;
  /** How many of their most recent competitions the average estimate is based on (<= recentWindowSize). */
  competitionsUsed: number;
  /** Every competition CubeBox found for this event, before windowing to the recent subset. */
  totalCompetitionsAvailable: number;
  /** Chronological (oldest first), exactly the recent subset the average estimate was built from. */
  history: PeerCompetitionResult[];
  average: PeerMetricPrediction;
  best: PeerMetricPrediction;
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
 * Linear least-squares slope of a value series against its index
 * (0, 1, 2, ...) - "index" rather than elapsed days, so a long gap between
 * two competitions doesn't manufacture an enormous trend. Returns null for
 * fewer than 2 points, where a slope isn't defined.
 */
function linearTrendPerCompetition(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (values[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Population variance of each value's fractional deviation from the
 * weighted average - deliberately the same scale as competitionPrediction's
 * gapPct variance (a small fraction, ~0.0025 is roughly a 5% spread) so
 * computeConfidence's thresholds apply unchanged to a completely different
 * kind of input.
 */
function relativeVariance(values: number[], referenceMs: number): number | null {
  if (values.length < 2 || referenceMs <= 0) return null;
  const deviations = values.map((v) => (v - referenceMs) / referenceMs);
  const meanDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  return deviations.reduce((sum, d) => sum + (d - meanDeviation) ** 2, 0) / deviations.length;
}

/**
 * The shared math behind both the average and best-single peer estimates:
 * a recency-weighted mean of `values` (oldest first), nudged by one step of
 * their linear trend. Mirrors predictCompetitionResult's empty-data
 * handling: 0 values -> everything null ("insufficient"), exactly 1 value
 * -> no trend is possible so no real prediction is produced either (still
 * "low" confidence, matching the practice model's single-competition case).
 */
function computeMetricPrediction(values: number[]): PeerMetricPrediction {
  const n = values.length;

  if (n === 0) {
    return {
      weightedMs: null,
      trendMsPerCompetition: null,
      predictedMs: null,
      confidenceRangeMs: null,
      confidenceLevel: computeConfidence(0, null),
      competitionsUsed: 0,
    };
  }

  // Weight increases linearly with recency: oldest value gets weight 1,
  // newest gets weight n - recent form matters more than old results, but
  // without the sharp cliff a fixed rolling window would create.
  const weights = values.map((_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const weightedMs = values.reduce((sum, v, i) => sum + v * weights[i], 0) / weightSum;

  if (n === 1) {
    return {
      weightedMs,
      trendMsPerCompetition: null,
      predictedMs: null,
      confidenceRangeMs: null,
      confidenceLevel: computeConfidence(1, null),
      competitionsUsed: 1,
    };
  }

  const trendMsPerCompetition = linearTrendPerCompetition(values);
  const variance = relativeVariance(values, weightedMs);
  const confidenceLevel = computeConfidence(n, variance);

  // Weighted average anchors the estimate; one step of the fitted trend
  // projects it forward to "their next competition" without extrapolating
  // further than that single step.
  const predictedMs = weightedMs + (trendMsPerCompetition ?? 0);
  const spreadFraction = variance !== null ? Math.sqrt(variance) : SINGLE_DATA_POINT_RANGE_FRACTION;
  const halfRangeMs = predictedMs * spreadFraction;
  const confidenceRangeMs: [number, number] = [predictedMs - halfRangeMs, predictedMs + halfRangeMs];

  return { weightedMs, trendMsPerCompetition, predictedMs, confidenceRangeMs, confidenceLevel, competitionsUsed: n };
}

/**
 * Builds a peer's "next competition" estimate - both average and best
 * single - from their official result history alone. `history` must
 * already be chronological (oldest first) - callers building it from WCA
 * data should sort by competition date first. Only the most recent
 * `recentWindowSize` results are used for the average estimate (see
 * DEFAULT_RECENT_WINDOW); `totalCompetitionsAvailable` still reports how
 * many were found in total. The best-single estimate is computed over the
 * same windowed subset, filtered to entries that actually have a bestMs
 * (rare to be missing, but not guaranteed for every imported round).
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

  const average = computeMetricPrediction(list.map((r) => r.averageMs));
  const bestValues = list.filter((r) => r.bestMs !== null).map((r) => r.bestMs as number);
  const best = computeMetricPrediction(bestValues);

  return {
    wcaId,
    personName,
    event,
    competitionsUsed: list.length,
    totalCompetitionsAvailable: fullHistory.length,
    history: list,
    average,
    best,
  };
}
