# Contributing to CubeBox

Thanks for taking a look at CubeBox. This is currently a solo-maintained
project, but issues, bug reports, and pull requests are genuinely welcome.

## Getting set up

Follow the [Installation](README.md#installation) and
[Configuration](README.md#configuration) sections in the README. CubeBox runs
fully offline without Firebase configured, so you don't need a Firebase
project just to explore the codebase.

## Before opening a pull request

Run the full local check suite — this is exactly what CI runs:

```sh
npm run test:run
npm run typecheck
npm run lint
npm run build
```

All four should pass cleanly. If a change intentionally affects behavior
covered by an existing test, update the test in the same PR rather than
deleting or skipping it.

## Code conventions

- **Analytics stays pure.** Code in `src/analytics/` has no React, Firebase,
  or browser dependencies, and this is deliberate — see
  [`docs/architecture/overview.md`](docs/architecture/overview.md). Don't
  import from React or the DOM there; add UI-facing conversions at the call
  site instead.
- **Log through `src/logger.js`, not `console`.** ESLint enforces this
  (`no-console`) everywhere except the logger module itself. See
  [`docs/architecture/observability.md`](docs/architecture/observability.md)
  for the level policy (`debug`/`info`/`warn`/`error`).
- **Don't add a new persistence mechanism.** Solve data flows through
  `src/hooks/useSolveSessions.js`'s offline-first localStorage/Firestore
  path. Derived data (like the personal-records system in
  `src/analytics/records.ts`) should be computed from that existing data,
  not stored separately — a second source of truth is how "delete a solve"
  and "the stats are now stale" bugs happen.
- **Match the existing style over introducing a new one.** Most components
  use inline styles and CSS custom properties from `src/index.css`
  (`--accent`, `--surface`, `--border`, etc.) rather than a component
  library. Keep new UI consistent with that rather than introducing Tailwind,
  styled-components, or similar.

## Commit messages

This repo uses plain, descriptive sentences that explain *why* a change was
made, not conventional-commit prefixes like `feat:` or `fix:`. Look at
`git log` for the tone: short, human, and specific about the problem being
solved.

## Tests

- Pure logic (`src/analytics/`) is tested with plain Vitest, no DOM.
- Components and hooks use `@testing-library/react` with a
  `// @vitest-environment jsdom` pragma at the top of the file.
- Prefer testing behavior over implementation details — see the existing
  test files under `src/**/__tests__/` for the established style. Avoid
  brittle snapshot tests.

## Reporting bugs

Open a GitHub issue with steps to reproduce, what you expected, and what
actually happened.
