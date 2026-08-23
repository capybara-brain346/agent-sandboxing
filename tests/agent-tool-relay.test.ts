import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionEndEvent, ToolExecutionStartEvent } from "ai";
import type { EventStore } from "../src/services/events/event-store";
import type { PublicEvent } from "../src/types/event.types";
import { ToolEventRelay } from "../src/services/agent/tool-event-relay";

const startEvent = (input: unknown): ToolExecutionStartEvent =>
  ({
    callId: "call_42",
    messages: [],
    toolCall: {
      type: "tool-call",
      toolCallId: "tool-call-42",
      toolName: "bash",
      input,
    },
    toolContext: undefined,
  }) as ToolExecutionStartEvent;

const endEvent = (
  toolOutput: Record<string, unknown>,
  toolExecutionMs = 12.4,
): ToolExecutionEndEvent =>
  ({
    callId: "call_42",
    messages: [],
    toolCall: {
      type: "tool-call",
      toolCallId: "tool-call-42",
      toolName: "bash",
      input: { command: "pwd" },
    },
    toolContext: undefined,
    toolOutput,
    toolExecutionMs,
  }) as ToolExecutionEndEvent;

const makeEvent = (input: { type: PublicEvent["type"] }): PublicEvent => ({
  id: `evt_${input.type}`,
  streamId: "task_1",
  taskId: "task_1",
  sandboxId: "sbox_1",
  commandId: null,
  sequence: 1,
  type: input.type,
  producerService: "agent",
  producerId: "task_1",
  correlationId: "call_42",
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("ToolEventRelay", () => {
  it("appends task-scoped call and result events with correlation IDs", async () => {
    const append = vi.fn(async (input: { type: PublicEvent["type"] }) =>
      makeEvent(input),
    );
    const publish = vi.fn();
    const relay = new ToolEventRelay({
      events: { append } as unknown as Pick<EventStore, "append">,
      publish,
    });
    const callbacks = relay.callbacks({
      taskId: "task_1",
      sandboxId: "sbox_1",
    });

    await callbacks.onToolExecutionStart(startEvent({ command: "pwd" }));
    await callbacks.onToolExecutionEnd(
      endEvent({
        type: "tool-result",
        output: { stdout: "ok", exitCode: 0, truncated: false },
      }),
    );

    expect(append.mock.calls.map(([input]) => input.type)).toEqual([
      "agent_tool_call",
      "agent_tool_result",
    ]);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      taskId: "task_1",
      sandboxId: "sbox_1",
      producerService: "agent",
      producerId: "task_1",
      correlationId: "call_42",
      payload: { tool_name: "bash", args: { command: "pwd" } },
    });
    expect(append.mock.calls[1]?.[0]).toMatchObject({
      correlationId: "call_42",
      payload: {
        tool_name: "bash",
        result_snippet: JSON.stringify({
          stdout: "ok",
          exitCode: 0,
          truncated: false,
        }),
        truncated: false,
        exit_code: 0,
        duration_ms: 12,
      },
    });
  });

  it("disambiguates repeated SDK call IDs", async () => {
    const append = vi.fn(async (input: { type: PublicEvent["type"] }) =>
      makeEvent(input),
    );
    const relay = new ToolEventRelay({
      events: { append } as unknown as Pick<EventStore, "append">,
      publish: vi.fn(),
    });
    const callbacks = relay.callbacks({
      taskId: "task_1",
      sandboxId: "sbox_1",
    });

    await callbacks.onToolExecutionStart(startEvent({ command: "pwd" }));
    await callbacks.onToolExecutionEnd(
      endEvent({ type: "tool-result", output: { exitCode: 0 } }),
    );
    await callbacks.onToolExecutionStart(startEvent({ command: "pwd" }));
    await callbacks.onToolExecutionEnd(
      endEvent({ type: "tool-result", output: { exitCode: 0 } }),
    );

    expect(append.mock.calls.map(([input]) => input.correlationId)).toEqual([
      "call_42",
      "call_42",
      "call_42:2",
      "call_42:2",
    ]);
  });

  it("bounds results on UTF-8 boundaries and sanitizes tool errors", async () => {
    const append = vi.fn(async (input: { type: PublicEvent["type"] }) =>
      makeEvent(input),
    );
    const relay = new ToolEventRelay({
      events: { append } as unknown as Pick<EventStore, "append">,
      publish: vi.fn(),
    });
    const callbacks = relay.callbacks({
      taskId: "task_1",
      sandboxId: "sbox_1",
    });

    await callbacks.onToolExecutionEnd(
      endEvent({
        type: "tool-result",
        output: { stdout: "😀".repeat(300), truncated: false },
      }),
    );
    const bounded = append.mock.calls[0]?.[0].payload.result_snippet as string;
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(500);
    expect(bounded).not.toContain("\uFFFD");

    await callbacks.onToolExecutionEnd(
      endEvent({
        type: "tool-error",
        error: new Error("provider secret and runtime details"),
      }),
    );
    const safe = append.mock.calls[1]?.[0].payload;
    expect(safe).toMatchObject({
      result_snippet: "Tool execution failed",
      exit_code: null,
      truncated: false,
    });
    expect(JSON.stringify(safe)).not.toContain("provider secret");
  });

  it("publishes only after append commits and propagates append failures", async () => {
    let committed = false;
    const event = makeEvent({ type: "agent_tool_call" });
    const append = vi.fn(async () => {
      committed = true;
      return event;
    });
    const publish = vi.fn(() => {
      expect(committed).toBe(true);
    });
    const relay = new ToolEventRelay({
      events: { append } as unknown as Pick<EventStore, "append">,
      publish,
    });

    await relay.onToolExecutionStart(
      { taskId: "task_1", sandboxId: "sbox_1" },
      startEvent({}),
    );
    expect(publish).toHaveBeenCalledWith(event);

    const failure = new Error("database unavailable");
    append.mockRejectedValueOnce(failure);
    await expect(
      relay.onToolExecutionStart(
        { taskId: "task_1", sandboxId: "sbox_1" },
        startEvent({}),
      ),
    ).rejects.toBe(failure);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("stores the full tool result as an artifact when the snippet truncates it, session-scoped", async () => {
    const append = vi.fn(async (input: { type: PublicEvent["type"] }) =>
      makeEvent(input),
    );
    const create = vi.fn(async (input: { kind: string }) => ({
      artifactId: "art_1",
      kind: input.kind,
      contentType: "application/json",
      byteSize: 5000,
      truncated: false,
      redacted: false,
      preview: "preview",
    }));
    const relay = new ToolEventRelay({
      events: { append } as unknown as Pick<EventStore, "append">,
      publish: vi.fn(),
      artifacts: { create },
    });
    const callbacks = relay.callbacks({
      taskId: "run_1",
      sandboxId: "sbox_1",
      sessionId: "chat_1",
    });

    await callbacks.onToolExecutionEnd(
      endEvent({
        type: "tool-result",
        output: { stdout: "x".repeat(5000), exitCode: 0, truncated: false },
      }),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "chat_1",
        runId: "run_1",
        kind: "tool_output",
      }),
    );
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      artifactId: "art_1",
      payload: expect.objectContaining({ artifact_byte_size: 5000 }),
    });
  });

  it("does not create an artifact when the tool result already fits the event snippet", async () => {
    const append = vi.fn(async (input: { type: PublicEvent["type"] }) =>
      makeEvent(input),
    );
    const create = vi.fn();
    const relay = new ToolEventRelay({
      events: { append } as unknown as Pick<EventStore, "append">,
      publish: vi.fn(),
      artifacts: { create },
    });
    const callbacks = relay.callbacks({
      taskId: "run_1",
      sandboxId: "sbox_1",
      sessionId: "chat_1",
    });

    await callbacks.onToolExecutionEnd(
      endEvent({
        type: "tool-result",
        output: { stdout: "ok", exitCode: 0, truncated: false },
      }),
    );

    expect(create).not.toHaveBeenCalled();
    expect(append.mock.calls[0]?.[0]).not.toHaveProperty("artifactId", "art_1");
  });
});
