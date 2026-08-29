import { redact } from "../artifacts/artifact-store";
import { boundUtf8 } from "../../shared/utf8";
import { logger } from "../../logger";
import type { PublicEvent } from "../../types/event.types";
import type { WorkerResult } from "../../types/harness.types";
import type {
  EvalTrace,
  EvalTraceContextSnapshot,
  EvalTraceMessageFacts,
  EvalTraceSink,
  EvalTraceToolEvent,
  ModelUsage,
  EvalTraceContextSummary,
} from "../../types/eval-trace.types";
import type { EvalTraceStage } from "../../types/eval-trace.types";

const TEXT_MAX_BYTES = 4000;
const RESULT_MAX_BYTES = 2000;
const TOOL_ARGS_MAX_ENTRIES = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeText = (value: string, maxBytes = TEXT_MAX_BYTES): string => {
  const scrubbed = redact(value).content;
  return boundUtf8(scrubbed, maxBytes).value;
};

const safeValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") return safeText(value, RESULT_MAX_BYTES);
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return value;
  if (depth >= 2) return "[bounded]";
  if (Array.isArray(value))
    return value
      .slice(0, TOOL_ARGS_MAX_ENTRIES)
      .map((item) => safeValue(item, depth + 1));
  if (!isRecord(value)) return safeText(String(value), RESULT_MAX_BYTES);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, TOOL_ARGS_MAX_ENTRIES)
      .map(([key, item]) => [safeText(key, 200), safeValue(item, depth + 1)]),
  );
};

const safeArgs = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) return {};
  return safeValue(value) as Record<string, unknown>;
};

const safeWorkerResult = (result: WorkerResult): WorkerResult => ({
  status: result.status,
  summary: safeText(result.summary),
});

const safeSnapshot = (
  snapshot: EvalTraceContextSnapshot,
): EvalTraceContextSnapshot => ({
  summary: safeText(snapshot.summary),
  recentMessages: snapshot.recentMessages
    .slice(0, TOOL_ARGS_MAX_ENTRIES)
    .map((message) => ({
      role: message.role,
      content: safeText(message.content),
    })),
  recentToolActivity: snapshot.recentToolActivity
    .slice(0, TOOL_ARGS_MAX_ENTRIES)
    .map((activity) => safeText(activity)),
  workspace: {
    hasPriorProcessing: snapshot.workspace.hasPriorProcessing,
    lastProcessingStatus: snapshot.workspace.lastProcessingStatus
      ? safeText(snapshot.workspace.lastProcessingStatus, 200)
      : null,
    changedFilesHint: snapshot.workspace.changedFilesHint
      .slice(0, TOOL_ARGS_MAX_ENTRIES)
      .map((file) => safeText(file, 500)),
  },
});

const normalizePayload = (
  event: PublicEvent,
  kind: EvalTraceToolEvent["kind"],
): EvalTraceToolEvent => {
  const payload = event.payload;
  const toolName =
    typeof payload.tool_name === "string" ? payload.tool_name : "unknown";
  const correlationId = event.correlationId ?? event.id;
  if (kind === "call")
    return {
      toolName: safeText(toolName, 200),
      kind,
      args: safeArgs(payload.args),
      correlationId,
    };

  const result: EvalTraceToolEvent = {
    toolName: safeText(toolName, 200),
    kind,
    resultSnippet:
      typeof payload.result_snippet === "string"
        ? safeText(payload.result_snippet, RESULT_MAX_BYTES)
        : "",
    exitCode:
      typeof payload.exit_code === "number" || payload.exit_code === null
        ? payload.exit_code
        : null,
    truncated: payload.truncated === true,
    durationMs:
      typeof payload.duration_ms === "number"
        ? Math.max(0, payload.duration_ms)
        : 0,
    correlationId,
  };
  const artifactId = event.artifactId ?? payload.artifact_id;
  if (typeof artifactId === "string" && artifactId)
    result.artifactId = artifactId;
  if (typeof payload.artifact_byte_size === "number")
    result.artifactByteSize = Math.max(0, payload.artifact_byte_size);
  if (typeof payload.artifact_redacted === "boolean")
    result.artifactRedacted = payload.artifact_redacted;
  return result;
};

export const normalizeToolEvents = (
  events: PublicEvent[],
): EvalTraceToolEvent[] =>
  events.flatMap((event) => {
    if (event.type === "agent_tool_call")
      return [normalizePayload(event, "call")];
    if (event.type === "agent_tool_result")
      return [normalizePayload(event, "result")];
    return [];
  });

type TraceState = {
  sessionId: string;
  messageId: string;
  userPrompt: string;
  contextSummary?: EvalTrace["orchestrator"]["contextSummary"];
  contextSnapshot?: EvalTraceContextSnapshot;
  workerBriefs: string[];
  workerResults: WorkerResult[];
  usage: Array<{ stage: EvalTraceStage; usage: ModelUsage }>;
  reply?: string;
  delegated: boolean;
  processing?: EvalTraceMessageFacts;
};

export type EvalTraceRecorderOptions = {
  includeContextSnapshot?: boolean;
  tags?: string[];
};

export type EvalTraceRecorderLike = Pick<
  EvalTraceRecorder,
  | "startProcessing"
  | "recordOrchestratorContext"
  | "recordWorkerBrief"
  | "recordWorkerResult"
  | "recordOrchestratorReply"
  | "recordUsage"
  | "finishProcessing"
