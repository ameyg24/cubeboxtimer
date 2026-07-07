import { describe, it, expect } from "vitest";
import { createAnalyticsContext } from "../context";
import type { AnalyticsInput } from "../context";
import type { CoachSolve } from "../../trainingSignals";
import type { PersistedCompetitionResultLike } from "../../wcaImport";
import type { Penalty } from "../../types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);

let idCounter = 0;
const solveAt = (daysBeforeBase: number, millis: number, penalty: Penalty = null): CoachSolve => ({
  id: `s-${idCounter++}`,
  millis,
  penalty,
  localCreatedAt: BASE - daysBeforeBase * DAY,
});

const competition = (
  id: string,
  daysBeforeBase: number,
  averageMs: number,
  event = "3x3x3"
): PersistedCompetitionResultLike => ({
  id,
  competitionName: `Competition ${id}`,
  date: new Date(BASE - daysBeforeBase * DAY).toISOString(),
  event,
  averageMs,
  bestMs: null,
  source: "manual",
});

function fullInput(): AnalyticsInput {
  return {
    event: "3x3x3",
    allSolvesForEvent: [
      solveAt(96, 10000),
      solveAt(94, 10100),
      solveAt(66, 10000),
      solveAt(64, 10200),
      solveAt(10, 10500),
      solveAt(5, 10000),
      solveAt(2, 9000),
    ],
    competitionResults: [
      competition("c1", 90, 10500),
      competition("c2", 60, 10600),
      competition("other-event", 60, 45000, "4x4x4"),
    ],
    now: BASE,
  };
}

const GETTERS = [
  "referencePoints",
  "recordHistory",
  "prediction",
  "bestPrediction",
  "backtest",
  "features",
  "explanation",
  "modelComparison",
  "trainingSignals",
  "practiceCoach",
  "trainingPlan",
  "recommendationEvaluation",
] as const;

describe("createAnalyticsContext", () => {
  it("exposes its input unchanged", () => {
    const input = fullInput();
    const ctx = createAnalyticsContext(input);
    expect(ctx.input).toBe(input);
  });

  it("scopes referencePoints to the event, rounds collapsed", () => {
    const ctx = createAnalyticsContext(fullInput());
    expect(ctx.referencePoints().map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("memoizes every getter — repeated reads return the same object, not a recomputation", () => {
    const ctx = createAnalyticsContext(fullInput());
    for (const getter of GETTERS) {
      expect(ctx[getter]()).toBe(ctx[getter]());
    }
  });

  it("is deterministic — two contexts over identical input produce equal outputs", () => {
    const a = createAnalyticsContext(fullInput());
    const b = createAnalyticsContext(fullInput());
    expect(a.prediction()).toEqual(b.prediction());
    expect(a.modelComparison()).toEqual(b.modelComparison());
    expect(a.practiceCoach()).toEqual(b.practiceCoach());
    expect(a.recommendationEvaluation()).toEqual(b.recommendationEvaluation());
  });

  it("keeps caches independent across contexts", () => {
    const a = createAnalyticsContext(fullInput());
    const b = createAnalyticsContext(fullInput());
    expect(a.prediction()).not.toBe(b.prediction());
  });

  it("does not mutate its inputs", () => {
    const input = fullInput();
    const snapshot = structuredClone(input);
    const ctx = createAnalyticsContext(input);
    for (const getter of GETTERS) ctx[getter]();
    expect(input).toEqual(snapshot);
  });

  it("handles a fully empty input without throwing", () => {
    const ctx = createAnalyticsContext({ event: "3x3x3", allSolvesForEvent: [], competitionResults: [], now: BASE });
    for (const getter of GETTERS) ctx[getter]();
    expect(ctx.prediction().predictedAverageMs).toBeNull();
    expect(ctx.practiceCoach().readiness.label).toBe("mixed");
    expect(ctx.trainingPlan().beforeNextCompetition).toEqual([]);
  });

  it("threads the shared prediction into its consumers rather than re-deriving it", () => {
    const ctx = createAnalyticsContext(fullInput());
    expect(ctx.trainingSignals().competitionGapPct).toBe(ctx.prediction().adjustmentFactorPct);
    expect(ctx.explanation().adjustmentFactorPct).toBe(ctx.prediction().adjustmentFactorPct);
  });

  it("populates the before-competition plan bucket only when a next competition date is supplied", () => {
    const withoutDate = createAnalyticsContext(fullInput());
    expect(withoutDate.trainingPlan().beforeNextCompetition).toEqual([]);

    const withDate = createAnalyticsContext({ ...fullInput(), nextCompetitionDateMs: BASE + 7 * DAY });
    expect(withDate.trainingPlan().beforeNextCompetition).toEqual(withDate.practiceCoach().focusAreas);
  });

  it("produces event-scoped output — different events over the same data differ", () => {
    // Solves are the caller's job to scope per event (they carry no event
    // field), matching every existing analytics function; competitions
    // carry one, so the context scopes those itself.
    const threeByThree = createAnalyticsContext(fullInput());
    const fourByFour = createAnalyticsContext({ ...fullInput(), event: "4x4x4", allSolvesForEvent: [] });
    expect(threeByThree.referencePoints().map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(fourByFour.referencePoints().map((c) => c.id)).toEqual(["other-event"]);
    expect(fourByFour.trainingSignals().practiceCount).toBe(0);
    expect(threeByThree.trainingSignals().practiceCount).toBeGreaterThan(0);
  });
});
