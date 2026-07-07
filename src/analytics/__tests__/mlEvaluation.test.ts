import { describe, it, expect } from "vitest";
import { computeRegressionMetrics, median } from "../mlEvaluation";

describe("median", () => {
  it("returns the middle value for an odd-length list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("computeRegressionMetrics", () => {
  it("returns all-null metrics for empty input", () => {
    expect(computeRegressionMetrics([])).toEqual({
      evaluatedCount: 0,
      mae: null,
      medianAbsoluteError: null,
      rmse: null,
      mapePct: null,
      bias: null,
    });
  });

  it("computes exact metrics for a single pair", () => {
    const m = computeRegressionMetrics([{ predicted: 9000, actual: 10000 }]);
    expect(m.evaluatedCount).toBe(1);
    expect(m.mae).toBe(1000);
    expect(m.medianAbsoluteError).toBe(1000);
    expect(m.rmse).toBe(1000);
    expect(m.mapePct).toBeCloseTo(10, 10);
    expect(m.bias).toBe(1000); // actual - predicted: prediction ran low
  });

  it("computes exact metrics for a hand-computed multi-pair fixture", () => {
    // errors (actual - predicted): +500, -500, +1000
    const m = computeRegressionMetrics([
      { predicted: 10000, actual: 10500 },
      { predicted: 10500, actual: 10000 },
      { predicted: 9000, actual: 10000 },
    ]);
    expect(m.evaluatedCount).toBe(3);
    expect(m.mae).toBeCloseTo((500 + 500 + 1000) / 3, 8);
    expect(m.medianAbsoluteError).toBe(500);
    expect(m.rmse).toBeCloseTo(Math.sqrt((500 ** 2 + 500 ** 2 + 1000 ** 2) / 3), 8);
    expect(m.mapePct).toBeCloseTo(((500 / 10500 + 500 / 10000 + 1000 / 10000) / 3) * 100, 8);
    expect(m.bias).toBeCloseTo((500 - 500 + 1000) / 3, 8);
  });

  it("keeps bias signed - consistently high predictions give negative bias", () => {
    const m = computeRegressionMetrics([
      { predicted: 11000, actual: 10000 },
      { predicted: 10800, actual: 10000 },
    ]);
    expect(m.bias).toBeCloseTo(-900, 8);
    expect(m.mae).toBeCloseTo(900, 8);
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const pairs = [
      { predicted: 10000, actual: 10500 },
      { predicted: 9000, actual: 10000 },
    ];
    expect(computeRegressionMetrics(pairs)).toEqual(computeRegressionMetrics(pairs));
  });
});
