import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ChatSessionService } from "../src/services/chat/chat-session";
import type { EventStore } from "../src/services/events/event-store";
import type { PublicEvent } from "../src/types/event.types";
import { logger } from "../src/logger";

const event = (streamId: string): PublicEvent => ({
  id: `evt_${streamId}`,
  streamId,
  streamScope: "session",
  domain: "chat",
  sessionId: "chat_1",
  messageId: null,
  artifactId: null,
  sandboxId: null,
  commandId: null,
  sequence: 1,
  type: "message_created",
  producerService: "chat",
  producerId: streamId,
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

const sessionRow = {
  id: "chat_1",
  title: "Fix tests",
  repoRef: "./repo",
  repoSource: "fixture",
  repoProvider: null,
  repoOwner: null,
  repoName: null,
  repoId: null,
  repoDefaultBranch: null,
  repoInstallationId: null,
  image: null,
  activeMessageId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const userId = "user_1";

describe("ChatSessionService", () => {
  it("creates a session and publishes its event after the transaction commits", async () => {
    let committed = false;
    const tx = {
      chatSession: {
        create: vi.fn(async () => sessionRow),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => {
        const result = await callback(tx);
        committed = true;
        return result;
      }),
    } as unknown as PrismaClient;
    const events = {
      appendSessionEventInTransaction: vi.fn(async () => event("chat_1")),
    };
    const publish = vi.fn(() => expect(committed).toBe(true));
    const service = new ChatSessionService(
      prisma,
      events as unknown as EventStore,
      publish,
      undefined,
      undefined,
      true,
    );

    await expect(
      service.createSession(userId, {
        repo: {
          source: "fixture",
          ref: "./repo",
          provider: null,
          owner: null,
          name: null,
          repoId: null,
          defaultBranch: null,
          installationId: null,
        },
        title: "Fix tests",
      }),
    ).resolves.toMatchObject({
      chatSessionId: "chat_1",
      title: "Fix tests",
      sandboxId: null,
    });
    expect(tx.chatSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ repoRef: "./repo" }),
      }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("rejects fixture sessions when fixture support is disabled", async () => {
    const service = new ChatSessionService(
      {} as PrismaClient,
      {} as EventStore,
    );

    await expect(
      service.createSession(userId, {
        repo: { source: "fixture", ref: "./repo" },
      }),
    ).rejects.toMatchObject({
      code: "fixture_repo_disabled",
      status: 403,
    });
  });

  it("creates GitHub sessions with the selected base branch", async () => {
    const tx = {
      chatSession: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...sessionRow,
          ...data,
          repoSource: "github",
          repoBaseBranch: "feature",
          repoBaseSha: "abc123",
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaClient;
    const events = {
      appendSessionEventInTransaction: vi.fn(async () => event("chat_1")),
    };
    const validateRepository = vi.fn(async () => undefined);
    const service = new ChatSessionService(
      prisma,
      events as unknown as EventStore,
      undefined,
      undefined,
      undefined,
      false,
      {
        currentPullRequest: vi.fn(async () => null),
        validateRepository,
      },
    );

    await expect(
      service.createSession(userId, {
        repo: {
          source: "github",
          ref: "github:octo/repo",
          baseBranch: "feature",
          baseSha: "abc123",
        },
      }),
    ).resolves.toMatchObject({
      repo: { baseBranch: "feature", baseSha: "abc123" },
    });
    expect(validateRepository).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ baseBranch: "feature", baseSha: "abc123" }),
    );
  });

  it("persists a queued message, lock, and session events together", async () => {
    const debug = vi.spyOn(logger, "debug");
    let committed = false;
    const tx = {
      chatSession: {
        findUnique: vi.fn(async () => ({
          id: "chat_1",
          userId,
          activeMessageId: null,
          repoRef: "./repo",
          image: null,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      chatMessage: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => {
        const result = await callback(tx);
        committed = true;
        return result;
      }),
    } as unknown as PrismaClient;
    const events = {
      appendSessionEventInTransaction: vi.fn(async () => event("chat_1")),
    };
    const publish = vi.fn(() => expect(committed).toBe(true));
    const service = new ChatSessionService(
      prisma,
      events as unknown as EventStore,
      publish,
    );

    const result = await service.appendMessage(userId, "chat_1", {
      content: "Fix the tests",
    });

    expect(result.message).toMatchObject({
      messageId: expect.any(String),
      chatSessionId: "chat_1",
    });
    expect(events.appendSessionEventInTransaction).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenCalledWith(
      "chat_message_appended",
      expect.objectContaining({
        sessionId: "chat_1",
        messageId: expect.any(String),
        eventCount: 2,
      }),
    );
    expect(debug).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: "Fix the tests" }),
    );
    debug.mockRestore();
  });

  it("rejects a second active message from the durable session lock", async () => {
    const tx = {
      chatSession: {
        findUnique: vi.fn(async () => ({
          id: "chat_1",
          userId,
          activeMessageId: "msg_existing",
          repoRef: "./repo",
          image: null,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaClient;
    const service = new ChatSessionService(prisma, {} as EventStore);

    await expect(
      service.appendMessage(userId, "chat_1", {
        content: "Second message",
      }),
    ).rejects.toMatchObject({
      code: "session_message_in_progress",
      status: 409,
      details: { activeMessageId: "msg_existing" },
    });
  });

  it("returns the latest terminal message result", async () => {
    const message = {
      id: "msg_latest",
      sessionId: "chat_1",
      role: "user" as const,
      content: "Fix the issue",
      processingStatus: "completed" as const,
      processingStartedAt: new Date("2026-01-01T00:00:01.000Z"),
      processingCompletedAt: new Date("2026-01-01T00:00:02.000Z"),
      failureCode: null,
      failureMessage: null,
      agentSummary: "Fixed the issue",
      diff: "diff --git a/file.txt b/file.txt",
      exitReason: "completed",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      artifacts: [],
    };
    const findFirst = vi.fn(async () => message);
    const prisma = {
      chatMessage: { findFirst },
    } as unknown as PrismaClient;
    const currentPullRequest = vi.fn(async () => null);
    const service = new ChatSessionService(
      prisma,
      {} as EventStore,
      undefined,
      undefined,
      undefined,
      false,
      { currentPullRequest, validateRepository: vi.fn() },
    );

    await expect(
      service.sessionResult(userId, "chat_1"),
    ).resolves.toMatchObject({
      messageId: "msg_latest",
      status: "completed",
      diff: "diff --git a/file.txt b/file.txt",
      agentSummary: "Fixed the issue",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: "chat_1",
          role: "user",
          processingStatus: { in: ["completed", "failed", "cancelled"] },
        }),
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(currentPullRequest).toHaveBeenCalledWith("chat_1");
  });

  it("returns completed cancellation when it directly cancels the active message", async () => {
    const cancelDirectly = vi.fn(async () => true);
    const service = new ChatSessionService(
      {
        chatSession: {
          findFirst: vi.fn(async () => ({ activeMessageId: "msg_1" })),
        },
        chatMessage: {
          findUnique: vi.fn(async () => ({ processingStatus: "queued" })),
        },
      } as unknown as PrismaClient,
      {} as EventStore,
      undefined,
      { requestCancellation: vi.fn(() => false), cancelDirectly },
    );

    await expect(
      service.cancelCurrentMessage(userId, "chat_1"),
    ).resolves.toEqual({ messageId: "msg_1", status: "cancelled" });
    expect(cancelDirectly).toHaveBeenCalledWith("chat_1", "msg_1");
  });

  it("returns cancelling while tracked processing receives cancellation", async () => {
    const requestCancellation = vi.fn(() => true);
    const service = new ChatSessionService(
      {
        chatSession: {
          findFirst: vi.fn(async () => ({ activeMessageId: "msg_1" })),
        },
        chatMessage: {
          findUnique: vi.fn(async () => ({ processingStatus: "working" })),
        },
      } as unknown as PrismaClient,
      {} as EventStore,
      undefined,
      { requestCancellation, cancelDirectly: vi.fn(async () => false) },
    );

    await expect(
      service.cancelCurrentMessage(userId, "chat_1"),
    ).resolves.toEqual({
      messageId: "msg_1",
      status: "cancelling",
      eventsUrl: "/chat-sessions/chat_1/events",
    });
    expect(requestCancellation).toHaveBeenCalledWith("chat_1", "msg_1");
  });

  it("delegates artifact fetches to the injected artifact store", async () => {
    const prisma = {
      chatSession: {
        findFirst: vi.fn(async () => ({ id: "chat_1" })),
      },
    } as unknown as PrismaClient;
    const get = vi.fn(async (sessionId: string, artifactId: string) => ({
      artifactId,
      sessionId,
      messageId: "msg_1",
      kind: "diff",
      contentType: "text/x-diff",
      content: "diff --git a/x b/x",
      byteSize: 19,
      truncated: false,
      redacted: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const service = new ChatSessionService(
      prisma,
      {} as EventStore,
      undefined,
      undefined,
      { get },
    );

    const artifact = await service.getArtifact(userId, "chat_1", "art_1");
    expect(get).toHaveBeenCalledWith("chat_1", "art_1");
    expect(artifact.content).toBe("diff --git a/x b/x");
  });
});
