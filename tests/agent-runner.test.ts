import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { loadConfig, type Config } from "../src/config";
import { AgentRunner } from "../src/services/agent/agent-runner";
import type { EventStore } from "../src/services/events/event-store";
import type { PublicEvent } from "../src/types/event.types";
import type { TaskRunContext } from "../src/services/task/task-runner";
import type { EvalTraceRecorderLike } from "../src/services/eval/eval-trace-recorder";

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
  streamId: "task_1",
  taskId: "task_1",
  sandboxId: "sbox_1",
  commandId: null,
  sequence: 1,
  type,
  producerService: "agent",
  producerId: "task_1",
  correlationId: "call_1",
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

const makeContext = (
  signal = new AbortController().signal,
): TaskRunContext => ({
  taskId: "task_1",
  sandboxId: "sbox_1",
  instructions: "Update the greeting",
  signal,
  sessionId: "chat_1",
  messageId: "msg_1",
});

const makeRunner = (overrides: Partial<Config> = {}) => {
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
  } as unknown as EvalTraceRecorderLike;
  const runner = new AgentRunner({
    config: { ...config, ...overrides },
    sandbox,
    events: events as unknown as Pick<EventStore, "append">,
    model: {} as LanguageModel,
    publish,
    traceRecorder,
  });
  return { runner, sandbox, events, publish, target, traceRecorder };
};

describe("AgentRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const workerOutput = {
    status: "completed" as const,
    summary: "completed work",
    changedFiles: [],
    testsRun: [],
    blockers: [],
    suggestedNextStep: "",
  };

  it("resolves the owned target and submits a structured result in the tool loop", async () => {
    aiMocks.generateText.mockImplementationOnce(async (options) => {
      const tools = options.tools as Record<
        string,
        { execute: (...args: never[]) => Promise<unknown> }
      >;
      const finishCall = {
        callId: "finish_call",
        toolCall: { toolName: "finish", input: workerOutput },
      };
      await options.onToolExecutionStart(finishCall);
      await tools.finish.execute(workerOutput as never, {} as never);
      await options.onToolExecutionEnd({
        ...finishCall,
        toolExecutionMs: 1,
        toolOutput: { type: "tool-result", output: { accepted: true } },
      });
      return {
        text: "completed work",
        toolCalls: [{ toolName: "finish", input: workerOutput }],
        response: {
          messages: [{ role: "assistant", content: "completed work" }],
        },
      };
    });
    const harness = makeRunner();

    await expect(harness.runner.run(makeContext())).resolves.toEqual(
      workerOutput,
    );

    expect(harness.sandbox.getAgentToolTarget).toHaveBeenCalledWith(
      "chat_1",
      "task_1",
      "sbox_1",
    );
    expect(aiMocks.isStepCount).toHaveBeenCalledWith(5);
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);

    const toolLoopOptions = aiMocks.generateText.mock.calls[0]?.[0];
    expect(toolLoopOptions).toMatchObject({
      model: expect.anything(),
      system: expect.stringContaining("/workspace/repo"),
      messages: [{ role: "user", content: "Update the greeting" }],
      abortSignal: expect.any(AbortSignal),
      stopWhen: [expect.any(Function), "step-count-5"],
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
      "finish",
    ]);
    expect(harness.events.append).not.toHaveBeenCalled();
    expect(harness.traceRecorder.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "worker" }),
    );
  });

  it("does not stop on an invalid finish call before accepting a valid result", async () => {
    aiMocks.generateText.mockImplementationOnce(async (options) => {
      const tools = options.tools as Record<
        string,
        { execute: (...args: never[]) => Promise<unknown> }
      >;
      const stopWhen = options.stopWhen as Array<
        (options: { steps: unknown[] }) => boolean
      >;
      const stopOnSubmittedResult = stopWhen[0];
      if (!stopOnSubmittedResult)
        throw new Error("Missing finish stop condition");
      const invalidInput = { ...workerOutput, status: "invalid" };

      await expect(
        tools.finish.execute(invalidInput as never, {} as never),
      ).rejects.toThrow();
      expect(
        stopOnSubmittedResult({
          steps: [{ toolCalls: [{ toolName: "finish", input: invalidInput }] }],
        }),
      ).toBe(false);

      await tools.finish.execute(workerOutput as never, {} as never);
      expect(
        stopOnSubmittedResult({
          steps: [{ toolCalls: [{ toolName: "finish", input: workerOutput }] }],
        }),
      ).toBe(true);

      return {
        text: "completed work",
        toolCalls: [{ toolName: "finish", input: workerOutput }],
        response: { messages: [] },
      };
    });

    await expect(makeRunner().runner.run(makeContext())).resolves.toEqual(
      workerOutput,
    );
  });

  it("derives changedFiles deterministically from write/edit tool calls, overriding the model's own list", async () => {
    aiMocks.generateText.mockImplementationOnce(async (options) => {
      const tools = options.tools as Record<
        string,
        { execute: (...args: never[]) => Promise<unknown> }
      >;
      await tools.finish.execute(
        { ...workerOutput, changedFiles: ["should be overridden"] } as never,
        {} as never,
      );
      return {
        text: "done",
        toolCalls: [
          { toolName: "read", input: { path: "/workspace/repo/a.txt" } },
          { toolName: "write", input: { path: "/workspace/repo/b.txt" } },
          { toolName: "edit", input: { path: "/workspace/repo/c.txt" } },
          { toolName: "write", input: { path: "/workspace/repo/b.txt" } },
          {
            toolName: "finish",
            input: { ...workerOutput, changedFiles: ["should be overridden"] },
          },
        ],
        response: { messages: [] },
      };
    });
    const harness = makeRunner();

    const result = await harness.runner.run(makeContext());
    expect(result.changedFiles).toEqual([
      "/workspace/repo/b.txt",
      "/workspace/repo/c.txt",
    ]);
  });

  it("returns a blocked result when the worker does not submit a finish result", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      text: "still working",
      toolCalls: [],
      response: { messages: [] },
    });

    await expect(makeRunner().runner.run(makeContext())).resolves.toMatchObject(
      {
        status: "blocked",
        summary: "Worker did not submit a structured result.",
        blockers: ["worker_result_not_submitted"],
      },
    );
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);
  });

  it("does not resolve the sandbox or call the model after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeRunner();

    await expect(
      harness.runner.run(makeContext(controller.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.sandbox.getAgentToolTarget).not.toHaveBeenCalled();
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });

  it("rethrows an in-flight AbortError", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    aiMocks.generateText.mockRejectedValueOnce(abortError);

    await expect(makeRunner().runner.run(makeContext())).rejects.toBe(
      abortError,
    );
  });

  it("converts provider failures to a safe agent_run_failed error", async () => {
    aiMocks.generateText.mockRejectedValueOnce(
      new Error("provider key leaked in a raw error"),
    );

    await expect(makeRunner().runner.run(makeContext())).rejects.toMatchObject({
      code: "agent_run_failed",
      message: "Agent run failed",
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
      await tools.finish.execute(workerOutput as never, {} as never);
      return {
        text: "",
        toolCalls: [{ toolName: "finish", input: workerOutput }],
        response: { messages: [] },
      };
    });

    await harness.runner.run(makeContext());
    expect(maximum).toBe(1);
  });
});
