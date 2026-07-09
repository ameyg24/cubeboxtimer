// CubeBox analytics - csTimer practice-solve import (pure).
//
// csTimer (cstimer.net) is a third-party browser-based practice timer, not
// affiliated with CubeBox or the WCA. Its "Export to file" (Menu > Export >
// Export to file) downloads a JSON object whose keys are per-session
// ("session1", "session2", ...), each holding an array of solve records:
//
//   [[penalty, timeMs], "scramble string", "comment", timestampSeconds]
//
// where penalty is 0 (no penalty), 2000 (+2, milliseconds - added to the
// raw time), or -1 (DNF); timeMs is the raw solve time *before* any penalty;
// and timestampSeconds is a Unix epoch in SECONDS (not milliseconds).
// Verified against two independent open-source csTimer-format readers (a
// Ruby parser and a Python session-time analyzer) that agree on this
// structure - csTimer's own source is compiled from Java/GWT and doesn't
// publish this as documented JSON, so this project reverse-engineers it the
// same way those tools did. A bare array (just one session's solve list,
// e.g. if a user copies only that instead of the full multi-session export)
// is also accepted, treated as a single session.
//
// This is the only csTimer export shape this module supports right now.
// csTimer also offers "Export to clipboard" in a few other layouts (plain
// text summaries, CSV-like round trip data for other timers) - none of
// those are parsed here. If support for another format is added later, it
// should get its own parse function in this file rather than overloading
// this one, so each format's parsing stays independently testable.
//
// Deliberately NOT attempted: auto-detecting which cube event a given
// "sessionN" belongs to. csTimer stores that separately, in a
// "properties.sessionData" blob whose exact shape wasn't confirmed against
// primary documentation - guessing wrong there would silently misfile solves
// under the wrong event. Every solve found across every session in the
// pasted export is treated as one flat list; the importing UI asks the user
// which CubeBox event to file them under, exactly like the existing
// "Add past solve" flow already does for a single manual entry.
//
// Also deliberately out of scope: this import path only ever produces
// practice Solve records (via the same addSolve path "Add past solve"
// uses) - it never touches CompetitionResult/addCompetitionResult. csTimer
// is a practice timer with no concept of official WCA results, so there is
// no "is this actually a competition attempt" ambiguity to resolve; every
// row it can export is practice data by construction.

export type CsTimerPenalty = "+2" | "DNF" | null;

export interface CsTimerParsedSolve {
  /** Raw time in ms, no penalty applied - matches CubeBox's own solve shape (effectiveMillis applies +2 at read time). */
  millis: number;
  penalty: CsTimerPenalty;
  /** ms epoch, converted from csTimer's second-resolution timestamp. */
  localCreatedAt: number;
}

export interface CsTimerParseResult {
  solves: CsTimerParsedSolve[];
  invalidRowCount: number;
  /** Set only when the input couldn't be interpreted as csTimer export data at all (bad JSON, or no solve arrays found). */
  parseError: string | null;
}

const DNF_FLAG = -1;
const PLUS_TWO_FLAG_MS = 2000;
const OK_FLAG = 0;

/**
 * Converts one raw csTimer solve entry into CubeBox's solve shape, or null
 * if the row can't be trusted. A row with no usable timestamp is treated as
 * invalid rather than defaulted to "now": CubeBox's date-based features
 * (competition-window matching, Daily grouping, chronological record
 * history) all need a real date, and silently stamping "now" would place a
 * years-old practice solve into today's stats - worse than dropping it. It
 * would also break duplicate detection on repeated imports of the same
 * file, since every re-run would mint a fresh "now" timestamp for the same
 * row and never match what was imported before.
 */
