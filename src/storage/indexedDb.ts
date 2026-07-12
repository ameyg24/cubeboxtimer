// IndexedDB-backed repository. Raw IndexedDB behind small promise helpers:
// the four repository methods need exactly open / getAll / clear+put, which
// is too little surface to justify a wrapper dependency.
//
// Schema v1: two object stores, "sessions" and "competitions", both using
// out-of-line auto-incremented keys so getAll returns records in the exact
// order the snapshot was written (the hooks depend on stored array order;
// a keyPath of "id" would silently re-sort by id string). Domain ids live
// inside the records, untouched. No secondary indexes: every read the app
// performs is a full hydration at startup; event scoping, chronological
// ordering, and import duplicate detection all run in memory over the
// hydrated arrays. An index gets added when a query needs it, not before.
//
// Saves are replace-all inside one transaction (clear + put each record).
// IndexedDB transactions are atomic, so a failed save leaves the previous
// snapshot intact rather than a partial mix.

import type { StorageRepository } from "./repository";
import type { PersistedCompetition, PersistedSession } from "./types";

export const DB_NAME = "cubeboxtimer";
export const DB_VERSION = 1;
const SESSIONS_STORE = "sessions";
const COMPETITIONS_STORE = "competitions";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
      db.createObjectStore(SESSIONS_STORE, { autoIncrement: true });
    }
    if (!db.objectStoreNames.contains(COMPETITIONS_STORE)) {
      db.createObjectStore(COMPETITIONS_STORE, { autoIncrement: true });
    }
  };
  return requestToPromise(request);
}

async function readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  const store = db.transaction(storeName, "readonly").objectStore(storeName);
  return requestToPromise(store.getAll() as IDBRequest<T[]>);
}

function replaceAll<T>(
  db: IDBDatabase,
  storeName: string,
  records: T[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    const store = tx.objectStore(storeName);
    store.clear();
    records.forEach((record) => store.put(record));
  });
}

export function createIndexedDbRepository(): StorageRepository {
  // One shared open per repository; IndexedDB connections are cheap to hold
  // and the browser closes them with the page.
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDb = () => {
    if (!dbPromise) dbPromise = openDatabase();
    return dbPromise;
  };

  return {
    loadSessions: async () => readAll<PersistedSession>(await getDb(), SESSIONS_STORE),
    saveSessions: async (sessions) => replaceAll(await getDb(), SESSIONS_STORE, sessions),
    loadCompetitions: async () => readAll<PersistedCompetition>(await getDb(), COMPETITIONS_STORE),
    saveCompetitions: async (competitions) =>
      replaceAll(await getDb(), COMPETITIONS_STORE, competitions),
  };
}
