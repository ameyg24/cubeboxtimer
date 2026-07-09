// CubeBox analytics — model comparison and evaluation (pure).
//
// Walk-forward evaluation of six predictors over the same competition
// history: three naive baselines (all-history practice mean, the rule-based
// model's own practice window without its adjustment, and carrying the
// previous competition forward), the rule-based model
// (competitionPrediction.ts, unchanged), linear regression, and
// nearest-neighbor (both predictionModels.ts). Baselines give the models
// something to beat — a model that can't outperform "predict your practice
// mean" hasn't earned its complexity. Same discipline as backtesting.ts: a
// competition is only scored using strictly earlier competitions and the
// practice window before it, and each model's evaluated count only includes
// competitions it had enough data to predict. Baselines produce point
// predictions only; they never appear in interval calibration.

import type { CompetitionResultInput, TimedPracticeSolve } from "./competitionPrediction";
import { DEFAULT_PRACTICE_WINDOW_DAYS, predictCompetitionResult } from "./competitionPrediction";
import { mean } from "./averages";
import { buildMlDataset } from "./mlDataset";
import { computeRegressionMetrics } from "./mlEvaluation";
import { fitLinearRegression, MODEL_FEATURE_KEYS, predictNearestNeighbor } from "./predictionModels";
import type { ModelFeatureKey, TrainingRow } from "./predictionModels";

export type ModelId =
  | "practice-mean"
  | "practice-window"
  | "last-competition"
  | "rule-based"
  | "linear-regression"
  | "nearest-neighbor";

export const MODEL_LABELS: Record<ModelId, string> = {
  "practice-mean": "Practice Mean",
  "practice-window": "Practice Window Average",
  "last-competition": "Last Competition",
  "rule-based": "Rule-based",
  "linear-regression": "Linear Regression",
  "nearest-neighbor": "Nearest-Neighbor",
};

// Fixed evaluation order, also used as the final best-model tie-break:
// simplest first, so a baseline that ties a model wins the tie — a model
// has to strictly beat the baselines to be selected.
const MODEL_ORDER: ModelId[] = [
  "practice-mean",
  "practice-window",
  "last-competition",
  "rule-based",
  "linear-regression",
  "nearest-neighbor",
];

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
  /** Competitions the rule-based model — the least data-hungry non-baseline — could actually score. Drives the UI's empty state. */
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

// All-history practice mean as of the target date — the most naive
// baseline: "predict what you average in practice, full stop."
function practiceMeanBefore(solves: TimedPracticeSolve[], dateMs: number): number | null {
  const prior = solves.filter(
    (s) => typeof s.localCreatedAt === "number" && (s.localCreatedAt as number) < dateMs
  );
  const result = mean(prior);
  return result.status === "ok" ? result.valueMs : null;
}

/**
 * Runs every predictor over every eligible competition for `event` and
 * returns their side-by-side evaluation. `allSolvesForEvent` should be
 * every known solve for the event, not just recent ones — early
 * competitions need practice windows from far enough back. `featureKeys`
 * only affects the feature-consuming models (ridge, k-NN); it exists for
 * feature ablation and defaults to the full set.
 */
