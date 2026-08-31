import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { loadConfig, type Config } from "../src/config";
import { AgentRunner } from "../src/services/agent/agent-runner";
import type { EventStore } from "../src/services/events/event-store";
import type { PublicEvent } from "../src/types/event.types";
import type { MessageProcessingContext } from "../src/types/message-processing.types";
import type { EvalTraceRecorderLike } from "../src/services/eval/eval-trace-recorder";
import { logger } from "../src/logger";
import type { ToolProfileName } from "../src/services/agent/tools/profile-loader";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  isStepCount: vi.fn((steps: number) => `step-count-${steps}`),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: aiMocks.generateText,
    isStepCount: aiMocks.isStepCount,
  };
});

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test",
  AGENT_MAX_STEPS: "4",
});

const event = (type: PublicEvent["type"]): PublicEvent => ({
  id: "evt_1",
  streamId: "chat_1",
  streamScope: "session",
  domain: "agent",
  sessionId: "chat_1",
  sandboxId: "sbox_1",
  commandId: null,
  sequence: 1,
  type,
  producerService: "agent",
  producerId: "msg_1",
  correlationId: "call_1",
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

const makeContext = (
  signal = new AbortController().signal,
): MessageProcessingContext => ({
  sandboxId: "sbox_1",
  instructions: "Update the greeting",
  signal,
  sessionId: "chat_1",
  messageId: "msg_1",
});

const makeRunner = (
  overrides: Partial<Config> = {},
  profile: ToolProfileName = "main",
) => {
  const runtime = {
    simpleExec: vi.fn(async () => ({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      truncated: false,
    })),
  };
  const target = {
    containerName: "sandbox-sbox_1",
    runtime,
  };
  const sandbox = {
    getAgentToolTarget: vi.fn(async () => target),
  };
  const events = {
    append: vi.fn(async (input: { type: PublicEvent["type"] }) =>
      event(input.type),
    ),
  };
  const publish = vi.fn();
  const traceRecorder = {
    recordUsage: vi.fn(),
    recordSubagent: vi.fn(),
  } as unknown as EvalTraceRecorderLike;
  const runner = new AgentRunner({
    config: { ...config, ...overrides },
    sandbox,
    events: events as unknown as Pick<EventStore, "append">,
    model: {} as LanguageModel,
    publish,
    profile,
    traceRecorder,
  });
  return { runner, sandbox, events, publish, target, traceRecorder };
};

describe("AgentRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the owned target and returns the model report text", async () => {
    aiMocks.generateText.mockImplementationOnce(async () => {
      return {
        text: "completed work",
        toolCalls: [],
        response: {
          messages: [{ role: "assistant", content: "completed work" }],
        },
      };
    });
    const harness = makeRunner();
    const debug = vi.spyOn(logger, "debug");

    await expect(harness.runner.process(makeContext())).resolves.toEqual({
      finalText: "completed work",
      usage: undefined,
      toolCalls: [],
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    });

    expect(harness.sandbox.getAgentToolTarget).toHaveBeenCalledWith(
      "chat_1",
      "sbox_1",
    );
    expect(aiMocks.isStepCount).toHaveBeenCalledWith(4);
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);

    const toolLoopOptions = aiMocks.generateText.mock.calls[0]?.[0];
    expect(toolLoopOptions).toMatchObject({
      model: expect.anything(),
      system: expect.stringContaining("/workspace/repo"),
      messages: [{ role: "user", content: "Update the greeting" }],
      abortSignal: expect.any(AbortSignal),
      stopWhen: "step-count-4",
    });
    expect(toolLoopOptions.output).toBeUndefined();
    expect(Object.keys(toolLoopOptions.tools)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
      "subagent",
    ]);
    expect(harness.events.append).not.toHaveBeenCalled();
    expect(harness.traceRecorder.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "sessionAgent" }),
    );
    expect(debug).toHaveBeenCalledWith(
      "session_agent_completed",
      expect.objectContaining({
        sessionId: "chat_1",
        messageId: "msg_1",
        sandboxId: "sbox_1",
        durationMs: expect.any(Number),
        finalTextPresent: true,
        toolCallCount: 0,
      }),
    );
    expect(debug).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ instructions: "Update the greeting" }),
    );
    debug.mockRestore();
  });

  it("returns empty final text when the agent returns no text", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      text: "",
      toolCalls: [],
      response: { messages: [] },
    });

    await expect(
      makeRunner().runner.process(makeContext()),
    ).resolves.toMatchObject({
      finalText: "",
      toolCalls: [],
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    });
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);
  });

  it("passes a restricted profile to the model loop", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      text: "completed investigation",
      toolCalls: [],
      response: { messages: [] },
    });
    const harness = makeRunner({}, "subagent");

    await harness.runner.process(makeContext());

    expect(Object.keys(aiMocks.generateText.mock.calls[0]?.[0].tools)).toEqual([
      "read",
      "grep",
      "find",
      "ls",
    ]);
  });

  it("runs a read-only subagent with the requested step limit and records it", async () => {
    const report = "investigation result";
    aiMocks.generateText.mockImplementation(async (options) => {
      if (Object.keys(options.tools).includes("subagent")) {
        const subagentResult = await options.tools.subagent.execute(
          { task: "Locate the greeting", maxSteps: 2 },
          {},
        );
        expect(subagentResult).toBe(report);
        return {
          text: "I found the greeting",
          toolCalls: [],
          response: { messages: [] },
        };
      }
      return {
        text: report,
        toolCalls: [{ toolName: "read", input: { path: "/workspace/repo/a" } }],
        response: { messages: [] },
      };
    });
    const harness = makeRunner();

    await expect(harness.runner.process(makeContext())).resolves.toMatchObject({
      finalText: "I found the greeting",
    });

    expect(aiMocks.generateText).toHaveBeenCalledTimes(2);
    const subagentOptions = aiMocks.generateText.mock.calls[1]?.[0];
    expect(subagentOptions).toMatchObject({
      system: expect.stringContaining("read-only investigation subagent"),
      messages: [{ role: "user", content: "Locate the greeting" }],
      stopWhen: "step-count-2",
    });
    expect(Object.keys(subagentOptions.tools)).toEqual([
      "read",
      "grep",
      "find",
      "ls",
    ]);
    expect(harness.events.append).not.toHaveBeenCalled();
    expect(harness.traceRecorder.recordSubagent).toHaveBeenCalledWith({
      messageId: "msg_1",
      subagent: expect.objectContaining({
        task: "Locate the greeting",
        summary: report,
        toolCalls: [
          {
            toolName: "read",
            input: { path: "/workspace/repo/a" },
          },
        ],
        startedAt: expect.any(String),
        completedAt: expect.any(String),
        durationMs: expect.any(Number),
        subagentRunId: expect.stringContaining("subagent_"),
      }),
    });
  });

  it("does not resolve the sandbox or call the model after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeRunner();

    await expect(
      harness.runner.process(makeContext(controller.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.sandbox.getAgentToolTarget).not.toHaveBeenCalled();
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });

  it("rethrows an in-flight AbortError", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    aiMocks.generateText.mockRejectedValueOnce(abortError);

    await expect(makeRunner().runner.process(makeContext())).rejects.toBe(
      abortError,
    );
  });

  it("converts provider failures to a safe processing error", async () => {
    aiMocks.generateText.mockRejectedValueOnce(
      new Error("provider key leaked in a raw error"),
    );

    await expect(
      makeRunner().runner.process(makeContext()),
    ).rejects.toMatchObject({
      code: "agent_processing_failed",
      message: "Agent processing failed",
      status: 502,
    });
  });

  it("serializes concurrent tool executions against one workspace", async () => {
    let active = 0;
    let maximum = 0;
    const harness = makeRunner();
    harness.target.runtime.simpleExec.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        truncated: false,
      };
    });
    aiMocks.generateText.mockImplementationOnce(async (options) => {
      const tools = options.tools as Record<
        string,
        { execute: (...args: never[]) => Promise<unknown> }
      >;
      await Promise.all([
        tools.read.execute(
          { path: "/workspace/repo/a.txt" } as never,
          {} as never,
        ),
        tools.write.execute(
          { path: "/workspace/repo/b.txt", content: "b" } as never,
          {} as never,
        ),
      ]);
      return {
        text: "",
        toolCalls: [],
        response: { messages: [] },
      };
    });

    await harness.runner.process(makeContext());
    expect(maximum).toBe(1);
  });
});
