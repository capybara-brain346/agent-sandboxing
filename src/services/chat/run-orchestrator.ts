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
import type { OrchestratorAgent } from "../agent/orchestrator-agent";
import type { SessionContextBuilder } from "./session-context-builder";
import type { SessionSummaryCompactor } from "../agent/session-summary-compactor";

export class RunOrchestrator implements TaskRunner {
  constructor(
    private readonly prisma: Pick<PrismaClient, "chatSession">,
    private readonly contextBuilder: SessionContextBuilder,
    private readonly compactor: SessionSummaryCompactor,
    private readonly worker: CodeWorkerRunner,
    private readonly agent: OrchestratorAgent,
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
    const delegate = (brief: string): Promise<WorkerResult> =>
      this.worker.run({ ...context, instructions: brief });

    const decision = await this.agent.decide({
      sessionId,
      repoRef: orchestratorContext.repoRef,
      summary: orchestratorContext.summary,
      recentMessages: orchestratorContext.recentMessages,
      recentToolActivity: orchestratorContext.recentToolActivity,
      workspace: orchestratorContext.workspace,
      message: context.instructions,
      signal: context.signal,
      delegate,
    });

    const lastResult = decision.delegations.at(-1) ?? null;

    if (orchestratorContext.shouldCompact)
      await this.compactSummary(sessionId, orchestratorContext, context.signal);

    const workerReport = lastResult
      ? JSON.stringify(lastResult, null, 2)
      : null;
    if (lastResult?.status === "failed")
      throw new ServiceError(
        "worker_failed",
        lastResult.blockers.length
          ? lastResult.blockers.join("; ")
          : lastResult.summary || "CodeWorker failed",
        502,
        { workerReport },
      );

    return workerReport
      ? { summary: decision.reply, workerReport }
      : { summary: decision.reply };
  }

  private async compactSummary(
    sessionId: string,
    orchestratorContext: OrchestratorContext,
    signal: AbortSignal,
  ): Promise<void> {
    const summary = await this.compactor.compact({
      previousSummary: orchestratorContext.summary,
      recentMessages: orchestratorContext.recentMessages,
      recentToolActivity: orchestratorContext.recentToolActivity,
      signal,
    });
    await runQuery("compact_session_summary", { sessionId }, () =>
      this.prisma.chatSession.updateMany({
        where: { id: sessionId },
        data: {
          summary,
          summaryCompactedThroughMessageCount: orchestratorContext.messageCount,
        },
      }),
    );
  }
}
