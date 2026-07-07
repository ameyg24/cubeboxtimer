// Committed sample fixture for `npm run benchmark:models`. Synthetic and
// deterministic (fixed dates, seeded LCG) — real user data is per-user and
// local, so the benchmark can never see it. Shape: two seasons of practice
// with a slow improvement trend, eight competitions each preceded by a
// practice block, competition averages ~6% slower than practice.

import type { CompetitionResultInput } from "../src/analytics/competitionPrediction";
import type { CoachSolve } from "../src/analytics/trainingSignals";

export const SAMPLE_EVENT = "3x3x3";
const SAMPLE_NOW = Date.UTC(2026, 4, 1);
export const SAMPLE_DATA_LABEL =
  "SAMPLE DATA — synthetic fixture (scripts/benchmarkData.ts), not real user results.";

const DAY = 24 * 60 * 60 * 1000;

function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function buildSampleData(): { solves: CoachSolve[]; competitionResults: CompetitionResultInput[] } {
  const rand = lcg(42);
  const solves: CoachSolve[] = [];
  const competitionResults: CompetitionResultInput[] = [];

  // Oldest first; practice mean improves ~13.4s -> ~11.3s across the span.
  const competitionDaysAgo = [420, 360, 300, 240, 180, 120, 60, 12];

  competitionDaysAgo.forEach((daysAgo, i) => {
    const practiceMeanMs = 13400 - i * 300;

    // A practice block in the 14 days before the competition, plus a
    // lighter block ~3 weeks out so momentum windows have data too.
    for (let s = 0; s < 26; s++) {
      const offsetDays = 1 + rand() * 12;
      const jitterMs = (rand() - 0.5) * 2400;
      const isDnf = rand() < 0.04;
      solves.push({
        id: `sample-${i}-${s}`,
        millis: isDnf ? 0 : Math.round(practiceMeanMs + jitterMs),
        penalty: isDnf ? "DNF" : rand() < 0.05 ? "+2" : null,
        localCreatedAt: SAMPLE_NOW - Math.round((daysAgo + offsetDays) * DAY),
      });
    }
    for (let s = 0; s < 8; s++) {
      solves.push({
        id: `sample-${i}-warm-${s}`,
        millis: Math.round(practiceMeanMs + 300 + (rand() - 0.5) * 2400),
        penalty: null,
        localCreatedAt: SAMPLE_NOW - Math.round((daysAgo + 15 + rand() * 6) * DAY),
      });
    }

    const gapNoise = (rand() - 0.5) * 0.04;
    competitionResults.push({
      id: `comp-${i + 1}`,
      date: new Date(SAMPLE_NOW - daysAgo * DAY).toISOString(),
      event: SAMPLE_EVENT,
      averageMs: Math.round(practiceMeanMs * (1.06 + gapNoise)),
      bestMs: Math.round(practiceMeanMs * 0.92),
    });
  });

  return { solves, competitionResults };
}
