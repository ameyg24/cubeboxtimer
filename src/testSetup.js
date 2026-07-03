import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
