import { randomUUID } from "node:crypto";
import { redact } from "../artifacts/artifact-store";
import { boundUtf8 } from "../../shared/utf8";
import { logger } from "../../logger";
import type { PublicEvent } from "../../types/event.types";
import type {
  ModelUsage,
  Trace,
  TraceContextSnapshot,
  TraceContextSummary,
  TraceError,
  TraceMessageFacts,
  TraceModelStage,
  TraceSink,
  TraceSubagent,
  TraceToolCall,
} from "../../types/trace.types";

const TEXT_MAX_BYTES = 4000;
const OUTPUT_MAX_BYTES = 50 * 1024;
const SUBAGENT_OUTPUT_MAX_BYTES = 20_000;
const MAX_ENTRIES = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeText = (value: string, maxBytes = TEXT_MAX_BYTES): string =>
  boundUtf8(redact(value).content, maxBytes).value;

const safeValue = (
  value: unknown,
  maxBytes = OUTPUT_MAX_BYTES,
  depth = 0,
): unknown => {
  if (typeof value === "string") return safeText(value, maxBytes);
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return value;
  if (depth >= 3) return "[bounded]";
  if (Array.isArray(value))
    return value
      .slice(0, MAX_ENTRIES)
      .map((item) => safeValue(item, maxBytes, depth + 1));
  if (!isRecord(value)) return safeText(String(value), maxBytes);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_ENTRIES)
      .map(([key, item]) => [
        safeText(key, 200),
        safeValue(item, maxBytes, depth + 1),
      ]),
  );
};

const safeArgs = (value: unknown): Record<string, unknown> => {
  const safe = safeValue(value);
  return isRecord(safe) ? safe : {};
};

const timing = (
  startedAt: string,
  completedAt: string,
  durationMs: number,
): { startedAt: string; completedAt: string; durationMs: number } => ({
  startedAt,
  completedAt,
  durationMs: Number.isFinite(durationMs)
    ? Math.max(0, Math.round(durationMs))
    : 0,
});

const durationBetween = (startedAt: string, completedAt: string): number => {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, end - start)
    : 0;
};

const safeError = (error: TraceError): TraceError => ({
  message: safeText(error.message),
  ...(error.code ? { code: safeText(error.code, 200) } : {}),
  ...(error.stage ? { stage: safeText(error.stage, 200) } : {}),
  ...(error.agentRunId ? { agentRunId: safeText(error.agentRunId, 200) } : {}),
  ...(error.subagentRunId
    ? { subagentRunId: safeText(error.subagentRunId, 200) }
    : {}),
  ...(error.correlationId
    ? { correlationId: safeText(error.correlationId, 200) }
    : {}),
});

const safeUsage = (usage: ModelUsage): ModelUsage => ({
  ...(usage.model ? { model: safeText(usage.model, 200) } : {}),
  ...(usage.inputTokens !== undefined && Number.isFinite(usage.inputTokens)
    ? { inputTokens: Math.max(0, usage.inputTokens) }
    : {}),
  ...(usage.outputTokens !== undefined && Number.isFinite(usage.outputTokens)
    ? { outputTokens: Math.max(0, usage.outputTokens) }
    : {}),
  ...(usage.totalTokens !== undefined && Number.isFinite(usage.totalTokens)
    ? { totalTokens: Math.max(0, usage.totalTokens) }
    : {}),
  ...(usage.estimatedUsd !== undefined && Number.isFinite(usage.estimatedUsd)
    ? { estimatedUsd: Math.max(0, usage.estimatedUsd) }
    : {}),
  ...(usage.latencyMs !== undefined && Number.isFinite(usage.latencyMs)
    ? { latencyMs: Math.max(0, usage.latencyMs) }
    : {}),
});

const eventToolName = (event: PublicEvent): string =>
  typeof event.payload.tool_name === "string"
    ? safeText(event.payload.tool_name, 200)
    : "unknown";

