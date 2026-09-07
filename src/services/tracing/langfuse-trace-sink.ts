import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  createTraceId,
  startObservation,
  type LangfuseSpan,
} from "@langfuse/tracing";
import { redact } from "../artifacts/artifact-store";
import { logger } from "../../logger";
import type { Config } from "../../config";
import type {
  ModelUsage,
  Trace,
  TraceModelStage,
  TraceSink,
  TraceSubagent,
  TraceToolCall,
} from "../../types/trace.types";

const usageDetails = (usage: ModelUsage): Record<string, number> => ({
  ...(usage.inputTokens !== undefined ? { input: usage.inputTokens } : {}),
  ...(usage.outputTokens !== undefined ? { output: usage.outputTokens } : {}),
  ...(usage.totalTokens !== undefined ? { total: usage.totalTokens } : {}),
});

const observationTiming = (value: {
  startedAt: string;
  completedAt: string;
  durationMs: number;
}): Record<string, unknown> => ({
  startedAt: value.startedAt,
  completedAt: value.completedAt,
  durationMs: value.durationMs,
});

const generation = (
  parent: Pick<LangfuseSpan, "startObservation">,
  name: TraceModelStage,
  usage: ModelUsage,
  output?: unknown,
): void => {
  const observation = parent.startObservation(
    `${name}.generate`,
    {
      ...(usage.model ? { model: usage.model } : {}),
      ...(Object.keys(usageDetails(usage)).length
        ? { usageDetails: usageDetails(usage) }
        : {}),
      metadata: {
        ...(usage.latencyMs !== undefined
          ? { latencyMs: usage.latencyMs }
          : {}),
        ...(usage.estimatedUsd !== undefined
          ? { estimatedUsd: usage.estimatedUsd }
          : {}),
      },
    },
    { asType: "generation" },
  );
  if (output !== undefined) observation.update({ output });
  observation.end();
};

const toolObservations = (
  parent: Pick<LangfuseSpan, "startObservation">,
  calls: TraceToolCall[],
): void => {
  for (const call of calls) {
    const observation = parent.startObservation(
      `tool.${call.toolName}`,
      {
        input: call.args,
        ...(call.output !== undefined
          ? { output: call.output }
          : call.error
            ? { output: { error: call.error } }
            : {}),
        metadata: {
          correlationId: call.correlationId,
          ...observationTiming(call),
          ...(call.resultSnippet !== undefined
            ? { resultSnippet: call.resultSnippet }
            : {}),
          exitCode: call.exitCode,
          truncated: call.truncated,
          ...(call.artifactId ? { artifactId: call.artifactId } : {}),
          ...(call.artifactByteSize !== undefined
            ? { artifactByteSize: call.artifactByteSize }
            : {}),
          ...(call.artifactRedacted !== undefined
            ? { artifactRedacted: call.artifactRedacted }
            : {}),
        },
      },
      { asType: "tool" },
    );
    observation.end();
  }
};

const subagentObservation = (
  parent: Pick<LangfuseSpan, "startObservation">,
  subagent: TraceSubagent,
): void => {
  const observation = parent.startObservation(
    "subagent",
    {
      input: { task: subagent.task },
      ...(subagent.error
        ? { output: { error: subagent.error } }
        : { output: subagent.summary }),
      metadata: {
        subagentRunId: subagent.subagentRunId,
        ...observationTiming(subagent),
      },
      ...(subagent.error ? { statusMessage: subagent.error.message } : {}),
    },
    { asType: "agent" },
  );
  for (const item of subagent.usage ?? [])
    generation(observation, item.stage, item.usage);
  toolObservations(observation, subagent.toolCalls);
  observation.end();
};