export function compareModels(
  allSolvesForEvent: TimedPracticeSolve[],
  allResultsForEvent: CompetitionResultInput[],
  event: string,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS,
  featureKeys: readonly ModelFeatureKey[] = MODEL_FEATURE_KEYS
): ModelComparisonResult {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const results = Array.isArray(allResultsForEvent) ? allResultsForEvent : [];

  // The dataset owns row construction and the walk-forward split — every
  // training row's features were built strictly from what was known as of
  // that competition's own date (see mlDataset.ts).
  const dataset = buildMlDataset(solves, results, event, windowDays);

  const casesByModel: Record<ModelId, ModelCase[]> = {
    "practice-mean": [],
    "practice-window": [],
    "last-competition": [],
    "rule-based": [],
    "linear-regression": [],
    "nearest-neighbor": [],
  };

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

    const pushCase = (modelId: ModelId, predictedMs: number | null) =>
      casesByModel[modelId].push({
        competitionId: target.competitionId,
        date: target.date,
        actualAverageMs: target.targetAverageMs,
        predictedMs,
      });

    pushCase("practice-mean", practiceMeanBefore(solves, target.dateMs));
    // The rule-based model's own practice window, without its competition
    // adjustment — already on the dataset row.
    pushCase("practice-window", target.features.practiceMeanMs);
    // Training rows are chronological; the last one is the most recent
    // strictly-earlier competition.
    pushCase("last-competition", datasetTrainingRows[datasetTrainingRows.length - 1].targetAverageMs);

    const rulePrediction = predictCompetitionResult(solves, priorResults, event, target.dateMs, windowDays);
    pushCase("rule-based", rulePrediction.predictedAverageMs);

    const linearFit = fitLinearRegression(trainingRows, featureKeys);
    pushCase("linear-regression", linearFit.predict(target.features));

    pushCase("nearest-neighbor", predictNearestNeighbor(trainingRows, target.features, undefined, featureKeys));
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

/** Short, deterministic sentence for the selected/best model — a fixed lookup, nothing composed at runtime. */
export function explainBestModel(comparison: ModelComparisonResult): string {
  if (comparison.bestModelId === null) {
    return "Not enough historical data yet to compare prediction models.";
  }
  switch (comparison.bestModelId) {
    case "practice-mean":
      return "The plain all-time practice mean had the lowest historical MAE — no model has beaten this baseline yet.";
    case "practice-window":
      return "The recent practice window average had the lowest historical MAE — no model has beaten this baseline yet.";
    case "last-competition":
      return "Carrying the previous competition's average forward had the lowest historical MAE — no model has beaten this baseline yet.";
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

export interface AblationModelMetrics {
  modelId: "linear-regression" | "nearest-neighbor";
  label: string;
  evaluatedCount: number;
  maeMs: number | null;
  rmseMs: number | null;
  biasMs: number | null;
}

export interface FeatureAblationEntry {
  removedFeature: ModelFeatureKey;
  metrics: AblationModelMetrics[];
}

export interface FeatureAblationResult {
  event: string;
  /** Full-feature reference the entries are read against. */
  allFeatures: AblationModelMetrics[];
  entries: FeatureAblationEntry[];
}

const ABLATED_MODEL_IDS = ["linear-regression", "nearest-neighbor"] as const;

function ablationMetrics(comparison: ModelComparisonResult): AblationModelMetrics[] {
  return ABLATED_MODEL_IDS.map((modelId) => {
    const m = comparison.metrics.find((x) => x.modelId === modelId) as ModelMetrics;
    return {
      modelId,
      label: m.label,
      evaluatedCount: m.evaluatedCount,
      maeMs: m.maeMs,
      rmseMs: m.rmseMs,
      biasMs: m.biasMs,
    };
  });
}

/**
 * Leave-one-feature-out evaluation, only for the models that consume the
 * feature vector (ridge and k-NN) — the rule-based model and the baselines
 * never read it, so ablating them would show fake invariance. Each entry
 * re-runs the same walk-forward comparison with the column genuinely
 * removed. Directional only: with this few competition labels, small MAE
 * deltas are noise — read the table, don't rank it.
 */
export function runFeatureAblation(
  allSolvesForEvent: TimedPracticeSolve[],
  allResultsForEvent: CompetitionResultInput[],
  event: string,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): FeatureAblationResult {
  const full = compareModels(allSolvesForEvent, allResultsForEvent, event, windowDays);
  const entries = MODEL_FEATURE_KEYS.map((removedFeature) => {
    const keys = MODEL_FEATURE_KEYS.filter((key) => key !== removedFeature);
    const comparison = compareModels(allSolvesForEvent, allResultsForEvent, event, windowDays, keys);
    return { removedFeature, metrics: ablationMetrics(comparison) };
  });
  return { event, allFeatures: ablationMetrics(full), entries };
}
