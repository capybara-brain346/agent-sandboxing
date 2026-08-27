import {
  generateText,
  isStepCount,
  tool,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import { logger } from "../../logger";
import type { PublicEvent } from "../../types/event.types";
import type { WorkerResult } from "../../types/harness.types";
import type { SandboxService } from "../sandbox/sandbox";
import type { EventStore } from "../events/event-store";
import { workerResultSchema } from "../../types/harness.types";
import type { TaskRunContext } from "../task/task-runner";
import { createAgentToolRegistry } from "./tools/registry";
import type { AgentToolConfig } from "./tools/config";
import type { CodeWorker } from "./code-worker";
import {
  createAbortError,
  isAbortError,
  throwIfAborted,
} from "./tools/helpers";
import {
  ToolEventRelay,
  type ToolEventRelayDependencies,
} from "./tool-event-relay";
import type { ArtifactRecorder } from "../artifacts/artifact-store";
import { getPromptText } from "../../prompts/load-prompt";
import type { EvalTraceRecorderLike } from "../eval/eval-trace-recorder";
import { recordModelUsage } from "../eval/model-usage";

export const AGENT_SYSTEM_PROMPT = getPromptText("code-worker");

const toolConfig = (config: Config): AgentToolConfig => ({
  AGENT_BASH_TIMEOUT_MS: config.AGENT_BASH_TIMEOUT_MS,
  AGENT_BASH_OUTPUT_MAX_BYTES: config.AGENT_BASH_OUTPUT_MAX_BYTES,
  AGENT_READ_MAX_BYTES: config.AGENT_READ_MAX_BYTES,
  AGENT_WRITE_MAX_BYTES: config.AGENT_WRITE_MAX_BYTES,
  AGENT_TOOL_TIMEOUT_MS: config.AGENT_TOOL_TIMEOUT_MS,
});

type PublishEvent = (event: PublicEvent) => void;

export type AgentRunnerSandbox = Pick<SandboxService, "getAgentToolTarget">;

export type AgentRunnerDependencies = {
  config: Config;
  sandbox: AgentRunnerSandbox;
  events: Pick<EventStore, "append">;
  model: LanguageModel;
  publish: PublishEvent;
  artifacts?: ArtifactRecorder;
  traceRecorder?: EvalTraceRecorderLike;
};

class SerialExecutor {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => PromiseLike<T> | T): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const serializeToolRegistry = <TOOLS extends ToolSet>(
  registry: TOOLS,
): TOOLS => {
  const executor = new SerialExecutor();
  const entries = Object.entries(registry).map(([name, definition]) => {
    if (typeof definition.execute !== "function")
      return [name, definition] as const;

    const execute = definition.execute;
    return [
      name,
      {
        ...definition,
        execute: (...args: Parameters<typeof execute>) =>
          executor.run(() => execute(...args)),
      },
    ] as const;
  });
  return Object.fromEntries(entries) as TOOLS;
};

export class AgentRunner implements CodeWorker {
  constructor(private readonly dependencies: AgentRunnerDependencies) {}

  async run(context: TaskRunContext): Promise<WorkerResult> {
    throwIfAborted(context.signal);
    const executionStartedAt = Date.now();
    logger.debug("agent_worker_started", {
      sessionId: context.sessionId,
      runId: context.taskId,
      sandboxId: context.sandboxId,
    });
    const target = await this.dependencies.sandbox.getAgentToolTarget(
      context.sessionId,
      context.taskId,
      context.sandboxId,
    );
    throwIfAborted(context.signal);

    const tools = serializeToolRegistry(
      createAgentToolRegistry(
        target.runtime,
        target.containerName,
        toolConfig(this.dependencies.config),
        context.signal,
      ),
    );
    let finalResult: WorkerResult | undefined;
    const allTools = {
      ...tools,
      finish: tool({
        description: "Submit the structured result for this worker attempt.",
        inputSchema: workerResultSchema,
        execute: async (input) => {
          finalResult = workerResultSchema.parse(input);
          return { accepted: true };
        },
      }),
    };
    const relay = new ToolEventRelay({
      events: this.dependencies.events,
      publish: this.dependencies.publish,
      ...(this.dependencies.artifacts
        ? { artifacts: this.dependencies.artifacts }
        : {}),
    } satisfies ToolEventRelayDependencies);
    const callbacks = relay.callbacks<ToolSet>({
      taskId: context.taskId,
      sandboxId: context.sandboxId,
      sessionId: context.sessionId,
    });

    const startedAt = Date.now();
    let usageRecorded = false;
    try {
      const result = await generateText({
        model: this.dependencies.model,
        system: AGENT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: context.instructions }],
        tools: allTools,
        abortSignal: context.signal,
        stopWhen: [
          () => finalResult !== undefined,
          isStepCount(this.dependencies.config.AGENT_MAX_STEPS + 1),
        ],
        onToolExecutionStart: async (event) => {
          if (event.toolCall.toolName !== "finish")
            await callbacks.onToolExecutionStart(event);
        },
        onToolExecutionEnd: async (event) => {
          if (event.toolCall.toolName !== "finish")
            await callbacks.onToolExecutionEnd(event);
        },
      });
      recordModelUsage({
        recorder: this.dependencies.traceRecorder,
        runId: context.taskId,
        stage: "worker",
        model: this.dependencies.model,
        startedAt,
        result,
      });
      usageRecorded = true;

      const changedFiles = [
        ...new Set(
          result.toolCalls
            .filter(
              (call) => call.toolName === "write" || call.toolName === "edit",
            )
            .map((call) => (call.input as { path: string }).path),
        ),
      ];
      const workerResult =
        finalResult ??
        ({
          status: "blocked",
          summary: "Worker did not submit a structured result.",
          changedFiles: [],
          testsRun: [],
          blockers: ["worker_result_not_submitted"],
          suggestedNextStep: "Retry the worker attempt with a smaller scope.",
        } satisfies WorkerResult);

      logger.debug("agent_worker_completed", {
        sessionId: context.sessionId,
        runId: context.taskId,
        sandboxId: context.sandboxId,
        durationMs: Date.now() - executionStartedAt,
        status: workerResult.status,
        finishSubmitted: finalResult !== undefined,
        toolCallCount: result.toolCalls.length,
        changedFileCount: changedFiles.length,
      });
      return {
        ...workerResult,
        changedFiles: changedFiles.length
          ? changedFiles
          : workerResult.changedFiles,
      };
    } catch (error) {
      const cancelled = isAbortError(error) || context.signal.aborted;
      logger.debug("agent_worker_failed", {
        sessionId: context.sessionId,
        runId: context.taskId,
        sandboxId: context.sandboxId,
        durationMs: Date.now() - executionStartedAt,
        outcome: cancelled ? "cancelled" : "failed",
        failureCode: error instanceof ServiceError ? error.code : null,
        usageRecorded,
      });
      if (!usageRecorded)
        recordModelUsage({
          recorder: this.dependencies.traceRecorder,
          runId: context.taskId,
          stage: "worker",
          model: this.dependencies.model,
          startedAt,
          result: {},
        });
      if (isAbortError(error)) throw error;
      if (context.signal.aborted) throw createAbortError();
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("agent_run_failed", "Agent run failed", 502);
    }
  }
}
