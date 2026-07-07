import { describe, it, expect } from "vitest";
import { computeErrorNotes, ERROR_NOTE_LABELS } from "../errorNotes";
import { COMPETITION_GAP_TRIGGER_PCT, CV_CAP, TARGET_SOLVES_14D } from "../practiceCoach";
import type { BacktestCase } from "../backtesting";
import type { FeatureVector } from "../predictionFeatures";

const features = (overrides: Partial<FeatureVector> = {}): FeatureVector => ({
  practiceMeanMs: 10000,
  practiceAo5Ms: 10000,
  practiceAo12Ms: null,
  practiceAo50Ms: null,
  practiceCount: TARGET_SOLVES_14D,
  practiceStddevMs: 200,
  dnfRatePct: 0,
  plus2RatePct: 0,
  practiceBestMs: 9500,
  daysSincePreviousCompetition: 30,
  averageCompetitionGapDays: 30,
  priorCompetitionCount: 2,
  priorPredictionErrorMs: null,
  ...overrides,
});

const backtestCase = (overrides: Partial<BacktestCase> = {}): BacktestCase => ({
  competitionId: "c1",
  date: "2026-01-01T00:00:00.000Z",
  predictedAverageMs: 10000,
  confidenceRangeMs: [9500, 10500],
  actualAverageMs: 10200,
  absoluteErrorMs: 200,
  percentErrorPct: 1.96,
  biasPct: 1.96,
  adjustmentFactorPctUsed: 0.02,
  confidenceLevelUsed: "medium",
  ...overrides,
});

describe("computeErrorNotes", () => {
  it("returns no notes for a well-supported, covered prediction", () => {
    expect(computeErrorNotes(backtestCase(), features())).toEqual([]);
  });

  it("flags few practice solves using the coach's own volume target", () => {
    expect(computeErrorNotes(backtestCase(), features({ practiceCount: TARGET_SOLVES_14D - 1 }))).toContain(
      "few-practice-solves"
    );
    expect(computeErrorNotes(backtestCase(), features({ practiceCount: TARGET_SOLVES_14D }))).toEqual([]);
  });

  it("flags high variance using the coach's CV cap", () => {
    const stddevOverCap = 10000 * (CV_CAP + 0.01);
    expect(computeErrorNotes(backtestCase(), features({ practiceStddevMs: stddevOverCap }))).toContain(
      "high-variance"
    );
    expect(computeErrorNotes(backtestCase(), features({ practiceMeanMs: null, practiceStddevMs: null }))).not.toContain(
      "high-variance"
    );
  });

  it("flags a large applied competition gap in either direction", () => {
    const over = COMPETITION_GAP_TRIGGER_PCT + 0.01;
    expect(computeErrorNotes(backtestCase({ adjustmentFactorPctUsed: over }), features())).toContain(
      "large-competition-gap"
    );
    expect(computeErrorNotes(backtestCase({ adjustmentFactorPctUsed: -over }), features())).toContain(
      "large-competition-gap"
    );
    expect(computeErrorNotes(backtestCase({ adjustmentFactorPctUsed: null }), features())).not.toContain(
      "large-competition-gap"
    );
  });

  it("flags low and insufficient confidence, not medium or high", () => {
    expect(computeErrorNotes(backtestCase({ confidenceLevelUsed: "low" }), features())).toContain("low-confidence");
    expect(computeErrorNotes(backtestCase({ confidenceLevelUsed: "insufficient" }), features())).toContain(
      "low-confidence"
    );
    expect(computeErrorNotes(backtestCase({ confidenceLevelUsed: "high" }), features())).toEqual([]);
  });

  it("flags an interval miss on either side, with inclusive bounds", () => {
    expect(computeErrorNotes(backtestCase({ actualAverageMs: 10600 }), features())).toContain("interval-miss");
    expect(computeErrorNotes(backtestCase({ actualAverageMs: 9400 }), features())).toContain("interval-miss");
    expect(computeErrorNotes(backtestCase({ actualAverageMs: 10500 }), features())).not.toContain("interval-miss");
    expect(computeErrorNotes(backtestCase({ confidenceRangeMs: null }), features())).not.toContain("interval-miss");
  });

  it("stacks multiple flags on one case", () => {
    const notes = computeErrorNotes(
      backtestCase({ confidenceLevelUsed: "low", actualAverageMs: 12000, adjustmentFactorPctUsed: 0.2 }),
      features({ practiceCount: 3 })
    );
    expect(notes).toEqual(["few-practice-solves", "large-competition-gap", "low-confidence", "interval-miss"]);
  });

  it("has a label for every note id", () => {
    const notes = computeErrorNotes(
      backtestCase({ confidenceLevelUsed: "low", actualAverageMs: 12000, adjustmentFactorPctUsed: 0.2 }),
      features({ practiceCount: 3, practiceStddevMs: 10000 })
    );
    for (const note of notes) {
      expect(ERROR_NOTE_LABELS[note]).toBeTruthy();
    }
    expect(notes).toHaveLength(5);
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const c = backtestCase({ confidenceLevelUsed: "low" });
    const f = features({ practiceCount: 3 });
    expect(computeErrorNotes(c, f)).toEqual(computeErrorNotes(c, f));
  });
});
