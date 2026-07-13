// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createAnalyticsClient } from "../analyticsClient";
import { createWorkerCore } from "../analyticsWorkerCore";
import type { ClientMessage, WorkerMessage } from "../protocol";

const solvesByEvent = (ids: string[]) => ({
  "3x3x3": ids.map((id, i) => ({
    id,
    millis: 10000 + i,
    penalty: null,
    cubeDimension: "3x3x3",
    localCreatedAt: 1000 + i,
  })),
});

// A fake worker wrapping the real core, with controllable failure. Uses
// the same asynchronous + structured-clone message discipline as a real
// Worker, so these tests exercise the true protocol path.
function createFakeWorkerFactory({ failOnCreate = 0, crashOnCompute = 0 } = {}) {
  const created: number[] = [];
  let creations = 0;
  const factory = () => {
    creations += 1;
    created.push(creations);
    if (creations <= failOnCreate) throw new Error("construction failed");
    const core = createWorkerCore();
    const instance = creations;
    const workerLike = {
      onmessage: null as ((e: { data: WorkerMessage }) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      onmessageerror: null as ((e: unknown) => void) | null,
      terminated: false,
      terminate() {
        this.terminated = true;
      },
      postMessage(message: ClientMessage) {
        const request = structuredClone(message);
        queueMicrotask(() => {
          if (workerLike.terminated) return;
          if (request.type === "compute" && instance <= crashOnCompute) {
            workerLike.onerror?.(new Error("simulated worker crash"));
            return;
          }
          const response = structuredClone(core.handle(request));
          workerLike.onmessage?.({ data: response });
        });
      },
    };
    return workerLike;
  };
  return { factory, createdCount: () => creations };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("analyticsClient lifecycle", () => {
  it("initialization followed by compute returns version-tagged results", async () => {
    const { factory } = createFakeWorkerFactory();
    const client = createAnalyticsClient({ createWorker: factory });
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    const outcome = await client.compute(["recordHistory"], "3x3x3", 5000);
    expect(outcome.datasetVersion).toBe(1);
    const history = outcome.results.recordHistory as { history: { solveId: string }[] };
    expect(history.history.some((e) => e.solveId === "a")).toBe(true);
  });

  it("rejects compute before any dataset is set", async () => {
    const { factory } = createFakeWorkerFactory();
    const client = createAnalyticsClient({ createWorker: factory });
    await expect(client.compute(["recordHistory"], "3x3x3", 1)).rejects.toThrow(/before any dataset/);
  });

  it("a newer dataset supersedes an older one: results reflect the latest state", async () => {
    const { factory } = createFakeWorkerFactory();
    const client = createAnalyticsClient({ createWorker: factory });
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    client.setDataset({ solvesByEvent: solvesByEvent(["b"]), competitions: [] });
    const outcome = await client.compute(["recordHistory"], "3x3x3", 5000);
    expect(outcome.datasetVersion).toBe(2);
    const history = outcome.results.recordHistory as { history: { solveId: string }[] };
    expect(history.history.every((e) => e.solveId === "b")).toBe(true);
  });

  it("a compute issued before a dataset replacement resolves tagged with its older version", async () => {
    const { factory } = createFakeWorkerFactory();
    const client = createAnalyticsClient({ createWorker: factory });
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    const inFlight = client.compute(["recordHistory"], "3x3x3", 5000);
    client.setDataset({ solvesByEvent: solvesByEvent(["b"]), competitions: [] });
    const outcome = await inFlight;
    // The consumer compares this against getDatasetVersion() and discards.
    expect(outcome.datasetVersion).toBe(1);
    expect(client.getDatasetVersion()).toBe(2);
  });

  it("notifies subscribers on every dataset change", () => {
    const { factory } = createFakeWorkerFactory();
    const client = createAnalyticsClient({ createWorker: factory });
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    client.setDataset({ solvesByEvent: solvesByEvent(["b"]), competitions: [] });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    client.setDataset({ solvesByEvent: solvesByEvent(["c"]), competitions: [] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("recovers from a worker crash exactly once and keeps serving results", async () => {
    const { factory, createdCount } = createFakeWorkerFactory({ crashOnCompute: 1 });
    const client = createAnalyticsClient({ createWorker: factory });
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });

    // First compute crashes worker #1; the pending promise rejects.
    await expect(client.compute(["recordHistory"], "3x3x3", 1)).rejects.toThrow(/worker failed/);
    await flush();
    expect(client.getMode()).toBe("worker");
    expect(createdCount()).toBe(2); // replaced once, re-initialized

    const outcome = await client.compute(["recordHistory"], "3x3x3", 1);
    expect(outcome.datasetVersion).toBe(1);
  });

  it("falls back to the in-process core after repeated failures, with no retry loop", async () => {
    const { factory, createdCount } = createFakeWorkerFactory({ crashOnCompute: 2 });
    const client = createAnalyticsClient({ createWorker: factory });
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });

    await expect(client.compute(["recordHistory"], "3x3x3", 1)).rejects.toThrow();
    await flush();
    await expect(client.compute(["recordHistory"], "3x3x3", 1)).rejects.toThrow();
    await flush();

    expect(client.getMode()).toBe("inline");
    expect(createdCount()).toBe(2); // never a third real worker

    // The fallback still produces correct, version-tagged results.
    const outcome = await client.compute(["recordHistory"], "3x3x3", 1);
    const history = outcome.results.recordHistory as { history: { solveId: string }[] };
    expect(history.history.some((e) => e.solveId === "a")).toBe(true);
    expect(createdCount()).toBe(2);
  });

  it("uses the in-process fallback when Worker construction throws", async () => {
    const { factory } = createFakeWorkerFactory({ failOnCreate: 99 });
    const client = createAnalyticsClient({ createWorker: factory });
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    const outcome = await client.compute(["allTimeStats"], "3x3x3", 1);
    expect(client.getMode()).toBe("inline");
    expect((outcome.results.allTimeStats as { count: number }).count).toBe(1);
  });

  it("uses the in-process fallback when no Worker global exists (jsdom default)", async () => {
    const client = createAnalyticsClient();
    expect(client.getMode()).toBe("inline");
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    const outcome = await client.compute(["recordHistory"], "3x3x3", 1);
    expect(outcome.datasetVersion).toBe(1);
  });

  it("an analytics error inside the worker rejects only that request", async () => {
    const { factory } = createFakeWorkerFactory();
    const client = createAnalyticsClient({ createWorker: factory });
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    // Force an error via a malformed-at-runtime request (unknown node is
    // rejected by validation inside the worker).
    await expect(
      client.compute(["notANode" as never], "3x3x3", 1)
    ).rejects.toThrow(/known nodes/);
    // The client is still healthy afterward.
    const outcome = await client.compute(["recordHistory"], "3x3x3", 1);
    expect(outcome.datasetVersion).toBe(1);
  });
});
