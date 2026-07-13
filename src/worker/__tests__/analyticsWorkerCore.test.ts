import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createWorkerCore } from "../analyticsWorkerCore";
import { computeDailyStats } from "../dashboardStats";
import { PROTOCOL_VERSION, WORKER_NODES } from "../protocol";
import type { WorkerNode } from "../protocol";
import { createAnalyticsContext, computeSessionStats } from "../../analytics";
import { buildSampleData, SAMPLE_EVENT } from "../../../scripts/benchmarkData";

const NOW = Date.UTC(2026, 4, 1);
const CONTEXT_NODES = WORKER_NODES.filter(
  (n) => n !== "allTimeStats" && n !== "dailyStats"
) as WorkerNode[];

function initMessage(solvesByEvent: Record<string, unknown[]>, competitions: unknown[], version = 1) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "initialize",
    datasetVersion: version,
    solvesByEvent,
    competitions,
  };
}

function computeMessage(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "compute",
    requestId: 1,
    datasetVersion: 1,
    event: SAMPLE_EVENT,
    now: NOW,
    nodes: [...WORKER_NODES],
    ...overrides,
  };
}

// The reference implementation: the exact synchronous path the app used
// before the worker existed.
function syncReference(solves: unknown[], competitions: unknown[], event: string, now: number) {
  const ctx = createAnalyticsContext({
    event,
    allSolvesForEvent: solves as never,
    competitionResults: competitions as never,
    now,
  });
  const results: Record<string, unknown> = {};
  for (const node of CONTEXT_NODES) {
    results[node] = (ctx as never as Record<string, () => unknown>)[node]();
  }
  results.allTimeStats = computeSessionStats(solves as never);
  results.dailyStats = computeDailyStats(solves as never, now);
  return results;
}

function expectWorkerEqualsSync(
  solvesByEvent: Record<string, unknown[]>,
  competitions: unknown[],
  event: string
) {
  const core = createWorkerCore();
  core.handle(initMessage(solvesByEvent, competitions));
  const response = core.handle(computeMessage({ event }));
  expect(response.type).toBe("result");
  if (response.type !== "result") return;
  const reference = syncReference(solvesByEvent[event] || [], competitions, event, NOW);
  for (const node of WORKER_NODES) {
    expect(response.results[node], node).toEqual(reference[node]);
  }
  // Everything that crosses the boundary must survive structured clone.
  expect(structuredClone(response)).toEqual(response);
}

describe("worker core equals the synchronous reference implementation", () => {
  it("on empty data", () => {
    expectWorkerEqualsSync({ "3x3x3": [] }, [], "3x3x3");
  });

  it("on the realistic sample dataset", { timeout: 30000 }, () => {
    const { solves, competitionResults } = buildSampleData();
    expectWorkerEqualsSync({ [SAMPLE_EVENT]: solves as never }, competitionResults as never, SAMPLE_EVENT);
  });

  it("on DNF and penalty data", () => {
    const solves = [
      { id: "a", millis: 10000, penalty: null, cubeDimension: "3x3x3", localCreatedAt: 1000 },
      { id: "b", millis: 0, penalty: "DNF", cubeDimension: "3x3x3", localCreatedAt: 2000 },
      { id: "c", millis: 9000, penalty: "+2", cubeDimension: "3x3x3", localCreatedAt: 3000 },
    ];
    expectWorkerEqualsSync({ "3x3x3": solves }, [], "3x3x3");
  });

  it("on import-shaped data (WCA competition rounds + csTimer solves)", () => {
    const solves = [
      { id: "i1", millis: 11000, penalty: null, reviewed: true, cubeDimension: "3x3x3", localCreatedAt: 1000, scramble: "R U R' U'" },
    ];
    const competitions = [
      {
        id: "c1", competitionName: "Nationals 2026", date: "2026-03-01T00:00:00.000Z", event: "3x3x3",
        bestMs: 9500, averageMs: 11200, source: "wca-import",
        wcaCompetitionId: "Nationals2026", wcaRoundId: 1, roundLabel: "First round", wcaId: "2019GABA01",
      },
    ];
    expectWorkerEqualsSync({ "3x3x3": solves }, competitions, "3x3x3");
  });

  it("scopes per event: a 2x2x2 request never sees 3x3x3 solves", () => {
    const { solves, competitionResults } = buildSampleData();
    const twoByTwo = [{ id: "t1", millis: 3000, penalty: null, cubeDimension: "2x2x2", localCreatedAt: 1000 }];
    const solvesByEvent = { [SAMPLE_EVENT]: solves as never[], "2x2x2": twoByTwo };
    const core = createWorkerCore();
    core.handle(initMessage(solvesByEvent, competitionResults as never));
    const response = core.handle(computeMessage({ event: "2x2x2", nodes: ["recordHistory", "allTimeStats"] }));
    expect(response.type).toBe("result");
    if (response.type !== "result") return;
    const reference = syncReference(twoByTwo, competitionResults as never, "2x2x2", NOW);
    expect(response.results.recordHistory).toEqual(reference.recordHistory);
    expect(response.results.allTimeStats).toEqual(reference.allTimeStats);
  });

  it("is deterministic for an explicit now: identical requests produce identical results", { timeout: 30000 }, () => {
    const { solves, competitionResults } = buildSampleData();
    const core = createWorkerCore();
    core.handle(initMessage({ [SAMPLE_EVENT]: solves as never }, competitionResults as never));
    const first = core.handle(computeMessage({ requestId: 1 }));
    const second = core.handle(computeMessage({ requestId: 2 }));
    if (first.type !== "result" || second.type !== "result") throw new Error("expected results");
    expect(second.results).toEqual(first.results);
  });
});

