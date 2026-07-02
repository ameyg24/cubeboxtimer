// Minimal, dependency-free logging layer. Every module logs through this
// instead of calling console directly, so level filtering and formatting
// live in one place. See docs/architecture/observability.md for the full
// rationale and how a real telemetry backend would plug in later.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CONSOLE_METHOD = { debug: "debug", info: "info", warn: "warn", error: "error" };

// debug is development-only noise; info/warn/error stay visible in production.
export function minLevelFor(isDev) {
  return isDev ? LEVELS.debug : LEVELS.info;
}

// Factory so tests can exercise both the dev and production thresholds
// without fighting Vite's build-time replacement of import.meta.env.
export function createLogger(isDev = () => import.meta.env.DEV) {
  function write(level, message, context) {
    if (LEVELS[level] < minLevelFor(isDev())) return;
    const method = CONSOLE_METHOD[level];
    if (context !== undefined) {
      console[method](`[${level}] ${message}`, context);
    } else {
      console[method](`[${level}] ${message}`);
    }
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

export const logger = createLogger();
