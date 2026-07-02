import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger, minLevelFor } from "../logger.js";

describe("minLevelFor", () => {
  it("allows debug in development", () => {
    expect(minLevelFor(true)).toBeLessThanOrEqual(10);
  });

  it("raises the floor above debug in production", () => {
    expect(minLevelFor(false)).toBeGreaterThan(minLevelFor(true));
  });
});

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs debug/info/warn/error through their matching console method", () => {
    const spies = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    const logger = createLogger(() => true);

    logger.debug("a debug message");
    logger.info("an info message");
    logger.warn("a warn message");
    logger.error("an error message");

    expect(spies.debug).toHaveBeenCalledWith("[debug] a debug message");
    expect(spies.info).toHaveBeenCalledWith("[info] an info message");
    expect(spies.warn).toHaveBeenCalledWith("[warn] a warn message");
    expect(spies.error).toHaveBeenCalledWith("[error] an error message");
  });

  it("passes context through to console as a second argument", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger(() => true);
    const context = { userId: "abc" };

    logger.error("failed", context);

    expect(errorSpy).toHaveBeenCalledWith("[error] failed", context);
  });

  it("omits the context argument entirely when none is given", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger(() => true);

    logger.info("no context here");

    expect(infoSpy).toHaveBeenCalledWith("[info] no context here");
    expect(infoSpy.mock.calls[0]).toHaveLength(1);
  });

  it("suppresses debug logs in production but keeps info/warn/error", () => {
    const spies = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    const logger = createLogger(() => false);

    logger.debug("hidden in prod");
    logger.info("visible in prod");
    logger.warn("visible in prod");
    logger.error("visible in prod");

    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalled();
  });
});
