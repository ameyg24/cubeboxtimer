// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSolveSessions } from "../useSolveSessions.js";
import { createIndexedDbRepository } from "../../storage/indexedDb";

// These tests exercise the hook with no signed-in user, which is the
// local-persistence code path - real Firebase config is absent in this
// environment, so src/firebase/config.js already falls back to a null db,
// and the hook's own `if (!user)` branch never touches Firestore either
// way. Durable data lives in IndexedDB (fake-indexeddb in tests); seeding
// the legacy localStorage key exercises the one-time migration.

const STORAGE_KEY = "cubeboxtimer_sessions";
const ACTIVE_KEY = "cubeboxtimer_activeSessionId";
const QUEUE_KEY = "cbt_write_queue";

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
});

// Hydration is asynchronous (IndexedDB), so tests wait for it before
// interacting: the hook always ends hydration with at least one session
// (the default). The durable snapshot is read back through the repository.
const awaitHydration = (result) =>
  waitFor(() => expect(result.current.sessions.length).toBeGreaterThan(0));
const readStored = () => createIndexedDbRepository().loadSessions();

describe("useSolveSessions", () => {
  it("creates a default session when nothing is persisted", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.eventSolves).toEqual([]);
    expect(result.current.activeSessionId).toBe(result.current.sessions[0].id);
  });

  it("rehydrates sessions already saved in localStorage", async () => {
    const saved = [
      {
        id: "s1",
        name: "Morning practice",
        createdAt: 1000,
        solves: { "2x2x2": [], "3x3x3": [solve({ id: "a" })], "4x4x4": [], "5x5x5": [] },
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    localStorage.setItem(ACTIVE_KEY, "s1");

    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0].name).toBe("Morning practice");
    expect(result.current.eventSolves).toHaveLength(1);
  });

  it("records a solve and persists it", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "s1", millis: 12340 }));
    });

    expect(result.current.eventSolves).toHaveLength(1);
    expect(result.current.eventSolves[0].millis).toBe(12340);

    await waitFor(async () => {
      const persisted = await readStored();
      expect(persisted[0].solves["3x3x3"]).toHaveLength(1);
    });
  });

  it("queues an offline write and reflects it as pending until a user signs in", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "s1" }));
    });

    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(queue.some((item) => item.type === "createSolve" && item.solveId === "s1")).toBe(true);
    expect(result.current.syncStatus.state).toBe("auth");
  });

  it("toggles a +2 penalty on a specific solve without touching the others", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a", millis: 10000 }));
      result.current.addSolve(solve({ id: "b", millis: 11000 }));
    });
    act(() => {
      result.current.updateSolve(1, { penalty: "+2" });
    });

    expect(result.current.eventSolves[0].penalty).toBeNull();
    expect(result.current.eventSolves[1].penalty).toBe("+2");
  });

  it("marks a solve DNF", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a" }));
    });
    act(() => {
      result.current.updateSolve(0, { penalty: "DNF" });
    });

    expect(result.current.eventSolves[0].penalty).toBe("DNF");
  });

  it("deletes a solve by index", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a" }));
      result.current.addSolve(solve({ id: "b" }));
    });
    act(() => {
      result.current.deleteSolve(0);
    });

    expect(result.current.eventSolves).toHaveLength(1);
    expect(result.current.eventSolves[0].id).toBe("b");
  });

  it("adds a solve to an explicit event override, independent of the currently active cubeDimension", async () => {
    const { result, rerender } = renderHook(
      ({ cubeDimension }) => useSolveSessions({ user: null, cubeDimension }),
      { initialProps: { cubeDimension: "3x3x3" } }
    );
    await awaitHydration(result);

    act(() => {
      // Backfilling a 4x4x4 practice solve while the header is on 3x3x3 -
      // the manual "Add past solve" form's whole point.
      result.current.addSolve(solve({ id: "a", cubeDimension: "4x4x4" }), "4x4x4");
    });

    expect(result.current.eventSolves).toHaveLength(0);
    await waitFor(async () => {
      const persisted = await readStored();
      expect(persisted[0].solves["4x4x4"]).toHaveLength(1);
      expect(persisted[0].solves["3x3x3"]).toHaveLength(0);
    });

    rerender({ cubeDimension: "4x4x4" });
    expect(result.current.eventSolves).toHaveLength(1);
    expect(result.current.eventSolves[0].id).toBe("a");
  });

  it("ignores an invalid dimension override and falls back to the active cubeDimension", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a" }), "not-a-real-dimension");
    });

    expect(result.current.eventSolves).toHaveLength(1);
  });

  it("keeps solves for different cube sizes separate", async () => {
    const { result, rerender } = renderHook(
      ({ cubeDimension }) => useSolveSessions({ user: null, cubeDimension }),
      { initialProps: { cubeDimension: "3x3x3" } }
    );
    await awaitHydration(result);

    act(() => {
      result.current.addSolve(solve({ id: "a", cubeDimension: "3x3x3" }));
    });
    expect(result.current.eventSolves).toHaveLength(1);

    rerender({ cubeDimension: "2x2x2" });
    expect(result.current.eventSolves).toHaveLength(0);

    rerender({ cubeDimension: "3x3x3" });
    expect(result.current.eventSolves).toHaveLength(1);
  });

  it("adds a new session and makes it active", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);
    const originalId = result.current.activeSessionId;

    act(() => {
      result.current.addSession();
    });

    expect(result.current.sessions).toHaveLength(2);
    expect(result.current.activeSessionId).not.toBe(originalId);
  });

  it("refuses to remove the only remaining session", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);
    const onlyId = result.current.activeSessionId;

    act(() => {
      result.current.removeSession(onlyId);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.activeSessionId).toBe(onlyId);
  });

  it("falls back to another session after removing the active one", async () => {
    const { result } = renderHook(() => useSolveSessions({ user: null, cubeDimension: "3x3x3" }));
    await awaitHydration(result);
    const firstId = result.current.activeSessionId;

    act(() => {
      result.current.addSession();
    });
    const secondId = result.current.activeSessionId;

    act(() => {
      result.current.removeSession(secondId);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.activeSessionId).toBe(firstId);
  });
});
