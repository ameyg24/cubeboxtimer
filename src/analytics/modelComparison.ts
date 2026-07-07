// CubeBox analytics — model comparison and evaluation (pure).
//
// Walk-forward evaluation of three prediction models — rule-based
// (competitionPrediction.ts, unchanged), linear regression, and
// nearest-neighbor (both predictionModels.ts) — over the same competition
// history, so they can be compared on equal footing. Same discipline as
// backtesting.ts: a competition is only scored using strictly earlier
// competitions and the practice window before it, and each model's own
// evaluated count only includes competitions it actually had enough data
// to predict — never a fabricated number.

import type { CompetitionResultInput, TimedPracticeSolve } from "./competitionPrediction";
import { DEFAULT_PRACTICE_WINDOW_DAYS, predictCompetitionResult } from "./competitionPrediction";
import { buildMlDataset } from "./mlDataset";
import { computeRegressionMetrics } from "./mlEvaluation";
import { fitLinearRegression, predictNearestNeighbor } from "./predictionModels";
import type { TrainingRow } from "./predictionModels";

export type ModelId = "rule-based" | "linear-regression" | "nearest-neighbor";

export const MODEL_LABELS: Record<ModelId, string> = {
  "rule-based": "Rule-based",
  "linear-regression": "Linear Regression",
  "nearest-neighbor": "Nearest-Neighbor",
};

// Fixed evaluation order, also used as the final best-model tie-break.
const MODEL_ORDER: ModelId[] = ["rule-based", "linear-regression", "nearest-neighbor"];

export interface ModelCase {
  competitionId: string;
  date: string;
  actualAverageMs: number;
  predictedMs: number | null;
}

export interface ModelMetrics {
  modelId: ModelId;
  label: string;
  evaluatedCount: number;
  maeMs: number | null;
  medianAeMs: number | null;
  rmseMs: number | null;
  mapePct: number | null;
  /** mean(actual - predicted), ms. Positive = model was optimistic (predicted too fast); negative = too slow. */
  biasMs: number | null;
  cases: ModelCase[];
}

export interface ModelComparisonResult {
  event: string;
  metrics: ModelMetrics[];
  bestModelId: ModelId | null;
  /** Competitions the rule-based model — the least data-hungry of the three — could actually score. Drives the UI's empty state. */
  comparableCompetitionsFound: number;
}

/** Minimum comparable competitions (rule-based evaluated count) before showing a comparison in the UI. */
export const MIN_COMPARABLE_FOR_COMPARISON = 3;

function summarize(modelId: ModelId, cases: ModelCase[]): ModelMetrics {
  const metrics = computeRegressionMetrics(
    cases
      .filter((c) => c.predictedMs !== null)
      .map((c) => ({ predicted: c.predictedMs as number, actual: c.actualAverageMs }))
  );
  return {
    modelId,
    label: MODEL_LABELS[modelId],
    evaluatedCount: metrics.evaluatedCount,
    maeMs: metrics.mae,
    medianAeMs: metrics.medianAbsoluteError,
    rmseMs: metrics.rmse,
    mapePct: metrics.mapePct,
    biasMs: metrics.bias,
    cases,
  };
}

function pickBestModel(metrics: ModelMetrics[]): ModelId | null {
  const candidates = metrics.filter((m) => m.evaluatedCount > 0 && m.maeMs !== null);
  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (const m of candidates.slice(1)) {
    if (
      (m.maeMs as number) < (best.maeMs as number) ||
      ((m.maeMs as number) === best.maeMs && m.evaluatedCount > best.evaluatedCount) ||
      ((m.maeMs as number) === best.maeMs &&
        m.evaluatedCount === best.evaluatedCount &&
        MODEL_ORDER.indexOf(m.modelId) < MODEL_ORDER.indexOf(best.modelId))
    ) {
      best = m;
    }
  }
  return best.modelId;
}

/**
 * Runs all three models over every eligible competition for `event` and
 * returns their side-by-side evaluation. `allSolvesForEvent` should be
 * every known solve for the event, not just recent ones — early
 * competitions need practice windows from far enough back.
 */
export function compareModels(
  allSolvesForEvent: TimedPracticeSolve[],
  allResultsForEvent: CompetitionResultInput[],
  event: string,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): ModelComparisonResult {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const results = Array.isArray(allResultsForEvent) ? allResultsForEvent : [];

  // The dataset owns row construction and the walk-forward split — every
  // training row's features were built strictly from what was known as of
  // that competition's own date (see mlDataset.ts).
  const dataset = buildMlDataset(solves, results, event, windowDays);

  const casesByModel: Record<ModelId, ModelCase[]> = { "rule-based": [], "linear-regression": [], "nearest-neighbor": [] };

  for (const { target, trainingRows: datasetTrainingRows } of dataset.cases) {
    const trainingRows: TrainingRow[] = datasetTrainingRows.map((r) => ({
      features: r.features,
      actualAverageMs: r.targetAverageMs,
    }));
    const priorResults: CompetitionResultInput[] = datasetTrainingRows.map((r) => ({
      id: r.competitionId,
      date: r.date,
      event,
      averageMs: r.targetAverageMs,
    }));

    const rulePrediction = predictCompetitionResult(solves, priorResults, event, target.dateMs, windowDays);
    casesByModel["rule-based"].push({
      competitionId: target.competitionId,
      date: target.date,
      actualAverageMs: target.targetAverageMs,
      predictedMs: rulePrediction.predictedAverageMs,
    });

    const linearFit = fitLinearRegression(trainingRows);
    casesByModel["linear-regression"].push({
      competitionId: target.competitionId,
      date: target.date,
      actualAverageMs: target.targetAverageMs,
      predictedMs: linearFit.predict(target.features),
    });

    casesByModel["nearest-neighbor"].push({
      competitionId: target.competitionId,
      date: target.date,
      actualAverageMs: target.targetAverageMs,
      predictedMs: predictNearestNeighbor(trainingRows, target.features),
    });
  }

  const metrics = MODEL_ORDER.map((modelId) => summarize(modelId, casesByModel[modelId]));
  const ruleBasedMetrics = metrics.find((m) => m.modelId === "rule-based") as ModelMetrics;

  return {
    event,
    metrics,
    bestModelId: pickBestModel(metrics),
    comparableCompetitionsFound: ruleBasedMetrics.evaluatedCount,
  };
}

/** Short, deterministic sentence for the selected/best model — no ML/LLM prose, just a fixed lookup. */
export function explainBestModel(comparison: ModelComparisonResult): string {
  if (comparison.bestModelId === null) {
    return "Not enough historical data yet to compare prediction models.";
  }
  switch (comparison.bestModelId) {
    case "rule-based":
      return "Rule-based is used until enough historical data exists for the statistical models to outperform it.";
    case "linear-regression":
      return "Linear regression is selected because it had the lowest historical MAE.";
    case "nearest-neighbor":
      return "Nearest-neighbor relies on competitions with similar practice averages and consistency.";
    default:
      return "";
  }
}
