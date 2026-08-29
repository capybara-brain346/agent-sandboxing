import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { loadConfig } from "../../config";
import { ServiceError, notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import { sandboxService } from "../sandbox/sandbox";
import {
  chatArtifacts,
  chatGithub,
  chatTraceRecorder,
  chatWorker,
} from "./chat-runtime";
import { MessageProcessingService } from "./message-processing";
import { MessageOrchestrator } from "./message-orchestrator";
import { ArtifactStore } from "../artifacts/artifact-store";
import type { ArtifactContent } from "../../types/artifact.types";
import { ModelOrchestratorAgent } from "../agent/orchestrator-agent";
import { resolveAgentModel } from "../agent/model";
import { SessionContextBuilder } from "./session-context-builder";
import { ModelSessionSummaryCompactor } from "../agent/session-summary-compactor";
import { PlaceholderMessageProcessor } from "../../types/message-processing.types";
import type { PublicEvent } from "../../types/event.types";
import type {
  ChatMessage,
  ChatSession,
  ChatSessionListItem,
  CreateChatSessionRequest,
  CreateMessageRequest,
  CreateMessageResponse,
  MessageCancellationResponse,
  Page,
  RepoScope,
  SessionResult,
  UpdateChatSessionRequest,
} from "../../types/chat.types";
import type {
  MessageProcessingFailure,
  MessageProcessingStatus,
} from "../../types/message-processing.types";
import type { PullRequestMetadata } from "../../types/github.types";
import type { GitHubService } from "../github/github";

type SessionRow = {
  id: string;
  title: string | null;
  repoRef: string;
  repoSource: string;
  repoProvider: string | null;
  repoOwner: string | null;
  repoName: string | null;
  repoId: string | null;
  repoDefaultBranch: string | null;
  repoInstallationId: string | null;
  repoBaseBranch: string | null;
  repoBaseSha: string | null;
  image: string | null;
  activeMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  sandbox?: { id: string } | null;
  messages?: Array<{
    id: string;
    content: string;
    role: "user" | "assistant" | "system";
    processingStatus: MessageProcessingStatus | null;
  }>;
};

type MessageRow = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  processingStatus: MessageProcessingStatus | null;
  processingStartedAt: Date | null;
  processingCompletedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  agentSummary: string | null;
  createdAt: Date;
  diff: string | null;
  exitReason: string | null;
  artifacts?: Array<{
    id: string;
    kind: string;
    contentType: string;
    byteSize: number;
    truncated: boolean;
    redacted: boolean;
  }>;
};

type ListSessionQuery = {
  limit: number;
  cursor?: string | undefined;
  repoSource?: "fixture" | "github" | undefined;
  repoRef?: string | undefined;
};

type MessagePageQuery = { limit: number; before?: string | undefined };
type PublishedEvent = (event: PublicEvent) => void;
type ProcessingTrigger = Pick<
  MessageProcessingService,
  "processMessage" | "requestCancellation" | "cancelDirectly"
>;

const noopProcessing: ProcessingTrigger = {
  processMessage: () => undefined,
  requestCancellation: () => false,
  cancelDirectly: async () => false,
};

const id = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const sessionUrl = (sessionId: string): string => `/chat-sessions/${sessionId}`;
const messagesUrl = (sessionId: string): string =>
  `${sessionUrl(sessionId)}/messages`;
const sessionEventsUrl = (sessionId: string): string =>
  `${sessionUrl(sessionId)}/events`;
const failure = (message: MessageRow): MessageProcessingFailure | null =>
  message.failureCode
    ? {
        code: message.failureCode,
        message: message.failureMessage ?? "Message processing failed",
      }
    : null;

const repo = (session: SessionRow): RepoScope => ({
  source: session.repoSource as RepoScope["source"],
  ref: session.repoRef,
  provider: session.repoProvider,
  owner: session.repoOwner,
  name: session.repoName,
  repoId: session.repoId,
  defaultBranch: session.repoDefaultBranch,
  installationId: session.repoInstallationId,
  baseBranch: session.repoBaseBranch,
  baseSha: session.repoBaseSha,
});

const sessionView = (session: SessionRow): ChatSession => ({
  chatSessionId: session.id,
  title: session.title,
  repo: repo(session),
  status: session.activeMessageId ? "working" : "active",
  activeMessageId: session.activeMessageId,
  sandboxId: session.sandbox?.id ?? null,
  eventsUrl: sessionEventsUrl(session.id),
  messagesUrl: messagesUrl(session.id),
  createdAt: session.createdAt.toISOString(),
  updatedAt: session.updatedAt.toISOString(),
});