function parseSolveEntry(entry: unknown): CsTimerParsedSolve | null {
  if (!Array.isArray(entry) || entry.length < 4) return null;
  const [xtime, , , timestampSeconds] = entry;

  if (!Array.isArray(xtime) || xtime.length < 2) return null;
  const [flag, rawTimeMs] = xtime;
  if (typeof flag !== "number" || typeof rawTimeMs !== "number") return null;

  let penalty: CsTimerPenalty;
  let millis: number;
  if (flag === DNF_FLAG) {
    penalty = "DNF";
    millis = 0; // matches CubeBox's own DNF convention (App.jsx / SolveList.jsx's AddSolveModal)
  } else if (flag === PLUS_TWO_FLAG_MS) {
    penalty = "+2";
    millis = rawTimeMs;
  } else if (flag === OK_FLAG) {
    penalty = null;
    millis = rawTimeMs;
  } else {
    return null; // unrecognized penalty flag - not a shape this module trusts
  }

  if (penalty !== "DNF" && (!Number.isFinite(millis) || millis <= 0)) return null;
  if (typeof timestampSeconds !== "number" || !Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return null;
  }

  return { millis, penalty, localCreatedAt: Math.round(timestampSeconds * 1000) };
}

/**
 * Parses a pasted/uploaded csTimer export. Accepts either the full
 * multi-session export object ({ session1: [...], session2: [...],
 * properties: {...} }) or a bare array (a single session's solve list) -
 * any non-array top-level value (like "properties") is silently ignored,
 * not counted as an invalid row, since it isn't a solve entry to begin
 * with. Every solve array found is flattened into one list.
 */
export function parseCsTimerExport(raw: string): CsTimerParseResult {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    return { solves: [], invalidRowCount: 0, parseError: "Paste or upload csTimer export data first." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      solves: [],
      invalidRowCount: 0,
      parseError:
        'Could not parse this as csTimer export data. Paste the raw contents of a csTimer "Export to file" download.',
    };
  }

  const sessionArrays: unknown[][] = [];
  if (Array.isArray(parsed)) {
    sessionArrays.push(parsed);
  } else if (parsed && typeof parsed === "object") {
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) sessionArrays.push(value);
    }
  }

  if (sessionArrays.length === 0) {
    return { solves: [], invalidRowCount: 0, parseError: "No csTimer solve data was found in the pasted export." };
  }

  const solves: CsTimerParsedSolve[] = [];
  let invalidRowCount = 0;
  for (const sessionArray of sessionArrays) {
    for (const entry of sessionArray) {
      const solve = parseSolveEntry(entry);
      if (solve) {
        solves.push(solve);
      } else {
        invalidRowCount += 1;
      }
    }
  }

  return { solves, invalidRowCount, parseError: null };
}

/** The minimal shape this module needs from an already-persisted solve to check for duplicates. */
export interface ExistingSolveForDuplicateCheck {
  millis: number;
  penalty?: CsTimerPenalty;
  localCreatedAt?: number;
}

function duplicateSignature(localCreatedAt: number, millis: number, penalty: CsTimerPenalty): string {
  return `${localCreatedAt}|${millis}|${penalty || "none"}`;
}

/**
 * Splits parsed csTimer solves into what's actually new versus what's
 * already present, using (timestamp, raw time, penalty) as the duplicate
 * signature - "event" is implicit, since `existingSolves` is expected to
 * already be scoped to the one CubeBox event being imported into. Also
 * catches duplicates *within* the pasted batch itself (e.g. a session
 * exported twice into the same file), not just against prior imports.
 */
export function filterOutDuplicates(
  parsedSolves: CsTimerParsedSolve[],
  existingSolves: ExistingSolveForDuplicateCheck[]
): { toImport: CsTimerParsedSolve[]; duplicateCount: number } {
  const existingSignatures = new Set(
    (existingSolves || [])
      .filter((s) => typeof s.localCreatedAt === "number")
      .map((s) => duplicateSignature(s.localCreatedAt as number, s.millis, (s.penalty as CsTimerPenalty) ?? null))
  );

  const seenInBatch = new Set<string>();
  const toImport: CsTimerParsedSolve[] = [];
  let duplicateCount = 0;

  for (const solve of parsedSolves) {
    const signature = duplicateSignature(solve.localCreatedAt, solve.millis, solve.penalty);
    if (existingSignatures.has(signature) || seenInBatch.has(signature)) {
      duplicateCount += 1;
      continue;
    }
    seenInBatch.add(signature);
    toImport.push(solve);
  }

  return { toImport, duplicateCount };
}
