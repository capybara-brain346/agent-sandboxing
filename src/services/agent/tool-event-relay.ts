import type {
  OnToolExecutionEndCallback,
  OnToolExecutionStartCallback,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolSet,
} from "ai";
import type { EventStore } from "../events/event-store";
import type { PublicEvent } from "../../types/event.types";
import { boundUtf8 } from "./tools/helpers";

const RESULT_SNIPPET_MAX_BYTES = 500;

type PublishEvent = (event: PublicEvent) => void;

export type ToolEventContext = {
  taskId: string;
  sandboxId: string;
};

export type ToolEventRelayDependencies = {
  events: Pick<EventStore, "append">;
  publish: PublishEvent;
};

export type ToolEventRelayCallbacks<TOOLS extends ToolSet> = {
  onToolExecutionStart: OnToolExecutionStartCallback<TOOLS>;
  onToolExecutionEnd: OnToolExecutionEndCallback<TOOLS>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeSerialize = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return "Tool result unavailable";
  }
};

const safeArgs = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const integerOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const duration = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export class ToolEventRelay {
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: ToolEventRelayDependencies) {}

  callbacks<TOOLS extends ToolSet>(
    context: ToolEventContext,
  ): ToolEventRelayCallbacks<TOOLS> {
    return {
      onToolExecutionStart: (event) =>
        this.onToolExecutionStart(context, event),
      onToolExecutionEnd: (event) => this.onToolExecutionEnd(context, event),
    } as ToolEventRelayCallbacks<TOOLS>;
  }

  async onToolExecutionStart(
    context: ToolEventContext,
    event: ToolExecutionStartEvent,
  ): Promise<void> {
    await this.appendAndPublish({
      taskId: context.taskId,
      sandboxId: context.sandboxId,
      type: "agent_tool_call",
      producerService: "agent",
      producerId: context.taskId,
      correlationId: event.callId,
      payload: {
        tool_name: event.toolCall.toolName,
        args: safeArgs(event.toolCall.input),
      },
    });
  }

  async onToolExecutionEnd(
    context: ToolEventContext,
    event: ToolExecutionEndEvent,
  ): Promise<void> {
    const output =
      event.toolOutput.type === "tool-result"
        ? event.toolOutput.output
        : undefined;
    const serialized = safeSerialize(
      event.toolOutput.type === "tool-error" ? "Tool execution failed" : output,
    );
    const bounded = boundUtf8(serialized, RESULT_SNIPPET_MAX_BYTES);
    const outputRecord = isRecord(output) ? output : {};

    await this.appendAndPublish({
      taskId: context.taskId,
      sandboxId: context.sandboxId,
      type: "agent_tool_result",
      producerService: "agent",
      producerId: context.taskId,
      correlationId: event.callId,
      payload: {
        tool_name: event.toolCall.toolName,
        result_snippet: bounded.value,
        truncated:
          event.toolOutput.type === "tool-result" &&
          (outputRecord.truncated === true || bounded.truncated),
        exit_code:
          event.toolOutput.type === "tool-result"
            ? integerOrNull(outputRecord.exitCode ?? outputRecord.exit_code)
            : null,
        duration_ms: duration(event.toolExecutionMs),
      },
    });
  }

  private appendAndPublish(
    input: Parameters<EventStore["append"]>[0],
  ): Promise<void> {
    const next = this.appendQueue.then(async () => {
      const event = await this.dependencies.events.append(input);
      this.dependencies.publish(event);
    });
    this.appendQueue = next.catch(() => undefined);
    return next;
  }
}