>;

export class EvalTraceRecorder implements EvalTraceRecorderLike {
  private readonly traces = new Map<string, TraceState>();
  private readonly tags: string[];

  constructor(
    private readonly sink: EvalTraceSink,
    private readonly options: EvalTraceRecorderOptions = {},
  ) {
    this.tags = options.tags?.slice() ?? [];
  }

  startProcessing(input: {
    sessionId: string;
    messageId: string;
    userPrompt: string;
  }): void {
    this.traces.set(input.messageId, {
      sessionId: input.sessionId,
      messageId: input.messageId,
      userPrompt: safeText(input.userPrompt),
      workerBriefs: [],
      workerResults: [],
      usage: [],
      delegated: false,
    });
    this.callSink("startProcessing", input);
  }

  recordOrchestratorContext(input: {
    messageId: string;
    contextSummary: EvalTraceContextSummary;
    contextSnapshot?: EvalTraceContextSnapshot;
  }): void {
    const state = this.state(input.messageId);
    state.contextSummary = input.contextSummary;
    if (this.options.includeContextSnapshot && input.contextSnapshot)
      state.contextSnapshot = safeSnapshot(input.contextSnapshot);
    this.callSink("recordOrchestratorContext", input);
  }

  recordWorkerBrief(input: { messageId: string; brief: string }): void {
    const state = this.state(input.messageId);
    state.workerBriefs.push(safeText(input.brief));
    state.delegated = true;
    this.callSink("recordWorkerBrief", input);
  }

  recordWorkerResult(input: { messageId: string; result: WorkerResult }): void {
    const state = this.state(input.messageId);
    state.workerResults.push(safeWorkerResult(input.result));
    state.delegated = true;
    this.callSink("recordWorkerResult", input);
  }

  recordOrchestratorReply(input: {
    messageId: string;
    reply: string;
    delegated: boolean;
  }): void {
    const state = this.state(input.messageId);
    state.reply = safeText(input.reply);
    state.delegated = input.delegated;
    this.callSink("recordOrchestratorReply", input);
  }

  recordUsage(input: {
    messageId: string;
    stage: EvalTraceStage;
    usage: ModelUsage;
  }): void {
    const state = this.state(input.messageId);
    state.usage.push({ stage: input.stage, usage: { ...input.usage } });
    this.callSink("recordUsage", input);
  }

  async finishProcessing(input: {
    messageId: string;
    terminal: EvalTraceMessageFacts;
    events: PublicEvent[];
  }): Promise<void> {
    const state = this.state(input.messageId);
    state.processing = {
      ...input.terminal,
      ...(input.terminal.finalMessage
        ? { finalMessage: safeText(input.terminal.finalMessage) }
        : {}),
    };
    const lastWorker = state.workerResults.at(-1);
    const trace: EvalTrace = {
      traceId: state.messageId,
      messageId: state.messageId,
      sessionId: state.sessionId,
      name: "chat_message",
      input: state.userPrompt,
      ...(state.processing.finalMessage
        ? { output: state.processing.finalMessage }
        : {}),
      tags: [...this.tags, `status:${state.processing.status}`],
      metadata: {
        messageId: state.messageId,
        sessionId: state.sessionId,
        status: state.processing.status,
        exitReason: state.processing.exitReason,
        diffBytes: state.processing.diffBytes,
        diffPresent: state.processing.diffPresent,
        delegated: state.delegated,
        workerResultCount: state.workerResults.length,
        toolEventCount: normalizeToolEvents(input.events).length,
      },
      orchestrator: {
        ...(state.contextSummary
          ? { contextSummary: state.contextSummary }
          : {}),
        ...(state.contextSnapshot
          ? { contextSnapshot: state.contextSnapshot }
          : {}),
        delegated: state.delegated,
        workerBriefs: state.workerBriefs,
        workerResults: state.workerResults,
        ...(state.reply ? { reply: state.reply } : {}),
      },
      usage: state.usage,
      tools: normalizeToolEvents(input.events),
      ...(lastWorker ? { worker: lastWorker } : {}),
      processing: state.processing,
    };
    await this.callSinkAsync("finishProcessing", trace);
    this.traces.delete(input.messageId);
  }

  private state(messageId: string): TraceState {
    const existing = this.traces.get(messageId);
    if (existing) return existing;
    const state: TraceState = {
      sessionId: "",
      messageId,
      userPrompt: "",
      workerBriefs: [],
      workerResults: [],
      usage: [],
      delegated: false,
    };
    this.traces.set(messageId, state);
    return state;
  }

  private callSink<K extends keyof EvalTraceSink>(
    method: K,
    input: Parameters<
      Extract<EvalTraceSink[K], (...args: never[]) => unknown>
    >[0],
  ): void {
    try {
      const result = (
        this.sink[method] as (value: typeof input) => void | Promise<void>
      )(input);
      if (result instanceof Promise)
        void result.catch((error) => this.logSinkError(method, error));
    } catch (error) {
      this.logSinkError(method, error);
    }
  }

  private async callSinkAsync(
    method: "finishProcessing",
    input: EvalTrace,
  ): Promise<void> {
    try {
      await this.sink[method](input);
    } catch (error) {
      this.logSinkError(method, error);
    }
  }

  private logSinkError(method: string, error: unknown): void {
    logger.warn("eval_trace_sink_failed", {
      method,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
