// @vitest-environment jsdom
//
// IndexedDB failure behavior, isolated in its own file: with IndexedDB
// broken, no persist ever fires, so nothing here can race the assertions
// (in a shared file, an earlier test's fire-and-forget persist can land
// after localStorage.clear() and leak a "complete" migration marker in).
//
// The contract under storage failure: the app keeps running in memory, the
// persist gate stays closed (a failed read must never unlock snapshot
// writes that could overwrite a store the app could not read), legacy data
// and the migration marker are preserved for the next healthy launch, and
// new mutations still reach the durable localStorage write queue.
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSolveSessions } from "../useSolveSessions.js";
import { useCompetitionResults } from "../useCompetitionResults.js";

const SESSIONS_KEY = "cubeboxtimer_sessions";
const COMPETITIONS_KEY = "cubeboxtimer_competitions";

const solve = (overrides = {}) => ({
  id: overrides.id || `solve-${Math.random().toString(36).slice(2)}`,
  millis: 10000,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: Date.now(),
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = {
    open: () => {
      throw new Error("IndexedDB unavailable");
    },
  };
});

describe("useSolveSessions when IndexedDB cannot open", () => {
  it("keeps running in memory, preserves legacy data, and keeps the persist gate closed", async () => {
    const saved = [
      {
        id: "s1",
        name: "Legacy",
        createdAt: 1000,
        solves: { "2x2x2": [], "3x3x3": [solve({ id: "a" })], "4x4x4": [], "5x5x5": [] },
      },
    ];
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(saved));

    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));

    // The app stays usable (fresh default session), but hydrated stays
    // false - the persist gate never opens after a failed read.
    await waitFor(() => expect(result.current.sessions.length).toBeGreaterThan(0));
    expect(result.current.hydrated).toBe(false);

    // Legacy data is untouched and the migration is not marked complete,
    // so the next healthy launch migrates it.
    expect(JSON.parse(localStorage.getItem(SESSIONS_KEY))).toEqual(saved);
    expect(localStorage.getItem("cbt_idb_migration")).not.toBe("complete");

    // New solves still work and are durably queued for replay.
    act(() => {
      result.current.addSolve(solve({ id: "while-broken", millis: 9000 }));
    });
    expect(result.current.eventSolves.some((s) => s.id === "while-broken")).toBe(true);
    expect(
      JSON.parse(localStorage.getItem("cbt_write_queue")).some(
        (item) => item.solveId === "while-broken"
      )
    ).toBe(true);
  });
});

describe("useCompetitionResults when IndexedDB cannot open", () => {
  it("keeps running in memory, preserves legacy data, and keeps the persist gate closed", async () => {
    const saved = [
      {
        id: "c1",
        competitionName: "Legacy Comp",
        date: "2026-01-15T00:00:00.000Z",
        event: "3x3x3",
        bestMs: 8500,
        averageMs: 9800,
        source: "manual",
      },
    ];
    localStorage.setItem(COMPETITIONS_KEY, JSON.stringify(saved));

    const { result } = renderHook(() => useCompetitionResults({ user: null }));
    await act(async () => {});

    expect(result.current.hydrated).toBe(false);
    expect(JSON.parse(localStorage.getItem(COMPETITIONS_KEY))).toEqual(saved);
    expect(localStorage.getItem("cbt_idb_migration")).not.toBe("complete");

    act(() => {
      result.current.addCompetitionResult({
        competitionName: "While Broken Open",
        date: "2026-03-01T00:00:00.000Z",
        event: "3x3x3",
        bestMs: 9000,
        averageMs: 11000,
        source: "manual",
      });
    });
    expect(result.current.competitions).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("cbt_competition_write_queue"))).toHaveLength(1);
  });
});
