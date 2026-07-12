// Shared mutation vocabulary. One operation type per durable mutation the
// app can currently perform; later phases (operation log, worker messages,
// randomized differential tests, replay) all speak this vocabulary instead
// of inventing their own. Deliberately absent:
//   SetPenalty        - penalties are an UpdateSolve patch today
//   ImportSolves      - csTimer import calls addSolve once per row
//   ImportCompetitionResults - WCA import calls add/update per round
// Timestamps (localCreatedAt, createdAt) travel inside the payloads only
// when the caller supplied them; nothing here reads the clock, so replaying
// an operation later produces the identical record.

import type { PersistedCompetition, PersistedSession, PersistedSolve } from "./types";

export interface AddSolveOp {
  type: "AddSolve";
  sessionId: string;
  cubeDimension: string;
  solve: PersistedSolve;
}

export interface UpdateSolveOp {
  type: "UpdateSolve";
  sessionId: string;
  cubeDimension: string;
  solveId: string;
  patch: Record<string, unknown>;
}

export interface DeleteSolveOp {
  type: "DeleteSolve";
  sessionId: string;
  cubeDimension: string;
  solveId: string;
}

export interface AddSessionOp {
  type: "AddSession";
  session: Omit<PersistedSession, "solves"> & { solves?: PersistedSession["solves"] };
}

export interface RemoveSessionOp {
  type: "RemoveSession";
  sessionId: string;
}

export interface AddCompetitionResultOp {
  type: "AddCompetitionResult";
  competition: PersistedCompetition;
}

export interface UpdateCompetitionResultOp {
  type: "UpdateCompetitionResult";
  competitionId: string;
  patch: Record<string, unknown>;
}

export interface DeleteCompetitionResultOp {
  type: "DeleteCompetitionResult";
  competitionId: string;
}

export type Operation =
  | AddSolveOp
  | UpdateSolveOp
  | DeleteSolveOp
  | AddSessionOp
  | RemoveSessionOp
  | AddCompetitionResultOp
  | UpdateCompetitionResultOp
  | DeleteCompetitionResultOp;

export type ValidationResult =
  | { ok: true; operation: Operation }
  | { ok: false; reason: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const invalid = (reason: string): ValidationResult => ({ ok: false, reason });

export function validateOperation(candidate: unknown): ValidationResult {
  if (!isPlainObject(candidate)) return invalid("operation must be an object");
  const op = candidate;
  switch (op.type) {
    case "AddSolve":
      if (!isNonEmptyString(op.sessionId)) return invalid("AddSolve requires sessionId");
      if (!isNonEmptyString(op.cubeDimension)) return invalid("AddSolve requires cubeDimension");
      if (!isPlainObject(op.solve) || !isNonEmptyString(op.solve.id)) {
        return invalid("AddSolve requires a solve with an id");
      }
      break;
    case "UpdateSolve":
      if (!isNonEmptyString(op.sessionId)) return invalid("UpdateSolve requires sessionId");
      if (!isNonEmptyString(op.cubeDimension)) return invalid("UpdateSolve requires cubeDimension");
      if (!isNonEmptyString(op.solveId)) return invalid("UpdateSolve requires solveId");
      if (!isPlainObject(op.patch)) return invalid("UpdateSolve requires a patch object");
      break;
    case "DeleteSolve":
      if (!isNonEmptyString(op.sessionId)) return invalid("DeleteSolve requires sessionId");
      if (!isNonEmptyString(op.cubeDimension)) return invalid("DeleteSolve requires cubeDimension");
      if (!isNonEmptyString(op.solveId)) return invalid("DeleteSolve requires solveId");
      break;
    case "AddSession":
      if (!isPlainObject(op.session) || !isNonEmptyString(op.session.id)) {
        return invalid("AddSession requires a session with an id");
      }
      break;
    case "RemoveSession":
      if (!isNonEmptyString(op.sessionId)) return invalid("RemoveSession requires sessionId");
      break;
    case "AddCompetitionResult":
      if (!isPlainObject(op.competition) || !isNonEmptyString(op.competition.id)) {
        return invalid("AddCompetitionResult requires a competition with an id");
      }
      break;
    case "UpdateCompetitionResult":
      if (!isNonEmptyString(op.competitionId)) return invalid("UpdateCompetitionResult requires competitionId");
      if (!isPlainObject(op.patch)) return invalid("UpdateCompetitionResult requires a patch object");
      break;
    case "DeleteCompetitionResult":
      if (!isNonEmptyString(op.competitionId)) return invalid("DeleteCompetitionResult requires competitionId");
      break;
    default:
      return invalid(`unknown operation type: ${String(op.type)}`);
  }
  return { ok: true, operation: op as unknown as Operation };
}
