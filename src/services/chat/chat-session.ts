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
  taskServiceArtifacts,
  taskServiceTraceRecorder,
  taskServiceWorker,
  taskServiceGithub,
} from "../task/task";
import { resolveAgentModel } from "../agent/model";
import { RunService } from "../task/run-service";
import { ArtifactStore } from "../artifacts/artifact-store";
import type { ArtifactContent } from "../../types/artifact.types";
import { RunOrchestrator } from "./run-orchestrator";
import { ModelOrchestratorAgent } from "../agent/orchestrator-agent";
import { SessionContextBuilder } from "./session-context-builder";
import { ModelSessionSummaryCompactor } from "../agent/session-summary-compactor";
import { PlaceholderTaskRunner } from "../task/task-runner";
import type { PublicEvent } from "../../types/event.types";
import type {
  ChatMessage,
  ChatSession,
  ChatSessionListItem,
  CreateChatSessionRequest,
  CreateMessageRequest,
  CreateMessageResponse,
  Page,
  RepoScope,
  RunCancellationResponse,
  RunResult,
  RunSnapshot,
  UpdateChatSessionRequest,
} from "../../types/chat.types";
import type { TaskFailure, TaskStatus } from "../../types/task.types";
import type { PullRequestMetadata } from "../../types/github.types";
import type { GitHubService } from "../github/github";

type RunRow = {
  id: string;
  sessionId: string | null;
  status: TaskStatus;
  sandboxId: string | null;
  createdAt: Date;
  provisioningAt: Date | null;
  runningAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  diff: string | null;
  agentSummary: string | null;
  exitReason: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  messages?: Array<{ id: string; role: "user" | "assistant" | "system" }>;
  artifacts?: Array<{
    id: string;
    kind: string;
    contentType: string;
    byteSize: number;
    truncated: boolean;
    redacted: boolean;
  }>;
};

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
  activeRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
  sandbox?: { id: string } | null;
  runs?: RunRow[];
  messages?: Array<{ id: string; content: string }>;
};

type ListSessionQuery = {
  limit: number;
  cursor?: string | undefined;
  repoSource?: "fixture" | "github" | undefined;
  repoRef?: string | undefined;
};

type PageQuery = { limit: number; cursor?: string | undefined };
type MessagePageQuery = { limit: number; before?: string | undefined };
type PublishedEvent = (event: PublicEvent) => void;

type RunTrigger = Pick<
  RunService,
  "createRunForMessage" | "requestCancellation" | "cancelDirectly"
