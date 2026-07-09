// CubeBox analytics - statistical prediction models (pure).
//
// Two small, from-scratch models over the FeatureVector produced by
// predictionFeatures.ts. Both operate on the same fixed set of numeric
// features and degrade to "no prediction" (null) exactly like
// predictCompetitionResult does when there isn't enough data - never a
// fabricated number.

import type { FeatureVector } from "./predictionFeatures";
import type { DatasetRow } from "./mlDataset";

export interface TrainingRow {
  features: FeatureVector;
  actualAverageMs: number;
}

// Fixed feature order used by both models. Exported so mlDataset.ts builds
// its feature matrix from the exact projection the models train on, not a
// second definition. Both models accept a key subset so feature ablation
// (modelComparison.ts) can genuinely remove a column - zeroing a value
// instead would pass an off-manifold point through standardization.
export const MODEL_FEATURE_KEYS = [
  "practiceMeanMs",
  "practiceStddevMs",
  "dnfRatePct",
  "priorCompetitionCount",
] as const;

export type ModelFeatureKey = (typeof MODEL_FEATURE_KEYS)[number];

export function toModelVector(
  f: FeatureVector,
  keys: readonly ModelFeatureKey[] = MODEL_FEATURE_KEYS
): number[] | null {
  const values = keys.map((key) => f[key]);
  return values.every((v): v is number => typeof v === "number") ? values : null;
}

interface ColumnStats {
  mean: number;
  std: number;
}

function standardizeColumns(rows: number[][]): { standardized: number[][]; stats: ColumnStats[] } {
  const cols = rows[0].length;
  const stats: ColumnStats[] = [];
  for (let c = 0; c < cols; c++) {
    const values = rows.map((row) => row[c]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    // A constant column (std 0, e.g. every training row has 0 DNFs) would
    // divide by zero - std 1 leaves it at its centered value (0) instead.
    stats.push({ mean, std: Math.sqrt(variance) || 1 });
  }
  const standardized = rows.map((row) => row.map((v, c) => (v - stats[c].mean) / stats[c].std));
  return { standardized, stats };
}

function transpose(m: number[][]): number[][] {
  return m[0].map((_, c) => m.map((row) => row[c]));
}

function matMul(a: number[][], b: number[][]): number[][] {
  return a.map((row) => b[0].map((_, c) => row.reduce((sum, v, i) => sum + v * b[i][c], 0)));
}

/** Gauss-Jordan inversion of a small square matrix. Ridge's added lambda*I keeps this non-singular even when rows < features. */
function invert(m: number[][]): number[][] {
  const n = m.length;
  const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r;
    }
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    const pivot = aug[col][col];
    for (let c = 0; c < 2 * n; c++) aug[col][c] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let c = 0; c < 2 * n; c++) aug[r][c] -= factor * aug[col][c];
    }
  }
  return aug.map((row) => row.slice(n));
}

// Mild L2 regularization. Standardized features put every column on the
// same ~unit scale, so one fixed lambda works regardless of raw feature
// units (ms vs percent vs a plain count) - this is what makes ridge, not
// plain least squares, the right fit here: training rows (competitions) are
// usually fewer than the 4 features, which plain OLS can't handle at all.
const RIDGE_LAMBDA = 1;
const MIN_LINEAR_REGRESSION_ROWS = 2;

export interface RidgeContribution {
  feature: ModelFeatureKey;
  contributionMs: number;
}

// Model mechanics, not feature importance: contributions are the exact
// additive terms of the fitted linear formula (prediction = interceptMs +
// sum of contributionMs). Correlated predictors share attribution under
// ridge shrinkage, so these describe how the model computed this number,
// not which feature matters.
export interface RidgeExplanation {
  interceptMs: number;
  contributions: RidgeContribution[];
  predictedMs: number;
}

export interface LinearRegressionFit {
  predict(features: FeatureVector): number | null;
  explain(features: FeatureVector): RidgeExplanation | null;
}

/**
 * Ridge regression on standardized features, closed-form (normal
 * equations). Both X and y are centered first, so no intercept column is
 * needed: predict() re-adds meanY and re-scales each feature through the
 * same stats the fit was trained on.
 */
export function fitLinearRegression(
  trainingRows: TrainingRow[],
  keys: readonly ModelFeatureKey[] = MODEL_FEATURE_KEYS
): LinearRegressionFit {
  const usable = trainingRows
    .map((r) => ({ vec: toModelVector(r.features, keys), y: r.actualAverageMs }))
    .filter((r): r is { vec: number[]; y: number } => r.vec !== null);

  if (usable.length < MIN_LINEAR_REGRESSION_ROWS) {
    return { predict: () => null, explain: () => null };
  }

  const { standardized, stats } = standardizeColumns(usable.map((r) => r.vec));
  const meanY = usable.reduce((sum, r) => sum + r.y, 0) / usable.length;
  const centeredY = usable.map((r) => r.y - meanY);

  const X = standardized;
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const regularized = XtX.map((row, i) => row.map((v, j) => (i === j ? v + RIDGE_LAMBDA : v)));
  const XtY = matMul(Xt, centeredY.map((v) => [v]));
  const weights = matMul(invert(regularized), XtY).map((row) => row[0]);

  const contributionsFor = (features: FeatureVector): RidgeContribution[] | null => {
    const vec = toModelVector(features, keys);
    if (vec === null) return null;
    return vec.map((v, c) => ({
      feature: keys[c],
      contributionMs: ((v - stats[c].mean) / stats[c].std) * weights[c],
    }));
  };

  return {
    predict(features: FeatureVector): number | null {
      const contributions = contributionsFor(features);
      if (contributions === null) return null;
      return meanY + contributions.reduce((sum, c) => sum + c.contributionMs, 0);
    },
    explain(features: FeatureVector): RidgeExplanation | null {
      const contributions = contributionsFor(features);
      if (contributions === null) return null;
      return {
        interceptMs: meanY,
        contributions,
        predictedMs: meanY + contributions.reduce((sum, c) => sum + c.contributionMs, 0),
      };
    },
  };
}

