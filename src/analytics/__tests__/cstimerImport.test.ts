import { describe, it, expect } from "vitest";
import { filterOutDuplicates, parseCsTimerExport } from "../cstimerImport";
import type { CsTimerParsedSolve, ExistingSolveForDuplicateCheck } from "../cstimerImport";

// csTimer's real export shape: [[penaltyFlag, rawTimeMs], scramble, comment, timestampSeconds].
const entry = (
  penaltyFlag: number,
  rawTimeMs: number,
  timestampSeconds: number | null = 1700000000,
  scramble = "R U R' U'"
) => [[penaltyFlag, rawTimeMs], scramble, "", timestampSeconds];

const exportOf = (entries: unknown[], sessionKey = "session1") => JSON.stringify({ [sessionKey]: entries });

describe("parseCsTimerExport", () => {
  it("parses a normal solve with no penalty", () => {
    const { solves, invalidRowCount, parseError } = parseCsTimerExport(exportOf([entry(0, 12345)]));
    expect(parseError).toBeNull();
    expect(invalidRowCount).toBe(0);
    expect(solves).toEqual([{ millis: 12345, penalty: null, localCreatedAt: 1700000000000 }]);
  });

  it("parses a +2 penalty, keeping the raw pre-penalty time", () => {
    const { solves } = parseCsTimerExport(exportOf([entry(2000, 9800)]));
    expect(solves[0]).toMatchObject({ millis: 9800, penalty: "+2" });
  });

  it("parses a DNF, zeroing millis regardless of any raw time csTimer stored", () => {
    const { solves } = parseCsTimerExport(exportOf([entry(-1, 15000)]));
    expect(solves[0]).toMatchObject({ millis: 0, penalty: "DNF" });
  });

  it("converts csTimer's second-resolution timestamp to a millisecond epoch", () => {
    const { solves } = parseCsTimerExport(exportOf([entry(0, 10000, 1600000000)]));
    expect(solves[0].localCreatedAt).toBe(1600000000000);
  });

  it("treats a missing/invalid timestamp as an invalid row rather than defaulting to now", () => {
    const { solves, invalidRowCount } = parseCsTimerExport(exportOf([entry(0, 10000, null)]));
    expect(solves).toHaveLength(0);
    expect(invalidRowCount).toBe(1);
  });

  it("rejects a non-positive or non-finite time for a non-DNF solve", () => {
    const { invalidRowCount } = parseCsTimerExport(
      JSON.stringify({
        session1: [entry(0, 0), entry(0, -500), [[0, NaN], "", "", 1700000000]],
      })
    );
    expect(invalidRowCount).toBe(3);
  });

  it("rejects an unrecognized penalty flag", () => {
    const { solves, invalidRowCount } = parseCsTimerExport(exportOf([entry(9999, 10000)]));
    expect(solves).toHaveLength(0);
    expect(invalidRowCount).toBe(1);
  });

  it("rejects a malformed row shape (too short, wrong types) without crashing", () => {
    const malformed = JSON.stringify({
      session1: [
        [[0, 10000]], // missing scramble/comment/timestamp
        "not an array",
        null,
        42,
        [["not", "a", "number", "pair"], "", "", 1700000000],
      ],
    });
    const { solves, invalidRowCount } = parseCsTimerExport(malformed);
    expect(solves).toHaveLength(0);
    expect(invalidRowCount).toBe(5);
  });

  it("flattens multiple sessions into one solve list", () => {
    const raw = JSON.stringify({
      session1: [entry(0, 10000)],
      session2: [entry(0, 9000), entry(-1, 0)],
    });
    const { solves } = parseCsTimerExport(raw);
    expect(solves).toHaveLength(3);
  });

  it("ignores non-array top-level values (like a real export's 'properties' key) without counting them as invalid", () => {
    const raw = JSON.stringify({
      session1: [entry(0, 10000)],
      properties: { sessionData: "{}", theme: "dark" },
    });
    const { solves, invalidRowCount } = parseCsTimerExport(raw);
    expect(solves).toHaveLength(1);
    expect(invalidRowCount).toBe(0);
  });

  it("accepts a bare array as a single session's export", () => {
    const raw = JSON.stringify([entry(0, 10000), entry(2000, 9500)]);
    const { solves, parseError } = parseCsTimerExport(raw);
    expect(parseError).toBeNull();
    expect(solves).toHaveLength(2);
  });

  it("reports a parse error for input that isn't valid JSON", () => {
    const { solves, parseError } = parseCsTimerExport("not json at all {{{");
    expect(solves).toHaveLength(0);
    expect(parseError).toMatch(/Could not parse/);
  });

  it("reports a parse error for empty input", () => {
    const { parseError } = parseCsTimerExport("");
    expect(parseError).toMatch(/Paste or upload/);
  });

  it("reports a parse error for valid JSON with no solve arrays at all", () => {
    const { parseError } = parseCsTimerExport(JSON.stringify({ properties: {} }));
    expect(parseError).toMatch(/No csTimer solve data/);
  });

  it("tolerates non-string input defensively", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    const { solves, parseError } = parseCsTimerExport(null);
    expect(solves).toEqual([]);
    expect(parseError).not.toBeNull();
  });
});

