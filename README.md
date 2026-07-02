# CubeBox

CubeBox is an open-source speedcubing platform for recording solves, analyzing performance, and helping cubers improve through data-driven insights. It provides a WCA-style timer with inspection and penalties, session management, and rich statistics and charts, with optional cloud sync via Firebase.

## Features

- **WCA-style timer** — start and stop with the spacebar or a tap, with a visual countdown.
- **Inspection & penalties** — 15-second inspection with automatic +2 and DNF handling per WCA rules.
- **WCA-style scrambles** — random-move scrambles for 2x2x2 through 5x5x5 using standard outer-block-turn notation, with no repeated face and no three consecutive moves on the same axis. This is not the random-state scrambling the WCA uses officially for 2x2x2/3x3x3 (that requires a full cube solver); see [`src/scramble.js`](src/scramble.js) for the exact rules.
- **Session management** — create, switch, and delete sessions; each tracks its own solves.
- **Performance statistics** — best, worst, mean, mo3, ao5, ao12, ao50, ao100, and session/all-time aggregates.
- **Interactive charts** — visualize trends and rolling averages with Chart.js.
- **Cloud sync & offline mode** — solves persist to Firebase Firestore when signed in, with an automatic local fallback when offline or signed out.
- **Google authentication** — sign in to sync across devices.
- **Responsive UI** — works on desktop and mobile.

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

### Running

```sh
npm run dev
```

The app is served at http://localhost:5173 (or the port shown in your terminal).

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
- **Analytics** — a pure, framework-free TypeScript module in [`src/analytics/`](src/analytics) that computes all solve statistics using WCA-style averaging rules. It has no React, Firebase, or browser dependencies, which keeps it easy to test and reuse.
- **Persistence** — Firebase Authentication and Cloud Firestore, with an automatic local-storage fallback so the app works offline and without an account.

## Testing

Unit tests run with [Vitest](https://vitest.dev):

```sh
npm run test:run
```

The analytics module is covered by tests for averaging rules, penalties (+2 / DNF), and edge cases. Components and hooks are covered too — session persistence and offline sync (`useSolveSessions`), keyboard interaction and focus handling in the solve list and dialogs, and the inspection timer's warning/penalty timing.

## Continuous Integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every pull request and on pushes to `main`, installing dependencies and running the tests, type-check, and build.

## Project Structure

```
src/
  analytics/    Pure TypeScript stats module (+ unit tests)
  components/   React components (Timer, Dashboard, Header, Modal, …)
  hooks/        Stateful logic extracted out of components (session/solve persistence)
  firebase/     Firebase initialization
  App.jsx       Application shell and timer logic
  __tests__/    Tests for App-level modules; each other directory keeps its own
docs/           Developer documentation
.github/        CI workflows
.env.example    Example environment variables
```

---

Made with ❤️ for cubers.

## License

Released under the MIT License.
