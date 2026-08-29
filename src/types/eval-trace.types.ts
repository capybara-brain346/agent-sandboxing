import type { WorkerResult } from "./harness.types";
import type { MessageProcessingStatus } from "./message-processing.types";

export type EvalTraceStage = "orchestrator" | "worker" | "summaryCompaction";

export type ModelUsage = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedUsd?: number;
  latencyMs?: number;
};

export type EvalTraceToolEvent = {
  toolName: string;
  kind: "call" | "result";
  args?: Record<string, unknown>;
  resultSnippet?: string;
  exitCode?: number | null;
  truncated?: boolean;
  durationMs?: number;
  artifactId?: string;
  artifactByteSize?: number;
  artifactRedacted?: boolean;
  correlationId: string;
};

export type EvalTraceContextSummary = {
  summaryPresent: boolean;
  summaryChars: number;
  recentMessageCount: number;
  recentToolActivityCount: number;
  workspaceHasPriorProcessing: boolean;
};

export type EvalTraceContextSnapshot = {
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

export type EvalTraceMessageFacts = {
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
};

export type EvalTrace = {
  traceId: string;
  messageId: string;
  sessionId: string;
  name: "chat_message";
  input: string;
  output?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  orchestrator: {
    contextSummary?: EvalTraceContextSummary;
    contextSnapshot?: EvalTraceContextSnapshot;
    delegated: boolean;
    workerBriefs: string[];
    workerResults: WorkerResult[];
    reply?: string;
  };
  usage: Array<{ stage: EvalTraceStage; usage: ModelUsage }>;
  tools: EvalTraceToolEvent[];
  worker?: WorkerResult;
  processing?: EvalTraceMessageFacts;
};

export type EvalTraceSink = {
  startProcessing(input: {
    sessionId: string;
    messageId: string;
    userPrompt: string;
  }): void | Promise<void>;
  recordOrchestratorContext(input: {
    messageId: string;
    contextSummary: EvalTraceContextSummary;
    contextSnapshot?: EvalTraceContextSnapshot;
  }): void | Promise<void>;
  recordWorkerBrief(input: {
    messageId: string;
    brief: string;
  }): void | Promise<void>;
  recordWorkerResult(input: {
    messageId: string;
    result: WorkerResult;
  }): void | Promise<void>;
  recordOrchestratorReply(input: {
    messageId: string;
    reply: string;
    delegated: boolean;
  }): void | Promise<void>;
  recordUsage(input: {
    messageId: string;
    stage: EvalTraceStage;
    usage: ModelUsage;
  }): void | Promise<void>;
  finishProcessing(trace: EvalTrace): void | Promise<void>;
};
