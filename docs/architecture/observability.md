# Observability

This document covers how CubeBox logs, what it instruments, and why there's
no external telemetry service wired in yet.

## Logging strategy

Every module logs through the single module at [`src/logger.js`](../../src/logger.js)
instead of calling `console` directly. ESLint enforces this (`no-console` is
an error everywhere except `src/logger.js` itself), so it can't quietly
regress back to scattered `console.log` calls.

The logger has four levels - `debug`, `info`, `warn`, `error` - matched
one-to-one to `console.debug/info/warn/error` so browser devtools' own level
filtering still works. In development (`import.meta.env.DEV`), all four
levels are emitted. In production, `debug` is suppressed; `info`/`warn`/`error`
still log. That's the whole policy: `debug` is for "what is this code doing
right now" detail you only want while working on it; `info` and above are
things worth seeing in a real deployment (a completed sync, a resolved auth
state, a failure of any kind).

The logger is a factory (`createLogger(isDev)`) so tests can exercise both
thresholds directly (`src/__tests__/logger.test.js`) without needing to
fight Vite's build-time replacement of `import.meta.env`. The app uses the
default singleton export, `logger`, which reads the real `import.meta.env.DEV`.

Every call site chooses its own level deliberately - this was decided
per-call, not defaulted:
- **`debug`** - frequent or fast operations only useful while developing:
  scramble generation, analytics recomputation on every render, per-move
  detail. Noisy in production for little operational value, so it's dropped.
- **`info`** - meaningful, infrequent lifecycle events worth seeing in
  production: app mounted, Firebase initialized, auth state resolved,
  sign-in/sign-out succeeded, a session or sync load completed, the chart
  module finished loading.
- **`warn`** - a recoverable failure the app already has a fallback for
  (a corrupted local write queue, a failed sync that will retry, a failed
  clipboard write). The user isn't blocked; a maintainer should still know.
- **`error`** - a boundary actually caught a render crash, or something that
  shouldn't be recoverable happened (a solve migration failing outright).

## Instrumentation strategy

There's no dedicated timing API - no `logger.time()`, no stopwatch class.
Call sites take a `performance.now()` reading, do the work, and log the
elapsed milliseconds as part of the same message's context object. That
keeps the logger itself to four methods and puts the instrumentation
decision (what to measure, at what level) next to the code being measured
instead of behind an abstraction.

What's currently measured, and where:
- **App startup** - `src/App.jsx`, a `useEffect` that fires once after the
  app shell first commits. `performance.now()` at that point is already
  "time since navigation start," so no manual start-mark bookkeeping is
  needed.
- **Session loading** - `src/hooks/useSolveSessions.js`, both the
  `localStorage` path and the Firestore `onSnapshot` path, logged once each
  on their first resolution (not on every subsequent live update).
- **Scramble generation** - `src/App.jsx`, around the batch-of-five
  `generateScramble` calls.
- **Analytics computation** - `src/components/Dashboard.jsx`'s
  `computeStats`/`computeDailyStats` wrappers, *not* inside
  `src/analytics/*.ts` itself. The analytics module is deliberately
  framework- and browser-free (see `docs/architecture/overview.md`); adding
  logging calls inside it would break that boundary for no real benefit,
  since every consumer of it already goes through a small number of call
  sites in the UI layer.
- **Chart lazy loading** - `src/components/Dashboard.jsx`, wrapping the
  `React.lazy(() => import("./StatsChart.jsx"))` dynamic import.
- **Firestore synchronization** - `src/hooks/useSolveSessions.js`'s
  `flushQueue`, covering the whole queued-write flush, not each individual
  write.

## Error boundary reporting

`src/components/ErrorBoundary.jsx` keeps the caught `error` and
`componentStack` on component state (not just passed to a log call and
discarded) and forwards them as a second argument to the `fallback`
render-prop: `fallback(retry, { error, componentStack })`. CubeBox's own
fallback UI doesn't render either of them - no stack traces reach the
user - but they're there for a future diagnostics affordance without
touching the boundary itself again. Every catch logs at `error` with a
`boundary` name (`"app-shell"` or `"dashboard"`) so the two boundaries are
distinguishable in the log; every retry logs at `info`.

## Why no external telemetry exists

Nothing in this app calls out to a network endpoint to report logs, errors,
or timings. That's deliberate, not an oversight:

- CubeBox is a small, offline-first hobby app with no existing
  error-reporting backend, on-call rotation, or budget line for one.
  Wiring up a real telemetry vendor without anyone positioned to act on the
  data would just be a data-collection liability for no operational payoff.
- Sending errors or usage data off-device is a privacy decision, not just an
  engineering one - it deserves an explicit choice (and probably a
  disclosure) at the point someone actually needs it, not a default baked in
  during an unrelated logging cleanup.
- The brief for this milestone was to make the codebase *ready* for
  telemetry, not to add it. Adding a vendor SDK now would mean picking a
  vendor, adding a dependency, and inventing a consent/opt-out story with no
  concrete requirement driving any of those decisions.

## How Sentry/OpenTelemetry could plug in later

Every log call funnels through one function: `write()` inside
`createLogger` in `src/logger.js`. That's the one place a real backend would
be wired in - nothing else in the app would need to change:

```js
function write(level, message, context) {
  if (LEVELS[level] < minLevelFor(isDev())) return;
  console[CONSOLE_METHOD[level]](`[${level}] ${message}`, context);

  // A future telemetry hook would go here, e.g.:
  // if (level === "error" && context?.error) {
  //   Sentry.captureException(context.error, { extra: context });
  // }
  // Or push every entry to an OpenTelemetry log exporter regardless of level.
}
```

For error reporting specifically, `ErrorBoundary`'s preserved `error` and
`componentStack` state means `componentDidCatch` could call
`Sentry.captureException(error, { contexts: { react: { componentStack } } })`
directly - the data it needs is already captured, not re-derived.

For performance data, the existing `durationMs` values already passed as
log context are exactly what an OpenTelemetry span or a custom performance
metric would want; the `write()` hook point above is where they'd get
forwarded instead of (or in addition to) printed to the console.
