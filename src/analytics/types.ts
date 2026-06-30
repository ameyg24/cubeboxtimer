// CubeBox analytics — shared types.
//
// These describe the *minimal* solve shape the analytics layer needs. The app's
// stored solve objects carry extra fields (id, reviewed, scramble, ...) that
// analytics deliberately ignores so this module stays decoupled from storage.

export type Penalty = "DNF" | "+2" | null | undefined;

export interface Solve {
  /** Raw recorded time in milliseconds. For a DNF this is typically 0 and unused. */
  millis: number;
  /** "+2" adds a 2000ms penalty; "DNF" excludes the solve from valid times. */
  penalty?: Penalty;
}

/**
 * Discriminated result for any average/mean/best/worst computation.
 *
 * Analytics functions never return mixed string|number values. Consumers map
 * this to their own presentation:
 *   - dashboard / sidebar: render "dnf" and "insufficient" as text
 *   - charts: map "dnf" / "insufficient" to null (gaps in the line)
 */
export type AverageResult =
  | { status: "ok"; valueMs: number }
  | { status: "dnf" }
  | { status: "insufficient" };
