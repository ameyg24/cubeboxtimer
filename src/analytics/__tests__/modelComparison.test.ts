import { describe, it, expect } from "vitest";
import {
  compareModels,
  explainBestModel,
  MIN_COMPARABLE_FOR_COMPARISON,
  runFeatureAblation,
} from "../modelComparison";
import { buildMlDataset } from "../mlDataset";
import { fitLinearRegression, MODEL_FEATURE_KEYS } from "../predictionModels";
import type { CompetitionResultInput, TimedPracticeSolve } from "../competitionPrediction";
import type { Penalty } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);

const solveAt = (daysBeforeBase: number, millis: number, penalty: Penalty = null): TimedPracticeSolve => ({
  millis,
  penalty,
  localCreatedAt: BASE - daysBeforeBase * DAY,
});

const competition = (id: string, daysBeforeBase: number, averageMs: number | null): CompetitionResultInput => ({
  id,
  date: new Date(BASE - daysBeforeBase * DAY).toISOString(),
  event: "3x3x3",
  averageMs,
});

// Five competitions, each with a practice window; practice is a flat
// 10000ms and the official gap is a flat +10% every time, so every model
// should be able to fit this well.
function fixture() {
  const solves: TimedPracticeSolve[] = [
    solveAt(108, 10000), solveAt(104, 10000),
    solveAt(78, 10000), solveAt(74, 10000),
    solveAt(48, 10000), solveAt(44, 10000),
    solveAt(28, 10000), solveAt(24, 10000),
    solveAt(12, 10000), solveAt(8, 10000),
  ];
  const results: CompetitionResultInput[] = [
    competition("c1", 100, 11000),
    competition("c2", 70, 11000),
    competition("c3", 40, 11000),
    competition("c4", 20, 11000),
    competition("c5", 5, 11000),
  ];
  return { solves, results };
}

