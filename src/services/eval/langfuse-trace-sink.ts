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
import type { WorkerResult } from "../../types/harness.types";
import type {
  EvalTrace,
  EvalTraceSink,
  EvalTraceStage,
  ModelUsage,
} from "../../types/eval-trace.types";

const asMetadata = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const usageDetails = (usage: ModelUsage): Record<string, number> => ({
  ...(usage.inputTokens !== undefined ? { input: usage.inputTokens } : {}),
  ...(usage.outputTokens !== undefined ? { output: usage.outputTokens } : {}),
  ...(usage.totalTokens !== undefined ? { total: usage.totalTokens } : {}),
});

const generation = (
  parent: Pick<LangfuseSpan, "startObservation">,
  stage: EvalTraceStage,
  usage: ModelUsage,
  output?: unknown,
): void => {
  const observation = parent.startObservation(
    `${stage}.generate`,
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

const workerOutput = (results: WorkerResult[]): unknown => {
  const result = results.at(-1);
  return result
    ? {
        status: result.status,
        summary: result.summary,
      }
    : undefined;
};

const toolObservations = (parent: LangfuseSpan, trace: EvalTrace): void => {
  const pairs = new Map<
    string,
    { call?: EvalTrace["tools"][number]; result?: EvalTrace["tools"][number] }
  >();
  for (const event of trace.tools) {
    const pair = pairs.get(event.correlationId) ?? {};
    if (event.kind === "call") pair.call = event;
    else pair.result = event;
    pairs.set(event.correlationId, pair);
  }
  for (const [correlationId, pair] of pairs) {
    const event = pair.call ?? pair.result;
    if (!event) continue;
    const observation = parent.startObservation(
      `tool.${event.toolName}`,
      {
        ...(pair.call?.args ? { input: pair.call.args } : {}),
        ...(pair.result
          ? {
              output: {
                snippet: pair.result.resultSnippet ?? "",
                exitCode: pair.result.exitCode ?? null,
              },
            }
          : {}),
        metadata: {
          correlationId,
          ...(pair.result?.truncated !== undefined
            ? { truncated: pair.result.truncated }
            : {}),
          ...(pair.result?.durationMs !== undefined
            ? { durationMs: pair.result.durationMs }
            : {}),
          ...(pair.result?.artifactId
            ? { artifactId: pair.result.artifactId }
            : {}),
          ...(pair.result?.artifactByteSize !== undefined
            ? { artifactByteSize: pair.result.artifactByteSize }
            : {}),
          ...(pair.result?.artifactRedacted !== undefined
            ? { artifactRedacted: pair.result.artifactRedacted }
            : {}),
        },
      },
      { asType: "tool" },
    );
    observation.end();
  }
};

export const langfuseTraceMetadata = (
  trace: EvalTrace,
): Record<string, unknown> => ({
  ...asMetadata(trace.metadata),
  runId: trace.runId,
  chatSessionId: trace.sessionId,
  sessionId: trace.sessionId,
  traceId: trace.traceId,
  orchestrator: {
    delegated: trace.orchestrator.delegated,
    workerBriefCount: trace.orchestrator.workerBriefs.length,
    workerResultCount: trace.orchestrator.workerResults.length,
    ...(trace.orchestrator.contextSummary
      ? { contextSummary: trace.orchestrator.contextSummary }
      : {}),
  },
  ...(trace.run ? { run: trace.run } : {}),
});

export class LangfuseTraceSink implements EvalTraceSink {
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

  startRun(): void {}

  recordOrchestratorContext(): void {}

  recordWorkerBrief(): void {}

  recordWorkerResult(): void {}

  recordOrchestratorReply(): void {}

  recordUsage(): void {}

  async finishRun(trace: EvalTrace): Promise<void> {
    if (!this.processor) return;
    try {
      const traceId = await createTraceId(trace.runId);
      const root = startObservation(
        trace.name,
        {
          input: trace.input,
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
        name: trace.name,
        sessionId: trace.sessionId,
        tags: trace.tags,
        metadata: langfuseTraceMetadata(trace),
      });

      for (const item of trace.usage) {
        if (item.stage !== "orchestrator" && item.stage !== "summaryCompaction")
          continue;
        const output =
          item.stage === "orchestrator" ? trace.orchestrator.reply : undefined;
        generation(root, item.stage, item.usage, output);
      }

      if (trace.orchestrator.delegated) {
        const worker = root.startObservation(
          "code_worker",
          {
            metadata: {
              briefCount: trace.orchestrator.workerBriefs.length,
              resultCount: trace.orchestrator.workerResults.length,
            },
          },
          { asType: "agent" },
        );
        for (const item of trace.usage) {
          if (item.stage === "worker")
            generation(worker, item.stage, item.usage);
        }
        toolObservations(worker, trace);
        const output = workerOutput(trace.orchestrator.workerResults);
        if (output !== undefined) worker.update({ output });
        worker.end();
      }

      const finalizer = root.startObservation("run.finalize", {
        output: trace.run ?? {},
        metadata: {
          status: trace.run?.status ?? "unknown",
          exitReason: trace.run?.exitReason ?? "unknown",
          toolEventCount: trace.tools.length,
        },
      });
      finalizer.end();
      root.update({
        output: trace.output ?? {
          status: trace.run?.status ?? "unknown",
          delegated: trace.orchestrator.delegated,
        },
      });
      root.end();
      await this.flush();
    } catch (error) {
      logger.warn("langfuse_trace_export_failed", {
        runId: trace.runId,
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