describe("filterOutDuplicates", () => {
  const solve = (localCreatedAt: number, millis: number, penalty: CsTimerParsedSolve["penalty"] = null): CsTimerParsedSolve => ({
    millis,
    penalty,
    localCreatedAt,
  });

  it("passes through everything when there are no existing solves", () => {
    const parsed = [solve(1000, 9000), solve(2000, 8500)];
    const { toImport, duplicateCount } = filterOutDuplicates(parsed, []);
    expect(toImport).toEqual(parsed);
    expect(duplicateCount).toBe(0);
  });

  it("skips a solve matching an existing one on timestamp, time, and penalty", () => {
    const existing: ExistingSolveForDuplicateCheck[] = [{ millis: 9000, penalty: null, localCreatedAt: 1000 }];
    const parsed = [solve(1000, 9000, null)];
    const { toImport, duplicateCount } = filterOutDuplicates(parsed, existing);
    expect(toImport).toHaveLength(0);
    expect(duplicateCount).toBe(1);
  });

  it("does not treat solves with the same timestamp+time but a different penalty as duplicates", () => {
    const existing: ExistingSolveForDuplicateCheck[] = [{ millis: 9000, penalty: null, localCreatedAt: 1000 }];
    const parsed = [solve(1000, 9000, "+2")];
    const { toImport, duplicateCount } = filterOutDuplicates(parsed, existing);
    expect(toImport).toHaveLength(1);
    expect(duplicateCount).toBe(0);
  });

  it("does not treat solves with the same time+penalty but a different timestamp as duplicates", () => {
    const existing: ExistingSolveForDuplicateCheck[] = [{ millis: 9000, penalty: null, localCreatedAt: 1000 }];
    const parsed = [solve(2000, 9000, null)];
    const { toImport } = filterOutDuplicates(parsed, existing);
    expect(toImport).toHaveLength(1);
  });

  it("catches duplicates within the same import batch, not just against prior imports", () => {
    const parsed = [solve(1000, 9000), solve(1000, 9000)];
    const { toImport, duplicateCount } = filterOutDuplicates(parsed, []);
    expect(toImport).toHaveLength(1);
    expect(duplicateCount).toBe(1);
  });

  it("ignores existing solves with no localCreatedAt when building the duplicate signature set", () => {
    const existing: ExistingSolveForDuplicateCheck[] = [{ millis: 9000, penalty: null }];
    const parsed = [solve(1000, 9000, null)];
    const { toImport } = filterOutDuplicates(parsed, existing);
    expect(toImport).toHaveLength(1);
  });
});
