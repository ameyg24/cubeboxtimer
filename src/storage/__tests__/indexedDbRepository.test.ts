import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describeRepositoryContract } from "./repositoryContract";
import { createIndexedDbRepository } from "../indexedDb";

// A fresh IDBFactory per test gives each contract case an empty database
// without relying on deleteDatabase ordering.
describeRepositoryContract("indexedDb", () => {
  globalThis.indexedDB = new IDBFactory();
  return createIndexedDbRepository();
});
