import { describe, it, expect } from "vitest";
import {
  buildImportCandidates,
  checkForDuplicateOrConflict,
  decideImportAction,
  findLinkedWcaId,
  isValidWcaId,
  mapWcaEventToCubeDimension,
  namesAreSimilar,
  normalizeWcaId,
  selectFinalRoundResults,
  wcaCentisecondsToMs,
} from "../wcaImport";
import type { PersistedCompetitionResultLike, WcaImportCandidate, WcaRawResult } from "../wcaImport";

describe("normalizeWcaId / isValidWcaId", () => {
  it("accepts a well-formed WCA ID", () => {
    expect(isValidWcaId("2009ZEMD01")).toBe(true);
  });

  it("normalizes case and surrounding whitespace before validating", () => {
    expect(normalizeWcaId("  2009zemd01  ")).toBe("2009ZEMD01");
    expect(isValidWcaId("  2009zemd01  ")).toBe(true);
  });

  it("rejects a WCA ID with the wrong number of digits or letters", () => {
    expect(isValidWcaId("200ZEMD01")).toBe(false);
    expect(isValidWcaId("2009ZEM01")).toBe(false);
    expect(isValidWcaId("2009ZEMD1")).toBe(false);
  });

  it("rejects an ID with digits in the name segment", () => {
    expect(isValidWcaId("2009ZE1D01")).toBe(false);
  });

  it("rejects non-string input defensively", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    expect(isValidWcaId(undefined)).toBe(false);
    // @ts-expect-error exercising defensive guard against bad runtime input
    expect(isValidWcaId(null)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidWcaId("")).toBe(false);
  });
});

describe("wcaCentisecondsToMs", () => {
  it("converts a normal positive time from centiseconds to milliseconds", () => {
    expect(wcaCentisecondsToMs(1005)).toBe(10050);
  });

  it("maps DNF (-1) to null", () => {
    expect(wcaCentisecondsToMs(-1)).toBeNull();
  });

  it("maps DNS (-2) to null", () => {
    expect(wcaCentisecondsToMs(-2)).toBeNull();
  });

  it("maps an unused/unattempted attempt slot (0) to null", () => {
    expect(wcaCentisecondsToMs(0)).toBeNull();
  });

  it("maps a non-finite or non-numeric value to null defensively", () => {
    expect(wcaCentisecondsToMs(NaN)).toBeNull();
    // @ts-expect-error exercising defensive guard against bad runtime input
    expect(wcaCentisecondsToMs("1005")).toBeNull();
    // @ts-expect-error exercising defensive guard against bad runtime input
    expect(wcaCentisecondsToMs(null)).toBeNull();
  });

  it("rounds to the nearest millisecond", () => {
    expect(wcaCentisecondsToMs(1)).toBe(10);
  });
});

describe("mapWcaEventToCubeDimension", () => {
  it("maps every CubeBox-supported WCA event", () => {
    expect(mapWcaEventToCubeDimension("222")).toBe("2x2x2");
    expect(mapWcaEventToCubeDimension("333")).toBe("3x3x3");
    expect(mapWcaEventToCubeDimension("444")).toBe("4x4x4");
    expect(mapWcaEventToCubeDimension("555")).toBe("5x5x5");
  });

  it("returns null for WCA events CubeBox doesn't support", () => {
    expect(mapWcaEventToCubeDimension("333bf")).toBeNull();
    expect(mapWcaEventToCubeDimension("333oh")).toBeNull();
    expect(mapWcaEventToCubeDimension("333fm")).toBeNull();
    expect(mapWcaEventToCubeDimension("333mbf")).toBeNull();
    expect(mapWcaEventToCubeDimension("444bf")).toBeNull();
    expect(mapWcaEventToCubeDimension("pyram")).toBeNull();
    expect(mapWcaEventToCubeDimension("minx")).toBeNull();
    expect(mapWcaEventToCubeDimension("666")).toBeNull();
    expect(mapWcaEventToCubeDimension("777")).toBeNull();
  });
});

