// CubeBox analytics — recommendation effectiveness review (pure).
//
// Retrospective, not causal: for each coach rule, finds the most recent
// point in the lookback window where it started triggering, then checks
// whether the same metric crossed back past the rule's own trigger
// condition within a fixed horizon. This is a walk-forward replay of
// computeTrainingSignals/practiceCoach's own trigger functions — the same
// shape as backtesting.ts, applied to rule conditions instead of
// prediction error. No new persistence, no causal claim: "resolved" means
// the condition that fired the rule stopped holding, not that this
// recommendation was the reason.

import { predictCompetitionResult } from "./competitionPrediction";
import { collapseRoundsToReference } from "./wcaImport";
import type { PersistedCompetitionResultLike } from "./wcaImport";
import { runBacktest } from "./backtesting";
import { computeTrainingSignals } from "./trainingSignals";
import type { CoachSolve, TrainingSignals } from "./trainingSignals";
import { FOCUS_RULES } from "./practiceCoach";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const EVALUATION_HORIZON_DAYS = 14;
export const EVALUATION_LOOKBACK_DAYS = 60;

export interface RecommendationEvaluationCase {
  ruleId: string;
  triggeredAt: number;
  metricAtTrigger: number;
  metricAtHorizon: number | null;
  resolved: boolean;
  daysToResolution: number | null;
}

export interface RecommendationEvaluationSummary {
  evaluatedCount: number;
  resolvedCount: number;
  activeCount: number;
  insufficientFollowupCount: number;
}

export interface RecommendationEvaluationResult {
  cases: RecommendationEvaluationCase[];
  summary: RecommendationEvaluationSummary;
}

function signalsAsOf(
  solves: CoachSolve[],
  event: string,
  competitionResults: PersistedCompetitionResultLike[],
  asOfMs: number
): TrainingSignals {
  const priorResults = competitionResults.filter(
    (c) => c.event === event && Number.isFinite(Date.parse(c.date)) && Date.parse(c.date) < asOfMs
  );
  const referencePoints = collapseRoundsToReference(priorResults);
  const prediction = predictCompetitionResult(solves, referencePoints, event, asOfMs);
  const backtest = runBacktest(solves, referencePoints, event);
  return computeTrainingSignals(solves, event, referencePoints, prediction, backtest.summary, asOfMs);
}

/**
 * Replays each coach rule over the lookback window. At most one case per
 * rule — its most recent onset — matching "show a few recent cases," not a
 * full history of every trigger/resolve cycle.
 */
export function evaluateRecommendations(
  solves: CoachSolve[],
  event: string,
  competitionResults: PersistedCompetitionResultLike[],
  now: number = Date.now(),
  lookbackDays: number = EVALUATION_LOOKBACK_DAYS,
  horizonDays: number = EVALUATION_HORIZON_DAYS
): RecommendationEvaluationResult {
  const list = Array.isArray(solves) ? solves : [];
  const results = Array.isArray(competitionResults) ? competitionResults : [];

  const days: { ms: number; signals: TrainingSignals }[] = [];
  for (let d = lookbackDays; d >= 0; d--) {
    const ms = now - d * MS_PER_DAY;
    days.push({ ms, signals: signalsAsOf(list, event, results, ms) });
  }

  const cases: RecommendationEvaluationCase[] = [];

  for (const rule of FOCUS_RULES) {
    let onsetIndex = -1;
    for (let i = 0; i < days.length; i++) {
      const triggeredNow = rule.trigger(days[i].signals);
      const triggeredBefore = i > 0 && rule.trigger(days[i - 1].signals);
      if (triggeredNow && !triggeredBefore) onsetIndex = i;
    }
    if (onsetIndex === -1) continue;

    const onset = days[onsetIndex];
    const metricAtTrigger = rule.metric(onset.signals);
    if (metricAtTrigger === null) continue;

    const horizonIndex = onsetIndex + horizonDays;
    if (horizonIndex >= days.length) {
      cases.push({
        ruleId: rule.id,
        triggeredAt: onset.ms,
        metricAtTrigger,
        metricAtHorizon: null,
        resolved: false,
        daysToResolution: null,
      });
      continue;
    }

    let resolvedAtIndex = -1;
    for (let i = onsetIndex + 1; i <= horizonIndex; i++) {
      if (!rule.trigger(days[i].signals)) {
        resolvedAtIndex = i;
        break;
      }
    }

    if (resolvedAtIndex !== -1) {
      cases.push({
        ruleId: rule.id,
        triggeredAt: onset.ms,
        metricAtTrigger,
        metricAtHorizon: rule.metric(days[resolvedAtIndex].signals),
        resolved: true,
        daysToResolution: Math.round((days[resolvedAtIndex].ms - onset.ms) / MS_PER_DAY),
      });
    } else {
      cases.push({
        ruleId: rule.id,
        triggeredAt: onset.ms,
        metricAtTrigger,
        metricAtHorizon: rule.metric(days[horizonIndex].signals),
        resolved: false,
        daysToResolution: null,
      });
    }
  }

  return {
    cases,
    summary: {
      evaluatedCount: cases.length,
      resolvedCount: cases.filter((c) => c.resolved).length,
      insufficientFollowupCount: cases.filter((c) => c.metricAtHorizon === null).length,
      activeCount: cases.filter((c) => !c.resolved && c.metricAtHorizon !== null).length,
    },
  };
}
