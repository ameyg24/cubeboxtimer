// Message protocol between the main thread and the analytics worker.
// Version 1. Every message is a plain structured-cloneable object; the
// discriminant is `type`. The worker never reads a clock or any storage,
// so a compute request carries everything the computation needs (event,
// now) and the worker state carries the rest (solves, competitions).

import type { PersistedCompetition, PersistedSolve } from "../storage/types";

export const PROTOCOL_VERSION = 1;

// All solves, flattened across sessions, grouped by event. This is the
// exact input shape the analytics context consumes per event.
export type SolvesByEvent = Record<string, PersistedSolve[]>;

export interface WorkerDataset {
  solvesByEvent: SolvesByEvent;
  competitions: PersistedCompetition[];
}

// The computations the worker can be asked for. The first twelve are the
// AnalyticsContext accessors; the last two are the Dashboard's all-time
// aggregations, which run over the same per-event solve array.
export const WORKER_NODES = [
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
  "allTimeStats",
  "dailyStats",
] as const;

export type WorkerNode = (typeof WORKER_NODES)[number];

export interface InitializeMessage {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "initialize";
  datasetVersion: number;
  solvesByEvent: SolvesByEvent;
  competitions: PersistedCompetition[];
}

export interface ComputeMessage {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "compute";
  requestId: number;
  datasetVersion: number;
  event: string;
  now: number;
  nodes: WorkerNode[];
}

export type ClientMessage = InitializeMessage | ComputeMessage;

export interface ResultMessage {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "result";
  requestId: number;
  datasetVersion: number;
  results: Partial<Record<WorkerNode, unknown>>;
}

export interface ErrorMessage {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "error";
  // -1 when the failure is not attributable to a specific request
  // (a malformed inbound message, for example).
  requestId: number;
  datasetVersion: number;
  error: { name: string; message: string };
}

export type WorkerMessage = ResultMessage | ErrorMessage;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ClientMessageValidation =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: string };

export function validateClientMessage(candidate: unknown): ClientMessageValidation {
  if (!isPlainObject(candidate)) return { ok: false, reason: "message must be an object" };
  if (candidate.protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, reason: `unsupported protocolVersion: ${String(candidate.protocolVersion)}` };
  }
  if (candidate.type === "initialize") {
    if (typeof candidate.datasetVersion !== "number") {
      return { ok: false, reason: "initialize requires a numeric datasetVersion" };
    }
    if (!isPlainObject(candidate.solvesByEvent)) {
      return { ok: false, reason: "initialize requires solvesByEvent" };
    }
    if (!Array.isArray(candidate.competitions)) {
      return { ok: false, reason: "initialize requires a competitions array" };
    }
    return { ok: true, message: candidate as unknown as InitializeMessage };
  }
  if (candidate.type === "compute") {
    if (typeof candidate.requestId !== "number") {
      return { ok: false, reason: "compute requires a numeric requestId" };
    }
    if (typeof candidate.datasetVersion !== "number") {
      return { ok: false, reason: "compute requires a numeric datasetVersion" };
    }
    if (typeof candidate.event !== "string" || candidate.event.length === 0) {
      return { ok: false, reason: "compute requires an event" };
    }
    if (typeof candidate.now !== "number") {
      return { ok: false, reason: "compute requires an explicit now" };
    }
    if (
      !Array.isArray(candidate.nodes) ||
      candidate.nodes.length === 0 ||
      !candidate.nodes.every((n) => (WORKER_NODES as readonly string[]).includes(n as string))
    ) {
      return { ok: false, reason: "compute requires a non-empty array of known nodes" };
    }
    return { ok: true, message: candidate as unknown as ComputeMessage };
  }
  return { ok: false, reason: `unknown message type: ${String(candidate.type)}` };
}

// Errors cross the boundary as name + message only; stack traces and any
// non-cloneable extras stay behind.
export function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}