// A trimmed version of Feliks Zemdegs's real /persons/2009ZEMD01/results
// data (verified against the live public WCA API), used to exercise
// multi-round selection with realistic shapes.
const rawResult = (overrides: Partial<WcaRawResult>): WcaRawResult => ({
  competition_id: "NewZealandChamps2009",
  event_id: "333",
  round_id: 525580,
  best: 1005,
  average: 1374,
  ...overrides,
});

describe("selectFinalRoundResults", () => {
  it("picks the highest round_id per (competition, event) group", () => {
    const results = [
      rawResult({ round_id: 525579, best: 1071, average: 1255 }),
      rawResult({ round_id: 525580, best: 1005, average: 1374 }),
    ];
    const final = selectFinalRoundResults(results);
    expect(final).toHaveLength(1);
    expect(final[0].round_id).toBe(525580);
    expect(final[0].average).toBe(1374);
  });

  it("keeps separate groups independent across different competitions and events", () => {
    const results = [
      rawResult({ competition_id: "CompA", event_id: "333", round_id: 1 }),
      rawResult({ competition_id: "CompA", event_id: "222", round_id: 2 }),
      rawResult({ competition_id: "CompB", event_id: "333", round_id: 3 }),
    ];
    const final = selectFinalRoundResults(results);
    expect(final).toHaveLength(3);
  });

  it("returns an empty array for empty input", () => {
    expect(selectFinalRoundResults([])).toEqual([]);
  });

  it("tolerates non-array input defensively", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    expect(selectFinalRoundResults(null)).toEqual([]);
  });
});

describe("buildImportCandidates", () => {
  const meta = new Map([
    ["NewZealandChamps2009", { name: "New Zealand Championships 2009", date: "2009-07-18T00:00:00.000Z" }],
  ]);

  it("converts a valid final-round result into an import candidate", () => {
    const { candidates, skipped } = buildImportCandidates([rawResult({})], meta);
    expect(skipped).toEqual([]);
    expect(candidates).toEqual([
      {
        wcaCompetitionId: "NewZealandChamps2009",
        event: "3x3x3",
        competitionName: "New Zealand Championships 2009",
        date: "2009-07-18T00:00:00.000Z",
        averageMs: 13740,
        bestMs: 10050,
      },
    ]);
  });

  it("skips an unsupported WCA event with a clear reason", () => {
    const { candidates, skipped } = buildImportCandidates(
      [rawResult({ event_id: "333bf", best: 15768, average: -1 })],
      meta
    );
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([
      { competitionId: "NewZealandChamps2009", eventId: "333bf", reason: "unsupported-event" },
    ]);
  });

  it("skips a result whose official average was a DNF", () => {
    const { candidates, skipped } = buildImportCandidates([rawResult({ average: -1 })], meta);
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([
      { competitionId: "NewZealandChamps2009", eventId: "333", reason: "dnf-or-dns-average" },
    ]);
  });

  it("skips a result whose official average was a DNS", () => {
    const { skipped } = buildImportCandidates([rawResult({ average: -2 })], meta);
    expect(skipped[0].reason).toBe("dnf-or-dns-average");
  });

  it("skips a result with no official average at all with a distinct reason from DNF/DNS", () => {
    // 0 means no average was computed (e.g. a Bo1/Bo3 round format that
    // only records a best) - a different situation from DNF/DNS, where an
    // average WAS computed but is invalid.
    const { candidates, skipped } = buildImportCandidates([rawResult({ average: 0 })], meta);
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([{ competitionId: "NewZealandChamps2009", eventId: "333", reason: "no-average" }]);
  });

  it("imports with bestMs: null when the best single itself was a DNF but the average was not", () => {
    // Realistic combination: an ao5 where the average is still computable
    // (only 1 of 5 attempts DNF'd) but this particular API record still
    // reports a DNF best for some other reason - defensive coverage.
    const { candidates } = buildImportCandidates([rawResult({ best: -1, average: 1374 })], meta);
    expect(candidates[0].bestMs).toBeNull();
    expect(candidates[0].averageMs).toBe(13740);
  });

  it("skips a result whose competition metadata could not be fetched", () => {
    const { candidates, skipped } = buildImportCandidates(
      [rawResult({ competition_id: "UnknownComp" })],
      new Map()
    );
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([
      { competitionId: "UnknownComp", eventId: "333", reason: "missing-competition-metadata" },
    ]);
  });

  it("only imports the final round when multiple rounds exist for the same competition and event", () => {
    const results = [
      rawResult({ round_id: 1, average: 1255 }),
      rawResult({ round_id: 2, average: 1374 }),
    ];
    const { candidates } = buildImportCandidates(results, meta);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].averageMs).toBe(13740); // from round_id: 2, the final round
  });
});

