// Worker entry point: the thinnest possible glue between the Worker global
// and the testable core. All behavior lives in analyticsWorkerCore.ts.

import { createWorkerCore } from "./analyticsWorkerCore";

// Compiled with the DOM lib, so `self` types as Window; in a dedicated
// worker it is the worker scope with a single-argument postMessage.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};

const core = createWorkerCore();

scope.onmessage = (event: MessageEvent) => {
  scope.postMessage(core.handle(event.data));
};
