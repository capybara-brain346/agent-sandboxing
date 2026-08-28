import type { PrismaClient } from "@prisma/client";
import { ServiceError } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
import type { CodeWorker } from "../agent/code-worker";
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
import type { EvalTraceRecorderLike } from "../eval/eval-trace-recorder";

export class RunOrchestrator implements TaskRunner {
  constructor(
    private readonly prisma: Pick<PrismaClient, "chatSession">,
    private readonly contextBuilder: SessionContextBuilder,
    private readonly compactor: SessionSummaryCompactor,
    private readonly worker: CodeWorker,
    private readonly agent: OrchestratorAgent,
    private readonly traceRecorder?: EvalTraceRecorderLike,
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
    logger.debug("orchestrator_context_built", {
      sessionId,
      runId: context.taskId,
      messageCount: orchestratorContext.messageCount,
      recentMessageCount: orchestratorContext.recentMessages.length,
      recentToolActivityCount: orchestratorContext.recentToolActivity.length,
      summaryPresent: Boolean(orchestratorContext.summary),
      hasPriorRun: orchestratorContext.workspace.hasPriorRun,
      shouldCompact: orchestratorContext.shouldCompact,
    });
    this.traceRecorder?.recordOrchestratorContext({
      runId: context.taskId,
      contextSummary: {
        summaryPresent: Boolean(orchestratorContext.summary),
        summaryChars: orchestratorContext.summary.length,
        recentMessageCount: orchestratorContext.recentMessages.length,
        recentToolActivityCount: orchestratorContext.recentToolActivity.length,
        workspaceHasPriorRun: orchestratorContext.workspace.hasPriorRun,
      },
      contextSnapshot: {
        summary: orchestratorContext.summary,
        recentMessages: orchestratorContext.recentMessages,
        recentToolActivity: orchestratorContext.recentToolActivity,
        workspace: {
          hasPriorRun: orchestratorContext.workspace.hasPriorRun,
          lastRunStatus: orchestratorContext.workspace.lastRunStatus,
          changedFilesHint: orchestratorContext.workspace.changedFilesHint,
        },
      },
    });
    const delegate = async (brief: string): Promise<WorkerResult> => {
      this.traceRecorder?.recordWorkerBrief({
        runId: context.taskId,
        brief,
      });
      const result = await this.worker.run({ ...context, instructions: brief });
      this.traceRecorder?.recordWorkerResult({
        runId: context.taskId,
        result,
      });
      return result;
    };

    const decision = await this.agent.decide({
      summary: orchestratorContext.summary,
      recentMessages: orchestratorContext.recentMessages,
      recentToolActivity: orchestratorContext.recentToolActivity,
      workspace: orchestratorContext.workspace,
      message: context.instructions,
      runId: context.taskId,
      signal: context.signal,
      delegate,
    });

    const lastResult = decision.delegations.at(-1) ?? null;
    this.traceRecorder?.recordOrchestratorReply({
      runId: context.taskId,
      reply: decision.reply,
      delegated: decision.delegations.length > 0,
    });
    logger.debug("orchestrator_decision_completed", {
      sessionId,
      runId: context.taskId,
      delegated: decision.delegations.length > 0,
      delegationCount: decision.delegations.length,
      lastDelegationStatus: lastResult?.status ?? null,
      replyPresent: decision.reply.trim().length > 0,
    });

    if (orchestratorContext.shouldCompact)
      await this.compactSummary(
        sessionId,
        orchestratorContext,
        context.taskId,
        context.signal,
      );

    const workerReport = lastResult
      ? JSON.stringify(lastResult, null, 2)
      : null;
    if (lastResult?.status === "failed")
      throw new ServiceError(
        "worker_failed",
        lastResult.summary || "CodeWorker failed",
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
    runId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const summary = await this.compactor.compact({
      previousSummary: orchestratorContext.summary,
      recentMessages: orchestratorContext.recentMessages,
      recentToolActivity: orchestratorContext.recentToolActivity,
      runId,
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
    logger.debug("session_summary_compacted", {
      sessionId,
      runId,
      messageCount: orchestratorContext.messageCount,
      summaryBytes: Buffer.byteLength(summary),
    });
  }
}
