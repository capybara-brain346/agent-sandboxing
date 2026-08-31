import type { PrismaClient } from "@prisma/client";
import { ServiceError } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
import type { OrchestratorContext } from "../../types/harness.types";
import type {
  MessageProcessingContext,
  MessageProcessingResult,
  MessageProcessor,
} from "../../types/message-processing.types";
import type { EvalTraceRecorderLike } from "../eval/eval-trace-recorder";
import type { SessionAgent } from "../agent/session-agent";
import type { SessionContextBuilder } from "./session-context-builder";
import type { SessionSummaryCompactor } from "../agent/session-summary-compactor";

const recentConversation = (context: OrchestratorContext): string =>
  context.recentMessages.length
    ? context.recentMessages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n")
    : "none.";

const recentToolActivity = (context: OrchestratorContext): string =>
  context.recentToolActivity.length
    ? context.recentToolActivity.join("\n")
    : "none.";

const workspaceState = (context: OrchestratorContext): string =>
  [
    `Prior processing: ${context.workspace.hasPriorProcessing ? "yes" : "no"}`,
    `Last processing status: ${context.workspace.lastProcessingStatus ?? "none"}`,
    `Last processing summary: ${context.workspace.lastProcessingSummary ?? "none"}`,
    `Changed files: ${context.workspace.changedFilesHint.join(", ") || "none"}`,
  ].join("\n");

export const composeSessionAgentMessage = (
  context: OrchestratorContext,
  request: string,
): string =>
  [
    `Session summary:\n${context.summary || "none yet."}`,
    `Recent conversation:\n${recentConversation(context)}`,
    `Recent tool activity:\n${recentToolActivity(context)}`,
    `Workspace state:\n${workspaceState(context)}`,
    `User request:\n${request}`,
  ].join("\n\n");

export class SessionAgentProcessor implements MessageProcessor {
  constructor(
    private readonly prisma: Pick<PrismaClient, "chatSession">,
    private readonly contextBuilder: SessionContextBuilder,
    private readonly compactor: SessionSummaryCompactor,
    private readonly runner: SessionAgent,
    private readonly traceRecorder?: EvalTraceRecorderLike,
  ) {}

  async process(
    context: MessageProcessingContext,
  ): Promise<MessageProcessingResult> {
    if (!context.sessionId)
      throw new ServiceError(
        "session_agent_requires_session",
        "SessionAgentProcessor requires a session",
        500,
      );
    const sessionId = context.sessionId;
    const sessionContext = await this.contextBuilder.build(sessionId);
    logger.debug("session_agent_context_built", {
      sessionId,
      messageId: context.messageId,
      messageCount: sessionContext.messageCount,
      recentMessageCount: sessionContext.recentMessages.length,
      recentToolActivityCount: sessionContext.recentToolActivity.length,
      summaryPresent: Boolean(sessionContext.summary),
      hasPriorProcessing: sessionContext.workspace.hasPriorProcessing,
      shouldCompact: sessionContext.shouldCompact,
    });
    this.traceRecorder?.recordOrchestratorContext({
      messageId: context.messageId,
      contextSummary: {
        summaryPresent: Boolean(sessionContext.summary),
        summaryChars: sessionContext.summary.length,
        recentMessageCount: sessionContext.recentMessages.length,
        recentToolActivityCount: sessionContext.recentToolActivity.length,
        workspaceHasPriorProcessing:
          sessionContext.workspace.hasPriorProcessing,
      },
      contextSnapshot: {
        summary: sessionContext.summary,
        recentMessages: sessionContext.recentMessages,
        recentToolActivity: sessionContext.recentToolActivity,
        workspace: {
          hasPriorProcessing: sessionContext.workspace.hasPriorProcessing,
          lastProcessingStatus: sessionContext.workspace.lastProcessingStatus,
          changedFilesHint: sessionContext.workspace.changedFilesHint,
        },
      },
    });

    const result = await this.runner.process({
      ...context,
      instructions: composeSessionAgentMessage(
        sessionContext,
        context.instructions,
      ),
    });
    this.traceRecorder?.recordOrchestratorReply({
      messageId: context.messageId,
      reply: result.finalText,
      delegated: false,
    });

    if (sessionContext.shouldCompact)
      await this.compactSummary(
        sessionId,
        sessionContext,
        context.messageId,
        context.signal,
      );

    return { summary: result.finalText || null };
  }

  private async compactSummary(
    sessionId: string,
    context: OrchestratorContext,
    messageId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const summary = await this.compactor.compact({
      previousSummary: context.summary,
      recentMessages: context.recentMessages,
      recentToolActivity: context.recentToolActivity,
      messageId,
      signal,
    });
    await runQuery("compact_session_summary", { sessionId }, () =>
      this.prisma.chatSession.updateMany({
        where: { id: sessionId },
        data: {
          summary,
          summaryCompactedThroughMessageCount: context.messageCount,
        },
      }),
    );
    logger.debug("session_summary_compacted", {
      sessionId,
      messageId,
      messageCount: context.messageCount,
      summaryBytes: Buffer.byteLength(summary),
    });
  }
}
