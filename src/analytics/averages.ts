// CubeBox analytics — averages, means, best/worst (pure, WCA-style).
//
// All values are computed in milliseconds. Consumers convert to seconds for
// display. DNF solves are treated as the largest possible time for trimming.

import type { AverageResult, Solve } from "./types";
import { effectiveMillis, isDNF, isValidSolve } from "./time";

const OK = (valueMs: number): AverageResult => ({ status: "ok", valueMs });
const DNF: AverageResult = { status: "dnf" };
const INSUFFICIENT: AverageResult = { status: "insufficient" };

/**
 * WCA trim count for an average of n: the fastest and slowest ceil(5%) solves
 * are dropped. n=5 -> 1, n=12 -> 1, n=50 -> 3, n=100 -> 5.
 */
export function trimCount(n: number): number {
  return Math.ceil(n * 0.05);
}

/**
 * WCA-style average of exactly n solves (uses the last n if more are supplied).
 *
 * Drops the fastest and slowest `trimCount(n)` solves, then takes the
 * arithmetic mean of what remains. DNFs sort to the end (treated as +Infinity),
 * so they are trimmed first; the average is a DNF only if a DNF survives the
 * trim (i.e. dnfCount > trimCount(n)).
 *
 * Note: this is the canonical WCA "average". It is NOT used for mo3 — see
 * `meanOfN` — because a mean of 3 is not trimmed.
 */
export function averageOfN(solves: Solve[], n: number): AverageResult {
  if (!Array.isArray(solves) || solves.length < n) return INSUFFICIENT;
  const window = solves.slice(-n);

  const t = trimCount(n);
  const values = window.map((s) => (isDNF(s) ? Infinity : effectiveMillis(s)));
  values.sort((a, b) => a - b);

  const counted = values.slice(t, n - t);
  if (counted.some((v) => !Number.isFinite(v))) return DNF;

  const sum = counted.reduce((a, b) => a + b, 0);
  return OK(sum / counted.length);
}

/**
 * Arithmetic mean of exactly n solves (uses the last n if more are supplied).
 * No trimming. Any DNF in the window makes the whole result a DNF. This is the
 * correct definition of "mean of 3" (mo3).
 */
export function meanOfN(solves: Solve[], n: number): AverageResult {
  if (!Array.isArray(solves) || solves.length < n) return INSUFFICIENT;
  const window = solves.slice(-n);
  if (window.some(isDNF)) return DNF;
  const sum = window.reduce((acc, s) => acc + effectiveMillis(s), 0);
  return OK(sum / n);
}

export const ao5 = (solves: Solve[]): AverageResult => averageOfN(solves, 5);
export const ao12 = (solves: Solve[]): AverageResult => averageOfN(solves, 12);
export const ao50 = (solves: Solve[]): AverageResult => averageOfN(solves, 50);
export const ao100 = (solves: Solve[]): AverageResult => averageOfN(solves, 100);
export const mo3 = (solves: Solve[]): AverageResult => meanOfN(solves, 3);

/** Arithmetic mean of every valid solve (DNFs excluded, +2 applied). */
export function mean(solves: Solve[]): AverageResult {
  const valid = (solves || []).filter(isValidSolve);
  if (valid.length === 0) return INSUFFICIENT;
  const sum = valid.reduce((acc, s) => acc + effectiveMillis(s), 0);
  return OK(sum / valid.length);
}

/** Fastest valid solve (single best), +2 applied. */
export function best(solves: Solve[]): AverageResult {
  const valid = (solves || []).filter(isValidSolve);
  if (valid.length === 0) return INSUFFICIENT;
  return OK(Math.min(...valid.map(effectiveMillis)));
}

/** Slowest valid solve (single worst), +2 applied. */
export function worst(solves: Solve[]): AverageResult {
  const valid = (solves || []).filter(isValidSolve);
  if (valid.length === 0) return INSUFFICIENT;
  return OK(Math.max(...valid.map(effectiveMillis)));
}

/**
 * Rolling average of n across the full solve list, aligned to input indices.
 * Entry i is the average of the window ending at solve i (length n), or
 * "insufficient" for the first n-1 positions. Useful for chart overlays.
 */
export function rollingAverageOfN(solves: Solve[], n: number): AverageResult[] {
  if (!Array.isArray(solves)) return [];
  return solves.map((_, i) =>
    i + 1 < n ? INSUFFICIENT : averageOfN(solves.slice(i + 1 - n, i + 1), n)
  );
}

/** Best (fastest) average of n over every window in the list. */
export function bestAverageOfN(solves: Solve[], n: number): AverageResult {
  return extremeAverageOfN(solves, n, "best");
}

/** Worst (slowest) average of n over every window in the list. */
export function worstAverageOfN(solves: Solve[], n: number): AverageResult {
  return extremeAverageOfN(solves, n, "worst");
}

function extremeAverageOfN(
  solves: Solve[],
  n: number,
  mode: "best" | "worst"
): AverageResult {
  if (!Array.isArray(solves) || solves.length < n) return INSUFFICIENT;
  let chosen: number | null = null;
  for (let i = n - 1; i < solves.length; i++) {
    const r = averageOfN(solves.slice(i + 1 - n, i + 1), n);
    if (r.status !== "ok") continue;
    if (
      chosen === null ||
      (mode === "best" ? r.valueMs < chosen : r.valueMs > chosen)
    ) {
      chosen = r.valueMs;
    }
  }
  return chosen === null ? INSUFFICIENT : OK(chosen);
}
