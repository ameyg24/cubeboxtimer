import { describe, it, expect } from "vitest";
import { explainNearestNeighbors, fitLinearRegression, MODEL_FEATURE_KEYS, predictNearestNeighbor } from "../predictionModels";
import type { TrainingRow } from "../predictionModels";
import type { DatasetRow } from "../mlDataset";
import type { FeatureVector } from "../predictionFeatures";

const feature = (overrides: Partial<FeatureVector> = {}): FeatureVector => ({
  practiceMeanMs: 10000,
  practiceAo5Ms: 10000,
  practiceAo12Ms: 10000,
  practiceAo50Ms: null,
  practiceCount: 5,
  practiceStddevMs: 200,
  dnfRatePct: 0,
  plus2RatePct: 0,
  practiceBestMs: 9500,
  daysSincePreviousCompetition: 30,
  averageCompetitionGapDays: 30,
  priorCompetitionCount: 1,
  priorPredictionErrorMs: null,
  ...overrides,
});

const row = (practiceMeanMs: number, actualAverageMs: number): TrainingRow => ({
  features: feature({ practiceMeanMs, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 }),
  actualAverageMs,
});

describe("fitLinearRegression", () => {
  it("returns a no-op predictor with fewer than 2 usable training rows", () => {
    const fit = fitLinearRegression([row(10000, 11000)]);
    expect(fit.predict(feature())).toBeNull();
  });

  it("returns a no-op predictor with 0 training rows", () => {
    const fit = fitLinearRegression([]);
    expect(fit.predict(feature())).toBeNull();
  });

  it("fits close to an exact linear relationship given enough consistent training rows", () => {
    // actual = practiceMean * 1.1 exactly, other features held constant.
    const trainingRows = [8000, 9000, 10000, 11000, 12000].map((m) => row(m, m * 1.1));
    const fit = fitLinearRegression(trainingRows);
    const predicted = fit.predict(feature({ practiceMeanMs: 10000, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 }));
    expect(predicted).not.toBeNull();
    expect(predicted as number).toBeCloseTo(11000, -2); // within ~100ms given ridge shrinkage
  });

  it("returns null when the target feature vector has no practice data", () => {
    const trainingRows = [8000, 9000, 10000].map((m) => row(m, m * 1.1));
    const fit = fitLinearRegression(trainingRows);
    expect(fit.predict(feature({ practiceMeanMs: null, practiceStddevMs: null }))).toBeNull();
  });

  it("ignores training rows with no practice data instead of throwing", () => {
    const trainingRows: TrainingRow[] = [
      row(8000, 8800),
      { features: feature({ practiceMeanMs: null, practiceStddevMs: null }), actualAverageMs: 9999 },
      row(10000, 11000),
    ];
    const fit = fitLinearRegression(trainingRows);
    expect(fit.predict(feature({ practiceMeanMs: 9000, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 }))).not.toBeNull();
  });
});

describe("predictNearestNeighbor", () => {
  it("returns null with 0 usable training rows", () => {
    expect(predictNearestNeighbor([], feature())).toBeNull();
  });

  it("returns null when the target feature vector has no practice data", () => {
    const trainingRows = [row(10000, 11000)];
    expect(predictNearestNeighbor(trainingRows, feature({ practiceMeanMs: null, practiceStddevMs: null }))).toBeNull();
  });

  it("returns the single training row's value with exactly 1 usable row", () => {
    const trainingRows = [row(10000, 11000)];
    const predicted = predictNearestNeighbor(trainingRows, feature({ practiceMeanMs: 12000 }));
    expect(predicted).toBe(11000);
  });

  it("returns an exact match's value outright rather than weight-averaging it with farther neighbors", () => {
    const trainingRows = [row(10000, 11000), row(20000, 25000)];
    const target = feature({ practiceMeanMs: 10000, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });
    expect(predictNearestNeighbor(trainingRows, target)).toBe(11000);
  });

  it("weights closer neighbors more heavily than farther ones", () => {
    // Three points on a line of practiceMeanMs; target sits much closer to
    // the 10000 row than the 10001 or 20000 rows.
    const trainingRows = [row(10000, 100), row(10001, 200), row(20000, 900)];
    const target = feature({ practiceMeanMs: 10000.1, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });
    const predicted = predictNearestNeighbor(trainingRows, target, 3);
    expect(predicted).not.toBeNull();
    expect(predicted as number).toBeLessThan(300); // dominated by the two nearest rows (100, 200), not the 900 outlier
  });

  it("only considers the k nearest neighbors, not the whole training set", () => {
    const trainingRows = [row(10000, 100), row(10100, 150), row(50000, 99999)];
    const target = feature({ practiceMeanMs: 10050, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });
    const predicted = predictNearestNeighbor(trainingRows, target, 2);
    expect(predicted).not.toBeNull();
    expect(predicted as number).toBeLessThan(200); // excludes the k=3rd, far-away row entirely
  });
});

