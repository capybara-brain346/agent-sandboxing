import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ChatSessionService } from "../src/services/chat/chat-session";
import type { EventStore } from "../src/services/events/event-store";
import type { PublicEvent } from "../src/types/event.types";

const event = (
  streamId: string,
  streamScope: "session" | "run",
): PublicEvent => ({
  id: `evt_${streamId}_${streamScope}`,
  streamId,
  streamScope,
  domain: streamScope,
  sessionId: "chat_1",
  runId: streamScope === "run" ? "run_1" : null,
  taskId: null,
  messageId: null,
  artifactId: null,
  sandboxId: null,
  commandId: null,
  sequence: 1,
  type: "run_created",
  producerService: "task",
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
  activeRunId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const runRow = {
  id: "run_1",
  sessionId: "chat_1",
  status: "created" as const,
  sandboxId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  provisioningAt: null,
  runningAt: null,
  completedAt: null,
  failedAt: null,
  cancelledAt: null,
  diff: null,
  agentSummary: null,
  exitReason: null,
  failureCode: null,
  failureMessage: null,
  messages: [{ id: "msg_1", role: "user" as const }],
};

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
      appendSessionEventInTransaction: vi.fn(async () =>
        event("chat_1", "session"),
      ),
    };
    const publish = vi.fn(() => expect(committed).toBe(true));
    const service = new ChatSessionService(
      prisma,
      events as unknown as EventStore,
      publish,
    );

    await expect(
      service.createSession({
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
      latestRun: null,
    });
    expect(tx.chatSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ repoRef: "./repo" }),
      }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("persists a message, run, lock, and both scoped event streams together", async () => {
    let committed = false;
    const tx = {
      chatSession: {
        findUnique: vi.fn(async () => ({
          id: "chat_1",
          activeRunId: null,
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
      task: {
        create: vi.fn(async () => runRow),
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
      appendSessionEventInTransaction: vi.fn(async () =>
        event("chat_1", "session"),
      ),
      appendRunEventInTransaction: vi.fn(async () => event("run_1", "run")),
    };
    const publish = vi.fn(() => expect(committed).toBe(true));
    const service = new ChatSessionService(
      prisma,
      events as unknown as EventStore,
      publish,
    );

    const result = await service.appendMessage("chat_1", {
      content: "Fix the tests",
      startRun: true,
    });

    expect(result.message).toMatchObject({
      messageId: expect.any(String),
      chatSessionId: "chat_1",
      taskRunId: expect.any(String),
    });
    expect(result.run).toMatchObject({
      chatSessionId: "chat_1",
      status: "created",
    });
    expect(events.appendSessionEventInTransaction).toHaveBeenCalledTimes(3);
    expect(events.appendRunEventInTransaction).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it("rejects a second active run from the durable session lock", async () => {
    const tx = {
      chatSession: {
        findUnique: vi.fn(async () => ({
          id: "chat_1",
          activeRunId: "run_existing",
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
      service.appendMessage("chat_1", {
        content: "Second run",
        startRun: true,
      }),
    ).rejects.toMatchObject({
      code: "session_run_in_progress",
      status: 409,
      details: { taskRunId: "run_existing" },
    });
  });

  it("delegates artifact fetches to the injected artifact store", async () => {
    const prisma = {} as unknown as PrismaClient;
    const get = vi.fn(async (sessionId: string, artifactId: string) => ({
      artifactId,
      sessionId,
      runId: "run_1",
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

    const artifact = await service.getArtifact("chat_1", "art_1");
    expect(get).toHaveBeenCalledWith("chat_1", "art_1");
    expect(artifact.content).toBe("diff --git a/x b/x");
  });
});