describe("worker core lifecycle", () => {
  it("compute before initialize returns a protocol error, not a crash", () => {
    const core = createWorkerCore();
    const response = core.handle(computeMessage());
    expect(response.type).toBe("error");
    if (response.type === "error") {
      expect(response.error.message).toMatch(/before initialize/);
      expect(response.requestId).toBe(1);
    }
  });

  it("a newer initialize replaces the previous dataset entirely", () => {
    const core = createWorkerCore();
    const solveA = [{ id: "a", millis: 10000, penalty: null, cubeDimension: "3x3x3", localCreatedAt: 1000 }];
    const solveB = [{ id: "b", millis: 8000, penalty: null, cubeDimension: "3x3x3", localCreatedAt: 2000 }];
    core.handle(initMessage({ "3x3x3": solveA }, [], 1));
    core.handle(initMessage({ "3x3x3": solveB }, [], 2));
    const response = core.handle(computeMessage({ datasetVersion: 2, nodes: ["recordHistory"] }));
    if (response.type !== "result") throw new Error("expected result");
    expect(response.datasetVersion).toBe(2);
    const history = response.results.recordHistory as { history: { solveId: string }[] };
    expect(history.history.every((e) => e.solveId === "b")).toBe(true);
  });

  it("responds to malformed messages with a requestId of -1", () => {
    const core = createWorkerCore();
    const response = core.handle({ garbage: true });
    expect(response.type).toBe("error");
    if (response.type === "error") expect(response.requestId).toBe(-1);
  });

  it("tags results with the dataset version they were computed from", () => {
    const core = createWorkerCore();
    core.handle(initMessage({ "3x3x3": [] }, [], 7));
    const response = core.handle(computeMessage({ nodes: ["recordHistory"], event: "3x3x3" }));
    expect(response.datasetVersion).toBe(7);
  });
});

describe("worker module purity", () => {
  it("no module under src/worker imports storage, Firebase, the logger, or reads the clock", () => {
    const dir = join(__dirname, "..");
    const sources = readdirSync(dir)
      // analyticsClient.ts is main-thread code (it owns logging and the
      // Worker lifecycle); the purity constraint applies to everything
      // that runs inside the worker.
      .filter((f) => f.endsWith(".ts") && f !== "analyticsClient.ts")
      .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));
    expect(sources.length).toBeGreaterThan(2);
    for (const { file, text } of sources) {
      const imports = text
        .split("\n")
        .filter((line) => /^\s*import\b|\brequire\(/.test(line))
        .join("\n");
      expect(imports, file).not.toMatch(/logger|firebase|storage\/(indexedDb|migration|repository)/i);
      // Code (not comments) must never read the clock or touch globals.
      const code = text.replace(/\/\/[^\n]*/g, "");
      expect(code, file).not.toMatch(/Date\.now\(\)/);
      expect(code, file).not.toMatch(/\bindexedDB\b|\blocalStorage\b|\bdocument\.|\bwindow\./);
    }
  });
});