>;
const noopRunService: RunTrigger = {
  createRunForMessage: () => undefined,
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
const runUrl = (sessionId: string, runId: string): string =>
  `${sessionUrl(sessionId)}/runs/${runId}`;
const runEventsUrl = (sessionId: string, runId: string): string =>
  `${runUrl(sessionId, runId)}/events`;
const runResultUrl = (sessionId: string, runId: string): string =>
  `${runUrl(sessionId, runId)}/result`;

const failure = (run: RunRow): TaskFailure | null =>
  run.failureCode
    ? {
        code: run.failureCode,
        message: run.failureMessage ?? "Run failed",
      }
    : null;

const terminalAt = (run: RunRow): Date | null =>
  run.completedAt ?? run.failedAt ?? run.cancelledAt;

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

const runSnapshot = (run: RunRow): RunSnapshot => {
  const sessionId = run.sessionId ?? "";
  const completedAt = terminalAt(run);
  return {
    taskRunId: run.id,
    chatSessionId: sessionId,
    triggerMessageId: run.messages?.[0]?.id ?? null,
    status: run.status,
    sandboxId: run.sandboxId,
    resultUrl: runResultUrl(sessionId, run.id),
    eventsUrl: runEventsUrl(sessionId, run.id),
    createdAt: run.createdAt.toISOString(),
    provisioningAt: run.provisioningAt?.toISOString() ?? null,
    runningAt: run.runningAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    failure: failure(run),
  };
};

const sessionView = (session: SessionRow): ChatSession => ({
  chatSessionId: session.id,
  title: session.title,
  repo: repo(session),
  status: "active",
  sandboxId: session.sandbox?.id ?? null,
  eventsUrl: sessionEventsUrl(session.id),
  messagesUrl: messagesUrl(session.id),
  latestRun: session.runs?.[0] ? runSnapshot(session.runs[0]) : null,
  createdAt: session.createdAt.toISOString(),
  updatedAt: session.updatedAt.toISOString(),
});

const messageView = (message: {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  runId: string | null;
  createdAt: Date;
}): ChatMessage => ({
  messageId: message.id,
  chatSessionId: message.sessionId,
  role: message.role,
  content: message.content,
  taskRunId: message.runId,
  createdAt: message.createdAt.toISOString(),
});

const runResult = (
  run: RunRow,
  pullRequest: PullRequestMetadata | null,
): RunResult => {
  const completed = terminalAt(run);
  if (!completed)
    throw new ServiceError(
      "run_result_unavailable",
      "Run result metadata is incomplete",
      500,
    );
  const exitReason =
    run.exitReason === "completed" ||
    run.exitReason === "failed" ||
    run.exitReason === "cancelled" ||
    run.exitReason === "timed_out"
      ? run.exitReason
      : run.status === "completed"
        ? "completed"
        : run.status === "cancelled"
          ? "cancelled"
          : "failed";
  return {
    taskRunId: run.id,
    chatSessionId: run.sessionId ?? "",
    status: run.status as RunResult["status"],
    diff: run.diff ?? "",
    artifacts:
      run.artifacts?.map((artifact) => ({
        artifactId: artifact.id,
        kind: artifact.kind,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        truncated: artifact.truncated,
        redacted: artifact.redacted,
      })) ?? [],
    assistantMessageId:
      run.messages?.find((message) => message.role === "assistant")?.id ?? null,
    agentSummary: run.agentSummary,
    exitReason,
    failure: failure(run),
    pullRequest,
    createdAt: run.createdAt.toISOString(),
    completedAt: completed.toISOString(),
  };
};

export class ChatSessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly publish: PublishedEvent = (event) => sseHub.publish(event),
    private readonly runService: RunTrigger = noopRunService,
    private readonly artifacts: Pick<ArtifactStore, "get"> = new ArtifactStore(
      prisma,
    ),
    private readonly fixtureReposEnabled = false,
    private readonly github?: Pick<
      GitHubService,
      "currentPullRequest" | "validateRepository"
    >,
  ) {}

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
          producerService: "task",
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
    return sessionView({ ...result.session, sandbox: null, runs: [] });
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
          runs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              messages: {
                where: { role: "user" },
                orderBy: { createdAt: "asc" },
                take: 1,
                select: { id: true, role: true },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, content: true },
          },
        },
      }),
    );
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map((row) => {
      const session = sessionView(row);
      return {
        ...session,
        latestRunStatus: session.latestRun?.status ?? null,
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
          include: {
            sandbox: { select: { id: true } },
            runs: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                messages: {
                  where: { role: "user" },
                  orderBy: { createdAt: "asc" },
                  take: 1,
                  select: { id: true, role: true },
                },
              },
            },
          },
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
    const runId = input.startRun ? id("run") : null;
    const messageId = id("msg");
    const result = await runQuery(
      "append_chat_message",
      { sessionId, runId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const session = await tx.chatSession.findUnique({
            where: { id: sessionId },
            select: {
              id: true,
              userId: true,
              activeRunId: true,
              repoRef: true,
              image: true,
            },
          });
          if (!session || session.userId !== userId)
            throw notFound(
              "chat_session_not_found",
              "Chat session was not found",
            );
          if (runId && session.activeRunId)
            throw this.activeRunError(sessionId, session.activeRunId);

          if (!runId) {
            const message = await tx.chatMessage.create({
              data: {
                id: messageId,
                sessionId,
                runId: null,
                role: "user",
                content: input.content,
              },
            });
            await tx.chatSession.update({
              where: { id: sessionId },
              data: { updatedAt: new Date() },
            });
            const event = await this.events.appendSessionEventInTransaction(
              tx,
              {
                sessionId,
                messageId,
                type: "message_created",
                producerService: "task",
                producerId: messageId,
                correlationId: id("cor").slice(0, 24),
                domain: "message",
                payload: { role: "user", content: input.content },
              },
            );
            return { message, run: null, events: [event] };
          }

          const run = await tx.task.create({
            data: {
              id: runId,
              sessionId,
              status: "created",
              repoRef: session.repoRef,
              instructions: input.content,
              image: session.image,
              nextEventSequence: 1,
            },
          });
          const claimed = await tx.chatSession.updateMany({
            where: { id: sessionId, activeRunId: null },
            data: {
              activeRunId: runId,
              lockedAt: new Date(),
              lockVersion: { increment: 1 },
            },
          });
          if (claimed.count === 0)
            throw this.activeRunError(sessionId, session.activeRunId ?? runId);

          const message = await tx.chatMessage.create({
            data: {
              id: messageId,
              sessionId,
              runId,
              role: "user",
              content: input.content,
            },
          });

          const messageEvent =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              messageId,
              type: "message_created",
              producerService: "task",
              producerId: messageId,
              correlationId: id("cor").slice(0, 24),
              domain: "message",
              payload: { role: "user", content: input.content },
            });
          const requestedEvent =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              type: "run_requested",
              producerService: "task",
              producerId: runId,
              correlationId: id("cor").slice(0, 24),
              domain: "run",
              payload: { message_id: messageId },
            });
          const sessionRunEvent =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              type: "run_created",
              producerService: "task",
              producerId: runId,
              correlationId: id("cor").slice(0, 24),
              domain: "run",
              payload: { message_id: messageId },
            });
          const runEvent = await this.events.appendRunEventInTransaction(tx, {
            sessionId,
            runId,
            type: "run_created",
            producerService: "task",
            producerId: runId,
            correlationId: id("cor").slice(0, 24),
            domain: "run",
            payload: { message_id: messageId },
          });
          return {
            message,
            run: {
              ...run,
              messages: [{ id: messageId, role: "user" as const }],
            },
            events: [messageEvent, requestedEvent, sessionRunEvent, runEvent],
          };
        }),
    );
    for (const event of result.events) this.publish(event);
    logger.debug("chat_message_appended", {
      sessionId,
      messageId,
      runId,
      startRun: result.run !== null,
      eventCount: result.events.length,
    });
    if (result.run)
      this.runService.createRunForMessage(
        sessionId,
        result.run.id,
        messageId,
        input.content,
      );
    return {
      message: messageView(result.message),
      run: result.run ? runSnapshot(result.run) : null,
      eventsUrl: sessionEventsUrl(sessionId),
    };
  }

  async listRuns(
    userId: string,
    sessionId: string,
    query: PageQuery,
  ): Promise<Page<RunSnapshot>> {
    await this.requireSession(userId, sessionId);
    const rows = await runQuery("list_chat_runs", { sessionId }, () =>
      this.prisma.task.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        take: query.limit + 1,
        include: {
          messages: {
            where: { role: "user" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { id: true, role: true },
          },
        },
      }),
    );
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map(runSnapshot);
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.taskRunId ?? null) : null,
    };
  }

  async getRun(
    userId: string,
    sessionId: string,
    runId: string,
  ): Promise<RunSnapshot> {
    const run = await this.findRun(userId, sessionId, runId);
    return runSnapshot(run);
  }

  async result(
    userId: string,
    sessionId: string,
    runId: string,
  ): Promise<RunResult> {
    const run = await runQuery(
      "get_chat_run_result",
      { sessionId, runId },
      () =>
        this.prisma.task.findFirst({
          where: { id: runId, sessionId, session: { userId } },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
              select: { id: true, role: true },
            },
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
    if (!run) throw notFound("run_not_found", "Run was not found");
    if (
      !(["completed", "failed", "cancelled"] as TaskStatus[]).includes(
        run.status,
      )
    )
      throw new ServiceError(
        "run_not_terminal",
        "Run result is not available until the run is terminal",
        409,
      );
    return runResult(
      run,
      this.github ? await this.github.currentPullRequest(sessionId) : null,
    );
  }

  async cancelRun(
    userId: string,
    sessionId: string,
    runId: string,
  ): Promise<RunCancellationResponse> {
    const current = await this.findRun(userId, sessionId, runId);
    if (current.status === "cancelled")
      return { taskRunId: runId, status: "cancelled" };
    if (current.status === "completed" || current.status === "failed")
      throw new ServiceError(
        "run_already_terminal",
        "Run is already terminal and cannot be cancelled",
        409,
      );

    const tracked = this.runService.requestCancellation(sessionId, runId);
    logger.debug("run_cancellation_requested", {
      sessionId,
      runId,
      previousStatus: current.status,
      mode: tracked ? "tracked" : "direct",
    });
    if (!tracked) await this.runService.cancelDirectly(sessionId, runId);

    return {
      taskRunId: runId,
      status: "cancelling",
      eventsUrl: runEventsUrl(sessionId, runId),
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

  async runEventsAfter(
    userId: string,
    sessionId: string,
    runId: string,
    after: number,
  ): Promise<PublicEvent[]> {
    await this.findRun(userId, sessionId, runId);
    return this.events.listRunEvents(runId, after);
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

  private async findRun(
    userId: string,
    sessionId: string,
    runId: string,
  ): Promise<RunRow> {
    const run = await runQuery(
      "get_chat_run",
      { sessionId, runId, userId },
      () =>
        this.prisma.task.findFirst({
          where: { id: runId, sessionId, session: { userId } },
          include: {
            messages: {
              where: { role: "user" },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { id: true, role: true },
            },
          },
        }),
    );
    if (!run) throw notFound("run_not_found", "Run was not found");
    return run;
  }

  private activeRunError(sessionId: string, runId: string): ServiceError {
    return new ServiceError(
      "session_run_in_progress",
      "A run is already active for this chat session",
      409,
      {
        taskRunId: runId,
        runId,
        eventsUrl: runEventsUrl(sessionId, runId),
      },
    );
  }
}

const chatSessionEvents = new EventStore(prisma);
const publishChatEvent = (event: PublicEvent): void => sseHub.publish(event);
const chatHarnessConfig = loadConfig();
const chatRunner =
  chatHarnessConfig.NODE_ENV === "test"
    ? new PlaceholderTaskRunner()
    : new RunOrchestrator(
        prisma,
        new SessionContextBuilder(prisma, chatSessionEvents),
        new ModelSessionSummaryCompactor(
          resolveAgentModel(chatHarnessConfig),
          taskServiceTraceRecorder,
        ),
        taskServiceWorker,
        new ModelOrchestratorAgent(
          resolveAgentModel(chatHarnessConfig),
          taskServiceTraceRecorder,
        ),
        taskServiceTraceRecorder,
      );
const chatRunService = new RunService(
  prisma,
  chatSessionEvents,
  sandboxService,
  chatRunner,
  publishChatEvent,
  taskServiceArtifacts,
  taskServiceTraceRecorder,
  taskServiceGithub,
);
export const chatSessionService = new ChatSessionService(
  prisma,
  chatSessionEvents,
  publishChatEvent,
  chatRunService,
  taskServiceArtifacts,
  chatHarnessConfig.FIXTURE_REPOS_ENABLED,
  taskServiceGithub,
);
