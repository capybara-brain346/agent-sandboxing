import type {
  OnToolExecutionEndCallback,
  OnToolExecutionStartCallback,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolSet,
} from "ai";
import type { EventStore } from "../events/event-store";
import type { PublicEvent } from "../../types/event.types";
import type { ArtifactRecorder } from "../artifacts/artifact-store";
import { ServiceError } from "../../shared/errors";
import { boundUtf8 } from "./tools/helpers";
import type { TraceRecorderLike } from "../tracing/trace-recorder";

const RESULT_SNIPPET_MAX_BYTES = 500;

type PublishEvent = (event: PublicEvent) => void;

export type ToolEventContext = {
  messageId: string;
  sandboxId: string;
  sessionId: string;
};

export type ToolEventRelayDependencies = {
  events: Pick<EventStore, "append">;
  publish: PublishEvent;
  /** When set, session-scoped tool results too large for the event snippet are stored here for on-demand fetch. */
  artifacts?: ArtifactRecorder;
  traceRecorder?: TraceRecorderLike;
  agentRunId?: string;
  emitEvents?: boolean;
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

const safeToolError = (value: unknown): Record<string, unknown> =>
  value instanceof ServiceError
    ? { error: { code: value.code, message: value.message } }
    : { error: { message: "Tool execution failed" } };

const safeToolArgs = (
  toolName: string,
  value: unknown,
): Record<string, unknown> =>
  toolName === "publish_pull_request"
    ? Object.fromEntries(
        Object.entries(safeArgs(value)).filter(
          ([key]) => key !== "body" && key !== "comment",
        ),
      )
    : safeArgs(value);

const integerOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const duration = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

export class ToolEventRelay {
  private appendQueue: Promise<void> = Promise.resolve();
  private readonly callCounts = new Map<string, number>();
  private readonly pendingCorrelations = new Map<string, string[]>();

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
    const correlationId = this.startCorrelation(event.callId);
    const startedAt = new Date().toISOString();
    this.dependencies.traceRecorder?.recordToolCallStart?.({
      messageId: context.messageId,
      agentRunId: this.dependencies.agentRunId ?? context.messageId,
      correlationId,
      toolName: event.toolCall.toolName,
      args: safeToolArgs(event.toolCall.toolName, event.toolCall.input),
      startedAt,
    });
    await this.appendAndPublish(
      this.eventInput(context, correlationId, "agent_tool_call", {
        tool_name: event.toolCall.toolName,
        args: safeToolArgs(event.toolCall.toolName, event.toolCall.input),
      }),
    );
  }

  async onToolExecutionEnd(
    context: ToolEventContext,
    event: ToolExecutionEndEvent,
  ): Promise<void> {
    const correlationId = this.endCorrelation(event.callId);
    const completedAt = new Date().toISOString();
    const output =
      event.toolOutput.type === "tool-result"
        ? event.toolOutput.output
        : undefined;
    const serialized = safeSerialize(
      event.toolOutput.type === "tool-error"
        ? safeToolError(event.toolOutput.error)
        : output,
    );
    const bounded = boundUtf8(serialized, RESULT_SNIPPET_MAX_BYTES);
    const outputRecord = isRecord(output) ? output : {};
    const outputTruncated =
      event.toolOutput.type === "tool-result" &&
      (outputRecord.truncated === true || bounded.truncated);
    const error =
      event.toolOutput.type === "tool-error"
        ? event.toolOutput.error instanceof ServiceError
          ? {
              code: event.toolOutput.error.code,
              message: event.toolOutput.error.message,
              stage: "tool",
              correlationId,
            }
          : { message: "Tool execution failed", stage: "tool", correlationId }
        : undefined;
    this.dependencies.traceRecorder?.recordToolCallEnd?.({
      messageId: context.messageId,
      agentRunId: this.dependencies.agentRunId ?? context.messageId,
      correlationId,
      toolName: event.toolCall.toolName,
      output:
        event.toolOutput.type === "tool-result"
          ? output
          : safeToolError(event.toolOutput.error),
      resultSnippet: bounded.value,
      exitCode:
        event.toolOutput.type === "tool-result"
          ? integerOrNull(outputRecord.exitCode ?? outputRecord.exit_code)
          : null,
      truncated: outputTruncated,
      completedAt,
      durationMs: duration(event.toolExecutionMs),
      ...(error ? { error } : {}),
    });

    const artifact =
      this.dependencies.emitEvents !== false &&
      context.sessionId &&
      bounded.truncated &&
      this.dependencies.artifacts
        ? await this.dependencies.artifacts.create({
            sessionId: context.sessionId,
            messageId: context.messageId,
            kind: "tool_output",
            contentType: "application/json",
            content: serialized,
          })
        : undefined;
    const artifactId = artifact?.artifactId;

    await this.appendAndPublish(
      this.eventInput(
        context,
        correlationId,
        "agent_tool_result",
        {
          tool_name: event.toolCall.toolName,
          result_snippet: bounded.value,
          truncated: outputTruncated,
          exit_code:
            event.toolOutput.type === "tool-result"
              ? integerOrNull(outputRecord.exitCode ?? outputRecord.exit_code)
              : null,
          error: event.toolOutput.type === "tool-error",
          duration_ms: duration(event.toolExecutionMs),
          ...(artifact
            ? {
                artifact_byte_size: artifact.byteSize,
                artifact_redacted: artifact.redacted,
              }
            : {}),
        },
        artifactId,
      ),
    );
    if (artifact)
      this.dependencies.traceRecorder?.recordToolCallEnd?.({
        messageId: context.messageId,
        agentRunId: this.dependencies.agentRunId ?? context.messageId,
        correlationId,
        toolName: event.toolCall.toolName,
        output:
          event.toolOutput.type === "tool-result"
            ? output
            : safeToolError(event.toolOutput.error),
        resultSnippet: bounded.value,
        exitCode:
          event.toolOutput.type === "tool-result"
            ? integerOrNull(outputRecord.exitCode ?? outputRecord.exit_code)
            : null,
        truncated: outputTruncated,
        completedAt,
        durationMs: duration(event.toolExecutionMs),
        artifactId: artifact.artifactId,
        artifactByteSize: artifact.byteSize,
        artifactRedacted: artifact.redacted,
        ...(error ? { error } : {}),
      });
  }

  private eventInput(
    context: ToolEventContext,
    correlationId: string,
    type: "agent_tool_call" | "agent_tool_result",
    payload: Record<string, unknown>,
    artifactId?: string,
  ): Parameters<EventStore["append"]>[0] {
    return {
      sessionId: context.sessionId,
      messageId: context.messageId,
      sandboxId: context.sandboxId,
      artifactId: artifactId ?? null,
      domain: "agent",
      type,
      producerService: "agent",
      producerId: context.messageId,
      correlationId,
      payload,
    };
  }

  private appendAndPublish(
    input: Parameters<EventStore["append"]>[0],
  ): Promise<void> {
    if (this.dependencies.emitEvents === false) return Promise.resolve();
    const next = this.appendQueue.then(async () => {
      const event = await this.dependencies.events.append(input);
      this.dependencies.publish(event);
    });
    this.appendQueue = next.catch(() => undefined);
    return next;
  }

  private startCorrelation(callId: string): string {
    const count = (this.callCounts.get(callId) ?? 0) + 1;
    this.callCounts.set(callId, count);
    const correlationId = count === 1 ? callId : `${callId}:${count}`;
    const pending = this.pendingCorrelations.get(callId) ?? [];
    pending.push(correlationId);
    this.pendingCorrelations.set(callId, pending);
    return correlationId;
  }

  private endCorrelation(callId: string): string {
    const pending = this.pendingCorrelations.get(callId);
    const correlationId = pending?.shift() ?? callId;
    if (pending?.length === 0) this.pendingCorrelations.delete(callId);
    return correlationId;
  }
}
