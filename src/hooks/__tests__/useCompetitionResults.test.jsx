// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCompetitionResults } from "../useCompetitionResults.js";

// Mirrors useSolveSessions.test.jsx: these tests exercise the hook with no
// signed-in user, which is the localStorage-only code path - real Firebase
// config is absent in this environment, so the hook's own `if (!user)`
// branch never touches Firestore either way.

const STORAGE_KEY = "cubeboxtimer_competitions";
const QUEUE_KEY = "cbt_competition_write_queue";

const competitionInput = (overrides = {}) => ({
  competitionName: "Local Open 2026",
  date: "2026-03-01T00:00:00.000Z",
  event: "3x3x3",
  bestMs: 9000,
  averageMs: 11000,
  source: "manual",
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe("useCompetitionResults", () => {
  it("starts with an empty list when nothing is persisted", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    expect(result.current.competitions).toEqual([]);
    expect(result.current.syncStatus.state).toBe("synced");
  });

  it("rehydrates competition results already saved in localStorage", () => {
    const saved = [
      {
        id: "c1",
        competitionName: "Winter Cubing 2026",
        date: "2026-01-15T00:00:00.000Z",
        event: "3x3x3",
        bestMs: 8500,
        averageMs: 9800,
        source: "manual",
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    expect(result.current.competitions).toHaveLength(1);
    expect(result.current.competitions[0].competitionName).toBe("Winter Cubing 2026");
  });

  it("adds a competition result and persists it", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput());
    });

    expect(result.current.competitions).toHaveLength(1);
    expect(result.current.competitions[0].competitionName).toBe("Local Open 2026");
    expect(result.current.competitions[0].source).toBe("manual");

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].averageMs).toBe(11000);
  });

  it("assigns a generated id when none is supplied", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput());
    });

    expect(result.current.competitions[0].id).toBeTruthy();
  });

  it("queues an offline write and reflects it as pending until a user signs in", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput());
    });

    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY));
    const competitionId = result.current.competitions[0].id;
    expect(queue.some((item) => item.type === "createCompetition" && item.competitionId === competitionId)).toBe(
      true
    );
    expect(result.current.syncStatus.state).toBe("auth");
  });

  it("edits a competition result and persists the patch", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput());
    });
    const id = result.current.competitions[0].id;

    act(() => {
      result.current.updateCompetitionResult(id, { averageMs: 10500, notes: "Better than expected." });
    });

    expect(result.current.competitions[0].averageMs).toBe(10500);
    expect(result.current.competitions[0].notes).toBe("Better than expected.");
    expect(result.current.competitions[0].bestMs).toBe(9000); // untouched fields survive the patch

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(persisted[0].averageMs).toBe(10500);
  });

  it("merges a queued edit into a still-pending create instead of appending a second entry", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput());
    });
    const id = result.current.competitions[0].id;

    act(() => {
      result.current.updateCompetitionResult(id, { averageMs: 10500 });
    });

    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe("createCompetition");
    expect(queue[0].competition.averageMs).toBe(10500);
  });

  it("deletes a competition result", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput({ competitionName: "A" }));
      result.current.addCompetitionResult(competitionInput({ competitionName: "B", date: "2026-04-01T00:00:00.000Z" }));
    });
    expect(result.current.competitions).toHaveLength(2);

    const idToDelete = result.current.competitions[0].id;
    act(() => {
      result.current.deleteCompetitionResult(idToDelete);
    });

    expect(result.current.competitions).toHaveLength(1);
    expect(result.current.competitions[0].competitionName).toBe("B");
  });

  it("deleting a still-pending (never-synced) create removes it from the queue entirely", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput());
    });
    const id = result.current.competitions[0].id;

    act(() => {
      result.current.deleteCompetitionResult(id);
    });

    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY));
    expect(queue).toHaveLength(0);
  });

  it("reflects queued offline writes again after a simulated reload", () => {
    const { result, unmount } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput());
    });
    unmount();

    const { result: reloaded } = renderHook(() => useCompetitionResults({ user: null }));

    expect(reloaded.current.competitions).toHaveLength(1);
    expect(reloaded.current.competitions[0].competitionName).toBe("Local Open 2026");
  });

  it("keeps multiple competitions for different events independent", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput({ event: "3x3x3", competitionName: "3x3 comp" }));
      result.current.addCompetitionResult(competitionInput({ event: "2x2x2", competitionName: "2x2 comp" }));
    });

    const events = result.current.competitions.map((c) => c.event).sort();
    expect(events).toEqual(["2x2x2", "3x3x3"]);
  });

  it("sorts competitions chronologically by date", () => {
    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    act(() => {
      result.current.addCompetitionResult(competitionInput({ competitionName: "Later", date: "2026-06-01T00:00:00.000Z" }));
      result.current.addCompetitionResult(competitionInput({ competitionName: "Earlier", date: "2026-01-01T00:00:00.000Z" }));
    });

    expect(result.current.competitions.map((c) => c.competitionName)).toEqual(["Earlier", "Later"]);
  });

  it("normalizes a malformed persisted doc defensively instead of crashing (migration-readiness seam)", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "legacy-1" /* missing every other field */ }])
    );

    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    expect(result.current.competitions).toHaveLength(1);
    expect(result.current.competitions[0].source).toBe("manual");
    expect(result.current.competitions[0].event).toBe("3x3x3");
    expect(result.current.competitions[0].bestMs).toBeNull();
    expect(result.current.competitions[0].averageMs).toBeNull();
  });

  it("tolerates a corrupted localStorage payload and starts empty rather than throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");

    const { result } = renderHook(() => useCompetitionResults({ user: null }));

    expect(result.current.competitions).toEqual([]);
  });
});
