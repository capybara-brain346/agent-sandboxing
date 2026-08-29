import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  CommandOutputLimiter,
  normalizeCommandRequest,
  splitOutput,
  CommandExecutionService,
} from "../src/services/sandbox/command-execution";
import { ServiceError } from "../src/shared/errors";
import { takeUtf8Prefix } from "../src/shared/utf8";
import type { Config } from "../src/config";
import type { EventStore } from "../src/services/events/event-store";
import type { SandboxRuntime } from "../src/services/sandbox/runtime";
import type { PublicEvent } from "../src/types/event.types";

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

  it("runs commands through a session-owned sandbox and persists session events", async () => {
    let sequence = 1;
    const event = (type: PublicEvent["type"]): PublicEvent => ({
      id: `evt_${sequence}`,
      streamId: "session_1",
      streamScope: "session",
      domain: "command",
      sessionId: "session_1",
      messageId: null,
      artifactId: null,
      sandboxId: "sbox_1",
      commandId: "cmd_1",
      sequence: sequence++,
      type,
      producerService: type === "command_started" ? "command" : "runtime",
      producerId: "cmd_1",
      correlationId: null,
      payload: {},
      createdAt: new Date().toISOString(),
    });
    const command = {
      id: "cmd_1",
      status: "running" as const,
      exitCode: null,
      outputBytes: 0,
      outputTruncated: false,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: null,
    };
    const tx = {
      $queryRaw: vi.fn(async () => [
        { id: "sbox_1", status: "ready", container_name: "sandbox-s1" },
      ]),
      command: {
        create: vi.fn(async () => command),
        update: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: unknown) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaClient;
    const runtime = {
      run: vi.fn(
        async (
          _container: string,
          _command: string,
          _cwd: string,
          _env: Record<string, string>,
          _timeout: number,
          onOutput: (output: {
            stream: "stdout";
            chunk: string;
          }) => Promise<void>,
        ) => {
          await onOutput({ stream: "stdout", chunk: "hello\n" });
          return {
            exitCode: 0,
            timedOut: false,
            outputBytes: 6,
            outputTruncated: false,
          };
        },
      ),
    } as unknown as SandboxRuntime;
    const events = {
      appendInTransaction: vi.fn(
        async (_tx: unknown, input: { type: PublicEvent["type"] }) =>
          event(input.type),
      ),
      append: vi.fn(async (input: { type: PublicEvent["type"] }) =>
        event(input.type),
      ),
    } as unknown as EventStore;
    const publish = vi.fn();
    const config = {
      SANDBOX_COMMAND_TIMEOUT_MS: 1000,
      COMMAND_OUTPUT_MAX_BYTES: 1024,
    } as Config;
    const service = new CommandExecutionService(
      prisma,
      events,
      runtime,
      config,
      publish,
    );

    await expect(
      service.runCommand("session_1", { command: "printf hello" }),
    ).resolves.toEqual({
      commandId: "cmd_1",
      sessionId: "session_1",
      status: "running",
    });
    await vi.waitFor(() =>
      expect(publish.mock.calls.map(([next]) => next.type)).toContain(
        "command_completed",
      ),
    );
    expect(runtime.run).toHaveBeenCalledWith(
      "sandbox-s1",
      "printf hello",
      "/workspace/repo",
      {},
      1000,
      expect.any(Function),
    );
    expect(
      events.appendInTransaction.mock.calls.map(([, input]) => input.type),
    ).toEqual(["command_started", "command_completed"]);
    expect(
      events.appendInTransaction.mock.calls.every(
        ([, input]) => input.domain === "command",
      ),
    ).toBe(true);
    expect(
      events.append.mock.calls.every(([input]) => input.domain === "command"),
    ).toBe(true);
    expect(events.append.mock.calls.map(([input]) => input.type)).toEqual([
      "command_output",
    ]);
  });
});
