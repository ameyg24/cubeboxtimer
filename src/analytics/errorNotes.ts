// CubeBox analytics — walk-forward error notes (pure).
//
// Deterministic per-case flags over a backtested prediction: which
// already-defined conditions held when it was made, and whether its
// interval held the actual result. Every threshold is imported from
// practiceCoach.ts — nothing here defines a new one. Flags are observed
// associations attached to individual cases, not a failure taxonomy: with
// this few competition labels there is no distribution to summarize.

import type { BacktestCase } from "./backtesting";
import type { FeatureVector } from "./predictionFeatures";
import { COMPETITION_GAP_TRIGGER_PCT, CV_CAP, TARGET_SOLVES_14D } from "./practiceCoach";

export type ErrorNoteId =
  | "few-practice-solves"
  | "high-variance"
  | "large-competition-gap"
  | "low-confidence"
  | "interval-miss";

export const ERROR_NOTE_LABELS: Record<ErrorNoteId, string> = {
  "few-practice-solves": "Few practice solves in the window",
  "high-variance": "High practice variance",
  "large-competition-gap": "Large practice-to-competition gap applied",
  "low-confidence": "Low prediction confidence at the time",
  "interval-miss": "Actual result fell outside the predicted interval",
};

/**
 * Flags for one backtest case, given the feature vector as of that
 * competition's date (the matching mlDataset row's features).
 */
export function computeErrorNotes(backtestCase: BacktestCase, features: FeatureVector): ErrorNoteId[] {
  const notes: ErrorNoteId[] = [];

  if (features.practiceCount < TARGET_SOLVES_14D) notes.push("few-practice-solves");

  if (
    features.practiceMeanMs !== null &&
    features.practiceMeanMs > 0 &&
    features.practiceStddevMs !== null &&
    features.practiceStddevMs / features.practiceMeanMs > CV_CAP
  ) {
    notes.push("high-variance");
  }

  if (
    backtestCase.adjustmentFactorPctUsed !== null &&
    Math.abs(backtestCase.adjustmentFactorPctUsed) > COMPETITION_GAP_TRIGGER_PCT
  ) {
    notes.push("large-competition-gap");
  }

  if (backtestCase.confidenceLevelUsed === "low" || backtestCase.confidenceLevelUsed === "insufficient") {
    notes.push("low-confidence");
  }

  if (
    backtestCase.confidenceRangeMs !== null &&
    (backtestCase.actualAverageMs < backtestCase.confidenceRangeMs[0] ||
      backtestCase.actualAverageMs > backtestCase.confidenceRangeMs[1])
  ) {
    notes.push("interval-miss");
  }

  return notes;
}
