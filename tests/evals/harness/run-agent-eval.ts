import type { LanguageModel } from "ai";
import { loadConfig } from "../../../src/config";
import { AgentRunner } from "../../../src/services/agent/agent-runner";
import type { PublicEvent } from "../../../src/types/event.types";
import { resolveAgentModel } from "../../../src/services/agent/model";
import { assertAgentEval } from "./assertions";
import { FakeAgentRuntime } from "./fake-runtime";
import type {
  AgentEvalCase,
  AgentEvalResult,
  AgentEvalTranscript,
} from "./types";

const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://eval",
  AGENT_MAX_STEPS: process.env.AGENT_MAX_STEPS ?? "8",
};

if (!env.OPENROUTER_API_KEY) delete env.OPENROUTER_API_KEY;

const config = loadConfig(env);

const toolNames = (toolCalls: unknown[]): string[] =>
  toolCalls
    .map((toolCall) => {
      if (toolCall && typeof toolCall === "object" && "toolName" in toolCall)
        return String(toolCall.toolName);
      if (
        toolCall &&
        typeof toolCall === "object" &&
        "toolCallType" in toolCall
      )
        return String(toolCall.toolCallType);
      return "unknown";
    })
    .filter((value) => value !== "unknown");

const evalTimeoutMs = Number(process.env.AGENT_EVAL_TIMEOUT_MS ?? 90_000);

export const runAgentEval = async (
  evalCase: AgentEvalCase,
  model: LanguageModel,
): Promise<AgentEvalResult> => {
  const runtime = new FakeAgentRuntime(evalCase.files);
  const filesBefore = runtime.snapshot();
  const runner = new AgentRunner({
    config,
    sandbox: {
      getAgentToolTarget: async () => ({
        containerName: "eval-sandbox",
        runtime,
      }),
    },
    events: {
      append: async (input) =>
        ({
          id: `evt_${Date.now()}`,
          streamId: "eval_session",
          streamScope: "session",
          domain: "agent",
          sessionId: "eval_session",
          sandboxId: "eval_sandbox",
          commandId: null,
          sequence: 1,
          type: input.type,
          producerService: "agent",
          producerId: "eval_message",
          correlationId: null,
          payload: {},
          createdAt: new Date().toISOString(),
        }) satisfies PublicEvent,
    },
    model,
    publish: () => undefined,
    profile: "main",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), evalTimeoutMs);
  try {
    const result = await runner.process({
      sandboxId: "eval_sandbox",
      sessionId: "eval_session",
      messageId: `eval_${evalCase.name.replaceAll(/\W+/g, "_").toLowerCase()}`,
      instructions: evalCase.prompt,
      signal: controller.signal,
      ...(evalCase.maxSteps === undefined
        ? {}
        : { maxSteps: evalCase.maxSteps }),
    });
    const transcript: AgentEvalTranscript = {
      finalText: result.finalText,
      toolCalls: toolNames(result.toolCalls),
      commands: runtime.executions.map((execution) => execution.command),
      filesBefore,
      filesAfter: runtime.snapshot(),
    };
    const failures = assertAgentEval(evalCase, transcript);
    return {
      name: evalCase.name,
      passed: failures.length === 0,
      skipped: false,
      failures,
      transcript,
      result,
    };
  } catch (error) {
    return {
      name: evalCase.name,
      passed: false,
      skipped: false,
      failures: [error instanceof Error ? error.message : "unknown eval error"],
      error: error instanceof Error ? error.stack : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const resolveEvalModel = (): LanguageModel | null => {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return resolveAgentModel(config);
};