export const DEFAULT_KNN_NEIGHBORS = 3;

interface ScoredNeighbor {
  /** Index into the usable-rows list this neighbor came from. */
  index: number;
  y: number;
  dist: number;
  /** Normalized 1/distance weight; the weights of one prediction sum to 1. */
  weight: number;
}

// The shared core of predictNearestNeighbor and explainNearestNeighbors:
// distances on the standardized feature space, nearest k, 1/distance
// weights normalized to sum to 1. An exact match (distance 0) takes weight
// 1 outright rather than being divided into.
function scoreNeighbors(
  rows: { vec: number[]; y: number; index: number }[],
  targetVec: number[],
  k: number
): ScoredNeighbor[] {
  const { standardized, stats } = standardizeColumns(rows.map((r) => r.vec));
  const zTarget = targetVec.map((v, c) => (v - stats[c].mean) / stats[c].std);

  const withDistance = rows.map((r, i) => ({
    index: r.index,
    y: r.y,
    dist: Math.sqrt(standardized[i].reduce((sum, z, c) => sum + (z - zTarget[c]) ** 2, 0)),
  }));
  withDistance.sort((a, b) => a.dist - b.dist);

  const nearest = withDistance.slice(0, Math.min(k, withDistance.length));
  const exact = nearest.find((n) => n.dist === 0);
  if (exact) return [{ ...exact, weight: 1 }];

  const rawWeights = nearest.map((n) => 1 / n.dist);
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);
  return nearest.map((n, i) => ({ ...n, weight: rawWeights[i] / weightSum }));
}

function toUsableRows(
  rows: { features: FeatureVector; y: number }[],
  keys: readonly ModelFeatureKey[]
): { vec: number[]; y: number; index: number }[] {
  return rows
    .map((r, index) => ({ vec: toModelVector(r.features, keys), y: r.y, index }))
    .filter((r): r is { vec: number[]; y: number; index: number } => r.vec !== null);
}

/**
 * Weighted k-nearest-neighbor regression: distances are computed on the
 * same standardized feature space as the linear model, so no single raw
 * feature (e.g. a practice mean in the thousands of ms vs a 0-100 DNF rate)
 * dominates the distance.
 */
export function predictNearestNeighbor(
  trainingRows: TrainingRow[],
  target: FeatureVector,
  k: number = DEFAULT_KNN_NEIGHBORS,
  keys: readonly ModelFeatureKey[] = MODEL_FEATURE_KEYS
): number | null {
  const usable = toUsableRows(
    trainingRows.map((r) => ({ features: r.features, y: r.actualAverageMs })),
    keys
  );
  const targetVec = toModelVector(target, keys);
  if (usable.length === 0 || targetVec === null) return null;

  return scoreNeighbors(usable, targetVec, k).reduce((sum, n) => sum + n.y * n.weight, 0);
}

export interface NeighborExplanation {
  competitionId: string;
  /** ISO date string, from the dataset row. */
  date: string;
  actualAverageMs: number;
  distance: number;
  weight: number;
  contributionMs: number;
}

export interface KnnExplanation {
  predictedMs: number;
  /** Nearest first. Weights sum to 1; contributions sum to predictedMs. */
  neighbors: NeighborExplanation[];
}

/** The same prediction as predictNearestNeighbor, decomposed into the specific competitions it was averaged from. */
export function explainNearestNeighbors(
  trainingRows: DatasetRow[],
  target: FeatureVector,
  k: number = DEFAULT_KNN_NEIGHBORS,
  keys: readonly ModelFeatureKey[] = MODEL_FEATURE_KEYS
): KnnExplanation | null {
  const rows = Array.isArray(trainingRows) ? trainingRows : [];
  const usable = toUsableRows(
    rows.map((r) => ({ features: r.features, y: r.targetAverageMs })),
    keys
  );
  const targetVec = toModelVector(target, keys);
  if (usable.length === 0 || targetVec === null) return null;

  const neighbors = scoreNeighbors(usable, targetVec, k).map((n) => ({
    competitionId: rows[n.index].competitionId,
    date: rows[n.index].date,
    actualAverageMs: n.y,
    distance: n.dist,
    weight: n.weight,
    contributionMs: n.y * n.weight,
  }));

  return {
    predictedMs: neighbors.reduce((sum, n) => sum + n.contributionMs, 0),
    neighbors,
  };
}
