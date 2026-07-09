// CubeBox analytics - public entry point.
//
// Pure, framework-free performance analytics over a list of solves. No React,
// no Firebase, no browser APIs.

export type { AverageResult, Penalty, Solve } from "./types";
export {
  PLUS2_PENALTY_MS,
  effectiveMillis,
  isDNF,
  isPlus2,
  isValidSolve,
} from "./time";
export {
  ao5,
  ao12,
  ao50,
  ao100,
  averageOfN,
  best,
  bestAverageOfN,
  mean,
  meanOfN,
  mo3,
  rollingAverageOfN,
  trimCount,
  worst,
  worstAverageOfN,
} from "./averages";
export { computeSessionStats } from "./sessionStats";
export type { SessionStats } from "./sessionStats";
export {
  RECORD_TYPES,
  RECORD_TYPE_LABELS,
  computeRecordHistory,
  toChronological,
} from "./records";
export type {
  CurrentRecords,
  RecordEvent,
  RecordHistoryResult,
  RecordMark,
  RecordType,
  TimedSolve,
} from "./records";
export {
  DEFAULT_PRACTICE_WINDOW_DAYS,
  computeAdjustmentFactor,
  computeConfidence,
  computePracticeWindow,
  predictCompetitionBest,
  predictCompetitionResult,
} from "./competitionPrediction";
export type {
  AdjustmentFactorResult,
  BestPredictionResult,
  CompetitionComparison,
  CompetitionResultInput,
  ConfidenceLevel,
  PracticeVsOfficial,
  PracticeWindow,
  PredictionResult,
  TimedPracticeSolve,
} from "./competitionPrediction";
export { runBacktest } from "./backtesting";
export type { BacktestCase, BacktestResult, BacktestSummary } from "./backtesting";
export { explainPrediction } from "./predictionExplanation";
export type { PredictionExplanation, PredictionFactors } from "./predictionExplanation";
export {
  WCA_ID_EXAMPLE,
  buildImportCandidates,
  checkForDuplicateOrConflict,
  collapseRoundsToReference,
  decideImportAction,
  findLinkedWcaId,
  isValidWcaId,
  labelRoundsByCompetitionEvent,
  mapWcaEventToCubeDimension,
  namesAreSimilar,
  normalizeWcaId,
  wcaCentisecondsToMs,
} from "./wcaImport";
export type {
  DuplicateCheckCandidate,
  DuplicateCheckResult,
  ImportDecision,
  ImportedCompetitionEvent,
  LabeledWcaRoundResult,
  PersistedCompetitionResultLike,
  SkipReason,
  SkippedWcaResult,
  WcaCompetitionMeta,
  WcaImportCandidate,
  WcaRawResult,
} from "./wcaImport";
export { predictFromCompetitionHistory } from "./peerComparison";
export type { PeerCompetitionResult, PeerMetricPrediction, PeerPredictionResult } from "./peerComparison";
export { filterOutDuplicates, parseCsTimerExport } from "./cstimerImport";
export type {
  CsTimerParsedSolve,
  CsTimerParseResult,
  CsTimerPenalty,
  ExistingSolveForDuplicateCheck,
} from "./cstimerImport";
export { buildFeatureVector } from "./predictionFeatures";
export type { FeatureVector } from "./predictionFeatures";
export {
  DEFAULT_KNN_NEIGHBORS,
  MODEL_FEATURE_KEYS,
  explainNearestNeighbors,
  fitLinearRegression,
  predictNearestNeighbor,
  toModelVector,
} from "./predictionModels";
export type {
  KnnExplanation,
  LinearRegressionFit,
  ModelFeatureKey,
  NeighborExplanation,
  RidgeContribution,
  RidgeExplanation,
  TrainingRow,
} from "./predictionModels";
export {
  MIN_COMPARABLE_FOR_COMPARISON,
  MODEL_LABELS,
  compareModels,
  explainBestModel,
  runFeatureAblation,
} from "./modelComparison";
export type {
  AblationModelMetrics,
  FeatureAblationEntry,
  FeatureAblationResult,
  ModelCase,
  ModelComparisonResult,
  ModelId,
  ModelMetrics,
} from "./modelComparison";
export { computeErrorNotes, ERROR_NOTE_LABELS } from "./errorNotes";
export type { ErrorNoteId } from "./errorNotes";
export { renderBenchmarkReport } from "./benchmarkReport";
export type { BenchmarkInput } from "./benchmarkReport";
export { computeTrainingSignals } from "./trainingSignals";
export type { CoachSolve, TrainingSignals } from "./trainingSignals";
export {
  COMPETITION_GAP_TRIGGER_PCT,
  CV_CAP,
  DNF_RISK_CAP,
  FOCUS_RULES,
  MOMENTUM_SENSITIVITY,
  TARGET_SOLVES_14D,
  computePracticeCoachResult,
} from "./practiceCoach";
export type {
  CoachConfidence,
  FocusArea,
  FocusAreaEvidence,
  FocusPriority,
  FocusRule,
  PracticeCoachResult,
  ReadinessLabel,
  ReadinessScore,
} from "./practiceCoach";
export { buildTrainingPlan } from "./trainingPlan";
export type { TrainingPlanResult } from "./trainingPlan";
export {
  EVALUATION_HORIZON_DAYS,
  EVALUATION_LOOKBACK_DAYS,
  evaluateRecommendations,
} from "./recommendationEvaluation";
export type {
  RecommendationEvaluationCase,
  RecommendationEvaluationResult,
  RecommendationEvaluationSummary,
} from "./recommendationEvaluation";
export { buildMlDataset, toFeatureMatrix } from "./mlDataset";
export type { DatasetRow, DatasetStats, FeatureMatrix, MlDataset, WalkForwardCase } from "./mlDataset";
export { computeRegressionMetrics, median } from "./mlEvaluation";
export type { PredictionActualPair, RegressionMetrics } from "./mlEvaluation";
export { computeCalibrationReport, toCalibrationCases } from "./calibration";
export type { CalibrationCase, CalibrationReport } from "./calibration";
export { createAnalyticsContext } from "./platform/context";
export type { AnalyticsContext, AnalyticsInput } from "./platform/context";
export {
  ANALYTICS_PIPELINES,
  findDependencyCycle,
  getPipeline,
  validatePipelineDependencies,
} from "./platform/registry";
export type { AnalyticsPipeline, PipelineId } from "./platform/registry";
