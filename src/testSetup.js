import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// jsdom has no IndexedDB, so every test runs against fake-indexeddb. A
// fresh factory per test keeps stored data from leaking between tests the
// same way localStorage.clear() does for the write queues.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// jsdom doesn't implement canvas 2D rendering without the optional "canvas"
// package. Chart.js itself is mocked per-test-file where needed, but this
// stub avoids a noisy "not implemented" warning from the underlying
// <canvas> element that Chart.js still calls getContext() on regardless.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => null;
}

afterEach(() => {
  cleanup();
});
