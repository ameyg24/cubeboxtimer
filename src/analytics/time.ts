// CubeBox analytics - solve-level time helpers (pure).

import type { Solve } from "./types";

export const PLUS2_PENALTY_MS = 2000;

export function isDNF(solve: Solve | undefined | null): boolean {
  return !!solve && solve.penalty === "DNF";
}

export function isPlus2(solve: Solve | undefined | null): boolean {
  return !!solve && solve.penalty === "+2";
}

/**
 * A solve counts as "valid" (contributes a real time) when it has a numeric
 * millis and is not a DNF. +2 solves are valid; their penalty is applied via
 * effectiveMillis().
 */
export function isValidSolve(solve: Solve | undefined | null): boolean {
  return (
    !!solve &&
    typeof solve.millis === "number" &&
    !Number.isNaN(solve.millis) &&
    !isDNF(solve)
  );
}

/**
 * Effective time in milliseconds, including the +2 penalty.
 * Not meaningful for DNF solves (callers should exclude those first).
 */
export function effectiveMillis(solve: Solve): number {
  return solve.millis + (isPlus2(solve) ? PLUS2_PENALTY_MS : 0);
}
