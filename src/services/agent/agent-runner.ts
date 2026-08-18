import {
  generateText,
  isStepCount,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import type { PublicEvent } from "../../types/event.types";
import type { SandboxService } from "../sandbox/sandbox";
import type { EventStore } from "../events/event-store";
import type {
  TaskRunContext,
  TaskRunResult,
  TaskRunner,
} from "../task/task-runner";
import { createAgentToolRegistry } from "./tools/registry";
import type { AgentToolConfig } from "./tools/config";
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

export class AgentRunner implements TaskRunner {
  constructor(private readonly dependencies: AgentRunnerDependencies) {}

  async run(context: TaskRunContext): Promise<TaskRunResult> {
    throwIfAborted(context.signal);
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
    const relay = new ToolEventRelay({
      events: this.dependencies.events,
      publish: this.dependencies.publish,
      ...(this.dependencies.artifacts
        ? { artifacts: this.dependencies.artifacts }
        : {}),
    } satisfies ToolEventRelayDependencies);
    const callbacks = relay.callbacks<typeof tools>({
      taskId: context.taskId,
      sandboxId: context.sandboxId,
      sessionId: context.sessionId,
    });

    try {
      const result = await generateText({
        model: this.dependencies.model,
        system: AGENT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: context.instructions }],
        tools,
        abortSignal: context.signal,
        stopWhen: isStepCount(this.dependencies.config.AGENT_MAX_STEPS),
        onToolExecutionStart: callbacks.onToolExecutionStart,
        onToolExecutionEnd: callbacks.onToolExecutionEnd,
      });
      return { summary: result.text.trim() || null };
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (context.signal.aborted) throw createAbortError();
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("agent_run_failed", "Agent run failed", 502);
    }
  }
}
