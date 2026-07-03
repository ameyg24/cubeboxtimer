// @vitest-environment jsdom
//
// Covers the two behaviors that only live in wcaApi.js itself (not
// exercised by the hook/component tests, which mock this module entirely):
// retrying a 429 with backoff, and bounding how many metadata requests run
// concurrently. Both were added after importing a prolific real WCA
// competitor's ID (150+ competitions) reproduced live 429s from the API.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimitState, fetchWcaCompetitionMeta, mapWithConcurrency } from "../wcaApi.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchWcaCompetitionMeta retry-on-429", () => {
  it("returns immediately on a 200 without retrying", async () => {
    globalThis.fetch.mockResolvedValue(
      jsonResponse({ name: "NZ Champs 2009", start_date: "2009-07-18" })
    );

    const result = await fetchWcaCompetitionMeta("NewZealandChamps2009");

    expect(result).toEqual({ name: "NZ Champs 2009", date: new Date("2009-07-18").toISOString() });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and succeeds once the API stops rate-limiting", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse(null, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(null, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ name: "NZ Champs 2009", start_date: "2009-07-18" }));

    const promise = fetchWcaCompetitionMeta("NewZealandChamps2009");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.name).toBe("NZ Champs 2009");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("honors a Retry-After header instead of the default backoff", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse(null, { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(jsonResponse({ name: "NZ Champs 2009", start_date: "2009-07-18" }));

    const promise = fetchWcaCompetitionMeta("NewZealandChamps2009");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.name).toBe("NZ Champs 2009");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry limit and surfaces a clear error", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(null, { status: 429 }));

    const promise = fetchWcaCompetitionMeta("NewZealandChamps2009");
    const assertion = expect(promise).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await assertion;
    // 1 initial attempt + 6 retries = 7 calls total.
    expect(globalThis.fetch).toHaveBeenCalledTimes(7);
  });

  it("does not retry a non-429 error status", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(null, { status: 500 }));

    await expect(fetchWcaCompetitionMeta("NewZealandChamps2009")).rejects.toThrow(/500/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // Reproduces the real failure: a WCA ID with enough competitions bursts
  // past the rate limit mid-import, and concurrent workers with independent
  // retries re-fire into the *same* still-active window instead of backing
  // off together, burning through retries and silently dropping results. A
  // shared rate-limit state fixes this - a request that hasn't even started
  // yet waits out a window another concurrent request already triggered,
  // instead of finding out the hard way with its own 429.
  it("shares a rate-limit backoff window across concurrent calls instead of each independently re-triggering it", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse(null, { status: 429, headers: { "Retry-After": "5" } }))
      .mockResolvedValueOnce(jsonResponse({ name: "Comp A", start_date: "2020-01-01" }))
      .mockResolvedValueOnce(jsonResponse({ name: "Comp B", start_date: "2020-01-02" }));

    const rateLimitState = createRateLimitState();
    const promiseA = fetchWcaCompetitionMeta("CompA", rateLimitState);
    // Let A's first attempt land (and set the shared backoff) before B starts.
    await vi.advanceTimersByTimeAsync(0);
    const promiseB = fetchWcaCompetitionMeta("CompB", rateLimitState);

    await vi.advanceTimersByTimeAsync(5000);
    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

    expect(resultA.name).toBe("Comp A");
    expect(resultB.name).toBe("Comp B");
    // B waited out A's shared backoff window instead of making its own
    // request into it and getting 429'd - exactly 3 fetch calls total: A's
    // 429, A's retry, and B's single (delayed) attempt.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const promise = mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` callbacks at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    const promise = mapWithConcurrency(items, 3, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return item;
    });
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(results).toEqual(items);
  });

  it("handles an empty item list", async () => {
    const results = await mapWithConcurrency([], 4, async (x) => x);
    expect(results).toEqual([]);
  });
});
