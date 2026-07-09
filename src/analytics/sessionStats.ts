// CubeBox analytics - aggregate stats for a list of solves (pure).
//
// This is the single source of truth behind the dashboard's stat cards.
// Averages are returned as AverageResult; scalar aggregates are in milliseconds.

import type { AverageResult, Solve } from "./types";
import { effectiveMillis, isDNF, isPlus2, isValidSolve } from "./time";
import {
  ao5,
  ao12,
  ao50,
  ao100,
  best,
  bestAverageOfN,
  mean,
  mo3,
  worst,
  worstAverageOfN,
} from "./averages";

export interface SessionStats {
  count: number;
  validCount: number;
  dnfCount: number;
  plus2Count: number;

  best: AverageResult;
  worst: AverageResult;
  mean: AverageResult;
  mo3: AverageResult;
  ao5: AverageResult;
  ao12: AverageResult;
  ao50: AverageResult;
  ao100: AverageResult;

  bestAo5: AverageResult;
  worstAo5: AverageResult;
  bestAo12: AverageResult;

  /** Population standard deviation of valid solve times (ms), or null. */
  stddevMs: number | null;
  /** Sum of all valid solve times (ms). */
  totalTimeMs: number;
  /** Longest run of consecutive valid solves faster than the overall mean. */
  bestStreak: number;
}

export function computeSessionStats(solvesRaw: Solve[]): SessionStats {
  const solves = Array.isArray(solvesRaw) ? solvesRaw : [];

  const valid = solves.filter(isValidSolve);
  const validTimes = valid.map(effectiveMillis);
  const dnfCount = solves.filter(isDNF).length;
  const plus2Count = solves.filter(isPlus2).length;

  const meanResult = mean(solves);

  let stddevMs: number | null = null;
  if (validTimes.length > 0 && meanResult.status === "ok") {
    const m = meanResult.valueMs;
    const variance =
      validTimes.reduce((sum, t) => sum + (t - m) ** 2, 0) / validTimes.length;
    stddevMs = Math.sqrt(variance);
  }

  const totalTimeMs = validTimes.reduce((a, b) => a + b, 0);

  let bestStreak = 0;
  if (meanResult.status === "ok") {
    const m = meanResult.valueMs;
    let cur = 0;
    for (const s of solves) {
      const t = isValidSolve(s) ? effectiveMillis(s) : null;
      if (t !== null && t < m) {
        cur++;
        if (cur > bestStreak) bestStreak = cur;
      } else {
        cur = 0;
      }
    }
  }

  return {
    count: solves.length,
    validCount: valid.length,
    dnfCount,
    plus2Count,

    best: best(solves),
    worst: worst(solves),
    mean: meanResult,
    mo3: mo3(solves),
    ao5: ao5(solves),
    ao12: ao12(solves),
    ao50: ao50(solves),
    ao100: ao100(solves),

    bestAo5: bestAverageOfN(solves, 5),
    worstAo5: worstAverageOfN(solves, 5),
    bestAo12: bestAverageOfN(solves, 12),

    stddevMs,
    totalTimeMs,
    bestStreak,
  };
}
