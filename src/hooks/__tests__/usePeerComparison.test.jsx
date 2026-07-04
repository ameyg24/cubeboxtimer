// @vitest-environment jsdom
//
// Hook-level tests with a mocked wcaApi.js (no real network calls) -
// exercises the fetch -> convert -> collapse -> predict pipeline and the
// status/result/error state usePeerComparison exposes. Nothing here is
// persisted (see the hook's own comment for why), so unlike
// useWcaImport.test.jsx there's no addCompetitionResult/updateCompetitionResult
// to assert against - only the returned `result` (a PeerPredictionResult).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePeerComparison } from "../usePeerComparison.js";

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
  name: "Feliks Zemdegs",
  competition_id: "NewZealandChamps2009",
  event_id: "333",
  round_id: 1,
  best: 1005,
  average: 1374,
  ...overrides,
});

const competitionMeta = { name: "New Zealand Championships 2009", date: "2009-07-18T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePeerComparison", () => {
  it("rejects an invalid WCA ID without making any network calls", async () => {
    const { result } = renderHook(() => usePeerComparison());
    await act(async () => {
      await result.current.compare("not-a-wca-id", "3x3x3");
    });
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/valid WCA ID/);
    expect(fetchWcaPersonResults).not.toHaveBeenCalled();
  });

  it("builds a prediction from a single competition's result, carrying through the person's name", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue(competitionMeta);
    const { result } = renderHook(() => usePeerComparison());

    await act(async () => {
      await result.current.compare("2009ZEMD01", "3x3x3");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.result.personName).toBe("Feliks Zemdegs");
    expect(result.current.result.wcaId).toBe("2009ZEMD01");
    expect(result.current.result.event).toBe("3x3x3");
    expect(result.current.result.competitionsUsed).toBe(1);
    expect(result.current.result.history).toEqual([
      {
        id: "NewZealandChamps2009",
        competitionName: "New Zealand Championships 2009",
        date: competitionMeta.date,
        averageMs: 13740,
        bestMs: 10050,
      },
    ]);
  });

  it("collapses a competition's multiple rounds into one history entry before predicting", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      rawResult({ round_id: 1, average: 1500 }),
      rawResult({ round_id: 2, average: 1374 }),
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue(competitionMeta);
    const { result } = renderHook(() => usePeerComparison());

    await act(async () => {
      await result.current.compare("2009ZEMD01", "3x3x3");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.result.history).toHaveLength(1);
    expect(result.current.result.competitionsUsed).toBe(1);
  });

  it("only considers results for the requested event", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      rawResult({ competition_id: "CompA", event_id: "333", average: 1374 }),
      rawResult({ competition_id: "CompB", event_id: "222", average: 700 }),
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue(competitionMeta);
    const { result } = renderHook(() => usePeerComparison());

    await act(async () => {
      await result.current.compare("2009ZEMD01", "3x3x3");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.result.competitionsUsed).toBe(1);
    expect(result.current.result.history[0].averageMs).toBe(13740);
  });

  it("tracks metadata-fetch progress and clears it once finished", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      rawResult({ competition_id: "CompA" }),
      rawResult({ competition_id: "CompB" }),
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue(competitionMeta);
    const { result } = renderHook(() => usePeerComparison());

    expect(result.current.progress).toBeNull();
    await act(async () => {
      await result.current.compare("2009ZEMD01", "3x3x3");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.progress).toBeNull();
  });

  it("reports a clear error when the WCA ID does not exist", async () => {
    fetchWcaPersonResults.mockRejectedValue(new Error('No WCA competitor found with ID "9999XXXX99".'));
    const { result } = renderHook(() => usePeerComparison());

    await act(async () => {
      await result.current.compare("9999XXXX99", "3x3x3");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toContain("No WCA competitor found");
  });

  it("does not persist anything - no addCompetitionResult-style side effects are possible since the hook takes none", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue(competitionMeta);
    const { result } = renderHook(() => usePeerComparison());

    await act(async () => {
      await result.current.compare("2009ZEMD01", "3x3x3");
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    // The hook's only outputs are status/result/errorMessage/progress - there
    // is no persistence callback to invoke in the first place.
    expect(Object.keys(result.current).sort()).toEqual(
      ["compare", "errorMessage", "progress", "reset", "result", "status"].sort()
    );
  });

  it("resets status and result back to idle", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue(competitionMeta);
    const { result } = renderHook(() => usePeerComparison());

    await act(async () => {
      await result.current.compare("2009ZEMD01", "3x3x3");
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
  });
});
