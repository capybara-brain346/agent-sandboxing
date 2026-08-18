import { generateText, type LanguageModel } from "ai";
import type { PrismaClient } from "@prisma/client";
import { ServiceError } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import type { CodeWorkerRunner } from "../agent/code-worker-runner";
import type {
  TaskRunContext,
  TaskRunner,
  TaskRunResult,
} from "../task/task-runner";
import type {
  OrchestratorContext,
  WorkerResult,
} from "../../types/harness.types";
import { classifyMessage } from "./message-classifier";
import { buildWorkerBrief, type WorkerCorrection } from "./worker-brief";
import type { SessionContextBuilder } from "./session-context-builder";
import type { SessionSummaryService } from "./session-summary";

export const DEFAULT_MAX_WORKER_ATTEMPTS = 2;

export type RespondInput = {
  sessionId: string;
  summary: string;
  recentMessages: OrchestratorContext["recentMessages"];
  message: string;
};

export type OrchestratorResponder = {
  respond(input: RespondInput): Promise<string>;
};

/** Deterministic fallback responder for environments without a live model. */
export class StaticResponder implements OrchestratorResponder {
  async respond(input: RespondInput): Promise<string> {
    return Promise.resolve(
      input.summary
        ? `Could you clarify what change you'd like next? Current context: ${input.summary}`
        : "Could you clarify what change you'd like me to make? No prior work exists in this session yet.",
    );
  }
}

const ORCHESTRATOR_SYSTEM_PROMPT = [
  "You are the orchestrator for a repo-scoped coding session.",
  "You never edit code yourself. The user has asked a clarifying question or made a",
  "non-actionable remark. Respond conversationally and briefly, using only the",
  "session summary and recent messages provided. Ask a focused follow-up question",
  "if you need more detail before code work can start.",
].join(" ");

export class ModelResponder implements OrchestratorResponder {
  constructor(private readonly model: LanguageModel) {}

  async respond(input: RespondInput): Promise<string> {
    const summaryLine = input.summary
      ? `Session summary:\n${input.summary}`
      : "Session summary: none yet.";
    const result = await generateText({
      model: this.model,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: summaryLine },
        ...input.recentMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user", content: input.message },
      ],
    });
    return result.text.trim() || "Could you share a bit more detail?";
  }
}

const composeResponse = (result: WorkerResult): string => {
  if (result.status === "completed") return result.summary;
  const blockerText = result.blockers.length
    ? ` Blockers: ${result.blockers.join("; ")}.`
    : "";
  const nextStep = result.suggestedNextStep
    ? ` Suggested next step: ${result.suggestedNextStep}.`
    : "";
  return `${result.summary}${blockerText}${nextStep}`.trim();
};

/**
 * Replaces one-shot instruction execution: classifies the current message,
 * either responds directly (never touching code) or drives the CodeWorker
 * through a bounded number of attempts, then rewrites the durable session
 * summary. Implements TaskRunner so it drops into RunService unchanged.
 */
export class RunOrchestrator implements TaskRunner {
  constructor(
    private readonly prisma: Pick<PrismaClient, "chatSession">,
    private readonly contextBuilder: SessionContextBuilder,
    private readonly summaryService: SessionSummaryService,
    private readonly worker: CodeWorkerRunner,
    private readonly responder: OrchestratorResponder = new StaticResponder(),
    private readonly maxWorkerAttempts: number = DEFAULT_MAX_WORKER_ATTEMPTS,
  ) {}

  async run(context: TaskRunContext): Promise<TaskRunResult> {
    if (!context.sessionId)
      throw new ServiceError(
        "orchestrator_requires_session",
        "RunOrchestrator requires a session-scoped run",
        500,
      );
    const sessionId = context.sessionId;

    const orchestratorContext = await this.contextBuilder.build(sessionId);
    const intent = classifyMessage(context.instructions);

    if (intent === "clarification") {
      const reply = await this.responder.respond({
        sessionId,
        summary: orchestratorContext.summary,
        recentMessages: orchestratorContext.recentMessages,
        message: context.instructions,
      });
      await this.persistSummary(sessionId, {
        previousSummary: orchestratorContext.summary,
        userMessage: context.instructions,
        outcome: {
          kind: "clarification",
          summary: reply,
          changedFiles: [],
          blockers: [],
        },
      });
      return { summary: reply };
    }

    const result = await this.runWorkerLoop(context, orchestratorContext);

    const outcomeKind =
      result.status === "completed"
        ? "worker_completed"
        : result.status === "blocked"
          ? "worker_blocked"
          : "worker_failed";
    await this.persistSummary(sessionId, {
      previousSummary: orchestratorContext.summary,
      userMessage: context.instructions,
      outcome: {
        kind: outcomeKind,
        summary: result.summary,
        changedFiles: result.changedFiles,
        blockers: result.blockers,
      },
    });

    const workerReport = JSON.stringify(result, null, 2);
    if (result.status === "failed")
      throw new ServiceError(
        "worker_failed",
        result.blockers.length
          ? result.blockers.join("; ")
          : result.summary || "CodeWorker failed",
        502,
        { workerReport },
      );

    return { summary: composeResponse(result), workerReport };
  }

  private async runWorkerLoop(
    context: TaskRunContext,
    orchestratorContext: OrchestratorContext,
  ): Promise<WorkerResult> {
    let attempt = 0;
    let correction: WorkerCorrection | undefined;
    let result: WorkerResult | undefined;
    while (attempt < this.maxWorkerAttempts) {
      attempt += 1;
      const brief = buildWorkerBrief(
        orchestratorContext,
        context.instructions,
        correction,
      );
      result = await this.worker.run({ ...context, instructions: brief });
      if (result.status === "completed") break;
      correction = {
        blockers: result.blockers,
        suggestedNextStep: result.suggestedNextStep,
      };
    }
    if (!result)
      throw new ServiceError(
        "worker_result_missing",
        "CodeWorker produced no result",
        502,
      );
    return result;
  }

  private async persistSummary(
    sessionId: string,
    input: Parameters<SessionSummaryService["rewrite"]>[0],
  ): Promise<void> {
    const summary = this.summaryService.rewrite(input);
    await runQuery("update_session_summary", { sessionId }, () =>
      this.prisma.chatSession.updateMany({
        where: { id: sessionId },
        data: { summary },
      }),
    );
  }
}
