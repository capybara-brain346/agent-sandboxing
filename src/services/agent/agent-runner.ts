import {
  generateText,
  isStepCount,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import { logger } from "../../logger";
import type { PublicEvent } from "../../types/event.types";
import { randomUUID } from "node:crypto";
import type { AgentResult } from "../../types/harness.types";
import type { SandboxService } from "../sandbox/sandbox";
import type { EventStore } from "../events/event-store";
import type { MessageProcessingContext } from "../../types/message-processing.types";
import { createAgentToolRegistry } from "./tools/registry";
import type { AgentToolConfig } from "./tools/config";
import type { SessionAgent } from "./session-agent";
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
import type { TraceRecorderLike } from "../tracing/trace-recorder";
import { recordModelUsage } from "../tracing/model-usage";
import type { AgentGitHubTools } from "./tools/registry";
import type { ToolProfileName } from "./tools/profile-loader";
import type { SubagentToolInput } from "./tools/subagent";

export const AGENT_SYSTEM_PROMPT = getPromptText("session-agent");
export const SUBAGENT_SYSTEM_PROMPT = getPromptText("subagent");

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
  profile: ToolProfileName;
  artifacts?: ArtifactRecorder;
  traceRecorder?: TraceRecorderLike;
  agentRunId?: string;
  subagentRunId?: string;
  agentTask?: string;
  github?: AgentGitHubTools;
  emitToolEvents?: boolean;
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

export class AgentRunner implements SessionAgent {
  constructor(private readonly dependencies: AgentRunnerDependencies) {}

  async process(context: MessageProcessingContext): Promise<AgentResult> {
    throwIfAborted(context.signal);
    const executionStartedAt = Date.now();
    const startedAt = new Date().toISOString();
    const agentRunId =
      this.dependencies.agentRunId ??
      this.dependencies.traceRecorder?.getAgentRunId?.(context.messageId) ??
      `agent_${randomUUID()}`;
    this.dependencies.traceRecorder?.startAgentRun?.({
      messageId: context.messageId,
      agentRunId,
      startedAt,
      input: context.instructions,
      ...(this.dependencies.subagentRunId
        ? { subagentRunId: this.dependencies.subagentRunId }
        : {}),
      ...(this.dependencies.agentTask
        ? { task: this.dependencies.agentTask }
        : {}),
    });
    logger.debug("session_agent_started", {
      sessionId: context.sessionId,
      messageId: context.messageId,
      sandboxId: context.sandboxId,
    });
    let target;
    try {
      target = await this.dependencies.sandbox.getAgentToolTarget(
        context.sessionId,
        context.sandboxId,
      );
    } catch (error) {
      if (!isAbortError(error) && !context.signal.aborted)
        this.dependencies.traceRecorder?.finishAgentRun?.({
          messageId: context.messageId,
          agentRunId,
          completedAt: new Date().toISOString(),
          error: {
            message:
              error instanceof ServiceError
                ? error.message
                : "Agent processing failed",
            ...(error instanceof ServiceError ? { code: error.code } : {}),
            stage: "sessionAgent",
            agentRunId,
          },
        });
      throw error;
    }
    throwIfAborted(context.signal);

    const runSubagent =
      this.dependencies.profile === "main"
        ? async (input: SubagentToolInput): Promise<AgentResult> => {
            const subagentRunId = `subagent_${randomUUID()}`;
            const subagentStartedAtMs = Date.now();
            const subagentStartedAt = new Date(
              subagentStartedAtMs,
            ).toISOString();
            try {
              const result = await new AgentRunner({
                config: this.dependencies.config,
                sandbox: this.dependencies.sandbox,
                events: this.dependencies.events,
                model: this.dependencies.model,
                publish: this.dependencies.publish,
                profile: "subagent",
                ...(this.dependencies.traceRecorder
                  ? { traceRecorder: this.dependencies.traceRecorder }
                  : {}),
                agentRunId: subagentRunId,
                subagentRunId,
                agentTask: input.task,
                ...(this.dependencies.artifacts
                  ? { artifacts: this.dependencies.artifacts }
                  : {}),
                ...(this.dependencies.github
                  ? { github: this.dependencies.github }
                  : {}),
                emitToolEvents: false,
              }).process({
                ...context,
                instructions: input.task,
                ...(input.maxSteps === undefined
                  ? {}
                  : { maxSteps: input.maxSteps }),
              });
              this.dependencies.traceRecorder?.recordSubagent?.({
                messageId: context.messageId,
                subagent: {
                  subagentRunId,
                  task: input.task,
                  toolCalls: result.toolCalls,
                  summary: result.finalText,
                  startedAt: subagentStartedAt,
                  completedAt: result.completedAt,
                  durationMs: Date.now() - subagentStartedAtMs,
                },
              });
              return result;
            } catch (error) {
              this.dependencies.traceRecorder?.recordSubagent?.({
                messageId: context.messageId,
                subagent: {
                  subagentRunId,
                  task: input.task,
                  toolCalls: [],
                  summary: "",
                  startedAt: subagentStartedAt,
                  completedAt: new Date().toISOString(),
                  durationMs: Date.now() - subagentStartedAtMs,
                  error:
                    error instanceof ServiceError
                      ? `${error.code}: ${error.message}`
                      : isAbortError(error) || context.signal.aborted
                        ? "Subagent cancelled"
                        : "Subagent failed",
                },
              });
              throw error;
            }
          }
        : undefined;
    const tools = serializeToolRegistry(
      createAgentToolRegistry(
        target.runtime,
        target.containerName,
        toolConfig(this.dependencies.config),
        context.signal,
        { sessionId: context.sessionId, messageId: context.messageId },
        this.dependencies.github,
        this.dependencies.profile,
        runSubagent,
      ),
    );
    const relay = new ToolEventRelay({
      events: this.dependencies.events,
      publish: this.dependencies.publish,
      ...(this.dependencies.artifacts
        ? { artifacts: this.dependencies.artifacts }
        : {}),
      ...(this.dependencies.traceRecorder
        ? { traceRecorder: this.dependencies.traceRecorder }
        : {}),
      agentRunId,
      emitEvents: this.dependencies.emitToolEvents !== false,
    } satisfies ToolEventRelayDependencies);
    const callbacks = relay?.callbacks<ToolSet>({
      messageId: context.messageId,
      sandboxId: context.sandboxId,
      sessionId: context.sessionId,
    });

    const usageStartedAt = Date.now();
    let usageRecorded = false;
    try {
      const result = await generateText({
        model: this.dependencies.model,
        system:
          this.dependencies.profile === "subagent"
            ? SUBAGENT_SYSTEM_PROMPT
            : AGENT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: context.instructions }],
        tools,
        abortSignal: context.signal,
        stopWhen: isStepCount(
          context.maxSteps ?? this.dependencies.config.AGENT_MAX_STEPS,
        ),
        ...(callbacks
          ? {
              onToolExecutionStart: callbacks.onToolExecutionStart,
              onToolExecutionEnd: callbacks.onToolExecutionEnd,
            }
          : {}),
      });
      recordModelUsage({
        recorder: this.dependencies.traceRecorder,
        messageId: context.messageId,
        stage: "sessionAgent",
        agentRunId,
        model: this.dependencies.model,
        startedAt: usageStartedAt,
        result,
      });
      usageRecorded = true;

      const agentResult: AgentResult = {
        finalText: result.text.trim(),
        usage: result.usage,
        toolCalls: result.toolCalls,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      this.dependencies.traceRecorder?.finishAgentRun?.({
        messageId: context.messageId,
        agentRunId,
        completedAt: agentResult.completedAt,
        output: agentResult.finalText,
      });

      logger.debug("session_agent_completed", {
        sessionId: context.sessionId,
        messageId: context.messageId,
        sandboxId: context.sandboxId,
        durationMs: Date.now() - executionStartedAt,
        finalTextPresent: agentResult.finalText.length > 0,
        toolCallCount: result.toolCalls.length,
      });
      return agentResult;
    } catch (error) {
      const cancelled = isAbortError(error) || context.signal.aborted;
      logger.debug("session_agent_failed", {
        sessionId: context.sessionId,
        messageId: context.messageId,
        sandboxId: context.sandboxId,
        durationMs: Date.now() - executionStartedAt,
        outcome: cancelled ? "cancelled" : "failed",
        failureCode: error instanceof ServiceError ? error.code : null,
        usageRecorded,
      });
      if (!usageRecorded)
        recordModelUsage({
          recorder: this.dependencies.traceRecorder,
          messageId: context.messageId,
          stage: "sessionAgent",
          agentRunId,
          model: this.dependencies.model,
          startedAt: usageStartedAt,
          result: {},
        });
      this.dependencies.traceRecorder?.finishAgentRun?.({
        messageId: context.messageId,
        agentRunId,
        completedAt: new Date().toISOString(),
        ...(cancelled
          ? {}
          : {
              error: {
                message:
                  error instanceof ServiceError
                    ? error.message
                    : "Agent processing failed",
                ...(error instanceof ServiceError ? { code: error.code } : {}),
                stage: "sessionAgent",
                agentRunId,
              },
            }),
      });
      if (isAbortError(error)) throw error;
      if (context.signal.aborted) throw createAbortError();
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "agent_processing_failed",
        "Agent processing failed",
        502,
      );
    }
  }
}
