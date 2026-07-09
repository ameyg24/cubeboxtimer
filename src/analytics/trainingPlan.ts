// CubeBox analytics - training plan (pure).
//
// Reshapes PracticeCoach's FocusArea[] into a small time-boxed plan.
// Nothing new is computed - this is a display-oriented grouping of an
// already-produced list, not a scheduling engine.

import type { FocusArea } from "./practiceCoach";

export interface TrainingPlanResult {
  actNow: FocusArea[];
  thisWeek: FocusArea[];
  beforeNextCompetition: FocusArea[];
  limitations: string[];
}

/**
 * `nextCompetitionDateMs` is the only date this module accepts - there is
 * no persisted "upcoming competition" concept in CubeBox yet, so callers
 * without one should pass null rather than inventing a schedule.
 */
export function buildTrainingPlan(
  focusAreas: FocusArea[],
  nextCompetitionDateMs: number | null = null
): TrainingPlanResult {
  const areas = Array.isArray(focusAreas) ? focusAreas : [];
  const actNow = areas.filter((f) => f.priority === "high");
  const thisWeek = areas.filter((f) => f.priority !== "high");
  const beforeNextCompetition = nextCompetitionDateMs !== null ? areas : [];

  const limitations: string[] = [];
  if (nextCompetitionDateMs === null) {
    limitations.push("No upcoming competition date set - before-competition plan not shown.");
  }

  return { actNow, thisWeek, beforeNextCompetition, limitations };
}
