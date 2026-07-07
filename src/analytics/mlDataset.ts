// CubeBox analytics — model-ready dataset builder (pure).
//
// The single source of truth for how competition history becomes training
// data: one row per usable competition (feature vector as of that
// competition's date, official average as the target), plus the
// walk-forward cases the models are evaluated on. Feature engineering is
// buildFeatureVector, unchanged — this module only decides which rows
// exist and what each row was allowed to see. The leakage rule lives here
// once: a row's features use only strictly-earlier competitions (same-day
// ties excluded), and buildFeatureVector re-enforces the date cutoff
// internally on top of that.

import type { CompetitionResultInput, TimedPracticeSolve } from "./competitionPrediction";
import { DEFAULT_PRACTICE_WINDOW_DAYS } from "./competitionPrediction";
import { buildFeatureVector } from "./predictionFeatures";
import type { FeatureVector } from "./predictionFeatures";
import { MODEL_FEATURE_KEYS, toModelVector } from "./predictionModels";

export interface DatasetRow {
  competitionId: string;
  /** ISO date string, as supplied on the competition result. */
  date: string;
  dateMs: number;
  features: FeatureVector;
  targetAverageMs: number;
}

export interface WalkForwardCase {
  target: DatasetRow;
  /** Rows strictly earlier than the target — a same-day competition is never training data for it. */
  trainingRows: DatasetRow[];
}

export interface DatasetStats {
  rowCount: number;
  caseCount: number;
  /** Results dropped for having no usable average or an unparseable date. */
  excludedCount: number;
  /** Rows whose practice window was empty (no model-usable feature vector). */
  rowsWithoutPracticeData: number;
  targetMeanMs: number | null;
  targetMinMs: number | null;
  targetMaxMs: number | null;
}

export interface MlDataset {
  event: string;
  /** Chronological, oldest first. */
  rows: DatasetRow[];
  cases: WalkForwardCase[];
  stats: DatasetStats;
}

export function buildMlDataset(
  allSolvesForEvent: TimedPracticeSolve[],
  allResultsForEvent: CompetitionResultInput[],
  event: string,
  windowDays: number = DEFAULT_PRACTICE_WINDOW_DAYS
): MlDataset {
  const solves = Array.isArray(allSolvesForEvent) ? allSolvesForEvent : [];
  const results = Array.isArray(allResultsForEvent) ? allResultsForEvent : [];

  const usable = results
    .filter((r) => r.averageMs !== null && Number.isFinite(r.averageMs) && Number.isFinite(Date.parse(r.date)))
    .map((r) => ({ ...r, dateMs: Date.parse(r.date) }))
    .sort((a, b) => a.dateMs - b.dateMs);

  const rows: DatasetRow[] = usable.map((r, i) => ({
    competitionId: r.id,
    date: r.date,
    dateMs: r.dateMs,
    features: buildFeatureVector(solves, event, r.dateMs, usable.slice(0, i), windowDays),
    targetAverageMs: r.averageMs as number,
  }));

  const cases: WalkForwardCase[] = [];
  for (const target of rows) {
    const trainingRows = rows.filter((r) => r.dateMs < target.dateMs);
    if (trainingRows.length === 0) continue;
    cases.push({ target, trainingRows });
  }

  const targets = rows.map((r) => r.targetAverageMs);
  return {
    event,
    rows,
    cases,
    stats: {
      rowCount: rows.length,
      caseCount: cases.length,
      excludedCount: results.length - usable.length,
      rowsWithoutPracticeData: rows.filter((r) => toModelVector(r.features) === null).length,
      targetMeanMs: targets.length > 0 ? targets.reduce((a, b) => a + b, 0) / targets.length : null,
      targetMinMs: targets.length > 0 ? Math.min(...targets) : null,
      targetMaxMs: targets.length > 0 ? Math.max(...targets) : null,
    },
  };
}

export interface FeatureMatrix {
  /** Column order, identical to what the models train on (MODEL_FEATURE_KEYS). */
  columns: readonly string[];
  matrix: number[][];
  targets: number[];
  /** competitionId per matrix row; rows without practice data are excluded. */
  rowIds: string[];
}

export function toFeatureMatrix(rows: DatasetRow[]): FeatureMatrix {
  const matrix: number[][] = [];
  const targets: number[] = [];
  const rowIds: string[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const vector = toModelVector(row.features);
    if (vector === null) continue;
    matrix.push(vector);
    targets.push(row.targetAverageMs);
    rowIds.push(row.competitionId);
  }
  return { columns: MODEL_FEATURE_KEYS, matrix, targets, rowIds };
}
