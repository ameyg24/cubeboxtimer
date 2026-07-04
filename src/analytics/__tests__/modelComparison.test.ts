import { describe, it, expect } from "vitest";
import { compareModels, explainBestModel, MIN_COMPARABLE_FOR_COMPARISON } from "../modelComparison";
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

  it("breaks a MAE tie by fixed model priority (rule-based, then linear regression, then nearest-neighbor)", () => {
    // Force three models to score identically by giving every case a
    // single zero-error data point structurally shared across all models:
    // one competition, one prior — every model reduces to "predict the only
    // thing it's ever seen," which is exact here.
    const solves = [solveAt(20, 10000), solveAt(16, 10000), solveAt(6, 10000), solveAt(2, 10000)];
    const results = [competition("c1", 15, 11000), competition("c2", 5, 11000)];
    const result = compareModels(solves, results, "3x3x3");
    expect(result.bestModelId).toBe("rule-based");
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

  it("produces a null-heavy result (not a crash) when there is competition history but no practice data at all", () => {
    const results = [competition("c1", 30, 11000), competition("c2", 10, 11000)];
    const result = compareModels([], results, "3x3x3");
    expect(result.metrics.every((m) => m.evaluatedCount === 0)).toBe(true);
    expect(result.bestModelId).toBeNull();
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
  });
});
