import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import type {
  OrchestratorChatMessage,
  OrchestratorContext,
  WorkerResult,
} from "../../types/harness.types";
import { buildWorkerBrief, type WorkerCorrection } from "./worker-brief";
import { getPromptText } from "../../prompts/load-prompt";

export const MAX_DELEGATIONS_PER_TURN = 2;
export const ORCHESTRATOR_MAX_STEPS = 6;

export type OrchestratorAgentInput = {
  sessionId: string;
  repoRef: string;
  summary: string;
  recentMessages: OrchestratorChatMessage[];
  recentToolActivity: string[];
  workspace: OrchestratorContext["workspace"];
  message: string;
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

type WorkerBriefContext = Pick<
  OrchestratorContext,
  "repoRef" | "summary" | "workspace"
>;

const toWorkerBriefContext = (
  input: OrchestratorAgentInput,
): WorkerBriefContext => ({
  repoRef: input.repoRef,
  summary: input.summary,
  workspace: input.workspace,
});

const ORCHESTRATOR_SYSTEM_PROMPT = getPromptText("orchestrator");

/**
 * Production agent: one context-aware generateText call that decides,
 * via real tool-calling, whether to reply directly or delegate to the
 * CodeWorker. changedFiles/blockers/workerReport are always derived by the
 * caller from the delegations actually observed here, never from the
 * model's own prose.
 */
export class ModelOrchestratorAgent implements OrchestratorAgent {
  constructor(private readonly model: LanguageModel) {}

  async decide(input: OrchestratorAgentInput): Promise<OrchestratorDecision> {
    const context = toWorkerBriefContext(input);
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
        const previousResult = delegations.at(-1);
        const correction =
          previousResult?.status === "blocked" ? lastCorrection : undefined;
        const fullBrief = buildWorkerBrief(context, brief, correction);
        const result = await input.delegate(fullBrief);
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

    const summaryLine = input.summary
      ? `Session summary:\n${input.summary}`
      : "Session summary: none yet.";
    const toolActivityLine = input.recentToolActivity.length
      ? `Recent tool activity:\n${input.recentToolActivity.join("\n")}`
      : "Recent tool activity: none.";

    // Deliberately no `output` schema here: combined with `tools`, some
    // models/providers unreliably skip tool-calling entirely in favor of
    // schema-shaped prose (see agent-runner.ts for the same finding). The
    // reply is a single free-text field, so plain result.text is enough.
    const result = await generateText({
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

    return {
      reply: result.text.trim() || "Could you share a bit more detail?",
      delegations,
    };
  }
}
