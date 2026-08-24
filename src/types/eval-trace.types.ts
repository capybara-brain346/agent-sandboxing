import type { WorkerResult } from "./harness.types";
import type { TaskStatus } from "./task.types";

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
  workspaceHasPriorRun: boolean;
};

export type EvalTraceContextSnapshot = {
  summary: string;
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  recentToolActivity: string[];
  workspace: {
    hasPriorRun: boolean;
    lastRunStatus: string | null;
    changedFilesHint: string[];
  };
};

export type EvalTraceRunFacts = {
  status: TaskStatus;
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
  runId: string;
  sessionId: string;
  name: "chat_run";
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
  run?: EvalTraceRunFacts;
};

export type EvalTraceSink = {
  startRun(input: {
    sessionId: string;
    runId: string;
    userPrompt: string;
  }): void | Promise<void>;
  recordOrchestratorContext(input: {
    runId: string;
    contextSummary: EvalTraceContextSummary;
    contextSnapshot?: EvalTraceContextSnapshot;
  }): void | Promise<void>;
  recordWorkerBrief(input: {
    runId: string;
    brief: string;
  }): void | Promise<void>;
  recordWorkerResult(input: {
    runId: string;
    result: WorkerResult;
  }): void | Promise<void>;
  recordOrchestratorReply(input: {
    runId: string;
    reply: string;
    delegated: boolean;
  }): void | Promise<void>;
  recordUsage(input: {
    runId: string;
    stage: EvalTraceStage;
    usage: ModelUsage;
  }): void | Promise<void>;
  finishRun(trace: EvalTrace): void | Promise<void>;
};