const normalizedToolEvents = (events: PublicEvent[]): TraceToolCall[] => {
  const pairs = new Map<string, { call?: PublicEvent; result?: PublicEvent }>();
  for (const event of events) {
    if (event.type !== "agent_tool_call" && event.type !== "agent_tool_result")
      continue;
    const correlationId = event.correlationId ?? event.id;
    const pair = pairs.get(correlationId) ?? {};
    if (event.type === "agent_tool_call") pair.call = event;
    else pair.result = event;
    pairs.set(correlationId, pair);
  }
  return [...pairs.entries()].map(([correlationId, pair]) => {
    const call = pair.call;
    const result = pair.result;
    const startedAt =
      call?.createdAt ?? result?.createdAt ?? new Date(0).toISOString();
    const completedAt = result?.createdAt ?? startedAt;
    const durationMs =
      typeof result?.payload.duration_ms === "number"
        ? Math.max(0, result.payload.duration_ms)
        : durationBetween(startedAt, completedAt);
    const output =
      typeof result?.payload.result_snippet === "string"
        ? safeText(result.payload.result_snippet, OUTPUT_MAX_BYTES)
        : undefined;
    const error =
      result?.payload.error === true
        ? safeError({
            message: "Tool execution failed",
            stage: "tool",
            correlationId,
          })
        : undefined;
    return {
      ...timing(startedAt, completedAt, durationMs),
      toolName: eventToolName(call ?? result!),
      args: safeArgs(call?.payload.args),
      ...(output !== undefined ? { output, resultSnippet: output } : {}),
      exitCode:
        typeof result?.payload.exit_code === "number" ||
        result?.payload.exit_code === null
          ? result.payload.exit_code
          : null,
      truncated: result?.payload.truncated === true,
      ...(result?.artifactId || typeof result?.payload.artifact_id === "string"
        ? {
            artifactId:
              result.artifactId ?? (result.payload.artifact_id as string),
          }
        : {}),
      ...(typeof result?.payload.artifact_byte_size === "number"
        ? { artifactByteSize: Math.max(0, result.payload.artifact_byte_size) }
        : {}),
      ...(typeof result?.payload.artifact_redacted === "boolean"
        ? { artifactRedacted: result.payload.artifact_redacted }
        : {}),
      correlationId,
      ...(error ? { error } : {}),
    };
  });
};

export const normalizeToolEvents = normalizedToolEvents;

type AgentRunState = {
  agentRunId: string;
  startedAt: string;
  input: string;
  completedAt?: string;
  output?: string;
  error?: TraceError;
  subagentRunId?: string;
  task?: string;
  usage: Array<{ stage: TraceModelStage; usage: ModelUsage }>;
  toolCalls: Map<string, TraceToolCall>;
};

type TraceState = {
  sessionId: string;
  messageId: string;
  userPrompt: string;
  startedAt: string;
  context?: {
    summary: TraceContextSummary;
    snapshot?: TraceContextSnapshot;
  };
  agentRunId: string;
  sessionAgent?: AgentRunState;
  subagents: Map<string, AgentRunState>;
  toolCalls: Map<string, TraceToolCall>;
  errors: TraceError[];
};

export type TraceRecorderOptions = {
  includeContextSnapshot?: boolean;
  tags?: string[];
};

export class TraceRecorder {
  private readonly traces = new Map<string, TraceState>();
  private readonly tags: string[];

