import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  WORKER_NODES,
  validateClientMessage,
  serializeError,
} from "../protocol";

const initialize = {
  protocolVersion: PROTOCOL_VERSION,
  type: "initialize",
  datasetVersion: 1,
  solvesByEvent: { "3x3x3": [{ id: "a", millis: 10000, cubeDimension: "3x3x3", localCreatedAt: 1 }] },
  competitions: [],
};

const compute = {
  protocolVersion: PROTOCOL_VERSION,
  type: "compute",
  requestId: 1,
  datasetVersion: 1,
  event: "3x3x3",
  now: 1000,
  nodes: ["recordHistory", "practiceCoach"],
};

describe("validateClientMessage", () => {
  it("accepts a valid initialize message", () => {
    expect(validateClientMessage(initialize)).toEqual({ ok: true, message: initialize });
  });

  it("accepts a valid compute message", () => {
    expect(validateClientMessage(compute)).toEqual({ ok: true, message: compute });
  });

  it("rejects malformed messages deterministically", () => {
    const malformed = [
      null,
      42,
      "compute",
      {},
      { protocolVersion: PROTOCOL_VERSION, type: "unknown" },
      { protocolVersion: PROTOCOL_VERSION, type: "initialize", datasetVersion: 1 }, // missing payload
      { protocolVersion: PROTOCOL_VERSION, type: "compute", requestId: 1, datasetVersion: 1, event: "3x3x3", now: 1 }, // missing nodes
      { ...compute, nodes: [] },
      { ...compute, nodes: ["notANode"] },
      { ...compute, now: "today" },
      { ...compute, event: "" },
    ];
    for (const message of malformed) {
      const result = validateClientMessage(message);
      expect(result.ok, JSON.stringify(message)).toBe(false);
      if (!result.ok) expect(typeof result.reason).toBe("string");
      expect(validateClientMessage(message)).toEqual(result);
    }
  });

  it("rejects a protocol-version mismatch", () => {
    const result = validateClientMessage({ ...compute, protocolVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/protocolVersion/);
  });

  it("every request type survives a structured-clone round trip", () => {
    expect(structuredClone(initialize)).toEqual(initialize);
    expect(structuredClone(compute)).toEqual(compute);
  });

  it("knows every node name exactly once", () => {
    expect(new Set(WORKER_NODES).size).toBe(WORKER_NODES.length);
  });
});

describe("serializeError", () => {
  it("keeps only name and message, both cloneable", () => {
    class WeirdError extends Error {
      // Functions are not structured-cloneable; they must not cross.
      callback = () => 42;
    }
    const serialized = serializeError(new WeirdError("boom"));
    expect(serialized).toEqual({ name: "Error", message: "boom" });
    expect(structuredClone(serialized)).toEqual(serialized);
  });

  it("stringifies non-Error throwables", () => {
    expect(serializeError("plain string")).toEqual({ name: "Error", message: "plain string" });
  });
});
