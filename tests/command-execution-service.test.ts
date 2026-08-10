import { describe, expect, it } from "vitest";
import {
  CommandOutputLimiter,
  normalizeCommandRequest,
  splitOutput,
  takeUtf8Prefix,
} from "../src/services/sandbox/command-execution-service";
import { ServiceError } from "../src/shared/errors";

describe("command execution rules", () => {
  it("normalizes safe command requests", () => {
    expect(
      normalizeCommandRequest(
        {
          command: "  npm test  ",
          cwd: "/workspace/repo/packages/app",
          env: { NODE_ENV: "test" },
          timeoutMs: 500,
        },
        1000,
      ),
    ).toEqual({
      command: "npm test",
      cwd: "/workspace/repo/packages/app",
      env: { NODE_ENV: "test" },
      timeoutMs: 500,
    });
  });

  it("rejects unsafe cwd, env, empty commands, and excessive timeouts", () => {
    expect(() => normalizeCommandRequest({ command: " " }, 1000)).toThrow(
      ServiceError,
    );
    expect(() =>
      normalizeCommandRequest({ command: "pwd", cwd: "/tmp" }, 1000),
    ).toThrow(ServiceError);
    expect(() =>
      normalizeCommandRequest(
        { command: "env", env: { "bad-key": "value" } },
        1000,
      ),
    ).toThrow(ServiceError);
    expect(() =>
      normalizeCommandRequest({ command: "sleep 1", timeoutMs: 1001 }, 1000),
    ).toThrow(ServiceError);
  });

  it("bounds command output without splitting UTF-8 characters", () => {
    const limiter = new CommandOutputLimiter(5);

    const events = limiter.limit({ stream: "stdout", chunk: "ééé" });

    expect(events).toEqual([
      {
        payload: {
          stream: "stdout",
          chunk: "éé",
          chunk_index: 0,
          truncated: true,
        },
      },
    ]);
    expect(limiter.bytes).toBe(4);
    expect(limiter.truncated).toBe(true);
  });

  it("byte-bounds output without splitting UTF-8 characters", () => {
    expect(splitOutput("a".repeat(20), 8)).toEqual([
      "aaaaaaaa",
      "aaaaaaaa",
      "aaaa",
    ]);
    expect(splitOutput("ééé", 4)).toEqual(["éé", "é"]);
    expect(takeUtf8Prefix("ééé", 5)).toBe("éé");
  });
});
