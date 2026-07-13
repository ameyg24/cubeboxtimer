// The worker's message handler, kept free of the Worker global so it is
// testable in plain Node and reusable as the client's in-process fallback.
// Holds one dataset (replaced wholesale by each initialize message) and
// computes requested nodes through a fresh AnalyticsContext per request.
// No storage, no Firebase, no DOM, no logger, no clock: `now` always
// arrives in the request, so identical requests produce identical results.

import { createAnalyticsContext, computeSessionStats } from "../analytics";
import {
  PROTOCOL_VERSION,
  validateClientMessage,
  serializeError,
} from "./protocol";
import type { ComputeMessage, WorkerDataset, WorkerMessage, WorkerNode } from "./protocol";
import { computeDailyStats } from "./dashboardStats";

const CONTEXT_NODES = [
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

type ContextNode = (typeof CONTEXT_NODES)[number];

function isContextNode(node: WorkerNode): node is ContextNode {
  return (CONTEXT_NODES as readonly string[]).includes(node);
}

function computeNodes(dataset: WorkerDataset, request: ComputeMessage) {
  // Persisted solves are an open record shape; at runtime they carry the
  // fields the analytics input types require (the hooks normalize them),
  // so this is the one narrowing point between storage and analytics.
  const solves = (dataset.solvesByEvent[request.event] || []) as never[];
  const ctx = createAnalyticsContext({
    event: request.event,
    allSolvesForEvent: solves,
    competitionResults: dataset.competitions,
    now: request.now,
  });
  const results: Partial<Record<WorkerNode, unknown>> = {};
  for (const node of request.nodes) {
    if (isContextNode(node)) {
      results[node] = (ctx as unknown as Record<ContextNode, () => unknown>)[node]();
    } else if (node === "allTimeStats") {
      results[node] = computeSessionStats(solves);
    } else {
      results[node] = computeDailyStats(solves, request.now);
    }
  }
  return results;
}

export interface WorkerCore {
  handle(message: unknown): WorkerMessage;
}

export function createWorkerCore(): WorkerCore {
  let dataset: WorkerDataset | null = null;
  let datasetVersion = 0;

  const error = (requestId: number, err: unknown): WorkerMessage => ({
    protocolVersion: PROTOCOL_VERSION,
    type: "error",
    requestId,
    datasetVersion,
    error: serializeError(err),
  });

  return {
    handle(raw: unknown): WorkerMessage {
      const validation = validateClientMessage(raw);
      if (!validation.ok) {
        // Echo the requestId when the malformed message carried one, so
        // the caller's pending promise still settles.
        const rawId = (raw as { requestId?: unknown } | null)?.requestId;
        return error(typeof rawId === "number" ? rawId : -1, new Error(validation.reason));
      }
      const message = validation.message;

      if (message.type === "initialize") {
        dataset = { solvesByEvent: message.solvesByEvent, competitions: message.competitions };
        datasetVersion = message.datasetVersion;
        return {
          protocolVersion: PROTOCOL_VERSION,
          type: "result",
          requestId: -1,
          datasetVersion,
          results: {},
        };
      }

      if (dataset === null) {
        return error(message.requestId, new Error("compute received before initialize"));
      }
      try {
        return {
          protocolVersion: PROTOCOL_VERSION,
          type: "result",
          requestId: message.requestId,
          datasetVersion,
          results: computeNodes(dataset, message),
        };
      } catch (err) {
        return error(message.requestId, err);
      }
    },
  };
}
