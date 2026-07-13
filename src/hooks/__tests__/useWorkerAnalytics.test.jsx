// @vitest-environment jsdom
import { StrictMode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useWorkerAnalytics } from "../useWorkerAnalytics.js";
import { createAnalyticsClient } from "../../worker/analyticsClient";

const solvesByEvent = (ids) => ({
  "3x3x3": ids.map((id, i) => ({
    id,
    millis: 10000 + i,
    penalty: null,
    cubeDimension: "3x3x3",
    localCreatedAt: 1000 + i,
  })),
});

const recordIds = (results) => results.recordHistory.history.map((e) => e.solveId);

describe("useWorkerAnalytics", () => {
  it("delivers results under StrictMode's doubled effects (regression: a re-run while a request was in flight used to strand the follow-up in a disposed closure)", async () => {
    const client = createAnalyticsClient();
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    const { result } = renderHook(
      () => useWorkerAnalytics(["recordHistory"], "3x3x3", { client }),
      { wrapper: StrictMode }
    );
    await waitFor(() => expect(result.current.results).not.toBeNull());
    expect(recordIds(result.current.results)).toContain("a");
  });

  it("a dataset change while a request is in flight coalesces into one follow-up that reflects the latest state", async () => {
    const client = createAnalyticsClient();
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    const { result } = renderHook(() => useWorkerAnalytics(["recordHistory"], "3x3x3", { client }));
    // Replace the dataset immediately: the first request is still in flight.
    act(() => {
      client.setDataset({ solvesByEvent: solvesByEvent(["b"]), competitions: [] });
    });
    await waitFor(() => expect(result.current.results).not.toBeNull());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(recordIds(result.current.results)).toContain("b");
    expect(recordIds(result.current.results)).not.toContain("a");
  });

  it("an event switch never exposes the previous event's results", async () => {
    const client = createAnalyticsClient();
    client.setDataset({
      solvesByEvent: { ...solvesByEvent(["a"]), "2x2x2": [] },
      competitions: [],
    });
    const { result, rerender } = renderHook(
      ({ event }) => useWorkerAnalytics(["recordHistory"], event, { client }),
      { initialProps: { event: "3x3x3" } }
    );
    await waitFor(() => expect(result.current.results).not.toBeNull());

    rerender({ event: "2x2x2" });
    // Synchronously after the switch: no stale 3x3x3 results.
    expect(result.current.results).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.results).not.toBeNull());
    expect(result.current.results.recordHistory.history).toEqual([]);
  });

  it("unmounting before the result arrives applies nothing and does not throw", async () => {
    const client = createAnalyticsClient();
    client.setDataset({ solvesByEvent: solvesByEvent(["a"]), competitions: [] });
    const { unmount } = renderHook(() => useWorkerAnalytics(["recordHistory"], "3x3x3", { client }));
    unmount();
    // Let the orphaned request settle; nothing to assert beyond no crash.
    await act(async () => {});
  });
});
