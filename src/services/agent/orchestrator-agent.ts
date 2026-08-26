import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import type {
  OrchestratorChatMessage,
  OrchestratorContext,
  WorkerResult,
} from "../../types/harness.types";
import { buildWorkerBrief, type WorkerCorrection } from "./worker-brief";
import { getPromptText } from "../../prompts/load-prompt";
import type { EvalTraceRecorderLike } from "../eval/eval-trace-recorder";
import { recordModelUsage } from "../eval/model-usage";
import { logger } from "../../logger";

export const MAX_DELEGATIONS_PER_TURN = 2;
export const ORCHESTRATOR_MAX_STEPS = 6;

export type OrchestratorAgentInput = {
  summary: string;
  recentMessages: OrchestratorChatMessage[];
  recentToolActivity: string[];
  workspace: OrchestratorContext["workspace"];
  message: string;
  runId?: string;
  signal: AbortSignal;
  delegate: (brief: string) => Promise<WorkerResult>;
};

export type OrchestratorDecision = {
  reply: string;
  delegations: WorkerResult[];
};

export type OrchestratorAgent = {
  decide(input: OrchestratorAgentInput): Promise<OrchestratorDecision>;
};

type WorkerBriefContext = Pick<OrchestratorContext, "summary" | "workspace">;

type DelegationToolInput = {
  context: WorkerBriefContext;
  delegate: OrchestratorAgentInput["delegate"];
};

const toWorkerBriefContext = (
  input: OrchestratorAgentInput,
): WorkerBriefContext => ({
  summary: input.summary,
  workspace: input.workspace,
});

const ORCHESTRATOR_SYSTEM_PROMPT = getPromptText("orchestrator");

const createDelegationTool = ({ context, delegate }: DelegationToolInput) => {
  const delegations: WorkerResult[] = [];
  let lastCorrection: WorkerCorrection | undefined;

  const delegateTool = tool({
    description:
      "Delegate a bounded, sandboxed coding attempt to the CodeWorker. " +
      "Only call this for imperative, actionable requests — never for " +
      "questions about past work or general conversation.",
    inputSchema: z.object({
      brief: z
        .string()
        .describe("A focused brief describing the coding work to do"),
    }),
    execute: async ({ brief }) => {
      const previousResult = delegations.at(-1);
      if (previousResult?.status === "failed") return previousResult;
      if (delegations.length >= MAX_DELEGATIONS_PER_TURN) {
        const blocked: WorkerResult = {
          status: "blocked",
          summary: "Delegation budget for this turn is exhausted.",
          changedFiles: [],
          testsRun: [],
          blockers: ["max_delegations_reached"],
          suggestedNextStep: "",
        };
        delegations.push(blocked);
        return blocked;
      }
      const correction =
        previousResult?.status === "blocked" ? lastCorrection : undefined;
      const fullBrief = buildWorkerBrief(context, brief, correction);
      const result = await delegate(fullBrief);
      delegations.push(result);
      lastCorrection =
        result.status === "blocked"
          ? {
              blockers: result.blockers,
              suggestedNextStep: result.suggestedNextStep,
            }
          : undefined;
      return result;
    },
  });

  return { delegateTool, delegations };
};

/**
 * Production agent: one context-aware generateText call that decides,
 * via real tool-calling, whether to reply directly or delegate to the
 * CodeWorker. changedFiles/blockers/workerReport are always derived by the
 * caller from the delegations actually observed here, never from the
 * model's own prose.
 */
export class ModelOrchestratorAgent implements OrchestratorAgent {
  constructor(
    private readonly model: LanguageModel,
    private readonly recorder?: EvalTraceRecorderLike,
  ) {}

  async decide(input: OrchestratorAgentInput): Promise<OrchestratorDecision> {
    const { delegateTool, delegations } = createDelegationTool({
      context: toWorkerBriefContext(input),
      delegate: input.delegate,
    });

    const summaryLine = input.summary
      ? `Session summary:\n${input.summary}`
      : "Session summary: none yet.";
    const toolActivityLine = input.recentToolActivity.length
      ? `Recent tool activity:\n${input.recentToolActivity.join("\n")}`
      : "Recent tool activity: none.";

    const startedAt = Date.now();
    let result;
    try {
      result = await generateText({
        model: this.model,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: summaryLine },
          { role: "user", content: toolActivityLine },
          ...input.recentMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          { role: "user", content: input.message },
        ],
        tools: { delegate_to_code_worker: delegateTool },
        abortSignal: input.signal,
        stopWhen: stepCountIs(ORCHESTRATOR_MAX_STEPS),
      });
    } catch (error) {
      logger.debug("orchestrator_model_failed", {
        runId: input.runId ?? null,
        durationMs: Date.now() - startedAt,
        outcome: input.signal.aborted ? "cancelled" : "failed",
      });
      recordModelUsage({
        recorder: this.recorder,
        runId: input.runId,
        stage: "orchestrator",
        model: this.model,
        startedAt,
        result: {},
      });
      throw error;
    }
    recordModelUsage({
      recorder: this.recorder,
      runId: input.runId,
      stage: "orchestrator",
      model: this.model,
      startedAt,
      result,
    });
    logger.debug("orchestrator_model_completed", {
      runId: input.runId ?? null,
      durationMs: Date.now() - startedAt,
      delegationCount: delegations.length,
      replyPresent: result.text.trim().length > 0,
    });

    return {
      reply: result.text.trim() || "Could you share a bit more detail?",
      delegations,
    };
  }
}