describe("namesAreSimilar", () => {
  it("treats identical names (after normalization) as similar", () => {
    expect(namesAreSimilar("New Zealand Championships 2009", "new zealand championships 2009")).toBe(true);
  });

  it("treats a shortened or abbreviated form as similar", () => {
    expect(namesAreSimilar("New Zealand Championships 2009", "NZ Champs 2009")).toBe(true);
  });

  it("treats substantially different names as not similar", () => {
    expect(namesAreSimilar("New Zealand Championships 2009", "Tokyo Open 2019")).toBe(false);
  });

  it("treats an empty name as not similar to anything", () => {
    expect(namesAreSimilar("", "New Zealand Championships 2009")).toBe(false);
  });
});

const competition = (overrides: Partial<PersistedCompetitionResultLike>): PersistedCompetitionResultLike => ({
  id: "c1",
  competitionName: "New Zealand Championships 2009",
  date: "2009-07-18T00:00:00.000Z",
  event: "3x3x3",
  averageMs: 13740,
  bestMs: 10050,
  source: "manual",
  ...overrides,
});

const importCandidate = (overrides: Partial<WcaImportCandidate> = {}): WcaImportCandidate => ({
  wcaCompetitionId: "NewZealandChamps2009",
  event: "3x3x3",
  competitionName: "New Zealand Championships 2009",
  date: "2009-07-18T00:00:00.000Z",
  averageMs: 13740,
  bestMs: 10050,
  ...overrides,
});

describe("checkForDuplicateOrConflict", () => {
  it("returns none when there is no existing record for that event/date", () => {
    const result = checkForDuplicateOrConflict(importCandidate(), []);
    expect(result.type).toBe("none");
  });

  it("returns duplicate when an existing record matches event, date, and both times exactly", () => {
    const existing = [competition({})];
    const result = checkForDuplicateOrConflict(importCandidate(), existing);
    expect(result.type).toBe("duplicate");
    expect(result.matchId).toBe("c1");
  });

  it("returns conflict when event/date match and the name is similar but the times differ", () => {
    const existing = [competition({ averageMs: 15000 })];
    const result = checkForDuplicateOrConflict(importCandidate(), existing);
    expect(result.type).toBe("conflict");
    expect(result.matchId).toBe("c1");
    expect(result.reason).toContain("New Zealand Championships 2009");
  });

  it("returns none when event/date match but the name is unrelated and times differ", () => {
    const existing = [competition({ competitionName: "Tokyo Open 2019", averageMs: 15000 })];
    const result = checkForDuplicateOrConflict(importCandidate(), existing);
    expect(result.type).toBe("none");
  });

  it("ignores records for a different event on the same date", () => {
    const existing = [competition({ event: "2x2x2" })];
    const result = checkForDuplicateOrConflict(importCandidate(), existing);
    expect(result.type).toBe("none");
  });

  it("ignores records on a different date for the same event", () => {
    const existing = [competition({ date: "2010-01-01T00:00:00.000Z" })];
    const result = checkForDuplicateOrConflict(importCandidate(), existing);
    expect(result.type).toBe("none");
  });

  it("excludes the record being edited via excludeId", () => {
    const existing = [competition({})];
    const result = checkForDuplicateOrConflict(importCandidate(), existing, "c1");
    expect(result.type).toBe("none");
  });
});

