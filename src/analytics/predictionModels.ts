// CubeBox analytics — statistical prediction models (pure).
//
// Two small, from-scratch models over the FeatureVector produced by
// predictionFeatures.ts. Both operate on the same fixed set of numeric
// features and degrade to "no prediction" (null) exactly like
// predictCompetitionResult does when there isn't enough data — never a
// fabricated number.

import type { FeatureVector } from "./predictionFeatures";

export interface TrainingRow {
  features: FeatureVector;
  actualAverageMs: number;
}

// Fixed feature order used by both models. All four are well-defined
// numbers whenever practiceMeanMs is non-null (a successful practiceMeanMs
// implies at least one valid solve, which is enough for computeSessionStats
// to also produce a real stddevMs), so toModelVector only needs to guard on
// the first one. Exported so mlDataset.ts builds its feature matrix from
// the exact projection the models train on, not a second definition.
export const MODEL_FEATURE_KEYS = [
  "practiceMeanMs",
  "practiceStddevMs",
  "dnfRatePct",
  "priorCompetitionCount",
] as const;

export function toModelVector(f: FeatureVector): number[] | null {
  if (f.practiceMeanMs === null || f.practiceStddevMs === null) return null;
  return MODEL_FEATURE_KEYS.map((key) => f[key] as number);
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
    // divide by zero — std 1 leaves it at its centered value (0) instead.
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
// units (ms vs percent vs a plain count) — this is what makes ridge, not
// plain least squares, the right fit here: training rows (competitions) are
// usually fewer than the 4 features, which plain OLS can't handle at all.
const RIDGE_LAMBDA = 1;
const MIN_LINEAR_REGRESSION_ROWS = 2;

export interface LinearRegressionFit {
  predict(features: FeatureVector): number | null;
}

/**
 * Ridge regression on standardized features, closed-form (normal
 * equations). Both X and y are centered first, so no intercept column is
 * needed: predict() re-adds meanY and re-scales each feature through the
 * same stats the fit was trained on.
 */
export function fitLinearRegression(trainingRows: TrainingRow[]): LinearRegressionFit {
  const usable = trainingRows
    .map((r) => ({ vec: toModelVector(r.features), y: r.actualAverageMs }))
    .filter((r): r is { vec: number[]; y: number } => r.vec !== null);

  if (usable.length < MIN_LINEAR_REGRESSION_ROWS) {
    return { predict: () => null };
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

  return {
    predict(features: FeatureVector): number | null {
      const vec = toModelVector(features);
      if (vec === null) return null;
      const z = vec.map((v, c) => (v - stats[c].mean) / stats[c].std);
      const dot = z.reduce((sum, v, i) => sum + v * weights[i], 0);
      return meanY + dot;
    },
  };
}

export const DEFAULT_KNN_NEIGHBORS = 3;

/**
 * Weighted k-nearest-neighbor regression: distances are computed on the
 * same standardized feature space as the linear model, so no single raw
 * feature (e.g. a practice mean in the thousands of ms vs a 0-100 DNF rate)
 * dominates the distance. An exact match (distance 0) is returned directly
 * rather than divided into with 1/distance weights.
 */
export function predictNearestNeighbor(
  trainingRows: TrainingRow[],
  target: FeatureVector,
  k: number = DEFAULT_KNN_NEIGHBORS
): number | null {
  const usable = trainingRows
    .map((r) => ({ vec: toModelVector(r.features), y: r.actualAverageMs }))
    .filter((r): r is { vec: number[]; y: number } => r.vec !== null);
  const targetVec = toModelVector(target);
  if (usable.length === 0 || targetVec === null) return null;

  const { standardized, stats } = standardizeColumns(usable.map((r) => r.vec));
  const zTarget = targetVec.map((v, c) => (v - stats[c].mean) / stats[c].std);

  const withDistance = usable.map((r, i) => ({
    y: r.y,
    dist: Math.sqrt(standardized[i].reduce((sum, z, c) => sum + (z - zTarget[c]) ** 2, 0)),
  }));
  withDistance.sort((a, b) => a.dist - b.dist);

  const neighbors = withDistance.slice(0, Math.min(k, withDistance.length));
  const exact = neighbors.find((n) => n.dist === 0);
  if (exact) return exact.y;

  const weights = neighbors.map((n) => 1 / n.dist);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  return neighbors.reduce((sum, n, i) => sum + n.y * weights[i], 0) / weightSum;
}
