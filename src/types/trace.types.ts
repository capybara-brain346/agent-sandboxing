import type { MessageProcessingStatus } from "./message-processing.types";

export type TraceModelStage = "sessionAgent" | "summaryCompaction";

export type ModelUsage = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedUsd?: number;
  latencyMs?: number;
};

export type TraceTiming = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export type TraceError = {
  message: string;
  code?: string;
  stage?: string;
  agentRunId?: string;
  subagentRunId?: string;
  correlationId?: string;
};

export type TraceToolCall = TraceTiming & {
  toolName: string;
  args: Record<string, unknown>;
  output?: unknown;
  resultSnippet?: string;
  exitCode: number | null;
  truncated: boolean;
  artifactId?: string;
  artifactByteSize?: number;
  artifactRedacted?: boolean;
  correlationId: string;
  error?: TraceError;
};

export type TraceSubagent = TraceTiming & {
  subagentRunId: string;
  task: string;
  toolCalls: TraceToolCall[];
  summary: string;
  usage?: Array<{ stage: TraceModelStage; usage: ModelUsage }>;
  error?: TraceError;
};

export type TraceContextSummary = {
  summaryPresent: boolean;
  summaryChars: number;
  recentMessageCount: number;
  recentToolActivityCount: number;
  workspaceHasPriorProcessing: boolean;
};

export type TraceContextSnapshot = {
  summary: string;
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  recentToolActivity: string[];
  workspace: {
    hasPriorProcessing: boolean;
    lastProcessingStatus: string | null;
    changedFilesHint: string[];
  };
};

export type TraceContext = {
  userRequest: string;
  summary: TraceContextSummary;
  snapshot?: TraceContextSnapshot;
};

export type TraceMessageFacts = {
  status: MessageProcessingStatus;
  exitReason: string;
  diffBytes: number;
  diffPresent: boolean;
  artifacts: Array<{
    artifactId: string;
    kind: string;
    byteSize: number;
    truncated: boolean;
    redacted: boolean;
  }>;
  finalMessage?: string;
  error?: TraceError;
};

export type TraceOutcome = "completed" | "failed" | "cancelled";

export type TraceSessionAgent = TraceTiming & {
  agentRunId: string;
  input: string;
  output?: string;
  usage: Array<{ stage: TraceModelStage; usage: ModelUsage }>;
  error?: TraceError;
};

export type Trace = TraceTiming & {
  identity: {
    sessionId: string;
    messageId: string;
    agentRunId: string;
  };
  context: TraceContext;
  sessionAgent: TraceSessionAgent;
  toolCalls: TraceToolCall[];
  subagents: TraceSubagent[];
  outcome: TraceOutcome;
  errors: TraceError[];
  tags: string[];
};

export type TraceSink = {
  finishTrace(trace: Trace): void | Promise<void>;
};
