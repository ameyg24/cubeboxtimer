// Daily aggregation moved verbatim from Dashboard.jsx so the worker can run
// it off the main thread (measured ~50 ms at the 25K-solve target, on the
// timer-stop path). Pure: `now` is a parameter, never read from a clock -
// it is only the fallback timestamp for a solve missing both a numeric id
// and localCreatedAt, which normal data never is.

import { computeSessionStats } from "../analytics";
import type { PersistedSolve } from "../storage/types";

// ok -> seconds, dnf -> "DNF", insufficient -> null.
export const toDisplay = (r: { status: string; valueMs?: number }): number | string | null =>
  r.status === "ok" && typeof r.valueMs === "number"
    ? r.valueMs / 1000
    : r.status === "dnf"
    ? "DNF"
    : null;

export interface DailyStatsRow {
  day: string;
  label: string;
  count: number;
  best: number | string | null;
  mean: number | string | null;
  ao5: number | string | null;
  dnfCount: number;
}

export function computeDailyStats(solvesRaw: PersistedSolve[], now: number): DailyStatsRow[] {
  const days: Record<string, PersistedSolve[]> = {};
  solvesRaw.forEach((s) => {
    const ts = typeof s.id === "number" ? s.id : s.localCreatedAt || now;
    const date = new Date(ts);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (!days[dayKey]) days[dayKey] = [];
    days[dayKey].push(s);
  });

  return Object.entries(days)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, solves]) => {
      const st = computeSessionStats(solves as never);
      const [year, month, dayNum] = day.split("-");
      const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
      const label = dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return {
        day,
        label,
        count: solves.length,
        best: toDisplay(st.best),
        mean: toDisplay(st.mean),
        ao5: toDisplay(st.ao5),
        dnfCount: st.dnfCount,
      };
    });
}
