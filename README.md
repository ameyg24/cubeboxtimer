# CubeBox

[![CI](https://github.com/ameyg24/cubeboxtimer/actions/workflows/ci.yml/badge.svg)](https://github.com/ameyg24/cubeboxtimer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

CubeBox is an open-source speedcubing platform for recording solves, analyzing performance, and helping cubers improve through data-driven insights. It provides a WCA-style timer with inspection and penalties, session management, and rich statistics and charts, with optional cloud sync via Firebase.

## Features

- **WCA-style timer** — start and stop with the spacebar or a tap, with a visual countdown.
- **Inspection & penalties** — 15-second inspection with automatic +2 and DNF handling per WCA rules.
- **WCA-style scrambles** — random-move scrambles for 2x2x2 through 5x5x5 using standard outer-block-turn notation, with no repeated face and no three consecutive moves on the same axis. This is not the random-state scrambling the WCA uses officially for 2x2x2/3x3x3 (that requires a full cube solver); see [`src/scramble.js`](src/scramble.js) for the exact rules.
- **Session management** — create, switch, and delete sessions; each tracks its own solves.
- **Performance statistics** — best, worst, mean, mo3, ao5, ao12, ao50, ao100, and session/all-time aggregates.
- **Personal records & PB history** — automatic detection of Single/ao5/ao12/ao50/ao100 records across every session, a dedicated Records tab with the full timeline of when each was set, and an in-timer celebration naming exactly which record just broke.
- **Interactive charts** — visualize trends and rolling averages with Chart.js.
- **Cloud sync & offline mode** — solves persist to Firebase Firestore when signed in, with an automatic local fallback when offline or signed out.
- **Google authentication** — sign in to sync across devices.
- **Responsive UI** — works on desktop and mobile, in light and dark mode.

## Tech Stack

- **Frontend:** React 19 + Vite
- **Analytics:** framework-free TypeScript module, unit-tested with Vitest
- **Charts:** Chart.js
- **Auth & persistence:** Firebase Authentication + Cloud Firestore
- **Tooling:** ESLint, GitHub Actions CI

## Getting Started

### Prerequisites

- Node.js 20 or later, and npm

### Installation

```sh
git clone https://github.com/ameyg24/cubeboxtimer
cd cubeboxtimer
npm install
```

### Configuration

CubeBox reads its Firebase credentials from environment variables. Copy the example file and fill in the values from your Firebase project console:

```sh
cp .env.example .env
```

Required variables:

| Variable | Description |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

If Firebase is not configured, CubeBox still runs and stores solves locally in the browser.

If you're pointing at your own Firebase project, also deploy the access rules in [`firestore.rules`](firestore.rules) (`firebase deploy --only firestore:rules`) — without them your Firestore database falls back to whatever default rules your project was created with, which is usually locked down to nobody.

### Running

```sh
npm run dev
```

The app is served at http://localhost:5173 (or the port shown in your terminal).

### Troubleshooting

- **Sign-in button does nothing / shows "Auth config needed".** Firebase environment variables are missing or incomplete — check `.env` against `.env.example`, then restart the dev server (Vite only reads `.env` on startup).
- **Signed in, but nothing syncs.** Firestore rules may not be deployed for your project — see the note above. Check the sync badge in the header; it explains the current state (`offline`, `sign in to sync`, `pending`, `sync failed`, `synced`).
- **Port 5173 is already in use.** Another Vite dev server is probably running; stop it, or pass `--port` to `npm run dev -- --port 5174`.
- **`npm run typecheck` fails on a file outside `src/analytics`.** That's expected — `tsconfig.json` only type-checks the analytics module by design (the rest of the app is plain JS/JSX). See [`docs/architecture/overview.md`](docs/architecture/overview.md).
- **Tests fail only in CI, not locally.** Confirm your local Node version matches CI (`node -v`, should be 20+) — see `engines` in `package.json`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Create a production build |
| `npm run preview` | Preview the production build locally |
| `npm run test:run` | Run the unit test suite (Vitest) |
| `npm run typecheck` | Type-check the TypeScript sources (`tsc --noEmit`) |
| `npm run lint` | Run ESLint |

## Architecture

CubeBox is organized into three layers:

- **UI (React)** — the timer, session controls, dashboard, and charts.
- **Analytics** — a pure, framework-free TypeScript module in [`src/analytics/`](src/analytics) that computes all solve statistics and personal records using WCA-style averaging rules. It has no React, Firebase, or browser dependencies, which keeps it easy to test and reuse.
- **Persistence** — Firebase Authentication and Cloud Firestore, with an automatic local-storage fallback so the app works offline and without an account.

Two deeper documents cover this in more detail, including a diagram and the reasoning behind the offline-first sync design:

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — layers, the analytics/records model, offline-first sync.
- [`docs/architecture/observability.md`](docs/architecture/observability.md) — logging strategy, what's instrumented and why, and how real telemetry would plug in later.

## Testing

Unit tests run with [Vitest](https://vitest.dev):

```sh
npm run test:run
```

The analytics module — averaging rules, penalties (+2 / DNF), edge cases, and personal-record detection — is tested in isolation with no DOM or network. Components and hooks are covered too: session persistence, offline sync, and reload/session-switching behavior (`useSolveSessions`), keyboard interaction and focus handling in the solve list and dialogs, the inspection timer's warning/penalty timing, the logging layer's dev/production level filtering, and error-boundary recovery.

## Continuous Integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every pull request and on pushes to `main`, installing dependencies and running the tests, type-check, lint, and build — the same commands described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Project Structure

```
src/
  analytics/    Pure TypeScript stats module: averages, session stats, records (+ unit tests)
  components/   React components (Timer, Dashboard, Header, Modal, …)
  hooks/        Stateful logic extracted out of components (session/solve persistence)
  firebase/     Firebase initialization
  logger.js     The one place console is called directly; everything else logs through it
  scramble.js   WCA-style random-move scramble generator
  App.jsx       Application shell and timer logic
  __tests__/    Tests for App-level modules; each other directory keeps its own
docs/
  architecture/ Layered architecture, offline-first sync, logging & instrumentation
.github/        CI workflow
firestore.rules Firestore security rules (deploy this to your own Firebase project)
.env.example    Example environment variables
```

## Contributing

Bug reports and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for local setup, conventions, and what CI checks before merge.

---

Made with ❤️ for cubers.

## License

Released under the [MIT License](LICENSE).
