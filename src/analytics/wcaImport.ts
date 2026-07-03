// CubeBox analytics — WCA competition result import (pure).
//
// Turns raw WCA public API data into CompetitionResult-shaped import
// candidates, and decides deterministically what to do with each one
// against a user's existing competition history. This module does no
// fetching itself (see src/hooks/wcaApi.js for that) — everything here is
// pure, framework-free interpretation of already-fetched WCA data, matching
// the same "no React, Firebase, or browser dependencies" bar as the rest of
// src/analytics, even though the subject matter (WCA import) is a
// different concern from solve statistics.
//
// WCA API behavior this module relies on (verified against the live public
// API before writing this file):
//   - GET /api/v0/persons/{wcaId}/results returns every result the person
//     has ever recorded, across every event and every round.
//   - Times are in centiseconds. -1 = DNF, -2 = DNS, 0 = an unused attempt
//     slot (e.g. a Bo3 round's unused 4th/5th attempt slots) or "no result".
//   - A (competition, event) pair can have multiple rounds. Round
//     progression is reliably tracked by round_id ascending (verified: a
//     first round always has a lower round_id than that competition's
//     final round for the same event) — the highest round_id per group is
//     "the" result WCA itself treats as final for that competition+event.
//   - GET /api/v0/competitions/{id} gives the competition's name and date,
//     but there is no bulk-lookup endpoint, so the caller fetches this once
//     per unique competition_id.

export type ImportedCompetitionEvent = "2x2x2" | "3x3x3" | "4x4x4" | "5x5x5";

// Only WCA's standard NxNxN speedsolving events have a CubeBox equivalent —
// every other WCA event (blindfolded, one-handed, FMC, megaminx, ...) is
// intentionally left unmapped and its results are skipped on import.
const WCA_EVENT_TO_CUBE_DIMENSION: Record<string, ImportedCompetitionEvent> = {
  "222": "2x2x2",
  "333": "3x3x3",
  "444": "4x4x4",
  "555": "5x5x5",
};

export function mapWcaEventToCubeDimension(wcaEventId: string): ImportedCompetitionEvent | null {
  return WCA_EVENT_TO_CUBE_DIMENSION[wcaEventId] ?? null;
}

// WCA ID format: 4-digit year + 4-letter name code + 2-digit disambiguator,
// e.g. "2009ZEMD01" — WCA's own long-standing public ID format.
const WCA_ID_PATTERN = /^\d{4}[A-Z]{4}\d{2}$/;
export const WCA_ID_EXAMPLE = "2009ZEMD01";

export function normalizeWcaId(rawId: string): string {
  return typeof rawId === "string" ? rawId.trim().toUpperCase() : "";
}

export function isValidWcaId(rawId: string): boolean {
  return WCA_ID_PATTERN.test(normalizeWcaId(rawId));
}

/**
 * Converts a WCA time value (centiseconds, with DNF/DNS/unused-slot
 * sentinels) into milliseconds, or null when there's no usable time.
 * -1 (DNF), -2 (DNS), 0 (unused/unattempted), and any other non-positive or
 * non-finite value all map to null — CompetitionResult has no separate DNF
 * concept, so a result with no usable time is simply not importable (see
 * buildImportCandidates).
 */
export function wcaCentisecondsToMs(value: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10);
}

export interface WcaRawResult {
  competition_id: string;
  event_id: string;
  round_id: number;
  best: number;
  average: number;
}

/**
 * Reduces every round a person competed in down to one result per
 * (competition, event): the highest round_id in that group, i.e. the
 * deepest/final round — the same result WCA's own person-results page
 * treats as "the" result for that competition and event.
 */
export function selectFinalRoundResults(results: WcaRawResult[]): WcaRawResult[] {
  const list = Array.isArray(results) ? results : [];
  const byGroup = new Map<string, WcaRawResult>();
  for (const r of list) {
    const key = `${r.competition_id}::${r.event_id}`;
    const existing = byGroup.get(key);
    if (!existing || r.round_id > existing.round_id) {
      byGroup.set(key, r);
    }
  }
  return Array.from(byGroup.values());
}

export interface WcaCompetitionMeta {
  name: string;
  /** ISO date string. */
  date: string;
}

export type SkipReason = "unsupported-event" | "dnf-or-dns-average" | "missing-competition-metadata";

export interface SkippedWcaResult {
  competitionId: string;
  eventId: string;
  reason: SkipReason;
}

export interface WcaImportCandidate {
  wcaCompetitionId: string;
  event: ImportedCompetitionEvent;
  competitionName: string;
  /** ISO date string. */
  date: string;
  averageMs: number;
  bestMs: number | null;
}

/**
 * Converts final-round WCA results into CompetitionResult-shaped import
 * candidates. Skips (rather than fabricates a value for) any result whose
 * event has no CubeBox equivalent, whose official average was a DNF/DNS,
 * or whose competition metadata couldn't be fetched — every skip is
 * reported with a reason so the caller can show the user what happened.
 */