  constructor(
    private readonly sink: TraceSink,
    private readonly options: TraceRecorderOptions = {},
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
      startedAt: new Date().toISOString(),
      agentRunId: `agent_${randomUUID()}`,
      subagents: new Map(),
      toolCalls: new Map(),
      errors: [],
    });
  }

  getAgentRunId(messageId: string): string | undefined {
    return this.traces.get(messageId)?.agentRunId;
  }

  recordContext(input: {
    messageId: string;
    contextSummary: TraceContextSummary;
    contextSnapshot?: TraceContextSnapshot;
  }): void {
    const state = this.state(input.messageId);
    state.context = {
      summary: {
        summaryPresent: input.contextSummary.summaryPresent,
        summaryChars: Math.max(0, input.contextSummary.summaryChars),
        recentMessageCount: Math.max(
          0,
          input.contextSummary.recentMessageCount,
        ),
        recentToolActivityCount: Math.max(
          0,
          input.contextSummary.recentToolActivityCount,
        ),
        workspaceHasPriorProcessing:
          input.contextSummary.workspaceHasPriorProcessing,
      },
      ...(this.options.includeContextSnapshot && input.contextSnapshot
        ? { snapshot: this.safeSnapshot(input.contextSnapshot) }
        : {}),
    };
  }

  startAgentRun(input: {
    messageId: string;
    agentRunId: string;
    startedAt: string;
    input: string;
    subagentRunId?: string;
    task?: string;
  }): void {
    const state = this.state(input.messageId);
    const run: AgentRunState = {
      agentRunId: input.agentRunId,
      startedAt: input.startedAt,
      input: safeText(input.input, OUTPUT_MAX_BYTES),
      ...(input.subagentRunId ? { subagentRunId: input.subagentRunId } : {}),
      ...(input.task ? { task: safeText(input.task) } : {}),
      usage: [],
      toolCalls: new Map(),
    };
    if (input.subagentRunId) state.subagents.set(input.subagentRunId, run);
    else state.sessionAgent = run;
  }

  finishAgentRun(input: {
    messageId: string;
    agentRunId: string;
    completedAt: string;
    output?: string;
    error?: TraceError;
  }): void {
    const state = this.state(input.messageId);
    const run = this.run(state, input.agentRunId);
    if (!run) return;
    run.completedAt = input.completedAt;
    if (input.output !== undefined)
      run.output = safeText(input.output, OUTPUT_MAX_BYTES);
    if (input.error) {
      run.error = safeError(input.error);
      if (
        input.error.message !== "Agent cancelled" &&
        input.error.message !== "Subagent cancelled"
      )
        this.pushError(state, run.error);
    }
  }

  recordToolCallStart(input: {
    messageId: string;
    agentRunId: string;
    correlationId: string;
    toolName: string;
    args: unknown;
    startedAt: string;
  }): void {
    const state = this.state(input.messageId);
    const run = this.ensureRun(state, input.agentRunId, input.startedAt);
    const call: TraceToolCall = {
      ...timing(input.startedAt, input.startedAt, 0),
      toolName: safeText(input.toolName, 200),
      args: safeArgs(input.args),
      exitCode: null,
      truncated: false,
      correlationId: safeText(input.correlationId, 200),
    };
    run.toolCalls.set(input.correlationId, call);
    if (!run.subagentRunId) state.toolCalls.set(input.correlationId, call);
  }

  recordToolCallEnd(input: {
    messageId: string;
    agentRunId: string;
    correlationId: string;
    toolName: string;
    output: unknown;
    resultSnippet?: string;
    exitCode: number | null;
    truncated: boolean;
    completedAt: string;
    durationMs: number;
    artifactId?: string;
    artifactByteSize?: number;
    artifactRedacted?: boolean;
    error?: TraceError;
  }): void {
    const state = this.state(input.messageId);
    const run = this.ensureRun(state, input.agentRunId, input.completedAt);
    const existing = run.toolCalls.get(input.correlationId);
    const startedAt =
      existing?.startedAt ??
      new Date(
        Date.parse(input.completedAt) - Math.max(0, input.durationMs),
      ).toISOString();
    const call: TraceToolCall = {
      ...timing(startedAt, input.completedAt, input.durationMs),
      toolName: safeText(input.toolName, 200),
      args: existing?.args ?? {},
      output: safeValue(input.output),
      ...(input.resultSnippet !== undefined
        ? { resultSnippet: safeText(input.resultSnippet, OUTPUT_MAX_BYTES) }
        : {}),
      exitCode: input.exitCode,
      truncated: input.truncated,
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      ...(input.artifactByteSize !== undefined
        ? { artifactByteSize: Math.max(0, input.artifactByteSize) }
        : {}),
      ...(input.artifactRedacted !== undefined
        ? { artifactRedacted: input.artifactRedacted }
        : {}),
      correlationId: safeText(input.correlationId, 200),
      ...(input.error ? { error: safeError(input.error) } : {}),
    };
    run.toolCalls.set(input.correlationId, call);
    if (!run.subagentRunId) state.toolCalls.set(input.correlationId, call);
    if (input.error) this.pushError(state, call.error!);
  }

  recordSubagent(input: {
    messageId: string;
    subagent: {
      subagentRunId: string;
      task: string;
      toolCalls: unknown[];
      summary: string;
      startedAt: string;
      completedAt: string;
      durationMs: number;
      error?: string;
    };
  }): void {
    const state = this.state(input.messageId);
    const run =
      state.subagents.get(input.subagent.subagentRunId) ??
      this.ensureRun(
        state,
        input.subagent.subagentRunId,
        input.subagent.startedAt,
      );
    run.subagentRunId = input.subagent.subagentRunId;
    run.task = safeText(input.subagent.task);
    run.completedAt = input.subagent.completedAt;
    run.output = safeText(input.subagent.summary, SUBAGENT_OUTPUT_MAX_BYTES);
    if (input.subagent.error) {
      run.error = safeError({
        message: input.subagent.error,
        stage: "subagent",
        subagentRunId: input.subagent.subagentRunId,
      });
      if (input.subagent.error !== "Subagent cancelled")
        this.pushError(state, run.error);
    }
    if (!run.toolCalls.size)
      for (const [index, toolCall] of input.subagent.toolCalls.entries()) {
        const correlationId = `subagent:${input.subagent.subagentRunId}:${index}`;
        const output = safeValue(toolCall);
        const call: TraceToolCall = {
          ...timing(
            input.subagent.startedAt,
            input.subagent.completedAt,
            input.subagent.durationMs,
          ),
          toolName:
            isRecord(toolCall) && typeof toolCall.toolName === "string"
              ? safeText(toolCall.toolName, 200)
              : "unknown",
          args: isRecord(toolCall) ? safeArgs(toolCall.input) : {},
          output,
          exitCode: null,
          truncated: false,
          correlationId,
        };
        run.toolCalls.set(correlationId, call);
      }
  }

  recordUsage(input: {
    messageId: string;
    stage: TraceModelStage;
    usage: ModelUsage;
    agentRunId?: string;
  }): void {
    const state = this.state(input.messageId);
    const run = this.ensureRun(
      state,
      input.agentRunId ?? state.agentRunId,
      state.startedAt,
    );
    run.usage.push({ stage: input.stage, usage: safeUsage(input.usage) });
  }

  async finishProcessing(input: {
    messageId: string;
    terminal: TraceMessageFacts;
    events: PublicEvent[];
  }): Promise<void> {
    const state = this.state(input.messageId);
    const completedAt = new Date().toISOString();
    const sessionAgent: AgentRunState = state.sessionAgent ?? {
      agentRunId: state.agentRunId,
      startedAt: state.startedAt,
      input: state.userPrompt,
      usage: [],
      toolCalls: new Map(),
    };
    if (
      sessionAgent.output === undefined &&
      input.terminal.finalMessage !== undefined
    )
      sessionAgent.output = safeText(
        input.terminal.finalMessage,
        OUTPUT_MAX_BYTES,
      );
    const normalized = normalizedToolEvents(input.events);
    for (const call of normalized)
      if (!state.toolCalls.has(call.correlationId))
        state.toolCalls.set(call.correlationId, call);
    const context = {
      userRequest: state.userPrompt,
      ...(state.context ?? {
        summary: {
          summaryPresent: false,
          summaryChars: 0,
          recentMessageCount: 0,
          recentToolActivityCount: 0,
          workspaceHasPriorProcessing: false,
        },
      }),
    };
    const terminalError = input.terminal.error
      ? safeError(input.terminal.error)
      : undefined;
    if (terminalError) this.pushError(state, terminalError);
    const outcome =
      input.terminal.status === "cancelled"
        ? "cancelled"
        : input.terminal.status === "completed"
          ? "completed"
          : "failed";
    const trace: Trace = {
      ...timing(
        state.startedAt,
        completedAt,
        durationBetween(state.startedAt, completedAt),
      ),
      identity: {
        sessionId: state.sessionId,
        messageId: state.messageId,
        agentRunId: state.agentRunId,
      },
      context,
      sessionAgent: this.finishRun(sessionAgent, completedAt),
      toolCalls: [...state.toolCalls.values()],
      subagents: [...state.subagents.values()].map((run) =>
        this.finishSubagent(run, completedAt),
      ),
      outcome,
      errors: state.errors,
      tags: [...this.tags, `outcome:${outcome}`],
    };
    try {
      await this.sink.finishTrace(trace);
    } catch (error) {
      logger.warn("trace_export_failed", {
        messageId: state.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.traces.delete(input.messageId);
    }
  }

  private finishRun(run: AgentRunState, completedAt: string) {
    return {
      ...timing(
        run.startedAt,
        run.completedAt ?? completedAt,
        durationBetween(run.startedAt, run.completedAt ?? completedAt),
      ),
      agentRunId: run.agentRunId,
      input: run.input,
      ...(run.output !== undefined ? { output: run.output } : {}),
      usage: run.usage,
      ...(run.error ? { error: run.error } : {}),
    };
  }

  private finishSubagent(
    run: AgentRunState,
    completedAt: string,
  ): TraceSubagent {
    return {
      ...timing(
        run.startedAt,
        run.completedAt ?? completedAt,
        durationBetween(run.startedAt, run.completedAt ?? completedAt),
      ),
      subagentRunId: run.subagentRunId ?? run.agentRunId,
      task: run.task ?? "",
      summary: run.output ?? "",
      toolCalls: [...run.toolCalls.values()],
      usage: run.usage,
      ...(run.error ? { error: run.error } : {}),
    };
  }

  private safeSnapshot(snapshot: TraceContextSnapshot): TraceContextSnapshot {
    return {
      summary: safeText(snapshot.summary),
      recentMessages: snapshot.recentMessages
        .slice(0, MAX_ENTRIES)
        .map((message) => ({
          role: message.role,
          content: safeText(message.content),
        })),
      recentToolActivity: snapshot.recentToolActivity
        .slice(0, MAX_ENTRIES)
        .map((activity) => safeText(activity)),
      workspace: {
        hasPriorProcessing: snapshot.workspace.hasPriorProcessing,
        lastProcessingStatus: snapshot.workspace.lastProcessingStatus
          ? safeText(snapshot.workspace.lastProcessingStatus, 200)
          : null,
        changedFilesHint: snapshot.workspace.changedFilesHint
          .slice(0, MAX_ENTRIES)
          .map((file) => safeText(file, 500)),
      },
    };
  }

  private run(
    state: TraceState,
    agentRunId: string,
  ): AgentRunState | undefined {
    if (agentRunId === state.agentRunId) return state.sessionAgent;
    return [...state.subagents.values()].find(
      (run) => run.agentRunId === agentRunId,
    );
  }

  private ensureRun(
    state: TraceState,
    agentRunId: string,
    startedAt: string,
  ): AgentRunState {
    const existing = this.run(state, agentRunId);
    if (existing) return existing;
    const run: AgentRunState = {
      agentRunId,
      startedAt,
      input: "",
      usage: [],
      toolCalls: new Map(),
    };
    if (agentRunId === state.agentRunId) state.sessionAgent = run;
    else {
      run.subagentRunId = agentRunId;
      state.subagents.set(agentRunId, run);
    }
    return run;
  }

  private pushError(state: TraceState, error: TraceError): void {
    if (
      !state.errors.some(
        (item) => JSON.stringify(item) === JSON.stringify(error),
      )
    )
      state.errors.push(error);
  }

  private state(messageId: string): TraceState {
    const existing = this.traces.get(messageId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const state: TraceState = {
      sessionId: "",
      messageId,
      userPrompt: "",
      startedAt: now,
      agentRunId: `agent_${randomUUID()}`,
      subagents: new Map(),
      toolCalls: new Map(),
      errors: [],
    };
    this.traces.set(messageId, state);
    return state;
  }
}

export type TraceRecorderLike = Pick<
  TraceRecorder,
  | "getAgentRunId"
  | "startProcessing"
  | "startAgentRun"
  | "finishAgentRun"
  | "recordContext"
  | "recordToolCallStart"
  | "recordToolCallEnd"
  | "recordSubagent"
  | "recordUsage"
  | "finishProcessing"
>;
