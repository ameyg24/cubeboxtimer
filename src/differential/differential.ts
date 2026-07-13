// Randomized differential harness: for a seeded operation sequence, after
// EVERY operation the production analytics implementation (the worker
// core, driven through its real protocol with structured-clone message
// boundaries) must deep-equal the reference path (the reference state fed
// straight into the pure analytics functions). No tolerances.
//
// A failure is fully reproducible from its seed and reports the operation
// index, the operation, the state before it, and the first differing path
// between expected and actual analytics.

import { createAnalyticsContext, computeSessionStats } from "../analytics";
import { computeDailyStats } from "../worker/dashboardStats";
import { createWorkerCore } from "../worker/analyticsWorkerCore";
import { PROTOCOL_VERSION, WORKER_NODES } from "../worker/protocol";
import type { WorkerMessage, WorkerNode } from "../worker/protocol";
import { createOperationGenerator, ANALYTICS_NOW } from "./operationGenerator";
import { applyOperation, emptyReferenceState, flattenForAnalytics } from "./referenceState";
import type { ReferenceState } from "./referenceState";
import type { Operation } from "../storage/operations";
import { CUBE_DIMENSIONS } from "../storage/normalize";

const CONTEXT_NODES = WORKER_NODES.filter(
  (node) => node !== "allTimeStats" && node !== "dailyStats"
);

// The reference analytics path: the pre-worker synchronous entry points,
// invoked directly, no protocol, no caching across requests.
export function referenceAnalytics(
  state: ReferenceState,
  event: string,
  now: number
): Record<string, unknown> {
  const { solvesByEvent, competitions } = flattenForAnalytics(state);
  const solves = solvesByEvent[event] || [];
  const ctx = createAnalyticsContext({
    event,
    allSolvesForEvent: solves as never,
    competitionResults: competitions as never,
    now,
  });
  const results: Record<string, unknown> = {};
  for (const node of CONTEXT_NODES) {
    results[node] = (ctx as unknown as Record<string, () => unknown>)[node]();
  }
  results.allTimeStats = computeSessionStats(solves as never);
  results.dailyStats = computeDailyStats(solves as never, now);
  return results;
}

/** Depth-first search for the first differing path between two values. */
export function firstDifference(
  expected: unknown,
  actual: unknown,
  path = "$"
): { path: string; expected: unknown; actual: unknown } | null {
  if (Object.is(expected, actual)) return null;
  const bothObjects =
    typeof expected === "object" && expected !== null && typeof actual === "object" && actual !== null;
  if (!bothObjects) return { path, expected, actual };
  if (Array.isArray(expected) !== Array.isArray(actual)) return { path, expected, actual };
  const keys = new Set([
    ...Object.keys(expected as object),
    ...Object.keys(actual as object),
  ]);
  for (const key of keys) {
    const difference = firstDifference(
      (expected as Record<string, unknown>)[key],
      (actual as Record<string, unknown>)[key],
      `${path}.${key}`
    );
    if (difference) return difference;
  }
  return null;
}

// The production side under test: initialize-with-full-state then compute,
// exactly as the app drives the worker. Messages cross a structuredClone
// boundary in both directions, like a real Worker.
export interface ProductionAnalytics {
  initialize(state: ReferenceState, datasetVersion: number): void;
  compute(event: string, now: number, datasetVersion: number): Record<string, unknown>;
}

export function createProductionAnalytics(): ProductionAnalytics {
  const core = createWorkerCore();
  let requestId = 0;
  const send = (message: unknown): WorkerMessage =>
    structuredClone(core.handle(structuredClone(message)));
  return {
    initialize(state, datasetVersion) {
      const { solvesByEvent, competitions } = flattenForAnalytics(state);
      send({ protocolVersion: PROTOCOL_VERSION, type: "initialize", datasetVersion, solvesByEvent, competitions });
    },
    compute(event, now, datasetVersion) {
      const response = send({
        protocolVersion: PROTOCOL_VERSION,
        type: "compute",
        requestId: (requestId += 1),
        datasetVersion,
        event,
        now,
        nodes: [...WORKER_NODES],
      });
      if (response.type !== "result") {
        throw new Error(`production compute failed: ${JSON.stringify(response)}`);
      }
      return response.results as Record<string, unknown>;
    },
  };
}

export interface DifferentialFailure {
  seed: number;
  operationIndex: number;
  operation: Operation;
  previousState: ReferenceState;
  event: string;
  node: WorkerNode;
  diff: { path: string; expected: unknown; actual: unknown };
}

export type DifferentialOutcome =
  | { ok: true; seed: number; operationCount: number; operationTypeCounts: Record<string, number> }
  | { ok: false; failure: DifferentialFailure };

export interface DifferentialRunOptions {
  seed: number;
  operationCount?: number;
  /** Injectable for tests of the failure reporting itself. */
  production?: ProductionAnalytics;
}

export function runDifferential({
  seed,
  operationCount = 40,
  production = createProductionAnalytics(),
}: DifferentialRunOptions): DifferentialOutcome {
  const generator = createOperationGenerator(seed);
  let state = emptyReferenceState();
  const operationTypeCounts: Record<string, number> = {};

  for (let index = 0; index < operationCount; index++) {
    const previousState = state;
    const operation = generator.next(state);
    operationTypeCounts[operation.type] = (operationTypeCounts[operation.type] || 0) + 1;
    state = applyOperation(state, operation);
    production.initialize(state, index + 1);

    // Compare every event that holds data (plus the primary event, so the
    // all-empty case is exercised too).
    const events = new Set(["3x3x3"]);
    for (const dimension of CUBE_DIMENSIONS) {
      const hasSolves = state.sessions.some((s) => (s.solves[dimension] || []).length > 0);
      const hasCompetitions = state.competitions.some((c) => c.event === dimension);
      if (hasSolves || hasCompetitions) events.add(dimension);
    }

    for (const event of events) {
      const expected = referenceAnalytics(state, event, ANALYTICS_NOW);
      const actual = production.compute(event, ANALYTICS_NOW, index + 1);
      for (const node of WORKER_NODES) {
        const diff = firstDifference(expected[node], actual[node], "$");
        if (diff) {
          return {
            ok: false,
            failure: { seed, operationIndex: index, operation, previousState, event, node, diff },
          };
        }
      }
    }
  }
  return { ok: true, seed, operationCount, operationTypeCounts };
}

/** One-line human-readable failure summary for test output. */
export function describeFailure(failure: DifferentialFailure): string {
  return [
    `differential failure: seed=${failure.seed} opIndex=${failure.operationIndex}`,
    `operation=${JSON.stringify(failure.operation)}`,
    `event=${failure.event} node=${failure.node}`,
    `diff at ${failure.diff.path}: expected=${JSON.stringify(failure.diff.expected)} actual=${JSON.stringify(failure.diff.actual)}`,
    `replay: runDifferential({ seed: ${failure.seed}, operationCount: ${failure.operationIndex + 1} })`,
  ].join("\n");
}
