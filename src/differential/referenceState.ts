// The reference state-transition implementation: (previous state,
// operation) -> next state, applying the Phase 1 operation vocabulary with
// the exact semantics the main-thread hooks implement. Intentionally
// simple and unoptimized - no caching, no incremental maintenance, no
// input mutation. This is the correctness oracle future optimizations must
// match byte for byte.
//
// Semantics mirrored from the hooks:
// - AddSolve appends to the target session's per-event array
//   (useSolveSessions.addSolve).
// - UpdateSolve merges the patch into the solve matched by String(id)
//   within the given event; a missing target is a no-op, exactly like the
//   hook's map-by-index finding nothing.
// - DeleteSolve filters by String(id); missing target is a no-op.
// - AddSession appends; RemoveSession filters. The hooks' refusal to
//   remove the last session is UI policy, not operation semantics; the
//   generator never emits it.
// - AddCompetitionResult appends then re-sorts by date ascending
//   (useCompetitionResults.addCompetitionResult); updates merge by id;
//   deletes filter by id.

import { CUBE_DIMENSIONS, byDateAscending, createEmptySolves } from "../storage/normalize";
import { validateOperation } from "../storage/operations";
import type { Operation } from "../storage/operations";
import type { PersistedCompetition, PersistedSession, PersistedSolve } from "../storage/types";
import type { SolvesByEvent } from "../worker/protocol";

export interface ReferenceState {
  sessions: PersistedSession[];
  competitions: PersistedCompetition[];
}

export function emptyReferenceState(): ReferenceState {
  return { sessions: [], competitions: [] };
}

function withSessionSolves(
  state: ReferenceState,
  sessionId: string,
  event: string,
  update: (solves: PersistedSolve[]) => PersistedSolve[]
): ReferenceState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            solves: {
              ...session.solves,
              [event]: update(session.solves[event] || []),
            },
          }
        : session
    ),
  };
}

export function applyOperation(state: ReferenceState, candidate: unknown): ReferenceState {
  const validation = validateOperation(candidate);
  if (!validation.ok) {
    throw new Error(`invalid operation: ${validation.reason}`);
  }
  const op: Operation = validation.operation;

  switch (op.type) {
    case "AddSolve":
      if (!state.sessions.some((s) => s.id === op.sessionId)) {
        throw new Error(`AddSolve targets unknown session: ${op.sessionId}`);
      }
      return withSessionSolves(state, op.sessionId, op.cubeDimension, (solves) => [
        ...solves,
        op.solve,
      ]);

    case "UpdateSolve":
      return withSessionSolves(state, op.sessionId, op.cubeDimension, (solves) =>
        solves.map((solve) =>
          String(solve.id) === String(op.solveId) ? { ...solve, ...op.patch } : solve
        )
      );

    case "DeleteSolve":
      return withSessionSolves(state, op.sessionId, op.cubeDimension, (solves) =>
        solves.filter((solve) => String(solve.id) !== String(op.solveId))
      );

    case "AddSession": {
      // Omit + the open index signature defeats TS's spread inference; the
      // runtime shape is a complete session.
      const session = {
        ...op.session,
        solves: op.session.solves || createEmptySolves(),
      } as PersistedSession;
      return { ...state, sessions: [...state.sessions, session] };
    }

    case "RemoveSession":
      return {
        ...state,
        sessions: state.sessions.filter((session) => session.id !== op.sessionId),
      };

    case "AddCompetitionResult":
      return {
        ...state,
        competitions: [...state.competitions, op.competition].sort(byDateAscending),
      };

    case "UpdateCompetitionResult":
      return {
        ...state,
        competitions: state.competitions.map((c) =>
          c.id === op.competitionId ? { ...c, ...op.patch } : c
        ),
      };

    case "DeleteCompetitionResult":
      return {
        ...state,
        competitions: state.competitions.filter((c) => c.id !== op.competitionId),
      };
  }
}

/** The exact projection the app feeds to analytics (see useAnalyticsDataset). */
export function flattenForAnalytics(state: ReferenceState): {
  solvesByEvent: SolvesByEvent;
  competitions: PersistedCompetition[];
} {
  const solvesByEvent: SolvesByEvent = {};
  CUBE_DIMENSIONS.forEach((dimension) => {
    solvesByEvent[dimension] = state.sessions.flatMap((session) =>
      Array.isArray(session.solves?.[dimension]) ? session.solves[dimension] : []
    );
  });
  return { solvesByEvent, competitions: state.competitions };
}
