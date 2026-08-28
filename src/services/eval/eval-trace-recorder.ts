import { redact } from "../artifacts/artifact-store";
import { boundUtf8 } from "../../shared/utf8";
import { logger } from "../../logger";
import type { PublicEvent } from "../../types/event.types";
import type { WorkerResult } from "../../types/harness.types";
import type {
  EvalTrace,
  EvalTraceContextSnapshot,
  EvalTraceRunFacts,
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
    hasPriorRun: snapshot.workspace.hasPriorRun,
    lastRunStatus: snapshot.workspace.lastRunStatus
      ? safeText(snapshot.workspace.lastRunStatus, 200)
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
  runId: string;
  userPrompt: string;
  contextSummary?: EvalTrace["orchestrator"]["contextSummary"];
  contextSnapshot?: EvalTraceContextSnapshot;
  workerBriefs: string[];
  workerResults: WorkerResult[];
  usage: Array<{ stage: EvalTraceStage; usage: ModelUsage }>;
  reply?: string;
  delegated: boolean;
  run?: EvalTraceRunFacts;
};

export type EvalTraceRecorderOptions = {
  includeContextSnapshot?: boolean;
  tags?: string[];
};

export type EvalTraceRecorderLike = Pick<
  EvalTraceRecorder,
  | "startRun"
  | "recordOrchestratorContext"
  | "recordWorkerBrief"
  | "recordWorkerResult"
  | "recordOrchestratorReply"
  | "recordUsage"
  | "finishRun"
>;

export class EvalTraceRecorder implements EvalTraceRecorderLike {
  private readonly runs = new Map<string, TraceState>();
  private readonly tags: string[];

  constructor(
    private readonly sink: EvalTraceSink,
    private readonly options: EvalTraceRecorderOptions = {},
  ) {
    this.tags = options.tags?.slice() ?? [];
  }

  startRun(input: {
    sessionId: string;
    runId: string;
    userPrompt: string;
  }): void {
    this.runs.set(input.runId, {
      sessionId: input.sessionId,
      runId: input.runId,
      userPrompt: safeText(input.userPrompt),
      workerBriefs: [],
      workerResults: [],
      usage: [],
      delegated: false,
    });
    this.callSink("startRun", input);
  }

  recordOrchestratorContext(input: {
    runId: string;
    contextSummary: EvalTraceContextSummary;
    contextSnapshot?: EvalTraceContextSnapshot;
  }): void {
    const state = this.state(input.runId);
    state.contextSummary = input.contextSummary;
    if (this.options.includeContextSnapshot && input.contextSnapshot)
      state.contextSnapshot = safeSnapshot(input.contextSnapshot);
    this.callSink("recordOrchestratorContext", input);
  }

  recordWorkerBrief(input: { runId: string; brief: string }): void {
    const state = this.state(input.runId);
    state.workerBriefs.push(safeText(input.brief));
    state.delegated = true;
    this.callSink("recordWorkerBrief", input);
  }

  recordWorkerResult(input: { runId: string; result: WorkerResult }): void {
    const state = this.state(input.runId);
    state.workerResults.push(safeWorkerResult(input.result));
    state.delegated = true;
    this.callSink("recordWorkerResult", input);
  }

  recordOrchestratorReply(input: {
    runId: string;
    reply: string;
    delegated: boolean;
  }): void {
    const state = this.state(input.runId);
    state.reply = safeText(input.reply);
    state.delegated = input.delegated;
    this.callSink("recordOrchestratorReply", input);
  }

  recordUsage(input: {
    runId: string;
    stage: EvalTraceStage;
    usage: ModelUsage;
  }): void {
    const state = this.state(input.runId);
    state.usage.push({ stage: input.stage, usage: { ...input.usage } });
    this.callSink("recordUsage", input);
  }

  async finishRun(input: {
    runId: string;
    terminal: EvalTraceRunFacts;
    events: PublicEvent[];
  }): Promise<void> {
    const state = this.state(input.runId);
    state.run = {
      ...input.terminal,
      ...(input.terminal.finalMessage
        ? { finalMessage: safeText(input.terminal.finalMessage) }
        : {}),
    };
    const lastWorker = state.workerResults.at(-1);
    const trace: EvalTrace = {
      traceId: state.runId,
      runId: state.runId,
      sessionId: state.sessionId,
      name: "chat_run",
      input: state.userPrompt,
      ...(state.run.finalMessage ? { output: state.run.finalMessage } : {}),
      tags: [...this.tags, `status:${state.run.status}`],
      metadata: {
        runId: state.runId,
        sessionId: state.sessionId,
        status: state.run.status,
        exitReason: state.run.exitReason,
        diffBytes: state.run.diffBytes,
        diffPresent: state.run.diffPresent,
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
      run: state.run,
    };
    await this.callSinkAsync("finishRun", trace);
    this.runs.delete(input.runId);
  }

  private state(runId: string): TraceState {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    const state: TraceState = {
      sessionId: "",
      runId,
      userPrompt: "",
      workerBriefs: [],
      workerResults: [],
      usage: [],
      delegated: false,
    };
    this.runs.set(runId, state);
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
    method: "finishRun",
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