export const langfuseTraceMetadata = (
  trace: Trace,
): Record<string, unknown> => ({
  identity: trace.identity,
  outcome: trace.outcome,
  timing: observationTiming(trace),
  context: trace.context.summary,
  sessionAgent: {
    agentRunId: trace.sessionAgent.agentRunId,
    ...observationTiming(trace.sessionAgent),
    ...(trace.sessionAgent.error ? { error: trace.sessionAgent.error } : {}),
  },
  subagentCount: trace.subagents.length,
  toolCallCount: trace.toolCalls.length,
  errors: trace.errors,
});

export class LangfuseTraceSink implements TraceSink {
  private readonly processor?: LangfuseSpanProcessor;
  private readonly sdk?: NodeSDK;

  constructor(private readonly config: Config) {
    if (!config.LANGFUSE_ENABLED) return;
    const processor = new LangfuseSpanProcessor({
      publicKey: config.LANGFUSE_PUBLIC_KEY!,
      secretKey: config.LANGFUSE_SECRET_KEY!,
      ...(config.LANGFUSE_BASE_URL
        ? { baseUrl: config.LANGFUSE_BASE_URL }
        : {}),
      environment: config.NODE_ENV,
      exportMode: "batched",
      flushAt: 1,
      shouldExportSpan: () => true,
      mask: ({ data }) =>
        typeof data === "string" ? redact(data).content : data,
    });
    this.processor = processor;
    this.sdk = new NodeSDK({ spanProcessors: [processor] });
    this.sdk.start();
  }

  async finishTrace(trace: Trace): Promise<void> {
    if (!this.processor) return;
    try {
      const traceId = await createTraceId(trace.identity.messageId);
      const root = startObservation(
        "chat_message",
        {
          input: trace.context.userRequest,
          metadata: langfuseTraceMetadata(trace),
        },
        {
          parentSpanContext: {
            traceId,
            spanId: "0000000000000001",
            traceFlags: 1,
          },
        },
      );
      root.updateTrace({
        name: "chat_message",
        sessionId: trace.identity.sessionId,
        tags: trace.tags,
        metadata: langfuseTraceMetadata(trace),
      });

      const sessionAgent = root.startObservation(
        "session_agent",
        {
          input: trace.sessionAgent.input,
          ...(trace.sessionAgent.output !== undefined
            ? { output: trace.sessionAgent.output }
            : {}),
          metadata: {
            agentRunId: trace.sessionAgent.agentRunId,
            ...observationTiming(trace.sessionAgent),
            ...(trace.sessionAgent.error
              ? { error: trace.sessionAgent.error }
              : {}),
          },
        },
        { asType: "agent" },
      );
      for (const item of trace.sessionAgent.usage)
        generation(
          sessionAgent,
          item.stage,
          item.usage,
          item.stage === "sessionAgent" ? trace.sessionAgent.output : undefined,
        );
      toolObservations(
        sessionAgent,
        trace.toolCalls.filter((call) => call.toolName !== "subagent"),
      );
      for (const subagent of trace.subagents)
        subagentObservation(sessionAgent, subagent);
      sessionAgent.end();

      const finalizer = root.startObservation("message.finalize", {
        output: {
          outcome: trace.outcome,
          ...(trace.sessionAgent.output !== undefined
            ? { finalMessage: trace.sessionAgent.output }
            : {}),
        },
        metadata: {
          ...observationTiming(trace),
          errorCount: trace.errors.length,
        },
      });
      finalizer.end();
      root.update({
        output: trace.sessionAgent.output ?? { outcome: trace.outcome },
      });
      root.end();
      await this.flush();
    } catch (error) {
      logger.warn("trace_export_failed", {
        messageId: trace.identity.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async shutdown(): Promise<void> {
    if (!this.processor) return;
    try {
      await this.flush();
      await this.processor.shutdown();
      await this.sdk?.shutdown();
    } catch (error) {
      logger.warn("langfuse_shutdown_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async flush(): Promise<void> {
    if (!this.processor) return;
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Langfuse flush timed out")),
        this.config.LANGFUSE_FLUSH_TIMEOUT_MS,
      );
      timer.unref();
    });
    await Promise.race([this.processor.forceFlush(), timeout]);
  }
}
