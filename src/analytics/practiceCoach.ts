// CubeBox analytics — practice coach (pure).
//
// Converts TrainingSignals into a scored, prioritized recommendation list.
// No new statistics live here — every evidence value is a formatted read of
// a TrainingSignals field. Readiness is a fixed weighted average of five
// subscores; focus areas come from a fixed rule table (hardcoded priority,
// hardcoded drill, array order as tie-break) — nothing fitted, nothing
// generated per case.

import type { ConfidenceLevel } from "./competitionPrediction";
import type { TrainingSignals } from "./trainingSignals";

export type ReadinessLabel = "ready" | "mixed" | "needs-work";
export type FocusPriority = "high" | "medium" | "low";
export type CoachConfidence = "low" | "medium" | "high";

export interface ReadinessScore {
  score: number;
  label: ReadinessLabel;
}

export interface FocusAreaEvidence {
  label: string;
  value: string;
}

export interface FocusArea {
  id: string;
  title: string;
  priority: FocusPriority;
  reason: string;
  evidence: FocusAreaEvidence[];
  suggestedDrill: string;
  target: string;
}

export interface PracticeCoachResult {
  event: string;
  readiness: ReadinessScore;
  focusAreas: FocusArea[];
  summary: string;
  confidence: CoachConfidence;
  limitations: string[];
}

// Plain, disclosed constants — not fitted. Each also doubles as the trigger
// threshold for the one rule its subscore corresponds to (see FOCUS_RULES),
// so a rule's `target` field can quote the exact number that fired it.
export const TARGET_SOLVES_14D = 50;
export const CV_CAP = 0.15;
export const DNF_RISK_CAP = 0.1;
export const MOMENTUM_SENSITIVITY = 0.08;
const COMPETITION_GAP_TRIGGER_PCT = 0.05;
const STALE_PB_DAYS = 30;

const NEUTRAL_SCORE = 0.5;

function coefficientOfVariation(s: TrainingSignals): number | null {
  if (s.practiceMeanMs === null || s.practiceStddevMs === null || s.practiceMeanMs <= 0) return null;
  return s.practiceStddevMs / s.practiceMeanMs;
}

// A null underlying signal scores neutral (0.5), not 0 — missing data isn't
// evidence of poor performance, it just means this subscore can't speak.
function consistencyScore(s: TrainingSignals): number {
  const cv = coefficientOfVariation(s);
  if (cv === null) return NEUTRAL_SCORE;
  return 1 - Math.min(cv / CV_CAP, 1);
}

function volumeScore(s: TrainingSignals): number {
  return Math.min(s.practiceCount / TARGET_SOLVES_14D, 1);
}

function momentumScore(s: TrainingSignals): number {
  if (s.momentumMs === null || s.practiceMeanMs === null || s.practiceMeanMs <= 0) return NEUTRAL_SCORE;
  if (s.momentumMs <= 0) return 1;
  return Math.max(0, 1 - s.momentumMs / s.practiceMeanMs / MOMENTUM_SENSITIVITY);
}

function dnfRiskScore(s: TrainingSignals): number {
  return 1 - Math.min(s.dnfRatePct / 100 / DNF_RISK_CAP, 1);
}

// Explicit lookup, not a formula — "insufficient" competition history is
// genuinely scored 0 here (unlike the neutral-default subscores above),
// matching how confidenceLevel already gates the live prediction itself.
const COMPETITION_CONFIDENCE_SCORES: Record<ConfidenceLevel, number> = {
  insufficient: 0,
  low: 0.33,
  medium: 0.66,
  high: 1,
};

function competitionConfidenceScore(s: TrainingSignals): number {
  return COMPETITION_CONFIDENCE_SCORES[s.competitionConfidence];
}

function computeReadiness(s: TrainingSignals): ReadinessScore {
  const subscores = [
    consistencyScore(s),
    volumeScore(s),
    momentumScore(s),
    dnfRiskScore(s),
    competitionConfidenceScore(s),
  ];
  const average = subscores.reduce((a, b) => a + b, 0) / subscores.length;
  const score = Math.round(100 * average);
  const label: ReadinessLabel = score >= 70 ? "ready" : score >= 40 ? "mixed" : "needs-work";
  return { score, label };
}

const fmtPct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const fmtDays = (days: number) => `${Math.round(days)}`;

interface FocusRule {
  id: string;
  title: string;
  priority: FocusPriority;
  trigger: (s: TrainingSignals) => boolean;
  reason: string;
  evidence: (s: TrainingSignals) => FocusAreaEvidence[];
  suggestedDrill: string;
  target: string;
}

