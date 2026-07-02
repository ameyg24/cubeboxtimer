# CubeBox Architecture

This document describes how CubeBox is structured, for contributors.

## Overview

CubeBox is a React single-page application built with Vite, organized into three
layers:

1. **UI (React/JSX)** — components in `src/components` plus the `App.jsx` shell
   handle the timer, inspection, dashboard, and charts. Session and solve state
   (including offline-first Firestore sync) is extracted into the
   `useSolveSessions` hook (`src/hooks`), which components call into rather than
   owning that state themselves.
2. **Analytics (TypeScript)** — `src/analytics` is a pure, framework-free module
   that computes every solve statistic. It has no React, Firebase, or browser
   dependencies.
3. **Persistence** — `src/firebase` initializes Firebase Authentication and Cloud
   Firestore. When Firebase is unconfigured, or the user is offline or signed out,
   the app falls back to `localStorage`.

## Analytics module

All statistics are derived from a list of solves. A solve has the shape:

```ts
{ millis: number; penalty?: "DNF" | "+2" | null }
```

Functions are pure and return a discriminated result rather than mixing numbers
and strings:

```ts
type AverageResult =
  | { status: "ok"; valueMs: number }
  | { status: "dnf" }
  | { status: "insufficient" };
```

Consumers decide presentation: the dashboard renders `dnf` and `insufficient` as
text, while charts map them to gaps (`null`). All computation is done in
milliseconds; UI consumers convert to seconds for display.

### Statistic semantics (WCA-style)

- **mean** — arithmetic mean of all valid solves. DNFs are excluded; +2 penalties
  are applied.
- **mo3** — arithmetic mean of three solves, no trimming. Any DNF makes the result
  a DNF.
- **aoN** (ao5, ao12, ao50, ao100) — drop the fastest and slowest `ceil(5%)`
  solves and average the remainder. DNFs sort as the slowest, so they are trimmed
  first; the result is a DNF only when a DNF survives the trim (i.e. there are more
  DNFs than the trim count).
- **best / worst** — fastest / slowest single valid solve, with +2 applied.

## Persistence and offline behavior

`localStorage` keys are prefixed `cubeboxtimer_*`. These are storage keys, not
branding — renaming them would orphan existing users' local data, so they are kept
stable.

## Testing

The analytics module is unit-tested with Vitest in `src/analytics/__tests__`.
Because the module is pure, the tests are fast and need no DOM or network.
