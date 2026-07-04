// @vitest-environment jsdom
//
// Hook-level tests with a mocked getExistingSolvesForDimension/addSolve (no
// real persistence) - exercises the orchestration (parse -> dedupe ->
// persist) and the status/summary/error state useCsTimerImport exposes.
// Persistence integration with the real useSolveSessions hook is covered
// separately in CsTimerImport.integration.test.jsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCsTimerImport } from "../useCsTimerImport.js";

const entry = (penaltyFlag, rawTimeMs, timestampSeconds = 1700000000, scramble = "R U R' U'") => [
  [penaltyFlag, rawTimeMs],
  scramble,
  "",
  timestampSeconds,
];

const exportOf = (entries) => JSON.stringify({ session1: entries });

function setup({ existingSolves = [] } = {}) {
  const addSolve = vi.fn();
  const getExistingSolvesForDimension = vi.fn(() => existingSolves);
  const { result } = renderHook(() => useCsTimerImport({ getExistingSolvesForDimension, addSolve }));
  return { result, addSolve, getExistingSolvesForDimension };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCsTimerImport", () => {
  it("imports every valid solve through addSolve, targeting the chosen cube dimension", () => {
    const { result, addSolve } = setup();

    act(() => {
      result.current.runImport(exportOf([entry(0, 12345), entry(2000, 9800), entry(-1, 0)]), "3x3x3");
    });

    expect(result.current.status).toBe("success");
    expect(addSolve).toHaveBeenCalledTimes(3);
    expect(addSolve).toHaveBeenCalledWith(
      expect.objectContaining({ millis: 12345, penalty: null, cubeDimension: "3x3x3" }),
      "3x3x3"
    );
    expect(addSolve).toHaveBeenCalledWith(
      expect.objectContaining({ millis: 9800, penalty: "+2", cubeDimension: "3x3x3" }),
      "3x3x3"
    );
    expect(addSolve).toHaveBeenCalledWith(
      expect.objectContaining({ millis: 0, penalty: "DNF", cubeDimension: "3x3x3" }),
      "3x3x3"
    );
    expect(result.current.summary).toEqual({ importedCount: 3, duplicateCount: 0, invalidRowCount: 0 });
  });

  it("assigns each imported solve a fresh id and marks it reviewed", () => {
    const { result, addSolve } = setup();
    act(() => {
      result.current.runImport(exportOf([entry(0, 10000)]), "3x3x3");
    });
    const [solveArg] = addSolve.mock.calls[0];
    expect(typeof solveArg.id).toBe("string");
    expect(solveArg.id.length).toBeGreaterThan(0);
    expect(solveArg.reviewed).toBe(true);
  });

  it("reports invalid rows without importing them", () => {
    const { result, addSolve } = setup();
    act(() => {
      result.current.runImport(
        exportOf([entry(0, 10000), entry(0, -5), [[9999, 1], "", "", 1700000000]]),
        "3x3x3"
      );
    });
    expect(addSolve).toHaveBeenCalledTimes(1);
    expect(result.current.summary).toEqual({ importedCount: 1, duplicateCount: 0, invalidRowCount: 2 });
  });

  it("skips solves that already exist for the target dimension", () => {
    const existingSolves = [{ millis: 12345, penalty: null, localCreatedAt: 1700000000000 }];
    const { result, addSolve } = setup({ existingSolves });

    act(() => {
      result.current.runImport(exportOf([entry(0, 12345), entry(0, 9999)]), "3x3x3");
    });

    expect(addSolve).toHaveBeenCalledTimes(1);
    expect(addSolve).toHaveBeenCalledWith(expect.objectContaining({ millis: 9999 }), "3x3x3");
    expect(result.current.summary).toEqual({ importedCount: 1, duplicateCount: 1, invalidRowCount: 0 });
  });

  it("checks duplicates against the dimension actually being imported into", () => {
    const { getExistingSolvesForDimension, result } = setup();
    act(() => {
      result.current.runImport(exportOf([entry(0, 10000)]), "4x4x4");
    });
    expect(getExistingSolvesForDimension).toHaveBeenCalledWith("4x4x4");
  });

  it("reports a parse error and does not call addSolve for unparseable input", () => {
    const { result, addSolve } = setup();
    act(() => {
      result.current.runImport("not valid json {{{", "3x3x3");
    });
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/Could not parse/);
    expect(addSolve).not.toHaveBeenCalled();
    expect(result.current.summary).toBeNull();
  });

  it("resets status, summary, and error back to idle", () => {
    const { result } = setup();
    act(() => {
      result.current.runImport(exportOf([entry(0, 10000)]), "3x3x3");
    });
    expect(result.current.status).toBe("success");

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.summary).toBeNull();
    expect(result.current.errorMessage).toBe("");
  });
});