describe("decideImportAction", () => {
  it("creates a new record when nothing matches", () => {
    const decision = decideImportAction(importCandidate(), []);
    expect(decision.type).toBe("create");
  });

  it("skips as already-imported when the same wcaCompetitionId + event was already imported with identical values", () => {
    const existing = [competition({ source: "wca-import", wcaCompetitionId: "NewZealandChamps2009" })];
    const decision = decideImportAction(importCandidate(), existing);
    expect(decision.type).toBe("skip-already-imported");
  });

  it("updates the existing record when the same wcaCompetitionId + event was imported before but values changed", () => {
    const existing = [
      competition({ source: "wca-import", wcaCompetitionId: "NewZealandChamps2009", averageMs: 14000 }),
    ];
    const decision = decideImportAction(importCandidate(), existing);
    expect(decision.type).toBe("update");
    expect((decision as { existingId: string }).existingId).toBe("c1");
  });

  it("manual-first then import: skips as a duplicate when a manual record already has the same event, date, and times", () => {
    const existing = [competition({ source: "manual" })];
    const decision = decideImportAction(importCandidate(), existing);
    expect(decision.type).toBe("skip-duplicate");
  });

  it("distinguishes skip-already-imported (re-importing the same WCA result) from skip-duplicate (matching a different record)", () => {
    const reimport = decideImportAction(importCandidate(), [
      competition({ source: "wca-import", wcaCompetitionId: "NewZealandChamps2009" }),
    ]);
    const crossDuplicate = decideImportAction(importCandidate(), [competition({ source: "manual" })]);
    expect(reimport.type).toBe("skip-already-imported");
    expect(crossDuplicate.type).toBe("skip-duplicate");
    expect(reimport.type).not.toBe(crossDuplicate.type);
  });

  it("manual-first then import: surfaces a conflict instead of silently overwriting a manual record with different times", () => {
    const existing = [competition({ source: "manual", averageMs: 15000 })];
    const decision = decideImportAction(importCandidate(), existing);
    expect(decision.type).toBe("conflict");
    expect((decision as { existingId: string }).existingId).toBe("c1");
  });

  it("never overwrites a manual record even when a conflict is detected", () => {
    const existing = [competition({ source: "manual", averageMs: 15000, competitionName: "My Manual Entry" })];
    const decision = decideImportAction(importCandidate({ competitionName: "My Manual Entry" }), existing);
    expect(decision.type).toBe("conflict");
    // The manual record's own values are untouched by this decision; only
    // the caller decides whether to prompt the user, and never auto-applies.
    expect(existing[0].averageMs).toBe(15000);
  });

  it("creates a new record for a different event even if a manual record with the same wcaCompetitionId-less date exists", () => {
    const existing = [competition({ event: "2x2x2" })];
    const decision = decideImportAction(importCandidate({ event: "3x3x3" }), existing);
    expect(decision.type).toBe("create");
  });
});

describe("findLinkedWcaId", () => {
  it("returns null when there are no imported results yet", () => {
    expect(findLinkedWcaId([])).toBeNull();
    expect(findLinkedWcaId([competition({ source: "manual" })])).toBeNull();
  });

  it("returns the WCA ID of an existing imported result", () => {
    const existing = [competition({ source: "wca-import", wcaId: "2009ZEMD01" })];
    expect(findLinkedWcaId(existing)).toBe("2009ZEMD01");
  });

  it("ignores manual records even when mixed with imported ones", () => {
    const existing = [
      competition({ id: "m1", source: "manual" }),
      competition({ id: "w1", source: "wca-import", wcaId: "2009ZEMD01" }),
    ];
    expect(findLinkedWcaId(existing)).toBe("2009ZEMD01");
  });

  it("handles an imported record missing wcaId defensively (pre-migration data)", () => {
    const existing = [competition({ source: "wca-import", wcaId: undefined })];
    expect(findLinkedWcaId(existing)).toBeNull();
  });
});
