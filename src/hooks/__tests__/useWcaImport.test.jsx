// @vitest-environment jsdom
//
// Hook-level tests with a mocked wcaApi.js (no real network calls) -
// exercises the orchestration (fetch -> convert -> dedupe -> persist) and
// the status/summary/error state useWcaImport exposes. Persistence
// integration with the real useCompetitionResults hook is covered
// separately in CompetitionTab.integration.test.jsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWcaImport } from "../useWcaImport.js";

// mapWithConcurrency/WCA_METADATA_FETCH_CONCURRENCY are left as the real
// implementation (only the two fetch calls are mocked) - useWcaImport uses
// them directly and they have no network dependency of their own.
vi.mock("../wcaApi.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchWcaPersonResults: vi.fn(),
    fetchWcaCompetitionMeta: vi.fn(),
  };
});

import { fetchWcaCompetitionMeta, fetchWcaPersonResults } from "../wcaApi.js";

const rawResult = (overrides = {}) => ({
  competition_id: "NewZealandChamps2009",
  event_id: "333",
  round_id: 1,
  best: 1005,
  average: 1374,
  ...overrides,
});

const competitionMeta = { name: "New Zealand Championships 2009", start_date: "2009-07-18" };

function setup({ competitions = [] } = {}) {
  const addCompetitionResult = vi.fn();
  const updateCompetitionResult = vi.fn();
  const { result } = renderHook(() =>
    useWcaImport({ competitions, addCompetitionResult, updateCompetitionResult })
  );
  return { result, addCompetitionResult, updateCompetitionResult };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useWcaImport", () => {
  it("rejects an invalid WCA ID without making any network calls", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.runImport("not-a-wca-id");
    });
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/valid WCA ID/);
    expect(fetchWcaPersonResults).not.toHaveBeenCalled();
  });

  it("imports a new competition result on success", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: competitionMeta.name,
      date: new Date(competitionMeta.start_date).toISOString(),
    });
    const { result, addCompetitionResult } = setup();

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(addCompetitionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        competitionName: "New Zealand Championships 2009",
        event: "3x3x3",
        averageMs: 13740,
        bestMs: 10050,
        source: "wca-import",
        wcaCompetitionId: "NewZealandChamps2009",
      })
    );
    expect(result.current.summary.createdCount).toBe(1);
    expect(result.current.summary.updatedCount).toBe(0);
  });

  it("normalizes a lowercase/whitespace-padded WCA ID before fetching", async () => {
    fetchWcaPersonResults.mockResolvedValue([]);
    const { result } = setup();

    await act(async () => {
      await result.current.runImport("  2009zemd01  ");
    });

    expect(fetchWcaPersonResults).toHaveBeenCalledWith("2009ZEMD01");
  });

  it("skips a result as a duplicate when it was already imported with identical values", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: competitionMeta.name,
      date: new Date(competitionMeta.start_date).toISOString(),
    });
    const existing = [
      {
        id: "c1",
        competitionName: "New Zealand Championships 2009",
        date: new Date(competitionMeta.start_date).toISOString(),
        event: "3x3x3",
        averageMs: 13740,
        bestMs: 10050,
        source: "wca-import",
        wcaCompetitionId: "NewZealandChamps2009",
      },
    ];
    const { result, addCompetitionResult } = setup({ competitions: existing });

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(addCompetitionResult).not.toHaveBeenCalled();
    expect(result.current.summary.skippedDuplicateCount).toBe(1);
  });

  it("updates the existing imported record when the same competition + event was re-imported with new values", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult({ average: 1400 })]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: competitionMeta.name,
      date: new Date(competitionMeta.start_date).toISOString(),
    });
    const existing = [
      {
        id: "c1",
        competitionName: "New Zealand Championships 2009",
        date: new Date(competitionMeta.start_date).toISOString(),
        event: "3x3x3",
        averageMs: 13740, // stale value
        bestMs: 10050,
        source: "wca-import",
        wcaCompetitionId: "NewZealandChamps2009",
      },
    ];
    const { result, updateCompetitionResult, addCompetitionResult } = setup({ competitions: existing });

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(addCompetitionResult).not.toHaveBeenCalled();
    expect(updateCompetitionResult).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ averageMs: 14000, source: "wca-import" })
    );
    expect(result.current.summary.updatedCount).toBe(1);
  });

  it("manual-first then import: does not overwrite a manual record, surfacing it as a conflict", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: competitionMeta.name,
      date: new Date(competitionMeta.start_date).toISOString(),
    });
    const existing = [
      {
        id: "manual-1",
        competitionName: "New Zealand Championships 2009",
        date: new Date(competitionMeta.start_date).toISOString(),
        event: "3x3x3",
        averageMs: 15000, // different value entered manually
        bestMs: 12000,
        source: "manual",
      },
    ];
    const { result, addCompetitionResult, updateCompetitionResult } = setup({ competitions: existing });

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(addCompetitionResult).not.toHaveBeenCalled();
    expect(updateCompetitionResult).not.toHaveBeenCalled();
    expect(result.current.summary.conflictCount).toBe(1);
    expect(result.current.summary.conflicts[0].reason).toContain("New Zealand Championships 2009");
    // The manual record itself is untouched.
    expect(existing[0].averageMs).toBe(15000);
  });

  it("manual-first then import: treats an identical manual record as already present, not a new import", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: competitionMeta.name,
      date: new Date(competitionMeta.start_date).toISOString(),
    });
    const existing = [
      {
        id: "manual-1",
        competitionName: "NZ Champs",
        date: new Date(competitionMeta.start_date).toISOString(),
        event: "3x3x3",
        averageMs: 13740,
        bestMs: 10050,
        source: "manual",
      },
    ];
    const { result, addCompetitionResult } = setup({ competitions: existing });

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(addCompetitionResult).not.toHaveBeenCalled();
    expect(result.current.summary.skippedDuplicateCount).toBe(1);
    expect(result.current.summary.conflictCount).toBe(0);
  });

  it("reports counts for skipped unsupported events and DNF results", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      rawResult({ event_id: "333bf", best: 15768, average: -1 }),
      rawResult({ event_id: "333", average: -1 }),
    ]);
    const { result } = setup();

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.summary.unsupportedEventCount).toBe(1);
    expect(result.current.summary.dnfCount).toBe(1);
    expect(result.current.summary.createdCount).toBe(0);
  });

  it("reports import failure when the WCA ID does not exist (404)", async () => {
    fetchWcaPersonResults.mockRejectedValue(new Error('No WCA competitor found with ID "2009ZEMD01".'));
    const { result } = setup();

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toContain("No WCA competitor found");
  });

  it("reports import failure on a network/timeout error", async () => {
    fetchWcaPersonResults.mockRejectedValue(new Error("Timed out fetching WCA results."));
    const { result } = setup();

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toContain("Timed out");
  });

  it("resets status and summary back to idle", async () => {
    fetchWcaPersonResults.mockResolvedValue([]);
    const { result } = setup();

    await act(async () => {
      await result.current.runImport("2009ZEMD01");
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.summary).toBeNull();
  });
});
