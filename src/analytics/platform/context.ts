// CubeBox analytics — analytics context (pure).
//
// One immutable, per-input view over every derived analytics output. A
// consumer builds a context once per (event, solves, competitions, now)
// and reads what it needs; each value is computed lazily on first read and
// memoized for the context's lifetime, so consumers that share an input
// (e.g. the prediction feeding both the explanation and the coach) share
// one computation instead of each re-running the wiring. Nothing here is
// persisted, and nothing new is computed — this is the same call chain
// CompetitionTab/CoachTab previously assembled by hand, in one place.

import { predictCompetitionBest, predictCompetitionResult } from "../competitionPrediction";
import type { BestPredictionResult, PredictionResult } from "../competitionPrediction";
import { collapseRoundsToReference } from "../wcaImport";
import type { PersistedCompetitionResultLike } from "../wcaImport";
import { runBacktest } from "../backtesting";
import type { BacktestResult } from "../backtesting";
import { buildFeatureVector } from "../predictionFeatures";
import type { FeatureVector } from "../predictionFeatures";
import { explainPrediction } from "../predictionExplanation";
import type { PredictionExplanation } from "../predictionExplanation";
import { compareModels } from "../modelComparison";
import type { ModelComparisonResult } from "../modelComparison";
import { computeTrainingSignals } from "../trainingSignals";
import type { CoachSolve, TrainingSignals } from "../trainingSignals";
import { computePracticeCoachResult } from "../practiceCoach";
import type { PracticeCoachResult } from "../practiceCoach";
import { buildTrainingPlan } from "../trainingPlan";
import type { TrainingPlanResult } from "../trainingPlan";
import { evaluateRecommendations } from "../recommendationEvaluation";
import type { RecommendationEvaluationResult } from "../recommendationEvaluation";
import { computeRecordHistory, toChronological } from "../records";
import type { RecordHistoryResult } from "../records";

export interface AnalyticsInput {
  event: string;
  allSolvesForEvent: CoachSolve[];
  /** The full persisted competition list, unfiltered — the context scopes to `event` itself. */
  competitionResults: PersistedCompetitionResultLike[];
  now: number;
  /** No persisted "upcoming competition" concept exists yet, so this is normally null. */
  nextCompetitionDateMs?: number | null;
}

export interface AnalyticsContext {
  input: AnalyticsInput;
  /** Event-scoped competitions, one reference point per competition (rounds collapsed). */
  referencePoints(): PersistedCompetitionResultLike[];
  recordHistory(): RecordHistoryResult;
  prediction(): PredictionResult;
  bestPrediction(): BestPredictionResult;
  backtest(): BacktestResult;
  features(): FeatureVector;
  explanation(): PredictionExplanation;
  modelComparison(): ModelComparisonResult;
  trainingSignals(): TrainingSignals;
  practiceCoach(): PracticeCoachResult;
  trainingPlan(): TrainingPlanResult;
  recommendationEvaluation(): RecommendationEvaluationResult;
}

export function createAnalyticsContext(input: AnalyticsInput): AnalyticsContext {
  const cache = new Map<string, unknown>();
  const memo = <T>(key: string, compute: () => T): T => {
    if (!cache.has(key)) cache.set(key, compute());
    return cache.get(key) as T;
  };

  const { event, allSolvesForEvent: solves, competitionResults, now } = input;

  const ctx: AnalyticsContext = {
    input,
    referencePoints: () =>
      memo("reference-points", () =>
        collapseRoundsToReference(competitionResults.filter((c) => c.event === event))
      ),
    recordHistory: () => memo("records", () => computeRecordHistory(toChronological(solves))),
    prediction: () =>
      memo("prediction", () => predictCompetitionResult(solves, ctx.referencePoints(), event, now)),
    bestPrediction: () =>
      memo("best-prediction", () => predictCompetitionBest(solves, ctx.referencePoints(), event, now)),
    backtest: () => memo("backtest", () => runBacktest(solves, ctx.referencePoints(), event)),
    features: () => memo("features", () => buildFeatureVector(solves, event, now, ctx.referencePoints())),
    explanation: () =>
      memo("prediction-explanation", () => explainPrediction(ctx.prediction(), ctx.backtest().summary)),
    modelComparison: () =>
      memo("model-comparison", () => compareModels(solves, ctx.referencePoints(), event)),
    trainingSignals: () =>
      memo("training-signals", () =>
        computeTrainingSignals(solves, event, ctx.referencePoints(), ctx.prediction(), ctx.backtest().summary, now)
      ),
    practiceCoach: () => memo("practice-coach", () => computePracticeCoachResult(ctx.trainingSignals())),
    trainingPlan: () =>
      memo("training-plan", () =>
        buildTrainingPlan(ctx.practiceCoach().focusAreas, input.nextCompetitionDateMs ?? null)
      ),
    recommendationEvaluation: () =>
      memo("recommendation-evaluation", () => evaluateRecommendations(solves, event, competitionResults, now)),
  };

  return ctx;
}
