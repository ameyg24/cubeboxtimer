// CubeBox analytics - pipeline registry (pure).
//
// A declarative table of the analytics capabilities the context exposes,
// with explicit dependencies. Dependencies mirror the real module-level
// call structure (what each analytics module actually consumes), not an
// aspirational diagram - see the tests that pin them. Adding a pipeline is
// one new row plus its context getter; existing rows don't change.

import type { AnalyticsContext } from "./context";

export type PipelineId =
  | "records"
  | "prediction"
  | "backtest"
  | "features"
  | "prediction-explanation"
  | "model-comparison"
  | "training-signals"
  | "practice-coach"
  | "training-plan"
  | "recommendation-evaluation";

export interface AnalyticsPipeline {
  id: PipelineId;
  version: number;
  dependencies: readonly PipelineId[];
  run(context: AnalyticsContext): unknown;
}

export const ANALYTICS_PIPELINES: readonly AnalyticsPipeline[] = [
  { id: "records", version: 1, dependencies: [], run: (ctx) => ctx.recordHistory() },
  { id: "prediction", version: 1, dependencies: [], run: (ctx) => ctx.prediction() },
  // backtesting.ts replays predictCompetitionResult per competition.
  { id: "backtest", version: 1, dependencies: ["prediction"], run: (ctx) => ctx.backtest() },
  // predictionFeatures.ts runs the backtest for priorPredictionErrorMs.
  { id: "features", version: 1, dependencies: ["backtest"], run: (ctx) => ctx.features() },
  {
    id: "prediction-explanation",
    version: 1,
    dependencies: ["prediction", "backtest"],
    run: (ctx) => ctx.explanation(),
  },
  // modelComparison.ts trains on feature vectors and compares against the rule-based prediction.
  {
    id: "model-comparison",
    version: 1,
    dependencies: ["prediction", "features"],
    run: (ctx) => ctx.modelComparison(),
  },
  // trainingSignals.ts reads the feature vector, prediction, backtest summary, and record history.
  {
    id: "training-signals",
    version: 1,
    dependencies: ["features", "prediction", "backtest", "records"],
    run: (ctx) => ctx.trainingSignals(),
  },
  { id: "practice-coach", version: 1, dependencies: ["training-signals"], run: (ctx) => ctx.practiceCoach() },
  { id: "training-plan", version: 1, dependencies: ["practice-coach"], run: (ctx) => ctx.trainingPlan() },
  // recommendationEvaluation.ts replays the coach's rule triggers over historical signals.
  {
    id: "recommendation-evaluation",
    version: 1,
    dependencies: ["prediction", "backtest", "training-signals", "practice-coach"],
    run: (ctx) => ctx.recommendationEvaluation(),
  },
];

export function getPipeline(id: PipelineId): AnalyticsPipeline {
  const pipeline = ANALYTICS_PIPELINES.find((p) => p.id === id);
  if (!pipeline) throw new Error(`Unknown analytics pipeline: ${id}`);
  return pipeline;
}

/** Returns one message per problem (duplicate id, dependency on an unregistered id); empty when valid. */
export function validatePipelineDependencies(
  pipelines: readonly AnalyticsPipeline[] = ANALYTICS_PIPELINES
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const p of pipelines) {
    if (ids.has(p.id)) errors.push(`Duplicate pipeline id: ${p.id}`);
    ids.add(p.id);
  }
  for (const p of pipelines) {
    for (const dep of p.dependencies) {
      if (!ids.has(dep)) errors.push(`Pipeline ${p.id} depends on unregistered id: ${dep}`);
    }
  }
  return errors;
}

/** DFS cycle check. Returns the cycle path (first repeated id at both ends) or null. */
export function findDependencyCycle(
  pipelines: readonly AnalyticsPipeline[] = ANALYTICS_PIPELINES
): PipelineId[] | null {
  const byId = new Map(pipelines.map((p) => [p.id, p]));
  const done = new Set<PipelineId>();
  const path: PipelineId[] = [];
  let cycle: PipelineId[] | null = null;

  const visit = (id: PipelineId) => {
    if (cycle || done.has(id)) return;
    const seenAt = path.indexOf(id);
    if (seenAt !== -1) {
      cycle = [...path.slice(seenAt), id];
      return;
    }
    path.push(id);
    for (const dep of byId.get(id)?.dependencies ?? []) visit(dep);
    path.pop();
    done.add(id);
  };

  for (const p of pipelines) visit(p.id);
  return cycle;
}
