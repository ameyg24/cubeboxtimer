// Type surface of logger.js for the TS modules under src/storage and
// src/analytics. The logger itself stays a plain JS module shared with the
// JSX app code.
type LogContext = Record<string, unknown>;

export declare const logger: {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
};

export declare function minLevelFor(isDev: boolean): number;

export declare function createLogger(isDev?: () => boolean): typeof logger;
