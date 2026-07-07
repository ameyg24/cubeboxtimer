import { describe, it, expect } from "vitest";
import { buildMlDataset, toFeatureMatrix } from "../mlDataset";
import { buildFeatureVector } from "../predictionFeatures";
import { MODEL_FEATURE_KEYS } from "../predictionModels";
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

// c1..c4, each with practice inside its 14-day window except c3.
function fixture() {
  const solves: TimedPracticeSolve[] = [
    solveAt(96, 10000), solveAt(94, 10100), // window before c1 (90 days)
    solveAt(66, 10050), solveAt(64, 10150), // window before c2 (60 days)
    // no practice before c3 (30 days) - its window (44..30 days back) is empty
    solveAt(12, 10150), solveAt(8, 10250), // window before c4 (5 days)
  ];
  const results: CompetitionResultInput[] = [
    competition("c1", 90, 10500),
    competition("c2", 60, 10550),
    competition("c3", 30, 10600),
    competition("c4", 5, 10650),
  ];
  return { solves, results };
}

describe("buildMlDataset", () => {
  it("produces one chronological row per usable competition, with the official average as target", () => {
    const { solves, results } = fixture();
    const dataset = buildMlDataset(solves, results, "3x3x3");
    expect(dataset.rows.map((r) => r.competitionId)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(dataset.rows.map((r) => r.targetAverageMs)).toEqual([10500, 10550, 10600, 10650]);
    expect(dataset.stats.rowCount).toBe(4);
  });

  it("excludes results with no usable average or an unparseable date, and counts them", () => {
    const { solves, results } = fixture();
    const withBad = [
      ...results,
      competition("no-average", 20, null),
      { id: "bad-date", date: "not a date", event: "3x3x3", averageMs: 10000 },
    ];
    const dataset = buildMlDataset(solves, withBad, "3x3x3");
    expect(dataset.rows.map((r) => r.competitionId)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(dataset.stats.excludedCount).toBe(2);
  });

  it("builds each row's features from strictly earlier competitions only - byte-identical to buildFeatureVector", () => {
    const { solves, results } = fixture();
    const dataset = buildMlDataset(solves, results, "3x3x3");
    const c3 = dataset.rows[2];
    const expected = buildFeatureVector(solves, "3x3x3", Date.parse(results[2].date), [results[0], results[1]]);
    expect(c3.features).toEqual(expected);
    expect(c3.features.priorCompetitionCount).toBe(2);
  });

  it("never leaks later data into an earlier row", () => {
    const { solves, results } = fixture();
    const baseline = buildMlDataset(solves, results, "3x3x3");

    // Corrupt only data strictly after c2's date - c2's row must not move.
    const laterSolves = solves.map((s) =>
      (s.localCreatedAt as number) > BASE - 60 * DAY ? { ...s, millis: 999999 } : s
    );
    const laterResults = results.map((r) => (r.id === "c4" ? { ...r, averageMs: 999999 } : r));
    const mutated = buildMlDataset(laterSolves, laterResults, "3x3x3");

    expect(mutated.rows[1]).toEqual(baseline.rows[1]);
  });

  it("excludes a same-day competition from a target's training rows", () => {
    const { solves } = fixture();
    const results = [competition("c1", 30, 10500), competition("same-day", 5, 10550), competition("c2", 5, 10600)];
    const dataset = buildMlDataset(solves, results, "3x3x3");
    const c2Case = dataset.cases.find((c) => c.target.competitionId === "c2");
    expect(c2Case!.trainingRows.map((r) => r.competitionId)).toEqual(["c1"]);
  });

  it("produces a walk-forward case for every row with at least one earlier row", () => {
    const { solves, results } = fixture();
    const dataset = buildMlDataset(solves, results, "3x3x3");
    expect(dataset.cases.map((c) => c.target.competitionId)).toEqual(["c2", "c3", "c4"]);
    expect(dataset.stats.caseCount).toBe(3);
    expect(dataset.cases[2].trainingRows.map((r) => r.competitionId)).toEqual(["c1", "c2", "c3"]);
  });

  it("counts rows whose practice window was empty", () => {
    const { solves, results } = fixture();
    const dataset = buildMlDataset(solves, results, "3x3x3");
    expect(dataset.stats.rowsWithoutPracticeData).toBe(1); // c3
  });

  it("computes target statistics", () => {
    const { solves, results } = fixture();
    const { stats } = buildMlDataset(solves, results, "3x3x3");
    expect(stats.targetMeanMs).toBeCloseTo((10500 + 10550 + 10600 + 10650) / 4, 8);
    expect(stats.targetMinMs).toBe(10500);
    expect(stats.targetMaxMs).toBe(10650);
  });

  it("handles empty input", () => {
    const dataset = buildMlDataset([], [], "3x3x3");
    expect(dataset.rows).toEqual([]);
    expect(dataset.cases).toEqual([]);
    expect(dataset.stats).toEqual({
      rowCount: 0,
      caseCount: 0,
      excludedCount: 0,
      rowsWithoutPracticeData: 0,
      targetMeanMs: null,
      targetMinMs: null,
      targetMaxMs: null,
    });
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const { solves, results } = fixture();
    expect(buildMlDataset(solves, results, "3x3x3")).toEqual(buildMlDataset(solves, results, "3x3x3"));
  });

  it("does not mutate its inputs", () => {
    const { solves, results } = fixture();
    const solvesSnapshot = structuredClone(solves);
    const resultsSnapshot = structuredClone(results);
    buildMlDataset(solves, results, "3x3x3");
    expect(solves).toEqual(solvesSnapshot);
    expect(results).toEqual(resultsSnapshot);
  });

  it("scopes features to the event it was given", () => {
    const { solves, results } = fixture();
    const dataset = buildMlDataset(solves, results, "4x4x4");
    expect(dataset.event).toBe("4x4x4");
    // Same solves, different event label: rows still build (solves are
    // caller-scoped), proving event is threaded through, not hardcoded.
    expect(dataset.rows).toHaveLength(4);
  });
});

describe("toFeatureMatrix", () => {
  it("produces a matrix in model feature order with aligned targets and row ids", () => {
    const { solves, results } = fixture();
    const dataset = buildMlDataset(solves, results, "3x3x3");
    const fm = toFeatureMatrix(dataset.rows);

    expect(fm.columns).toEqual(MODEL_FEATURE_KEYS);
    expect(fm.rowIds).toEqual(["c1", "c2", "c4"]); // c3 has no practice data
    expect(fm.matrix).toHaveLength(3);
    expect(fm.matrix[0]).toHaveLength(MODEL_FEATURE_KEYS.length);
    expect(fm.targets).toEqual([10500, 10550, 10650]);

    const c1 = dataset.rows[0];
    expect(fm.matrix[0]).toEqual([
      c1.features.practiceMeanMs,
      c1.features.practiceStddevMs,
      c1.features.dnfRatePct,
      c1.features.priorCompetitionCount,
    ]);
  });

  it("returns an empty matrix for no rows", () => {
    expect(toFeatureMatrix([])).toEqual({ columns: MODEL_FEATURE_KEYS, matrix: [], targets: [], rowIds: [] });
  });
});
