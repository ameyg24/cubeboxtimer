// Deterministic replay: (initial snapshot, ordered operation list) ->
// final state, by folding the reference reducer. Everything a mutation
// needed from the environment at capture time (crypto ids, wall-clock
// timestamps, generated session names) travels inside the operation
// payloads, so replay itself never touches a clock, random source, or any
// global state: the same snapshot and operations always produce the
// identical final state.
//
// Scope: operations model the app's local durable mutations. The three
// non-operation state sources (initial hydration, the hooks' default
// session bootstrap, and Firestore snapshot deliveries in signed-in mode)
// are snapshot boundaries: replay starts from a snapshot taken after
// them. Operations are supplied by the caller; nothing in production
// persists an operation log.

import { applyOperation } from "./referenceState";
import type { ReferenceState } from "./referenceState";

export interface ReplaySuccess {
  ok: true;
  state: ReferenceState;
  operationCount: number;
}

export interface ReplayFailure {
  ok: false;
  operationIndex: number;
  operation: unknown;
  reason: string;
  /** State immediately before the failing operation. */
  stateBeforeFailure: ReferenceState;
}

export type ReplayOutcome = ReplaySuccess | ReplayFailure;

export function replayOperations(
  initial: ReferenceState,
  operations: readonly unknown[]
): ReplayOutcome {
  let state = initial;
  for (let index = 0; index < operations.length; index++) {
    try {
      state = applyOperation(state, operations[index]);
    } catch (error) {
      return {
        ok: false,
        operationIndex: index,
        operation: operations[index],
        reason: error instanceof Error ? error.message : String(error),
        stateBeforeFailure: state,
      };
    }
  }
  return { ok: true, state, operationCount: operations.length };
}
