import type { PrismaClient } from "@prisma/client";
import { ServiceError } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
import type { SessionAgent } from "../agent/session-agent";
import type {
  MessageProcessingContext,
  MessageProcessingResult,
  MessageProcessor,
} from "../../types/message-processing.types";
import type {
  OrchestratorContext,
  SessionAgentResult,
} from "../../types/harness.types";
import type { OrchestratorAgent } from "../agent/orchestrator-agent";
import type { SessionContextBuilder } from "./session-context-builder";
import type { SessionSummaryCompactor } from "../agent/session-summary-compactor";
import type { TraceRecorderLike } from "../tracing/trace-recorder";

export class MessageOrchestrator implements MessageProcessor {
  constructor(
    private readonly prisma: Pick<PrismaClient, "chatSession">,
    private readonly contextBuilder: SessionContextBuilder,
    private readonly compactor: SessionSummaryCompactor,
    private readonly worker: SessionAgent,
    private readonly agent: OrchestratorAgent,
    private readonly traceRecorder?: TraceRecorderLike,
  ) {}

  async process(
    context: MessageProcessingContext,
  ): Promise<MessageProcessingResult> {
    if (!context.sessionId)
      throw new ServiceError(
        "orchestrator_requires_session",
        "MessageOrchestrator requires a session",
        500,
      );
    const sessionId = context.sessionId;

    const orchestratorContext = await this.contextBuilder.build(sessionId);
    logger.debug("orchestrator_context_built", {
      sessionId,
      messageId: context.messageId,
      messageCount: orchestratorContext.messageCount,
      recentMessageCount: orchestratorContext.recentMessages.length,
      recentToolActivityCount: orchestratorContext.recentToolActivity.length,
      summaryPresent: Boolean(orchestratorContext.summary),
      hasPriorProcessing: orchestratorContext.workspace.hasPriorProcessing,
      shouldCompact: orchestratorContext.shouldCompact,
    });
    this.traceRecorder?.recordContext({
      messageId: context.messageId,
      contextSummary: {
        summaryPresent: Boolean(orchestratorContext.summary),
        summaryChars: orchestratorContext.summary.length,
        recentMessageCount: orchestratorContext.recentMessages.length,
        recentToolActivityCount: orchestratorContext.recentToolActivity.length,
        workspaceHasPriorProcessing:
          orchestratorContext.workspace.hasPriorProcessing,
      },
      contextSnapshot: {
        summary: orchestratorContext.summary,
        recentMessages: orchestratorContext.recentMessages,
        recentToolActivity: orchestratorContext.recentToolActivity,
        workspace: {
          hasPriorProcessing: orchestratorContext.workspace.hasPriorProcessing,
          lastProcessingStatus:
            orchestratorContext.workspace.lastProcessingStatus,
          changedFilesHint: orchestratorContext.workspace.changedFilesHint,
        },
      },
    });
    const delegate = async (brief: string): Promise<SessionAgentResult> => {
      const agentResult = await this.worker.process({
        ...context,
        instructions: brief,
      });
      const result: SessionAgentResult = {
        status: "completed",
        summary: agentResult.finalText,
      };
      return result;
    };

    const decision = await this.agent.decide({
      summary: orchestratorContext.summary,
      recentMessages: orchestratorContext.recentMessages,
      recentToolActivity: orchestratorContext.recentToolActivity,
      workspace: orchestratorContext.workspace,
      message: context.instructions,
      messageId: context.messageId,
      signal: context.signal,
      delegate,
    });

    const lastResult = decision.delegations.at(-1) ?? null;
    logger.debug("orchestrator_decision_completed", {
      sessionId,
      messageId: context.messageId,
      delegated: decision.delegations.length > 0,
      delegationCount: decision.delegations.length,
      lastDelegationStatus: lastResult?.status ?? null,
      replyPresent: decision.reply.trim().length > 0,
    });

    if (orchestratorContext.shouldCompact)
      await this.compactSummary(
        sessionId,
        orchestratorContext,
        context.messageId,
        context.signal,
      );

    const workerReport = lastResult
      ? JSON.stringify(lastResult, null, 2)
      : null;
    if (lastResult?.status === "failed")
      throw new ServiceError(
        "worker_failed",
        lastResult.summary || "Session agent failed",
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
    messageId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const summary = await this.compactor.compact({
      previousSummary: orchestratorContext.summary,
      recentMessages: orchestratorContext.recentMessages,
      recentToolActivity: orchestratorContext.recentToolActivity,
      messageId,
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
      messageId,
      messageCount: orchestratorContext.messageCount,
      summaryBytes: Buffer.byteLength(summary),
    });
  }
}
