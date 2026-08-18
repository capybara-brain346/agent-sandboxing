import type { PrismaClient } from "@prisma/client";
import { notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import type {
  OrchestratorChatMessage,
  OrchestratorContext,
  WorkspaceSnapshot,
} from "../../types/harness.types";

const RECENT_MESSAGE_LIMIT = 8;
const MAX_CHANGED_FILES_HINT = 20;

const CHANGED_FILE_LINE = /^diff --git a\/(.+?) b\/(.+)$/;

const extractChangedFiles = (diff: string): string[] => {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = CHANGED_FILE_LINE.exec(line);
    const path = match?.[2] ?? match?.[1];
    if (path) files.add(path);
  }
  return [...files].slice(0, MAX_CHANGED_FILES_HINT);
};

type SessionSummaryRow = { repoRef: string; summary: string | null } | null;
type MessageRow = { role: "user" | "assistant" | "system"; content: string };
type LastRunRow = {
  status: string;
  diff: string | null;
  agentSummary: string | null;
} | null;

export type SessionContextPrismaCollaborator = Pick<
  PrismaClient,
  "chatSession" | "chatMessage" | "task"
>;

/**
 * Builds the bounded, explicitly-selected context the orchestrator reads:
 * session identity, durable summary, recent chat messages only, and a
 * compact workspace snapshot derived from the last terminal run. Never
 * replays raw event/command history.
 */
export class SessionContextBuilder {
  constructor(private readonly prisma: SessionContextPrismaCollaborator) {}

  async build(sessionId: string): Promise<OrchestratorContext> {
    const session: SessionSummaryRow = await runQuery(
      "build_orchestrator_context_session",
      { sessionId },
      () =>
        this.prisma.chatSession.findUnique({
          where: { id: sessionId },
          select: { repoRef: true, summary: true },
        }),
    );
    if (!session)
      throw notFound("chat_session_not_found", "Chat session was not found");

    const messageRows: MessageRow[] = await runQuery(
      "build_orchestrator_context_messages",
      { sessionId },
      () =>
        this.prisma.chatMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: "desc" },
          take: RECENT_MESSAGE_LIMIT,
          select: { role: true, content: true },
        }),
    );

    const lastRun: LastRunRow = await runQuery(
      "build_orchestrator_context_last_run",
      { sessionId },
      () =>
        this.prisma.task.findFirst({
          where: {
            sessionId,
            status: { in: ["completed", "failed", "cancelled"] },
          },
          orderBy: { createdAt: "desc" },
          select: { status: true, diff: true, agentSummary: true },
        }),
    );

    const workspace: WorkspaceSnapshot = lastRun
      ? {
          hasPriorRun: true,
          lastRunStatus: lastRun.status,
          lastRunSummary: lastRun.agentSummary,
          changedFilesHint: extractChangedFiles(lastRun.diff ?? ""),
        }
      : {
          hasPriorRun: false,
          lastRunStatus: null,
          lastRunSummary: null,
          changedFilesHint: [],
        };

    const recentMessages: OrchestratorChatMessage[] = messageRows
      .slice()
      .reverse()
      .map((message) => ({ role: message.role, content: message.content }));

    return {
      sessionId,
      repoRef: session.repoRef,
      summary: session.summary ?? "",
      recentMessages,
      workspace,
    };
  }
}
