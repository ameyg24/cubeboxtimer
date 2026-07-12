// @vitest-environment jsdom
//
// Signed-out to signed-in transition: IndexedDB hydration happens first,
// offline mutations queue up, then a user signs in and the first Firestore
// snapshot arrives. The pending-queue overlay must keep local changes
// visible (and still queued) whether the remote side is empty or already
// has data - the snapshot replaces state wholesale, so the overlay is the
// only thing standing between a queued write and a lost one.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Deterministic Firestore stand-in: onSnapshot captures its listener so the
// test delivers snapshots by hand; the write-side functions resolve inertly.
const snapshotListeners = [];
vi.mock("firebase/firestore", () => ({
  collection: (...segments) => ({ kind: "collection", segments }),
  query: (target) => ({ kind: "query", target }),
  orderBy: () => ({ kind: "orderBy" }),
  doc: (...segments) => ({ kind: "doc", segments }),
  setDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  serverTimestamp: () => ({ kind: "serverTimestamp" }),
  onSnapshot: vi.fn((target, next, error) => {
    snapshotListeners.push({ target, next, error });
    return () => {};
  }),
}));
// db must be truthy so the hooks take the authed branch.
vi.mock("../../firebase/config", () => ({
  db: {},
  auth: null,
  provider: null,
  firebaseProjectId: "test-project",
}));

import { useSolveSessions } from "../useSolveSessions.js";
import { useCompetitionResults } from "../useCompetitionResults.js";

// getIdToken rejects, so the REST flush fails cleanly and the queue is
// provably retained rather than drained mid-assertion.
const user = { uid: "u1", getIdToken: vi.fn().mockRejectedValue(new Error("offline token")) };

const querySnapshotOf = (docs) => ({
  forEach: (cb) => docs.forEach((d) => cb(d)),
});

const solve = (overrides = {}) => ({
  id: overrides.id || `solve-${Math.random().toString(36).slice(2)}`,
  millis: 10000,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: Date.now(),
  ...overrides,
});

beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  localStorage.clear();
  snapshotListeners.length = 0;
  vi.clearAllMocks();
});

describe("signed-out to signed-in transition", () => {
  it("keeps an offline solve visible and queued when the first (empty) Firestore snapshot arrives", async () => {
    const { result, rerender } = renderHook(
      ({ currentUser }) => useSolveSessions({ user: currentUser, cubeDimension: "3x3x3" }),
      { initialProps: { currentUser: null } }
    );
    await waitFor(() => expect(result.current.sessions.length).toBeGreaterThan(0));

    act(() => {
      result.current.addSolve(solve({ id: "offline-1", millis: 12340 }));
    });
    expect(result.current.eventSolves.map((s) => s.id)).toEqual(["offline-1"]);

    rerender({ currentUser: user });
    await waitFor(() => expect(snapshotListeners.length).toBeGreaterThan(0));

    // First remote snapshot: the account has no sessions at all.
    await act(async () => {
      snapshotListeners[0].next(querySnapshotOf([]));
    });

    // The overlay reconstructs the offline solve's session from the queue.
    expect(result.current.allSolves.map((s) => s.id)).toContain("offline-1");
    const queue = JSON.parse(localStorage.getItem("cbt_write_queue"));
    expect(queue.some((item) => item.type === "createSolve" && item.solveId === "offline-1")).toBe(true);
  });

  it("overlays queued local solves on top of a remote session snapshot without losing either side", async () => {
    const { result, rerender } = renderHook(
      ({ currentUser }) => useSolveSessions({ user: currentUser, cubeDimension: "3x3x3" }),
      { initialProps: { currentUser: null } }
    );
    await waitFor(() => expect(result.current.sessions.length).toBeGreaterThan(0));

    act(() => {
      result.current.addSolve(solve({ id: "offline-1", millis: 12340 }));
    });

    rerender({ currentUser: user });
    await waitFor(() => expect(snapshotListeners.length).toBeGreaterThan(0));

    // Remote sessions arrive, then the per-session solves subcollection
    // snapshot - exactly the two-level listener shape the hook subscribes.
    await act(async () => {
      snapshotListeners[0].next(
        querySnapshotOf([
          {
            id: "remote-session",
            data: () => ({ name: "Remote", createdAt: { toMillis: () => 500 }, solvesMigrated: true }),
          },
        ])
      );
    });
    await waitFor(() => expect(snapshotListeners.length).toBeGreaterThan(1));
    await act(async () => {
      snapshotListeners[1].next(
        querySnapshotOf([
          {
            id: "remote-a",
            data: () => ({ id: "remote-a", millis: 11000, cubeDimension: "3x3x3", localCreatedAt: 400 }),
          },
        ])
      );
    });

    const allIds = result.current.allSolves.map((s) => s.id);
    expect(allIds).toContain("remote-a");
    expect(allIds).toContain("offline-1");
    const queue = JSON.parse(localStorage.getItem("cbt_write_queue"));
    expect(queue.some((item) => item.solveId === "offline-1")).toBe(true);
  });

  it("keeps an offline competition result visible and queued across the transition", async () => {
    const { result, rerender } = renderHook(
      ({ currentUser }) => useCompetitionResults({ user: currentUser }),
      { initialProps: { currentUser: null } }
    );
    await act(async () => {});

    act(() => {
      result.current.addCompetitionResult({
        competitionName: "Offline Open",
        date: "2026-03-01T00:00:00.000Z",
        event: "3x3x3",
        bestMs: 9000,
        averageMs: 11000,
        source: "manual",
      });
    });
    expect(result.current.competitions).toHaveLength(1);

    rerender({ currentUser: user });
    await waitFor(() => expect(snapshotListeners.length).toBeGreaterThan(0));

    await act(async () => {
      snapshotListeners[0].next(querySnapshotOf([]));
    });

    expect(result.current.competitions.map((c) => c.competitionName)).toEqual(["Offline Open"]);
    const queue = JSON.parse(localStorage.getItem("cbt_competition_write_queue"));
    expect(queue.some((item) => item.type === "createCompetition")).toBe(true);
  });
});
