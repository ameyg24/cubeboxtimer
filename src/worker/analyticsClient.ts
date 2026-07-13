// Main-thread side of the analytics worker boundary.
//
// Owns: worker lifecycle, the dataset version counter, request ids, and
// the failure policy. Consumers push the full dataset after every mutation
// (full state replacement: a 25K-solve clone measured ~13 ms, small next to
// the hundreds of milliseconds the worker removes from the main thread)
// and request computations tagged with the version they will be answered
// from. Stale-response suppression happens in the consuming hook; this
// client only guarantees that every result carries the datasetVersion it
// was computed against.
//
// Failure policy: on the first worker error, terminate, recreate once, and
// re-initialize from the latest dataset. If the replacement also fails, or
// Worker construction is unavailable (jsdom, old browsers), fall back to
// running the identical core in-process. The fallback still routes every
// message through structuredClone, so protocol guarantees hold in every
// mode and behavior stays byte-identical (the core is pure).

import { logger } from "../logger.js";
import { PROTOCOL_VERSION } from "./protocol";
import type {
  ClientMessage,
  ComputeMessage,
  ResultMessage,
  WorkerDataset,
  WorkerMessage,
  WorkerNode,
} from "./protocol";
import { createWorkerCore } from "./analyticsWorkerCore";

export interface ComputeOutcome {
  datasetVersion: number;
  results: ResultMessage["results"];
}

interface WorkerLike {
  postMessage(message: ClientMessage): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

function createRealWorker(): WorkerLike {
  return new Worker(new URL("./analyticsWorker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
}

// In-process stand-in with the same message discipline as a real Worker:
// asynchronous delivery and a structured clone on both boundaries.
function createInlineWorker(): WorkerLike {
  const core = createWorkerCore();
  const inline: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate() {},
    postMessage(message: ClientMessage) {
      const request = structuredClone(message);
      queueMicrotask(() => {
        const response = structuredClone(core.handle(request));
        inline.onmessage?.({ data: response });
      });
    },
  };
  return inline;
}

export interface AnalyticsClient {
  setDataset(dataset: WorkerDataset): void;
  compute(nodes: WorkerNode[], event: string, now: number): Promise<ComputeOutcome>;
  getDatasetVersion(): number;
  subscribe(listener: () => void): () => void;
  /** "worker" | "inline"; exposed for logging and tests. */
  getMode(): string;
}

export function createAnalyticsClient(
  factories: { createWorker?: () => WorkerLike } = {}
): AnalyticsClient {
  const makeRealWorker =
    factories.createWorker ??
    (typeof Worker === "undefined" ? null : createRealWorker);

  let mode = makeRealWorker ? "worker" : "inline";
  let replacedOnce = false;
  let worker: WorkerLike | null = null;

  let datasetVersion = 0;
  let latestDataset: WorkerDataset | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, { resolve: (o: ComputeOutcome) => void; reject: (e: Error) => void }>();
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function handleMessage(message: WorkerMessage) {
    if (!message || (message.type !== "result" && message.type !== "error")) {
      logger.warn("Analytics worker sent a malformed message; ignoring it.", { message });
      return;
    }
    if (message.requestId === -1) {
      if (message.type === "error") {
        logger.warn("Analytics worker rejected a message.", { error: message.error });
      }
      return; // initialize acknowledgements need no routing
    }
    const entry = pending.get(message.requestId);
    if (!entry) return; // response to a request from a replaced worker
    pending.delete(message.requestId);
    if (message.type === "result") {
      entry.resolve({ datasetVersion: message.datasetVersion, results: message.results });
    } else {
      entry.reject(new Error(`${message.error.name}: ${message.error.message}`));
    }
  }

  function failAllPending(reason: string) {
    const entries = [...pending.values()];
    pending.clear();
    entries.forEach((entry) => entry.reject(new Error(reason)));
  }

  function handleWorkerFailure(kind: string, detail: unknown) {
    logger.error("Analytics worker failed.", { kind, detail: String(detail), mode, replacedOnce });
    worker?.terminate();
    worker = null;
    failAllPending("analytics worker failed");
    if (mode === "worker" && !replacedOnce) {
      replacedOnce = true; // one replacement, never a retry loop
    } else {
      mode = "inline";
    }
    // Re-arm from the latest main-thread state and let consumers re-request.
    if (latestDataset) sendInitialize();
    notify();
  }

  function getWorker(): WorkerLike {
    if (worker) return worker;
    if (mode === "worker" && makeRealWorker) {
      try {
        worker = makeRealWorker();
      } catch (error) {
        logger.error("Analytics worker construction failed; using in-process fallback.", {
          error: String(error),
        });
        mode = "inline";
        worker = createInlineWorker();
      }
    } else {
      worker = createInlineWorker();
    }
    worker.onmessage = (event) => handleMessage(event.data);
    worker.onerror = (event) => handleWorkerFailure("error", event);
    worker.onmessageerror = (event) => handleWorkerFailure("messageerror", event);
    return worker;
  }

  function sendInitialize() {
    if (!latestDataset) return;
    getWorker().postMessage({
      protocolVersion: PROTOCOL_VERSION,
      type: "initialize",
      datasetVersion,
      solvesByEvent: latestDataset.solvesByEvent,
      competitions: latestDataset.competitions,
    });
  }

  return {
    setDataset(dataset: WorkerDataset) {
      latestDataset = dataset;
      datasetVersion += 1;
      // Message order is FIFO per worker, so computes sent after this
      // initialize are always answered from the new dataset; no explicit
      // acknowledgement round trip is needed for correctness.
      sendInitialize();
      notify();
    },

    compute(nodes: WorkerNode[], event: string, now: number): Promise<ComputeOutcome> {
      if (datasetVersion === 0) {
        return Promise.reject(new Error("compute requested before any dataset was set"));
      }
      const requestId = nextRequestId++;
      const message: ComputeMessage = {
        protocolVersion: PROTOCOL_VERSION,
        type: "compute",
        requestId,
        datasetVersion,
        event,
        now,
        nodes,
      };
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        getWorker().postMessage(message);
      });
    },

    getDatasetVersion: () => datasetVersion,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getMode: () => mode,
  };
}

// The application-wide client. Component hooks default to this instance;
// tests construct their own with an injected worker factory.
export const analyticsClient = createAnalyticsClient();
