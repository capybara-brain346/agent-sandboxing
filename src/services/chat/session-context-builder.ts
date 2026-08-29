import type { PrismaClient } from "@prisma/client";
import { notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { boundUtf8 } from "../../shared/utf8";
import type { EventStore } from "../events/event-store";
import type {
  OrchestratorChatMessage,
  OrchestratorContext,
  WorkspaceSnapshot,
} from "../../types/harness.types";

export const RECENT_MESSAGE_LIMIT = 10;
export const COMPACTION_INTERVAL = RECENT_MESSAGE_LIMIT;
const MAX_CHANGED_FILES_HINT = 20;
const RECENT_TOOL_ACTIVITY_LIMIT = 5;
const TOOL_ACTIVITY_SNIPPET_MAX_BYTES = 200;

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

type SessionSummaryRow = {
  repoRef: string;
  summary: string | null;
  summaryCompactedThroughMessageCount: number;
} | null;
type MessageRow = { role: "user" | "assistant" | "system"; content: string };
type LastMessageRow = {
  id: string;
  processingStatus: string | null;
  diff: string | null;
  agentSummary: string | null;
} | null;

export type SessionContextPrismaCollaborator = Pick<
  PrismaClient,
  "chatSession" | "chatMessage"
>;

export type SessionContextEventStore = Pick<EventStore, "listSessionEvents">;

const toolActivityLine = (event: {
  type: string;
  payload: Record<string, unknown>;
}): string => {
  const toolName =
    typeof event.payload.tool_name === "string"
      ? event.payload.tool_name
      : "unknown_tool";
  const detail =
    event.type === "agent_tool_result"
      ? typeof event.payload.result_snippet === "string"
        ? event.payload.result_snippet
        : ""
      : JSON.stringify(event.payload.args ?? {});
  return `${toolName}: ${boundUtf8(detail, TOOL_ACTIVITY_SNIPPET_MAX_BYTES).value}`;
};

export class SessionContextBuilder {
  constructor(
    private readonly prisma: SessionContextPrismaCollaborator,
    private readonly events: SessionContextEventStore,
  ) {}

  async build(sessionId: string): Promise<OrchestratorContext> {
    const session: SessionSummaryRow = await runQuery(
      "build_orchestrator_context_session",
      { sessionId },
      () =>
        this.prisma.chatSession.findUnique({
          where: { id: sessionId },
          select: {
            repoRef: true,
            summary: true,
            summaryCompactedThroughMessageCount: true,
          },
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

    const messageCount = await runQuery(
      "build_orchestrator_context_message_count",
      { sessionId },
      () => this.prisma.chatMessage.count({ where: { sessionId } }),
    );

    const lastMessage: LastMessageRow = await runQuery(
      "build_orchestrator_context_last_message",
      { sessionId },
      () =>
        this.prisma.chatMessage.findFirst({
          where: {
            sessionId,
            role: "user",
            processingStatus: { in: ["completed", "failed", "cancelled"] },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            processingStatus: true,
            diff: true,
            agentSummary: true,
          },
        }),
    );

    const workspace: WorkspaceSnapshot = lastMessage
      ? {
          hasPriorProcessing: true,
          lastProcessingStatus: lastMessage.processingStatus,
          lastProcessingSummary: lastMessage.agentSummary,
          changedFilesHint: extractChangedFiles(lastMessage.diff ?? ""),
        }
      : {
          hasPriorProcessing: false,
          lastProcessingStatus: null,
          lastProcessingSummary: null,
          changedFilesHint: [],
        };

    const recentToolActivity = lastMessage
      ? (await this.events.listSessionEvents(sessionId, 0))
          .filter(
            (event) =>
              event.messageId === lastMessage.id &&
              (event.type === "agent_tool_call" ||
                event.type === "agent_tool_result"),
          )
          .slice(-RECENT_TOOL_ACTIVITY_LIMIT)
          .map(toolActivityLine)
      : [];

    const recentMessages: OrchestratorChatMessage[] = messageRows
      .slice()
      .reverse()
      .map((message) => ({ role: message.role, content: message.content }));

    return {
      sessionId,
      repoRef: session.repoRef,
      summary: session.summary ?? "",
      recentMessages,
      recentToolActivity,
      messageCount,
      shouldCompact:
        messageCount - session.summaryCompactedThroughMessageCount >=
        COMPACTION_INTERVAL,
      workspace,
    };
  }
}