const messageView = (message: MessageRow): ChatMessage => ({
  messageId: message.id,
  chatSessionId: message.sessionId,
  role: message.role,
  content: message.content,
  processingStatus: message.processingStatus,
  processingStartedAt: message.processingStartedAt?.toISOString() ?? null,
  processingCompletedAt: message.processingCompletedAt?.toISOString() ?? null,
  failure: failure(message),
  agentSummary: message.agentSummary,
  createdAt: message.createdAt.toISOString(),
});

const terminalStatuses: MessageProcessingStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

const sessionResult = (
  message: MessageRow,
  pullRequest: PullRequestMetadata | null,
): SessionResult => {
  if (!message.processingCompletedAt || !message.processingStatus)
    throw new ServiceError(
      "session_result_unavailable",
      "Session result metadata is incomplete",
      500,
    );
  const status = message.processingStatus;
  if (!terminalStatuses.includes(status))
    throw new ServiceError(
      "message_processing_not_terminal",
      "Message processing is not complete",
      409,
    );
  const exitReason =
    message.exitReason === "completed" ||
    message.exitReason === "failed" ||
    message.exitReason === "cancelled" ||
    message.exitReason === "timed_out"
      ? message.exitReason
      : status === "completed"
        ? "completed"
        : status === "cancelled"
          ? "cancelled"
          : "failed";
  const terminalStatus = status as Extract<
    MessageProcessingStatus,
    "completed" | "failed" | "cancelled"
  >;
  return {
    messageId: message.id,
    chatSessionId: message.sessionId,
    status: terminalStatus,
    diff: message.diff ?? "",
    artifacts:
      message.artifacts?.map((artifact) => ({
        artifactId: artifact.id,
        kind: artifact.kind,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        truncated: artifact.truncated,
        redacted: artifact.redacted,
      })) ?? [],
    agentSummary: message.agentSummary,
    exitReason,
    failure: failure(message),
    pullRequest,
    createdAt: message.createdAt.toISOString(),
    completedAt: message.processingCompletedAt.toISOString(),
  };
};

