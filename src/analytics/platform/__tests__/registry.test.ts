import { describe, it, expect } from "vitest";
import {
  ANALYTICS_PIPELINES,
  findDependencyCycle,
  getPipeline,
  validatePipelineDependencies,
} from "../registry";
import type { AnalyticsPipeline } from "../registry";
import { createAnalyticsContext } from "../context";

const emptyContext = () =>
  createAnalyticsContext({ event: "3x3x3", allSolvesForEvent: [], competitionResults: [], now: Date.UTC(2026, 0, 1) });

describe("ANALYTICS_PIPELINES", () => {
  it("registers the expected pipelines", () => {
    expect(ANALYTICS_PIPELINES.map((p) => p.id).sort()).toEqual(
      [
        "backtest",
        "features",
        "model-comparison",
        "practice-coach",
        "prediction",
        "prediction-explanation",
        "records",
        "recommendation-evaluation",
        "training-plan",
        "training-signals",
      ].sort()
    );
  });

  it("has valid dependencies (no duplicates, no unregistered ids)", () => {
    expect(validatePipelineDependencies()).toEqual([]);
  });

  it("has no dependency cycles", () => {
    expect(findDependencyCycle()).toBeNull();
  });

  it("pins the key dependency edges", () => {
    expect(getPipeline("backtest").dependencies).toEqual(["prediction"]);
    expect(getPipeline("features").dependencies).toEqual(["backtest"]);
    expect(getPipeline("training-signals").dependencies).toEqual(
      expect.arrayContaining(["features", "prediction", "backtest", "records"])
    );
    expect(getPipeline("practice-coach").dependencies).toEqual(["training-signals"]);
    expect(getPipeline("training-plan").dependencies).toEqual(["practice-coach"]);
  });

  it("every pipeline has a positive integer version", () => {
    for (const p of ANALYTICS_PIPELINES) {
      expect(Number.isInteger(p.version)).toBe(true);
      expect(p.version).toBeGreaterThan(0);
    }
  });

  it("every pipeline's run() returns the context's memoized value for that capability", () => {
    const ctx = emptyContext();
    expect(getPipeline("records").run(ctx)).toBe(ctx.recordHistory());
    expect(getPipeline("prediction").run(ctx)).toBe(ctx.prediction());
    expect(getPipeline("backtest").run(ctx)).toBe(ctx.backtest());
    expect(getPipeline("features").run(ctx)).toBe(ctx.features());
    expect(getPipeline("prediction-explanation").run(ctx)).toBe(ctx.explanation());
    expect(getPipeline("model-comparison").run(ctx)).toBe(ctx.modelComparison());
    expect(getPipeline("training-signals").run(ctx)).toBe(ctx.trainingSignals());
    expect(getPipeline("practice-coach").run(ctx)).toBe(ctx.practiceCoach());
    expect(getPipeline("training-plan").run(ctx)).toBe(ctx.trainingPlan());
    expect(getPipeline("recommendation-evaluation").run(ctx)).toBe(ctx.recommendationEvaluation());
  });
});

describe("getPipeline", () => {
  it("throws on an unknown id", () => {
    expect(() => getPipeline("nope" as never)).toThrow(/Unknown analytics pipeline/);
  });
});

describe("validatePipelineDependencies", () => {
  it("reports a dependency on an unregistered id", () => {
    const broken: AnalyticsPipeline[] = [
      { id: "prediction", version: 1, dependencies: ["records"], run: () => null },
    ];
    expect(validatePipelineDependencies(broken)).toEqual([
      "Pipeline prediction depends on unregistered id: records",
    ]);
  });

  it("reports duplicate ids", () => {
    const broken: AnalyticsPipeline[] = [
      { id: "prediction", version: 1, dependencies: [], run: () => null },
      { id: "prediction", version: 2, dependencies: [], run: () => null },
    ];
    expect(validatePipelineDependencies(broken)).toEqual(["Duplicate pipeline id: prediction"]);
  });
});

describe("findDependencyCycle", () => {
  it("detects a direct cycle", () => {
    const cyclic: AnalyticsPipeline[] = [
      { id: "prediction", version: 1, dependencies: ["backtest"], run: () => null },
      { id: "backtest", version: 1, dependencies: ["prediction"], run: () => null },
    ];
    expect(findDependencyCycle(cyclic)).toEqual(["prediction", "backtest", "prediction"]);
  });

  it("detects a longer cycle through an intermediate pipeline", () => {
    const cyclic: AnalyticsPipeline[] = [
      { id: "prediction", version: 1, dependencies: ["backtest"], run: () => null },
      { id: "backtest", version: 1, dependencies: ["features"], run: () => null },
      { id: "features", version: 1, dependencies: ["prediction"], run: () => null },
    ];
    expect(findDependencyCycle(cyclic)).toEqual(["prediction", "backtest", "features", "prediction"]);
  });
});
