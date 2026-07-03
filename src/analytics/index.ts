// CubeBox analytics — public entry point.
//
// Pure, framework-free performance analytics over a list of solves. No React,
// no Firebase, no browser APIs. This is the foundation layer of the CubeBox
// Speedcubing Performance Intelligence Platform.

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
  predictCompetitionResult,
} from "./competitionPrediction";
export type {
  AdjustmentFactorResult,
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