describe("fitLinearRegression explain", () => {
  const trainingRows = [8000, 9000, 10000, 11000, 12000].map((m) => row(m, m * 1.1));
  const target = feature({ practiceMeanMs: 10500, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });

  it("contributions plus intercept sum exactly to the prediction", () => {
    const fit = fitLinearRegression(trainingRows);
    const explanation = fit.explain(target)!;
    const sum = explanation.contributions.reduce((acc, c) => acc + c.contributionMs, 0);
    expect(explanation.interceptMs + sum).toBeCloseTo(explanation.predictedMs, 10);
    expect(explanation.predictedMs).toBeCloseTo(fit.predict(target) as number, 10);
  });

  it("uses the training-target mean as the intercept", () => {
    const fit = fitLinearRegression(trainingRows);
    const meanY = trainingRows.reduce((acc, r) => acc + r.actualAverageMs, 0) / trainingRows.length;
    expect(fit.explain(target)!.interceptMs).toBeCloseTo(meanY, 8);
  });

  it("returns one contribution per feature key, in model feature order", () => {
    const fit = fitLinearRegression(trainingRows);
    expect(fit.explain(target)!.contributions.map((c) => c.feature)).toEqual([...MODEL_FEATURE_KEYS]);
  });

  it("returns null for a target without practice data or an unfittable model", () => {
    const fit = fitLinearRegression(trainingRows);
    expect(fit.explain(feature({ practiceMeanMs: null, practiceStddevMs: null }))).toBeNull();
    expect(fitLinearRegression([]).explain(target)).toBeNull();
  });

  it("is deterministic - identical fits explain identically", () => {
    const a = fitLinearRegression(trainingRows).explain(target);
    const b = fitLinearRegression(trainingRows).explain(target);
    expect(a).toEqual(b);
  });
});

describe("explainNearestNeighbors", () => {
  const datasetRow = (id: string, daysAgo: number, practiceMeanMs: number, targetAverageMs: number): DatasetRow => ({
    competitionId: id,
    date: new Date(Date.UTC(2026, 0, 1) - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    dateMs: Date.UTC(2026, 0, 1) - daysAgo * 24 * 60 * 60 * 1000,
    features: feature({ practiceMeanMs, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 }),
    targetAverageMs,
  });

  it("matches predictNearestNeighbor and decomposes it into weighted neighbors", () => {
    const rows = [datasetRow("a", 30, 10000, 11000), datasetRow("b", 20, 10400, 11500), datasetRow("c", 10, 12000, 13000)];
    const target = feature({ practiceMeanMs: 10200, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });

    const explanation = explainNearestNeighbors(rows, target)!;
    const predicted = predictNearestNeighbor(
      rows.map((r) => ({ features: r.features, actualAverageMs: r.targetAverageMs })),
      target
    );

    expect(explanation.predictedMs).toBeCloseTo(predicted as number, 8);
    expect(explanation.neighbors.reduce((acc, n) => acc + n.weight, 0)).toBeCloseTo(1, 10);
    expect(explanation.neighbors.reduce((acc, n) => acc + n.contributionMs, 0)).toBeCloseTo(explanation.predictedMs, 8);
  });

  it("returns neighbors nearest-first, carrying competition identity from the dataset row", () => {
    const rows = [datasetRow("far", 30, 20000, 21000), datasetRow("near", 20, 10100, 11000)];
    const target = feature({ practiceMeanMs: 10000, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });

    const explanation = explainNearestNeighbors(rows, target)!;
    expect(explanation.neighbors[0].competitionId).toBe("near");
    expect(explanation.neighbors[0].date).toBe(rows[1].date);
    expect(explanation.neighbors[0].actualAverageMs).toBe(11000);
    expect(explanation.neighbors[0].distance).toBeLessThan(explanation.neighbors[1].distance);
  });

  it("gives an exact match weight 1 and returns it alone", () => {
    const rows = [datasetRow("exact", 30, 10000, 11000), datasetRow("other", 20, 20000, 21000)];
    const target = feature({ practiceMeanMs: 10000, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });

    const explanation = explainNearestNeighbors(rows, target)!;
    expect(explanation.neighbors).toHaveLength(1);
    expect(explanation.neighbors[0].competitionId).toBe("exact");
    expect(explanation.neighbors[0].weight).toBe(1);
    expect(explanation.predictedMs).toBe(11000);
  });

  it("limits neighbors to k", () => {
    const rows = [
      datasetRow("a", 40, 10000, 11000),
      datasetRow("b", 30, 10200, 11200),
      datasetRow("c", 20, 10400, 11400),
      datasetRow("d", 10, 10600, 11600),
    ];
    const target = feature({ practiceMeanMs: 10100, practiceStddevMs: 0, dnfRatePct: 0, priorCompetitionCount: 0 });
    expect(explainNearestNeighbors(rows, target, 2)!.neighbors).toHaveLength(2);
  });

  it("returns null without usable rows or target practice data", () => {
    const target = feature({ practiceMeanMs: null, practiceStddevMs: null });
    expect(explainNearestNeighbors([], feature())).toBeNull();
    expect(explainNearestNeighbors([datasetRow("a", 10, 10000, 11000)], target)).toBeNull();
  });
});
