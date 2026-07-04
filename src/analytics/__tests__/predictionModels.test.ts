import { describe, it, expect } from "vitest";
import { fitLinearRegression, predictNearestNeighbor } from "../predictionModels";
import type { TrainingRow } from "../predictionModels";
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