export class ChatSessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly publish: PublishedEvent = (event) => sseHub.publish(event),
    private readonly processing: ProcessingTrigger = noopProcessing,
    private readonly artifacts: Pick<ArtifactStore, "get"> = new ArtifactStore(
      prisma,
    ),
    private readonly fixtureReposEnabled = false,
    private readonly github?: Pick<
      GitHubService,
      "currentPullRequest" | "validateRepository"
    >,
  ) {}

  async currentPullRequest(
    userId: string,
    sessionId: string,
  ): Promise<PullRequestMetadata | null> {
    await this.requireSession(userId, sessionId);
    return this.github ? this.github.currentPullRequest(sessionId) : null;
  }

  async createSession(
    userId: string,
    input: CreateChatSessionRequest,
  ): Promise<ChatSession> {
    if (input.repo.source === "fixture" && !this.fixtureReposEnabled)
      throw new ServiceError(
        "fixture_repo_disabled",
        "Fixture repositories are not available in the product path",
        403,
      );
    if (input.repo.source === "github") {
      if (!this.github)
        throw new ServiceError(
          "github_repository_not_found",
          "Repository was not found",
          404,
        );
      await this.github.validateRepository(userId, input.repo);
    }

    const sessionId = id("chat");
    const result = await runQuery("create_chat_session", { sessionId }, () =>
      this.prisma.$transaction(async (tx) => {
        const session = await tx.chatSession.create({
          data: {
            id: sessionId,
            userId,
            title: input.title ?? null,
            repoRef: input.repo.ref,
            repoSource: input.repo.source,
            repoProvider: input.repo.provider ?? null,
            repoOwner: input.repo.owner ?? null,
            repoName: input.repo.name ?? null,
            repoId: input.repo.repoId ?? null,
            repoDefaultBranch: input.repo.defaultBranch ?? null,
            repoInstallationId: input.repo.installationId ?? null,
            repoBaseBranch: input.repo.baseBranch ?? null,
            repoBaseSha: input.repo.baseSha ?? null,
            image: input.image ?? null,
          },
        });
        const event = await this.events.appendSessionEventInTransaction(tx, {
          sessionId,
          type: "session_created",
          producerService: "chat",
          producerId: sessionId,
          correlationId: id("cor").slice(0, 24),
          payload: {
            repo_source: input.repo.source,
            repo_ref: input.repo.ref,
          },
        });
        return { session, event };
      }),
    );
    this.publish(result.event);
    logger.debug("chat_session_created", { sessionId });
    return sessionView({ ...result.session, sandbox: null, messages: [] });
  }

  async listSessions(
    userId: string,
    query: ListSessionQuery,
  ): Promise<Page<ChatSessionListItem>> {
    const rows = await runQuery("list_chat_sessions", query, () =>
      this.prisma.chatSession.findMany({
        where: {
          userId,
          ...(query.repoSource ? { repoSource: query.repoSource } : {}),
          ...(query.repoRef ? { repoRef: query.repoRef } : {}),
        },
        orderBy: { updatedAt: "desc" },
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        take: query.limit + 1,
        include: {
          sandbox: { select: { id: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              content: true,
              role: true,
              processingStatus: true,
            },
          },
        },
      }),
    );
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((row) => {
      const session = sessionView(row);
      return {
        ...session,
        latestMessageStatus: row.messages?.[0]?.processingStatus ?? null,
        lastMessagePreview: row.messages?.[0]?.content ?? null,
      };
    });
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.chatSessionId ?? null) : null,
    };
  }

  async getSession(userId: string, sessionId: string): Promise<ChatSession> {
    const session = await runQuery(
      "get_chat_session",
      { sessionId, userId },
      () =>
        this.prisma.chatSession.findFirst({
          where: { id: sessionId, userId },
          include: { sandbox: { select: { id: true } } },
        }),
    );
    if (!session)
      throw notFound("chat_session_not_found", "Chat session was not found");
    return sessionView(session);
  }

  async updateSession(
    userId: string,
    sessionId: string,
    input: UpdateChatSessionRequest,
  ): Promise<ChatSession> {
    const updated = await runQuery(
      "update_chat_session",
      { sessionId, userId },
      () =>
        this.prisma.chatSession.updateMany({
          where: { id: sessionId, userId },
          data: { title: input.title },
        }),
    );
    if (updated.count === 0)
      throw notFound("chat_session_not_found", "Chat session was not found");
    return this.getSession(userId, sessionId);
  }

  async listMessages(
    userId: string,
    sessionId: string,
    query: MessagePageQuery,
  ): Promise<Page<ChatMessage>> {
    await this.requireSession(userId, sessionId);
    let before: Date | undefined;
    if (query.before) {
      const cursor = await this.prisma.chatMessage.findFirst({
        where: { id: query.before, sessionId },
        select: { createdAt: true },
      });
      if (!cursor)
        throw new ServiceError("invalid_cursor", "Message cursor is invalid");
      before = cursor.createdAt;
    }
    const rows = await runQuery("list_chat_messages", { sessionId }, () =>
      this.prisma.chatMessage.findMany({
        where: {
          sessionId,
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: query.limit + 1,
      }),
    );
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).reverse().map(messageView);
    return {
      items,
      nextCursor: hasMore ? (items[0]?.messageId ?? null) : null,
    };
  }

  async appendMessage(
    userId: string,
    sessionId: string,
    input: CreateMessageRequest,
  ): Promise<CreateMessageResponse> {
    const activeMessageId = id("msg");
    const result = await runQuery(
      "append_chat_message",
      { sessionId, messageId: activeMessageId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const session = await tx.chatSession.findUnique({
            where: { id: sessionId },
            select: { id: true, userId: true, activeMessageId: true },
          });
          if (!session || session.userId !== userId)
            throw notFound(
              "chat_session_not_found",
              "Chat session was not found",
            );
          if (session.activeMessageId)
            throw this.activeMessageError(sessionId, session.activeMessageId);

          const claimed = await tx.chatSession.updateMany({
            where: { id: sessionId, activeMessageId: null },
            data: {
              activeMessageId,
              lockedAt: new Date(),
              lockVersion: { increment: 1 },
            },
          });
          if (claimed.count === 0) {
            const current = await tx.chatSession.findUnique({
              where: { id: sessionId },
              select: { activeMessageId: true },
            });
            throw this.activeMessageError(
              sessionId,
              current?.activeMessageId ?? activeMessageId,
            );
          }

          const message = await tx.chatMessage.create({
            data: {
              id: activeMessageId,
              sessionId,
              role: "user",
              content: input.content,
              processingStatus: "queued",
            },
          });
          const messageCreated =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              messageId: activeMessageId,
              type: "message_created",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: id("cor").slice(0, 24),
              domain: "message",
              payload: { role: "user", content: input.content },
            });
          const processingRequested =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              messageId: activeMessageId,
              type: "message_processing_requested",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: id("cor").slice(0, 24),
              domain: "message",
              payload: {},
            });
          return { message, events: [messageCreated, processingRequested] };
        }),
    );
    result.events.forEach((event) => this.publish(event));
    logger.debug("chat_message_appended", {
      sessionId,
      messageId: activeMessageId,
      eventCount: result.events.length,
    });
    this.processing.processMessage(sessionId, activeMessageId, input.content);
    return {
      message: messageView(result.message),
      sessionUrl: sessionUrl(sessionId),
      messagesUrl: messagesUrl(sessionId),
      eventsUrl: sessionEventsUrl(sessionId),
    };
  }

  async sessionResult(
    userId: string,
    sessionId: string,
  ): Promise<SessionResult> {
    const message = await runQuery(
      "get_session_result",
      { sessionId, userId },
      () =>
        this.prisma.chatMessage.findFirst({
          where: {
            sessionId,
            role: "user",
            processingStatus: { in: terminalStatuses },
            session: { userId },
          },
          orderBy: { createdAt: "desc" },
          include: {
            artifacts: {
              select: {
                id: true,
                kind: true,
                contentType: true,
                byteSize: true,
                truncated: true,
                redacted: true,
              },
            },
          },
        }),
    );
    if (!message)
      throw notFound(
        "session_result_not_found",
        "No processed message was found",
      );
    return sessionResult(
      message,
      this.github ? await this.github.currentPullRequest(sessionId) : null,
    );
  }

  async cancelCurrentMessage(
    userId: string,
    sessionId: string,
  ): Promise<MessageCancellationResponse> {
    const session = await runQuery(
      "get_active_message",
      { sessionId, userId },
      () =>
        this.prisma.chatSession.findFirst({
          where: { id: sessionId, userId },
          select: { activeMessageId: true },
        }),
    );
    if (!session)
      throw notFound("chat_session_not_found", "Chat session was not found");
    if (!session.activeMessageId)
      throw new ServiceError(
        "no_active_message",
        "No message is currently being processed",
        409,
      );
    const active = await this.prisma.chatMessage.findUnique({
      where: { id: session.activeMessageId },
      select: { processingStatus: true },
    });
    if (!active) throw notFound("message_not_found", "Message was not found");
    if (active.processingStatus === "cancelled")
      return { messageId: session.activeMessageId, status: "cancelled" };
    if (
      active.processingStatus === "completed" ||
      active.processingStatus === "failed"
    )
      throw new ServiceError(
        "message_processing_already_terminal",
        "Message processing is already terminal",
        409,
      );

    const tracked = this.processing.requestCancellation(
      sessionId,
      session.activeMessageId,
    );
    logger.debug("message_cancellation_requested", {
      sessionId,
      messageId: session.activeMessageId,
      mode: tracked ? "tracked" : "direct",
    });
    if (!tracked)
      await this.processing.cancelDirectly(sessionId, session.activeMessageId);
    return {
      messageId: session.activeMessageId,
      status: "cancelling",
      eventsUrl: sessionEventsUrl(sessionId),
    };
  }

  async sessionEventsAfter(
    userId: string,
    sessionId: string,
    after: number,
  ): Promise<PublicEvent[]> {
    await this.requireSession(userId, sessionId);
    return this.events.listSessionEvents(sessionId, after);
  }

  async getArtifact(
    userId: string,
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactContent> {
    await this.requireSession(userId, sessionId);
    return this.artifacts.get(sessionId, artifactId);
  }

  private async requireSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session)
      throw notFound("chat_session_not_found", "Chat session was not found");
  }

  private activeMessageError(
    sessionId: string,
    activeMessageId: string,
  ): ServiceError {
    return new ServiceError(
      "session_message_in_progress",
      "A message is already being processed for this chat session",
      409,
      {
        activeMessageId,
        eventsUrl: sessionEventsUrl(sessionId),
      },
    );
  }
}

const chatEvents = new EventStore(prisma);
const config = loadConfig();
const processor =
  config.NODE_ENV === "test"
    ? new PlaceholderMessageProcessor()
    : new MessageOrchestrator(
        prisma,
        new SessionContextBuilder(prisma, chatEvents),
        new ModelSessionSummaryCompactor(
          resolveAgentModel(config),
          chatTraceRecorder,
        ),
        chatWorker,
        new ModelOrchestratorAgent(
          resolveAgentModel(config),
          chatTraceRecorder,
        ),
        chatTraceRecorder,
      );
const messageProcessing = new MessageProcessingService(
  prisma,
  chatEvents,
  sandboxService,
  processor,
  (event) => sseHub.publish(event),
  chatArtifacts,
  chatTraceRecorder,
  chatGithub,
);
export const chatSessionService = new ChatSessionService(
  prisma,
  chatEvents,
  (event) => sseHub.publish(event),
  messageProcessing,
  chatArtifacts,
  config.FIXTURE_REPOS_ENABLED,
  chatGithub,
);