describe("compareModels", () => {
  it("returns all-empty metrics and a null best model with no competitions", () => {
    const result = compareModels([], [], "3x3x3");
    expect(result.comparableCompetitionsFound).toBe(0);
    expect(result.bestModelId).toBeNull();
    expect(result.metrics.every((m) => m.evaluatedCount === 0)).toBe(true);
  });

  it("finds no comparable competitions with only one competition (nothing prior to train on)", () => {
    const solves = [solveAt(10, 10000), solveAt(5, 10000)];
    const results = [competition("only", 8, 11000)];
    const result = compareModels(solves, results, "3x3x3");
    expect(result.comparableCompetitionsFound).toBe(0);
  });

  it("evaluates rule-based on every competition with at least one earlier competition and matching practice", () => {
    const { solves, results } = fixture();
    const result = compareModels(solves, results, "3x3x3");
    const rule = result.metrics.find((m) => m.modelId === "rule-based")!;
    expect(rule.evaluatedCount).toBe(4); // c2..c5
    expect(result.comparableCompetitionsFound).toBe(4);
    expect(result.comparableCompetitionsFound).toBeGreaterThanOrEqual(MIN_COMPARABLE_FOR_COMPARISON);
  });

  it("never leaks a later competition's data into an earlier competition's prediction", () => {
    const { solves, results } = fixture();
    const baseline = compareModels(solves, results, "3x3x3");

    // Corrupt only the practice/official data strictly after c3's date -
    // c3's own predictions, across all three models, must be unaffected.
    const laterSolves = solves.map((s) =>
      (s.localCreatedAt as number) > BASE - 40 * DAY ? { ...s, millis: 999999 } : s
    );
    const laterResults = results.map((r) => (r.id === "c5" ? { ...r, averageMs: 999999 } : r));
    const mutated = compareModels(laterSolves, laterResults, "3x3x3");

    for (const modelId of ["rule-based", "linear-regression", "nearest-neighbor"] as const) {
      const before = baseline.metrics.find((m) => m.modelId === modelId)!.cases.find((c) => c.competitionId === "c3");
      const after = mutated.metrics.find((m) => m.modelId === modelId)!.cases.find((c) => c.competitionId === "c3");
      expect(after?.predictedMs).toEqual(before?.predictedMs);
    }
  });

  it("computes MAE/median/RMSE/MAPE/bias correctly for a hand-computable fixture", () => {
    const { solves, results } = fixture();
    const result = compareModels(solves, results, "3x3x3");
    const rule = result.metrics.find((m) => m.modelId === "rule-based")!;

    // Rule-based: c1 seeds a +10% adjustment factor with no error to
    // measure yet; c2..c5 each reuse only prior +10% gaps, so predicted ==
    // actual (11000) exactly once the factor has any history at all.
    expect(rule.maeMs).toBeCloseTo(0, 5);
    expect(rule.medianAeMs).toBeCloseTo(0, 5);
    expect(rule.rmseMs).toBeCloseTo(0, 5);
    expect(rule.mapePct).toBeCloseTo(0, 5);
    expect(rule.biasMs).toBeCloseTo(0, 5);
  });

  it("selects the model with the lowest MAE as best", () => {
    const { solves, results } = fixture();
    const result = compareModels(solves, results, "3x3x3");
    expect(result.bestModelId).not.toBeNull();
    const best = result.metrics.find((m) => m.modelId === result.bestModelId)!;
    for (const m of result.metrics) {
      if (m.evaluatedCount > 0 && m.maeMs !== null) {
        expect(best.maeMs as number).toBeLessThanOrEqual(m.maeMs as number);
      }
    }
  });

  it("breaks a MAE tie by preferring the simplest model (baselines before models)", () => {
    // One competition, one prior with identical averages: the rule-based
    // model and the last-competition baseline both predict 11000 exactly.
    // On a tie the simpler predictor must win - a model has to strictly
    // beat the baselines to be selected.
    const solves = [solveAt(20, 10000), solveAt(16, 10000), solveAt(6, 10000), solveAt(2, 10000)];
    const results = [competition("c1", 15, 11000), competition("c2", 5, 11000)];
    const result = compareModels(solves, results, "3x3x3");
    expect(result.bestModelId).toBe("last-competition");
  });

  it("keeps DNF/+2 practice solves flowing through every model via the shared feature vector", () => {
    const solves: TimedPracticeSolve[] = [
      solveAt(20, 10000), solveAt(18, 0, "DNF"), solveAt(16, 9800, "+2"),
      solveAt(6, 10000), solveAt(4, 10200),
    ];
    const results = [competition("c1", 15, 11000), competition("c2", 5, 11000)];
    const result = compareModels(solves, results, "3x3x3");
    expect(result.comparableCompetitionsFound).toBe(1);
  });

  it("with no practice data at all, only the last-competition baseline can be scored", () => {
    const results = [competition("c1", 30, 11000), competition("c2", 10, 11000)];
    const result = compareModels([], results, "3x3x3");
    for (const m of result.metrics) {
      expect(m.evaluatedCount).toBe(m.modelId === "last-competition" ? 1 : 0);
    }
    expect(result.bestModelId).toBe("last-competition");
  });
});

describe("explainBestModel", () => {
  it("explains an insufficient-data result", () => {
    const result = compareModels([], [], "3x3x3");
    expect(explainBestModel(result)).toMatch(/Not enough historical data/);
  });

  it("explains each model id with a distinct, deterministic sentence", () => {
    const base = { event: "3x3x3", metrics: [], comparableCompetitionsFound: 5 };
    expect(explainBestModel({ ...base, bestModelId: "rule-based" })).toMatch(/Rule-based/);
    expect(explainBestModel({ ...base, bestModelId: "linear-regression" })).toMatch(/Linear regression/);
    expect(explainBestModel({ ...base, bestModelId: "nearest-neighbor" })).toMatch(/Nearest-neighbor/);
    expect(explainBestModel({ ...base, bestModelId: "practice-mean" })).toMatch(/practice mean/);
    expect(explainBestModel({ ...base, bestModelId: "practice-window" })).toMatch(/practice window/);
    expect(explainBestModel({ ...base, bestModelId: "last-competition" })).toMatch(/previous competition/);
  });
});