// Fixed table: hardcoded priority, hardcoded drill, array order is the
// tie-break for equal-priority rules. Six rules, six distinct signals — no
// two rules key off the same underlying number.
const FOCUS_RULES: FocusRule[] = [
  {
    id: "clean-up-solves",
    title: "Clean up solves",
    priority: "high",
    trigger: (s) => s.dnfRatePct > DNF_RISK_CAP * 100,
    reason: "DNF rate is above target.",
    evidence: (s) => [
      { label: "DNF rate", value: `${s.dnfRatePct.toFixed(1)}%` },
      { label: "+2 rate", value: `${s.plus2RatePct.toFixed(1)}%` },
    ],
    suggestedDrill: "Run 3 blocks of 20 solves where a DNF ends the block.",
    target: `DNF rate under ${(DNF_RISK_CAP * 100).toFixed(0)}%.`,
  },
  {
    id: "run-competition-simulations",
    title: "Run competition simulations",
    priority: "high",
    trigger: (s) =>
      s.competitionGapPct !== null &&
      s.competitionConfidence !== "insufficient" &&
      s.competitionGapPct > COMPETITION_GAP_TRIGGER_PCT,
    reason: "Competition averages have been slower than practice.",
    evidence: (s) => [
      { label: "Competition gap", value: fmtPct(s.competitionGapPct as number) },
      { label: "Prediction confidence", value: s.competitionConfidence },
    ],
    suggestedDrill: "Run 3 mock averages with inspection and no resets.",
    target: `Competition gap under ${(COMPETITION_GAP_TRIGGER_PCT * 100).toFixed(0)}%.`,
  },
  {
    id: "stabilize-execution",
    title: "Stabilize execution",
    priority: "medium",
    trigger: (s) => {
      const cv = coefficientOfVariation(s);
      return cv !== null && cv > CV_CAP;
    },
    reason: "Recent practice times are inconsistent.",
    evidence: (s) => [{ label: "Consistency (stddev/mean)", value: fmtPct(coefficientOfVariation(s) as number) }],
    suggestedDrill: "Do 3 blocks of 20 solves focused on clean execution, not speed.",
    target: `Consistency under ${(CV_CAP * 100).toFixed(0)}%.`,
  },
  {
    id: "stabilize-before-pushing-speed",
    title: "Stabilize before pushing speed",
    priority: "medium",
    trigger: (s) =>
      s.momentumMs !== null &&
      s.practiceMeanMs !== null &&
      s.practiceMeanMs > 0 &&
      s.momentumMs > 0 &&
      s.momentumMs / s.practiceMeanMs > MOMENTUM_SENSITIVITY,
    reason: "Recent practice has been slower than the two weeks before.",
    evidence: (s) => [{ label: "Momentum", value: `${((s.momentumMs as number) / 1000).toFixed(2)}s slower` }],
    suggestedDrill: "Do controlled-turning sessions and review your worst solves.",
    target: `Momentum within ${(MOMENTUM_SENSITIVITY * 100).toFixed(0)}% of prior pace.`,
  },
  {
    id: "build-recent-volume",
    title: "Build recent volume",
    priority: "medium",
    trigger: (s) => s.practiceCount < TARGET_SOLVES_14D,
    reason: "Practice volume in the last 14 days is below target.",
    evidence: (s) => [
      { label: "Solves in last 14 days", value: `${s.practiceCount}` },
      { label: "Practice days in last 14", value: `${s.practiceDaysInLast14}` },
    ],
    suggestedDrill: "Complete 5 sessions of 25 solves before the next competition.",
    target: `${TARGET_SOLVES_14D} solves in the last 14 days.`,
  },
  {
    id: "reset-training-stimulus",
    title: "Reset training stimulus",
    priority: "low",
    trigger: (s) => s.daysSinceLastPb !== null && s.daysSinceLastPb > STALE_PB_DAYS,
    reason: "No personal record set recently.",
    evidence: (s) => [{ label: "Days since last PB", value: fmtDays(s.daysSinceLastPb as number) }],
    suggestedDrill: "Switch to a different practice format for one week (OH, one scramble type, or slow-turning blocks).",
    target: `A new PB within ${STALE_PB_DAYS} days.`,
  },
];

const PRIORITY_RANK: Record<FocusPriority, number> = { high: 0, medium: 1, low: 2 };
const MAX_FOCUS_AREAS = 3;

function computeFocusAreas(s: TrainingSignals): FocusArea[] {
  return FOCUS_RULES.filter((rule) => rule.trigger(s))
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      priority: rule.priority,
      reason: rule.reason,
      evidence: rule.evidence(s),
      suggestedDrill: rule.suggestedDrill,
      target: rule.target,
    }))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, MAX_FOCUS_AREAS);
}

function computeConfidence(s: TrainingSignals): CoachConfidence {
  if (s.practiceMeanMs === null) return "low";
  if (s.competitionGapPct === null || s.momentumMs === null) return "medium";
  return "high";
}

function computeLimitations(s: TrainingSignals): string[] {
  const limitations: string[] = [];
  if (s.practiceMeanMs === null) limitations.push("No practice solves in the last 14 days.");
  if (s.competitionConfidence === "insufficient") {
    limitations.push("Not enough competition history for a competition-gap signal.");
  }
  if (s.momentumMs === null) limitations.push("Not enough practice in the last two weeks to measure momentum.");
  if (s.daysSinceLastPb === null) limitations.push("No personal records recorded yet.");
  return limitations;
}

function buildSummary(readiness: ReadinessScore, focusAreas: FocusArea[]): string {
  if (focusAreas.length === 0) return `Readiness: ${readiness.label}. No focus areas flagged.`;
  const rest = focusAreas.length - 1;
  const suffix = rest > 0 ? ` (${rest} more flagged)` : "";
  return `Readiness: ${readiness.label}. Top focus: ${focusAreas[0].title}${suffix}.`;
}

export function computePracticeCoachResult(signals: TrainingSignals): PracticeCoachResult {
  const readiness = computeReadiness(signals);
  const focusAreas = computeFocusAreas(signals);
  return {
    event: signals.event,
    readiness,
    focusAreas,
    summary: buildSummary(readiness, focusAreas),
    confidence: computeConfidence(signals),
    limitations: computeLimitations(signals),
  };
}