export function buildImportCandidates(
  rawResults: WcaRawResult[],
  competitionMetaById: Map<string, WcaCompetitionMeta>
): { candidates: WcaImportCandidate[]; skipped: SkippedWcaResult[] } {
  const finalRoundResults = selectFinalRoundResults(rawResults);
  const candidates: WcaImportCandidate[] = [];
  const skipped: SkippedWcaResult[] = [];

  for (const result of finalRoundResults) {
    const event = mapWcaEventToCubeDimension(result.event_id);
    if (!event) {
      skipped.push({ competitionId: result.competition_id, eventId: result.event_id, reason: "unsupported-event" });
      continue;
    }

    const averageMs = wcaCentisecondsToMs(result.average);
    if (averageMs === null) {
      skipped.push({ competitionId: result.competition_id, eventId: result.event_id, reason: "dnf-or-dns-average" });
      continue;
    }

    const meta = competitionMetaById.get(result.competition_id);
    if (!meta) {
      skipped.push({
        competitionId: result.competition_id,
        eventId: result.event_id,
        reason: "missing-competition-metadata",
      });
      continue;
    }

    candidates.push({
      wcaCompetitionId: result.competition_id,
      event,
      competitionName: meta.name,
      date: meta.date,
      averageMs,
      bestMs: wcaCentisecondsToMs(result.best),
    });
  }

  return { candidates, skipped };
}

// ---------------------------------------------------------------------
// Duplicate / conflict policy
// ---------------------------------------------------------------------
// The minimal shape this module needs from a persisted CompetitionResult -
// matches useCompetitionResults.js's normalizeCompetitionDoc output.
export interface PersistedCompetitionResultLike {
  id: string;
  competitionName: string;
  date: string;
  event: string;
  averageMs: number | null;
  bestMs: number | null;
  source: string;
  wcaCompetitionId?: string | null;
}

function sameCalendarDay(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a) && Boolean(b) && (a as string).slice(0, 10) === (b as string).slice(0, 10);
}

function normalizeName(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A deliberately simple, deterministic "is this probably the same
 * competition" check — not a fuzzy-matching library. Two names are similar
 * when normalized they're identical, one contains the other, or they share
 * at least half of their significant (length > 2) words.
 */
export function namesAreSimilar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;

  const wordsA = new Set(na.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
  return overlap / Math.min(wordsA.size, wordsB.size) >= 0.5;
}

export interface DuplicateCheckCandidate {
  event: string;
  date: string;
  competitionName: string;
  averageMs: number | null;
  bestMs: number | null;
}

export interface DuplicateCheckResult {
  type: "none" | "duplicate" | "conflict";
  matchId: string | null;
  reason: string | null;
}

/**
 * The shared primitive behind both directions of the duplicate policy:
 * checking a new WCA-import candidate against existing records, and
 * checking a new manual entry against existing records (including past
 * imports). Only ever compares records for the same event and calendar day
 * - anything else is unrelated by definition.
 *
 *   - Same event + date + identical average/best -> "duplicate" (already present).
 *   - Same event + date + similar competition name but different values -> "conflict"
 *     (never silently overwritten - the caller decides whether to skip or
 *     let the user confirm).
 *   - Same event + date but an unrelated name and different values -> "none"
 *     (two genuinely different results happening to share a date).
 */
export function checkForDuplicateOrConflict(
  candidate: DuplicateCheckCandidate,
  existingCompetitions: PersistedCompetitionResultLike[],
  excludeId: string | null = null
): DuplicateCheckResult {
  const sameEventDate = (existingCompetitions || []).filter(
    (c) => c.id !== excludeId && c.event === candidate.event && sameCalendarDay(c.date, candidate.date)
  );

  const identical = sameEventDate.find(
    (c) => c.averageMs === candidate.averageMs && c.bestMs === candidate.bestMs
  );
  if (identical) {
    return {
      type: "duplicate",
      matchId: identical.id,
      reason: "A result with the same event, date, and times already exists.",
    };
  }

  const similarName = sameEventDate.find((c) => namesAreSimilar(c.competitionName, candidate.competitionName));
  if (similarName) {
    return {
      type: "conflict",
      matchId: similarName.id,
      reason: `"${similarName.competitionName}" already has a result for this event and date with different times.`,
    };
  }

  return { type: "none", matchId: null, reason: null };
}

export type ImportDecision =
  | { type: "create" }
  | { type: "update"; existingId: string; reason: string }
  | { type: "skip-duplicate"; reason: string }
  | { type: "conflict"; existingId: string; reason: string };

/**
 * Decides what to do with one import candidate against the user's existing
 * competition history. Checked in order:
 *
 *   1. Same wcaCompetitionId + event as a previous import -> this is a
 *      re-import of the same result. Identical values: skip as a
 *      duplicate. Different values (e.g. a late DQ or results correction
 *      on WCA's side): deterministically update that same record - this is
 *      safe specifically because it's the same wcaCompetitionId, not a
 *      different competition being folded into an existing one.
 *   2/3. Otherwise, run the shared duplicate/conflict check against every
 *      existing record (manual or imported). A manual record is never
 *      silently overwritten by either path.
 */
export function decideImportAction(
  candidate: WcaImportCandidate,
  existingCompetitions: PersistedCompetitionResultLike[]
): ImportDecision {
  const list = Array.isArray(existingCompetitions) ? existingCompetitions : [];

  const existingImport = list.find(
    (c) =>
      c.source === "wca-import" &&
      c.wcaCompetitionId === candidate.wcaCompetitionId &&
      c.event === candidate.event
  );
  if (existingImport) {
    const sameValues = existingImport.averageMs === candidate.averageMs && existingImport.bestMs === candidate.bestMs;
    return sameValues
      ? { type: "skip-duplicate", reason: "Already imported with identical values." }
      : {
          type: "update",
          existingId: existingImport.id,
          reason: "Already imported for this competition and event; updating with the latest WCA values.",
        };
  }

  const check = checkForDuplicateOrConflict(candidate, list);
  if (check.type === "duplicate") {
    return { type: "skip-duplicate", reason: check.reason as string };
  }
  if (check.type === "conflict") {
    return { type: "conflict", existingId: check.matchId as string, reason: check.reason as string };
  }
  return { type: "create" };
}