describe("baselines", () => {
  it("evaluates all six predictors over the same walk-forward cases", () => {
    const { solves, results } = fixture();
    const result = compareModels(solves, results, "3x3x3");
    expect(result.metrics.map((m) => m.modelId)).toEqual([
      "practice-mean",
      "practice-window",
      "last-competition",
      "rule-based",
      "linear-regression",
      "nearest-neighbor",
    ]);
    for (const m of result.metrics) {
      expect(m.cases.map((c) => c.competitionId)).toEqual(["c2", "c3", "c4", "c5"]);
    }
  });

  it("last-competition predicts the most recent strictly-earlier competition's average", () => {
    const solves = [solveAt(20, 10000), solveAt(6, 10000)];
    const results = [competition("c1", 15, 11000), competition("c2", 5, 12000), competition("c3", 1, 12500)];
    const result = compareModels(solves, results, "3x3x3");
    const cases = result.metrics.find((m) => m.modelId === "last-competition")!.cases;
    expect(cases.find((c) => c.competitionId === "c2")!.predictedMs).toBe(11000);
    expect(cases.find((c) => c.competitionId === "c3")!.predictedMs).toBe(12000);
  });

  it("practice-mean predicts the all-history mean before the target date, not the recent window", () => {
    // One old slow solve outside any 14-day window plus one recent fast
    // solve: the all-history mean sees both, the window mean only one.
    const solves = [solveAt(40, 20000), solveAt(6, 10000)];
    const results = [competition("c1", 15, 11000), competition("c2", 5, 12000)];
    const result = compareModels(solves, results, "3x3x3");
    const c2 = (id: string) =>
      result.metrics.find((m) => m.modelId === id)!.cases.find((c) => c.competitionId === "c2")!.predictedMs;
    expect(c2("practice-mean")).toBe(15000); // (20000 + 10000) / 2
    expect(c2("practice-window")).toBe(10000); // only the recent solve is in the window
  });

  it("baselines report null predictions instead of fabricating one without data", () => {
    // No practice at all: both practice baselines must be null per case.
    const results = [competition("c1", 30, 11000), competition("c2", 10, 11000)];
    const result = compareModels([], results, "3x3x3");
    for (const id of ["practice-mean", "practice-window"]) {
      const cases = result.metrics.find((m) => m.modelId === id)!.cases;
      expect(cases.every((c) => c.predictedMs === null)).toBe(true);
    }
  });

  it("a baseline can legitimately be the best model", () => {
    // Practice wildly misrepresents competition results, so the rule-based
    // adjustment overshoots while last-competition nails the flat history.
    const solves = [
      solveAt(48, 8000), solveAt(44, 8000),
      solveAt(28, 9000), solveAt(24, 9000),
      solveAt(12, 7000), solveAt(8, 7500),
    ];
    const results = [competition("c1", 40, 12000), competition("c2", 20, 12000), competition("c3", 5, 12000)];
    const result = compareModels(solves, results, "3x3x3");
    expect(result.bestModelId).toBe("last-competition");
  });
});

describe("runFeatureAblation", () => {
  it("produces one entry per model feature, for the feature-consuming models only", () => {
    const { solves, results } = fixture();
    const ablation = runFeatureAblation(solves, results, "3x3x3");
    expect(ablation.entries.map((e) => e.removedFeature)).toEqual([
      "practiceMeanMs",
      "practiceStddevMs",
      "dnfRatePct",
      "priorCompetitionCount",
    ]);
    for (const entry of ablation.entries) {
      expect(entry.metrics.map((m) => m.modelId)).toEqual(["linear-regression", "nearest-neighbor"]);
    }
    expect(ablation.allFeatures.map((m) => m.modelId)).toEqual(["linear-regression", "nearest-neighbor"]);
  });

  it("genuinely removes the column - the ablated ridge fit has one fewer contribution", () => {
    const { solves, results } = fixture();
    const dataset = buildMlDataset(solves, results, "3x3x3");
    const lastCase = dataset.cases[dataset.cases.length - 1];
    const trainingRows = lastCase.trainingRows.map((r) => ({ features: r.features, actualAverageMs: r.targetAverageMs }));

    const keys = MODEL_FEATURE_KEYS.filter((k) => k !== "dnfRatePct");
    const ablatedFit = fitLinearRegression(trainingRows, keys);
    const explanation = ablatedFit.explain(lastCase.target.features);
    expect(explanation!.contributions.map((c) => c.feature)).toEqual(keys);
  });

  it("reports evaluated counts alongside every ablated metric", () => {
    const { solves, results } = fixture();
    const ablation = runFeatureAblation(solves, results, "3x3x3");
    for (const entry of ablation.entries) {
      for (const m of entry.metrics) {
        expect(m.evaluatedCount).toBeGreaterThanOrEqual(0);
        expect(typeof m.evaluatedCount).toBe("number");
      }
    }
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const { solves, results } = fixture();
    expect(runFeatureAblation(solves, results, "3x3x3")).toEqual(runFeatureAblation(solves, results, "3x3x3"));
  });
});
