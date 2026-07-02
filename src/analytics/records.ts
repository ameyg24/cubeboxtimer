// CubeBox analytics — personal record detection (pure).
//
// A record event is fully derivable from the solve list itself (no extra
// state needed): replay solves in chronological order and note every time a
// value beats the best seen so far. This reuses the exact same average math
// as the rest of analytics (rollingAverageOfN) rather than re-implementing
// windowing/trimming — it's a chronological walk over already-computed
// values, not a second averaging engine.

import type { Solve } from "./types";
import { effectiveMillis, isValidSolve } from "./time";
import { rollingAverageOfN } from "./averages";

export type RecordType = "single" | "ao5" | "ao12" | "ao50" | "ao100";

export const RECORD_TYPES: RecordType[] = ["single", "ao5", "ao12", "ao50", "ao100"];

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  single: "Single",
  ao5: "ao5",
  ao12: "ao12",
  ao50: "ao50",
  ao100: "ao100",
};

const AVERAGE_WINDOWS: { type: Exclude<RecordType, "single">; n: number }[] = [
  { type: "ao5", n: 5 },
  { type: "ao12", n: 12 },
  { type: "ao50", n: 50 },
  { type: "ao100", n: 100 },
];

/** The minimal solve shape record detection needs beyond {millis, penalty}. */
export interface TimedSolve extends Solve {
  id: string;
  localCreatedAt?: number;
}

export interface RecordMark {
  valueMs: number;
  solveId: string;
  timestamp: number;
}

export type CurrentRecords = Record<RecordType, RecordMark | null>;

export interface RecordEvent extends RecordMark {
  recordType: RecordType;
  /** null when this is the first time this record type was ever set. */
  previousValueMs: number | null;
}

export interface RecordHistoryResult {
  currentRecords: CurrentRecords;
  /** Chronological order, oldest first. Reverse for "newest first" display. */
  history: RecordEvent[];
}

function timestampOf(solve: TimedSolve): number {
  return solve.localCreatedAt ?? 0;
}

/** Sorts a copy of the given solves into chronological order. */
export function toChronological<T extends TimedSolve>(solves: T[]): T[] {
  return [...solves].sort((a, b) => timestampOf(a) - timestampOf(b));
}

function emptyCurrentRecords(): CurrentRecords {
  return { single: null, ao5: null, ao12: null, ao50: null, ao100: null };
}

/**
 * Walks a chronologically-ordered solve list once and detects every moment a
 * new personal record was set, for the single time and each WCA average
 * window. A record only counts as new when it strictly beats the previous
 * one — a tie is not a PB.
 */
export function computeRecordHistory(solvesChronological: TimedSolve[]): RecordHistoryResult {
  const solves = Array.isArray(solvesChronological) ? solvesChronological : [];

  const rollingByType = Object.fromEntries(
    AVERAGE_WINDOWS.map(({ type, n }) => [type, rollingAverageOfN(solves, n)])
  ) as Record<Exclude<RecordType, "single">, ReturnType<typeof rollingAverageOfN>>;

  const currentRecords = emptyCurrentRecords();
  const history: RecordEvent[] = [];

  const consider = (recordType: RecordType, valueMs: number, solve: TimedSolve) => {
    const existing = currentRecords[recordType];
    if (existing !== null && valueMs >= existing.valueMs) return;
    const mark: RecordMark = { valueMs, solveId: solve.id, timestamp: timestampOf(solve) };
    currentRecords[recordType] = mark;
    history.push({ ...mark, recordType, previousValueMs: existing ? existing.valueMs : null });
  };

  solves.forEach((solve, i) => {
    if (isValidSolve(solve)) {
      consider("single", effectiveMillis(solve), solve);
    }
    for (const { type } of AVERAGE_WINDOWS) {
      const result = rollingByType[type][i];
      if (result.status === "ok") {
        consider(type, result.valueMs, solve);
      }
    }
  });

  return { currentRecords, history };
}
