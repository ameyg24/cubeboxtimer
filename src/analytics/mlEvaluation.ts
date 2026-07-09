// CubeBox analytics - regression evaluation metrics (pure).
//
// One place for the point-prediction error formulas modelComparison.ts
// previously computed inline. Unit-agnostic: metrics come back in the same
// unit as the inputs (ms in this codebase), except mapePct which is always
// a percentage of the actual value.

export interface PredictionActualPair {
  predicted: number;
  actual: number;
}

export interface RegressionMetrics {
  evaluatedCount: number;
  mae: number | null;
  medianAbsoluteError: number | null;
  rmse: number | null;
  /** mean(|predicted - actual| / actual) * 100. Assumes strictly positive actuals. */
  mapePct: number | null;
  /** mean(actual - predicted). Positive = predictions ran low (optimistic); negative = ran high. */
  bias: number | null;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeRegressionMetrics(pairs: PredictionActualPair[]): RegressionMetrics {
  const list = Array.isArray(pairs) ? pairs : [];
  if (list.length === 0) {
    return { evaluatedCount: 0, mae: null, medianAbsoluteError: null, rmse: null, mapePct: null, bias: null };
  }

  const errors = list.map((p) => p.actual - p.predicted);
  const absErrors = errors.map(Math.abs);
  const pctErrors = list.map((p, i) => (absErrors[i] / p.actual) * 100);

  return {
    evaluatedCount: list.length,
    mae: absErrors.reduce((a, b) => a + b, 0) / absErrors.length,
    medianAbsoluteError: median(absErrors),
    rmse: Math.sqrt(errors.reduce((sum, e) => sum + e ** 2, 0) / errors.length),
    mapePct: pctErrors.reduce((a, b) => a + b, 0) / pctErrors.length,
    bias: errors.reduce((a, b) => a + b, 0) / errors.length,
  };
}
