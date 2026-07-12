// Shape coercion for persisted records, moved verbatim from
// useSolveSessions.js / useCompetitionResults.js so the hooks, the
// localStorage-to-IndexedDB migration, and future replay/differential
// phases all normalize through one definition. Behavior is unchanged;
// the hooks re-export what their callers already import.

import { CUBE_DIMENSIONS } from "./types";
export { CUBE_DIMENSIONS } from "./types";
import type {
  PersistedCompetition,
  PersistedSession,
  PersistedSolve,
  SolvesByEvent,
} from "./types";

export function createEmptySolves(): SolvesByEvent {
  return CUBE_DIMENSIONS.reduce((acc, dimension) => {
    acc[dimension] = [];
    return acc;
  }, {} as SolvesByEvent);
}

export function createSolveId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createCompetitionId(): string {
  return createSolveId();
}

export function normalizeSolveDoc(
  solve: Partial<PersistedSolve>,
  fallbackId?: string | number,
  fallbackDimension?: string
): PersistedSolve {
  const id = String(solve.id || fallbackId || createSolveId());
  return {
    ...solve,
    id,
    cubeDimension: solve.cubeDimension || fallbackDimension || "3x3x3",
  };
}

export function normalizeSolvesShape(solves: unknown): SolvesByEvent {
  const normalized = createEmptySolves();
  if (!solves) return normalized;
  if (Array.isArray(solves)) {
    normalized["3x3x3"] = solves.map((solve) => normalizeSolveDoc(solve, undefined, "3x3x3"));
    return normalized;
  }
  const byEvent = solves as Record<string, unknown>;
  CUBE_DIMENSIONS.forEach((dimension) => {
    const forEvent = byEvent[dimension];
    normalized[dimension] = Array.isArray(forEvent)
      ? forEvent.map((solve) => normalizeSolveDoc(solve, undefined, dimension))
      : [];
  });
  return normalized;
}

export function normalizeSessionsShape(sessions: PersistedSession[]): PersistedSession[] {
  return sessions.map((session) => ({
    ...session,
    solves: normalizeSolvesShape(session.solves),
  }));
}

export function normalizeCompetitionDoc(
  competitionDoc: Partial<PersistedCompetition> | null | undefined,
  fallbackId?: string
): PersistedCompetition {
  const source = competitionDoc || {};
  return {
    id: String(source.id || fallbackId || createCompetitionId()),
    competitionName: source.competitionName || "",
    date: source.date || new Date().toISOString(),
    event: source.event || "3x3x3",
    bestMs: typeof source.bestMs === "number" ? source.bestMs : null,
    averageMs: typeof source.averageMs === "number" ? source.averageMs : null,
    source: source.source || "manual",
    notes: source.notes || undefined,
    // Set only for source: "wca-import" records - the stable identifier
    // analytics/wcaImport.ts's duplicate policy matches future imports
    // against, so re-importing never creates a second record for the same
    // WCA competition + event + round.
    wcaCompetitionId: source.wcaCompetitionId || null,
    // The specific WCA round this record is (a competition can have several
    // - First round, Semi Final, Final, ...), each imported as its own
    // record. Combined with wcaCompetitionId + event, this is what lets a
    // re-import tell "update this round" apart from "this is a different
    // round of the same competition."
    wcaRoundId: typeof source.wcaRoundId === "number" ? source.wcaRoundId : null,
    // Human-readable label for wcaRoundId (e.g. "First round", "Final") -
    // shown next to the result in the Competition Results list.
    roundLabel: source.roundLabel || null,
    // The WCA person ID this record was imported from - findLinkedWcaId
    // (analytics/wcaImport.ts) reads this to lock future imports to the
    // same WCA ID, so two different competitors' results can never end up
    // mixed into one history.
    wcaId: source.wcaId || null,
  };
}

export function normalizeCompetitionsShape(competitions: unknown): PersistedCompetition[] {
  return Array.isArray(competitions)
    ? competitions.map((c) => normalizeCompetitionDoc(c))
    : [];
}

export function byDateAscending(a: PersistedCompetition, b: PersistedCompetition): number {
  return (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
}
