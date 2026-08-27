import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogger, logger } from "../src/logger";

const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");

const setTTY = (stream: NodeJS.WriteStream, value: boolean): void => {
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value,
  });
};

const restoreTTY = (
  stream: NodeJS.WriteStream,
  descriptor: PropertyDescriptor | undefined,
): void => {
  if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
  else Reflect.deleteProperty(stream, "isTTY");
};

describe("logger", () => {
  beforeEach(() => {
    configureLogger({ level: "info", color: "false" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreTTY(process.stdout, stdoutTTY);
    restoreTTY(process.stderr, stderrTTY);
    configureLogger({
      level: process.env.NODE_ENV === "test" ? "error" : "info",
      color: "auto",
    });
  });

  it("skips debug logs at info level", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureLogger({ level: "info", color: "false" });

    logger.debug("skipped");
    logger.info("emitted");

    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "info",
      event: "emitted",
    });
  });

  it("emits debug logs at debug level", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureLogger({ level: "debug", color: "false" });

    logger.debug("emitted");

    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "debug",
      event: "emitted",
    });
  });

  it("emits warn and error logs at warn level only", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    configureLogger({ level: "warn", color: "false" });

    logger.debug("skipped");
    logger.info("skipped");
    logger.warn("warned");
    logger.error("failed");

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("keeps LOG_COLOR=false output parseable JSON", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureLogger({ level: "info", color: "false" });

    logger.info("emitted", { status: 200 });

    const line = output.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toMatchObject({
      level: "info",
      event: "emitted",
      status: 200,
    });
    expect(line).not.toContain("\u001b[");
  });

  it("adds ANSI color codes when LOG_COLOR=true", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureLogger({ level: "info", color: "true" });

    logger.info("emitted");

    const line = output.mock.calls[0]?.[0] as string;
    expect(line.startsWith("\u001b[32m")).toBe(true);
    expect(line.endsWith("\u001b[0m")).toBe(true);
  });

  it("colors auto output only for the destination TTY", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setTTY(process.stdout, true);
    setTTY(process.stderr, false);
    configureLogger({ level: "debug", color: "auto" });

    logger.debug("colored");
    logger.info("colored");
    logger.warn("clean");

    expect((stdout.mock.calls[0]?.[0] as string).startsWith("\u001b[90m")).toBe(
      true,
    );
    expect((stdout.mock.calls[1]?.[0] as string).startsWith("\u001b[32m")).toBe(
      true,
    );
    expect(stderr.mock.calls[0]?.[0]).not.toContain("\u001b[");
  });

  it("uses stdout for debug/info and stderr for warn/error", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    configureLogger({ level: "debug", color: "false" });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(stdout).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
