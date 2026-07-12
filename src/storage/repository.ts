// The storage boundary. Four methods shaped by how the app actually uses
// persistence today: hydrate everything once at startup, then write the
// full snapshot after each change (the same semantics the localStorage
// blobs had - saves are replace-all, so deletes need no separate call).
// Finer-grained writes arrive with the operation-log phase, not before.

import type { PersistedCompetition, PersistedSession } from "./types";

export interface StorageRepository {
  loadSessions(): Promise<PersistedSession[]>;
  saveSessions(sessions: PersistedSession[]): Promise<void>;
  loadCompetitions(): Promise<PersistedCompetition[]>;
  saveCompetitions(competitions: PersistedCompetition[]): Promise<void>;
}

// In-memory implementation for tests and future differential harnesses.
// structuredClone on both sides keeps stored state and caller state
// disconnected, matching what a real serialization boundary does.
export function createMemoryRepository(): StorageRepository {
  let sessions: PersistedSession[] = [];
  let competitions: PersistedCompetition[] = [];
  return {
    loadSessions: async () => structuredClone(sessions),
    saveSessions: async (next) => {
      sessions = structuredClone(next);
    },
    loadCompetitions: async () => structuredClone(competitions),
    saveCompetitions: async (next) => {
      competitions = structuredClone(next);
    },
  };
}
