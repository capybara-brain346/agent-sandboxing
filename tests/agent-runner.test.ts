import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { loadConfig, type Config } from "../src/config";
import { AgentRunner } from "../src/services/agent/agent-runner";
import type { EventStore } from "../src/services/events/event-store";
import type { PublicEvent } from "../src/types/event.types";
import type { TaskRunContext } from "../src/services/task/task-runner";

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
  const runner = new AgentRunner({
    config: { ...config, ...overrides },
    sandbox,
    events: events as unknown as Pick<EventStore, "append">,
    model: {} as LanguageModel,
    publish,
  });
  return { runner, sandbox, events, publish, target };
};

describe("AgentRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the owned target and calls generateText with the seven tools", async () => {
    aiMocks.generateText.mockResolvedValueOnce({ text: "  completed work  " });
    const harness = makeRunner();

    await expect(harness.runner.run(makeContext())).resolves.toEqual({
      summary: "completed work",
    });

    expect(harness.sandbox.getAgentToolTarget).toHaveBeenCalledWith(
      "task_1",
      "sbox_1",
    );
    expect(aiMocks.isStepCount).toHaveBeenCalledWith(4);
    const options = aiMocks.generateText.mock.calls.at(-1)?.[0];
    expect(options).toMatchObject({
      model: expect.anything(),
      system: expect.stringContaining("/workspace/repo"),
      messages: [{ role: "user", content: "Update the greeting" }],
      abortSignal: expect.any(AbortSignal),
      stopWhen: "step-count-4",
    });
    expect(Object.keys(options.tools)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
    ]);
  });

  it("returns a null summary when the model has no final text", async () => {
    aiMocks.generateText.mockResolvedValueOnce({ text: "   " });

    await expect(makeRunner().runner.run(makeContext())).resolves.toEqual({
      summary: null,
    });
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
      return { text: "" };
    });

    await harness.runner.run(makeContext());
    expect(maximum).toBe(1);
  });
});
