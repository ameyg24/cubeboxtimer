// @vitest-environment jsdom
//
// Integration tests for how record history behaves wired into the real
// persistence layer: computeRecordHistory itself is pure and covered in
// src/analytics/__tests__/records.test.ts. These tests instead exercise the
// property that makes that design safe - records are derived fresh from
// allSolves, never cached separately - across reload, session switching,
// deletion, and penalty edits.
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSolveSessions } from "../useSolveSessions.js";
import { computeRecordHistory, toChronological } from "../../analytics";

const solve = (overrides = {}) => ({
  id: overrides.id || `solve-${Math.random().toString(36).slice(2)}`,
  millis: 10000,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: Date.now(),
  ...overrides,
});

const recordsFor = (allSolves) => computeRecordHistory(toChronological(allSolves));

beforeEach(() => {
  localStorage.clear();
});

// IndexedDB hydration is asynchronous; wait for the default session before
// interacting, and for rehydrated solves after a remount.
const awaitHydration = (result) =>
  waitFor(() => expect(result.current.sessions.length).toBeGreaterThan(0));

describe("record history wired into useSolveSessions", () => {
  it("survives a reload: recomputing after remount matches the pre-reload result", async () => {
    const { result, unmount } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a", millis: 12000, localCreatedAt: 1 }));
      result.current.addSolve(solve({ id: "b", millis: 9000, localCreatedAt: 2 }));
    });
    const before = recordsFor(result.current.allSolves);
    expect(before.currentRecords.single).toMatchObject({ solveId: "b", valueMs: 9000 });

    unmount();

    const { result: reloaded } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await waitFor(() => expect(reloaded.current.allSolves).toHaveLength(2));
    const after = recordsFor(reloaded.current.allSolves);

    expect(after).toEqual(before);
  });

  it("keeps a PB set in one session as the current record after switching to another", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a", millis: 8000, localCreatedAt: 1 }));
    });
    expect(recordsFor(result.current.allSolves).currentRecords.single).toMatchObject({ solveId: "a" });

    act(() => {
      result.current.addSession();
    });
    act(() => {
      // Slower solve in the new session - should not overwrite the record.
      result.current.addSolve(solve({ id: "b", millis: 15000, localCreatedAt: 2 }));
    });

    const records = recordsFor(result.current.allSolves);
    expect(records.currentRecords.single).toMatchObject({ solveId: "a", valueMs: 8000 });
    // Both sessions' solves feed the same all-time record set.
    expect(result.current.allSolves.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("reverts the record after the record-holding solve is deleted", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a", millis: 12000, localCreatedAt: 1 }));
      result.current.addSolve(solve({ id: "b", millis: 9000, localCreatedAt: 2 }));
    });
    expect(recordsFor(result.current.allSolves).currentRecords.single).toMatchObject({ solveId: "b" });

    act(() => {
      // "b" is the most recent solve (index 1) and the current record holder.
      result.current.deleteSolve(1);
    });

    const records = recordsFor(result.current.allSolves);
    expect(records.currentRecords.single).toMatchObject({ solveId: "a", valueMs: 12000 });
  });

  it("reverts the record when the holding solve is marked DNF", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a", millis: 12000, localCreatedAt: 1 }));
      result.current.addSolve(solve({ id: "b", millis: 9000, localCreatedAt: 2 }));
    });
    expect(recordsFor(result.current.allSolves).currentRecords.single).toMatchObject({ solveId: "b" });

    act(() => {
      result.current.updateSolve(1, { penalty: "DNF" });
    });

    const records = recordsFor(result.current.allSolves);
    expect(records.currentRecords.single).toMatchObject({ solveId: "a", valueMs: 12000 });
  });

  it("a +2 penalty can push a solve's effective time past the standing record", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a", millis: 10000, localCreatedAt: 1 }));
      result.current.addSolve(solve({ id: "b", millis: 9000, localCreatedAt: 2 }));
    });
    expect(recordsFor(result.current.allSolves).currentRecords.single).toMatchObject({ solveId: "b", valueMs: 9000 });

    act(() => {
      // 9000 + 2000 penalty = 11000, no longer faster than "a"'s 10000.
      result.current.updateSolve(1, { penalty: "+2" });
    });

    const records = recordsFor(result.current.allSolves);
    expect(records.currentRecords.single).toMatchObject({ solveId: "a", valueMs: 10000 });
  });
});
