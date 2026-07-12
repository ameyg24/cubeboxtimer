// Persisted domain records. These are open shapes: solves and competitions
// carry fields this layer never interprets (scramble, notes, WCA metadata),
// and persistence must round-trip them untouched, so every record keeps an
// unknown-field index signature alongside the fields the storage and
// normalization code actually reads.

export const CUBE_DIMENSIONS = ["2x2x2", "3x3x3", "4x4x4", "5x5x5"] as const;

export type CubeDimension = (typeof CUBE_DIMENSIONS)[number];

export interface PersistedSolve {
  id: string;
  cubeDimension: string;
  millis?: number;
  penalty?: string | null;
  reviewed?: boolean;
  localCreatedAt?: number;
  [extra: string]: unknown;
}

export type SolvesByEvent = Record<string, PersistedSolve[]>;

export interface PersistedSession {
  id: string;
  name?: string;
  createdAt?: number;
  solves: SolvesByEvent;
  [extra: string]: unknown;
}

export interface PersistedCompetition {
  id: string;
  competitionName: string;
  date: string;
  event: string;
  bestMs: number | null;
  averageMs: number | null;
  source: string;
  notes?: string;
  wcaCompetitionId: string | null;
  wcaRoundId: number | null;
  roundLabel: string | null;
  wcaId: string | null;
  [extra: string]: unknown;
}
