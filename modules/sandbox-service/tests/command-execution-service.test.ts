import { describe, expect, it } from "vitest";
import {
  CommandOutputLimiter,
  normalizeCommandRequest,
} from "../src/command-execution-service";
import { ServiceError } from "../src/errors";

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
});
