# CubeBox — Day 1 Architecture

## Long-term vision

CubeBox is evolving from a Rubik's Cube **timer** into a **Speedcubing Performance
Intelligence Platform**. The timer is only the data-capture layer. Planned future
modules: performance analytics, weakness detection, grounded AI coaching, training
planning, competition support, and community features.

To support that, the codebase needs a clean separation between **data capture**
(timer/UI), **analytics** (pure computation), and **persistence** (Firestore +
local fallback). Day 1 establishes the analytics seam.

## Current architecture (before Day 1)

- React 19 + Vite, JavaScript/JSX (no TypeScript).
- Firebase Auth + Firestore, with offline-first local fallback (`localStorage`).
- Chart.js for visualization. Vercel for deployment.
- `App.jsx` is a large monolith holding timer, session, and stats logic.
- **Statistics logic was duplicated and divergent** across `App.jsx`,
  `Dashboard.jsx`, `StatsChart.jsx`, and `Sidebar.jsx` — each with its own copy of
  the averaging rules, and the copies disagreed (see "Bugs" below).
- No tests, no CI, no typechecking.

## Day 1 target architecture

A single pure analytics module is now the source of truth for all stat math:

```
src/analytics/
  types.ts         # Solve, Penalty, AverageResult (discriminated union)
  time.ts          # isDNF / isPlus2 / isValidSolve / effectiveMillis
  averages.ts      # averageOfN, ao5/ao12/ao50/ao100, mo3, mean, best, worst,
                   # rolling/best/worst-average helpers
  sessionStats.ts  # computeSessionStats() — aggregate for the dashboard cards
  index.ts         # public entry point
  __tests__/       # Vitest unit tests (31 cases)
```

`App.jsx`, `Dashboard.jsx`, `StatsChart.jsx`, and `Sidebar.jsx` now **import** from
`src/analytics` instead of each carrying their own copy.

### Module design principles

- **Pure**: no React, Firebase, or browser APIs. Plain solve objects in, plain
  results out. Trivially testable and reusable by a future backend.
- **Milliseconds internally**: all computation is in ms; UI consumers convert to
  seconds for display.
- **Discriminated result contract** instead of mixed string/number returns:
  ```ts
  type AverageResult =
    | { status: "ok"; valueMs: number }
    | { status: "dnf" }
    | { status: "insufficient" };
  ```
  Consumers decide presentation: dashboard/sidebar render `dnf`/`insufficient` as
  text; charts map them to `null` (line gaps).

## WCA / stat bugs discovered and fixed

The four duplicated implementations diverged. Canonical behavior is now WCA-style;
intentional changes:

1. **mo3 was median-of-3, not mean-of-3.** `Dashboard` computed mo3 by calling its
   trimmed-average helper on 3 solves, which dropped best+worst and left the middle
   one (the median). Fixed: `mo3` is the arithmetic mean of 3 (any DNF ⇒ DNF).
2. **ao5/ao12 with exactly one DNF over-trimmed.** All copies trimmed one fastest
   and one slowest *valid* time and ignored that the DNF is itself the trimmed
   worst — so a 1-DNF ao5 averaged only 2 solves instead of the correct 3. Fixed:
   DNFs sort to the end and are trimmed first; a 1-DNF ao5 trims the DNF + the
   fastest valid and averages the remaining three.
3. **Sidebar best/mean ignored the +2 penalty.** Sidebar computed best/mean from
   raw `millis` while its own ao5 (and the dashboard) added +2. Fixed: best/mean
   now apply +2 consistently.
4. **ao50/ao100 trimmed only one each end.** Now uses the WCA 5% rule
   (`ceil(n*0.05)`): 3 each end for ao50, 5 for ao100. (ao5/ao12 unchanged at 1.)
5. **DNF/insufficient were conflated.** Previously both could surface as `null`.
   Now distinguished via the result contract.

Chart overlays still plot **valid solves** on the x-axis (unchanged, no redesign);
they now use the shared `rollingAverageOfN` over that valid series.

## Decisions deferred (not Day 1)

- Full TypeScript migration of the app (only the analytics module is TS).
- Breaking up the `App.jsx` monolith.
- Backend / API, AI coaching, vector search, embeddings.
- Social/community features and any UI redesign.
- `localStorage` keys remain `cubeboxtimer_*` on purpose — renaming them would wipe
  existing users' local data. They are persistence keys, not branding.
- Reworking the chart x-axis to include DNF positions.
