import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MessageProcessingService } from "../src/services/chat/message-processing";
import type { EventStore } from "../src/services/events/event-store";
import type { PublicEvent } from "../src/types/event.types";
import type { MessageProcessor } from "../src/types/message-processing.types";
import type { SessionSandboxCollaborator } from "../src/services/sandbox/sandbox";

const makeEvent = (
  type: PublicEvent["type"],
  messageId = "msg_1",
): PublicEvent => ({
  id: `evt_${type}`,
  streamId: "chat_1",
  streamScope: "session",
  domain: "message",
  sessionId: "chat_1",
  messageId,
  artifactId: null,
  sandboxId: "sbox_1",
  commandId: null,
  sequence: 1,
  type,
  producerService: "chat",
  producerId: messageId,
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

const makeService = () => {
  const tx = {
    chatMessage: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })),
    },
    chatSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    sandbox: { update: vi.fn(async () => undefined) },
  };
  const prisma = {
    chatSession: {
      findUnique: vi.fn(async () => ({
        id: "chat_1",
        repoSource: "fixture",
        repoRef: "./repo",
        image: null,
        repoOwner: null,
        repoName: null,
        repoDefaultBranch: null,
        repoInstallationId: null,
        repoBaseBranch: null,
        repoBaseSha: null,
        sandbox: null,
      })),
    },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaClient;
  const events = {
    appendSessionEventInTransaction: vi.fn(
      async (_tx: unknown, input: { type: PublicEvent["type"] }) =>
        makeEvent(input.type),
    ),
    listSessionEvents: vi.fn(async () => []),
  } as unknown as EventStore;
  const sandbox = {
    createForSessionInTransaction: vi.fn(async () => ({
      sandboxId: "sbox_1",
      containerName: "sandbox-sbox_1",
      workspacePath: "/workspace/repo",
    })),
    ensureReadyForSession: vi.fn(async () => ({ status: "ready" as const })),
    prepareSessionBranchForSession: vi.fn(async () => undefined),
    diffForSession: vi.fn(async () => ({
      sandboxId: "sbox_1",
      diff: "diff --git a/a b/a",
      generatedAt: "2026-01-01T00:00:00.000Z",
    })),
  } as unknown as SessionSandboxCollaborator;
  const processor = {
    process: vi.fn(async () => ({ summary: "completed" })),
  } as unknown as MessageProcessor;
  const publish = vi.fn();
  const service = new MessageProcessingService(
    prisma,
    events,
    sandbox,
    processor,
    publish,
  );
  return { service, prisma, events, sandbox, processor, publish, tx };
};

describe("MessageProcessingService", () => {
  it("processes a message and clears the session lock", async () => {
    const harness = makeService();

    harness.service.processMessage("chat_1", "msg_1", "Fix the issue");

    await vi.waitFor(() =>
      expect(harness.processor.process).toHaveBeenCalled(),
    );
    await vi.waitFor(() =>
      expect(harness.tx.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: "chat_1", activeMessageId: "msg_1" },
        data: { activeMessageId: null, lockedAt: null },
      }),
    );

    expect(harness.processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "chat_1",
        messageId: "msg_1",
        sandboxId: "sbox_1",
        instructions: "Fix the issue",
      }),
    );
    expect(
      harness.events.appendSessionEventInTransaction.mock.calls.map(
        ([, input]) => input.type,
      ),
    ).toEqual([
      "sandbox_created",
      "message_processing_started",
      "message_created",
      "message_processing_completed",
      "message_result_ready",
    ]);
  });

  it("cancels the active message before background processing starts", async () => {
    const harness = makeService();

    harness.service.processMessage("chat_1", "msg_1", "Fix the issue");
    expect(harness.service.requestCancellation("chat_1", "msg_1")).toBe(true);

    await vi.waitFor(() =>
      expect(harness.processor.process).not.toHaveBeenCalled(),
    );
    await vi.waitFor(() =>
      expect(harness.tx.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: "chat_1", activeMessageId: "msg_1" },
        data: { activeMessageId: null, lockedAt: null },
      }),
    );
    expect(
      harness.events.appendSessionEventInTransaction.mock.calls.map(
        ([, input]) => input.type,
      ),
    ).toContain("message_processing_cancelled");
  });

  it("reuses the GitHub session sandbox and branch for a second message", async () => {
    const tx = {
      chatMessage: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })),
      },
      chatSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const sessions = [
      {
        id: "chat_1",
        repoSource: "github",
        repoRef: "github:octo/repo",
        image: null,
        repoOwner: "octo",
        repoName: "repo",
        repoDefaultBranch: "main",
        repoInstallationId: "10",
        repoBaseBranch: "main",
        repoBaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sandbox: null,
      },
      {
        id: "chat_1",
        repoSource: "github",
        repoRef: "github:octo/repo",
        image: null,
        repoOwner: "octo",
        repoName: "repo",
        repoDefaultBranch: "main",
        repoInstallationId: "10",
        repoBaseBranch: "main",
        repoBaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sandbox: { id: "sbox_1", status: "ready" },
      },
    ];
    const prisma = {
      chatSession: {
        findUnique: vi.fn(async () => sessions.shift()),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaClient;
    const events = {
      appendSessionEventInTransaction: vi.fn(
        async (_tx: unknown, input: { type: PublicEvent["type"] }) =>
          makeEvent(input.type),
      ),
      listSessionEvents: vi.fn(async () => []),
    } as unknown as EventStore;
    const sandbox = {
      createForSessionInTransaction: vi.fn(async () => ({
        sandboxId: "sbox_1",
        containerName: "sandbox-sbox_1",
        workspacePath: "/workspace/repo",
      })),
      ensureReadyForSession: vi.fn(async () => ({ status: "ready" as const })),
      prepareSessionBranchForSession: vi.fn(async () => undefined),
      diffForSession: vi.fn(async () => ({
        sandboxId: "sbox_1",
        diff: "",
        generatedAt: "2026-01-01T00:00:00.000Z",
      })),
    } as unknown as SessionSandboxCollaborator;
    const processor = {
      process: vi.fn(async () => ({ summary: "completed" })),
    } as unknown as MessageProcessor;
    const github = {
      createInstallationToken: vi.fn(async () => "installation-token"),
    };
    const service = new MessageProcessingService(
      prisma,
      events,
      sandbox,
      processor,
      vi.fn(),
      undefined,
      undefined,
      github,
    );

    service.processMessage("chat_1", "msg_1", "First message");
    await vi.waitFor(() => expect(processor.process).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(tx.chatSession.updateMany).toHaveBeenCalledTimes(1),
    );

    service.processMessage("chat_1", "msg_2", "Second message");
    await vi.waitFor(() => expect(processor.process).toHaveBeenCalledTimes(2));

    expect(sandbox.createForSessionInTransaction).toHaveBeenCalledTimes(1);
    expect(sandbox.createForSessionInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        source: {
          source: "github",
          owner: "octo",
          name: "repo",
          installationId: "10",
          cloneUrl: "https://github.com/octo/repo.git",
          baseBranch: "main",
          baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          token: "installation-token",
        },
        image: undefined,
      },
      { sessionId: "chat_1" },
    );
    expect(sandbox.ensureReadyForSession).toHaveBeenNthCalledWith(
      1,
      "chat_1",
      "msg_1",
      "sbox_1",
      expect.objectContaining({
        source: "github",
        baseBranch: "main",
        baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(sandbox.ensureReadyForSession).toHaveBeenNthCalledWith(
      2,
      "chat_1",
      "msg_2",
      "sbox_1",
    );
    expect(sandbox.prepareSessionBranchForSession).toHaveBeenNthCalledWith(
      1,
      "chat_1",
      "sbox_1",
      { baseBranch: "main", defaultBranch: "main" },
    );
    expect(sandbox.prepareSessionBranchForSession).toHaveBeenNthCalledWith(
      2,
      "chat_1",
      "sbox_1",
      { baseBranch: "main", defaultBranch: "main" },
    );
    expect(github.createInstallationToken).toHaveBeenCalledWith("10");
    expect(github.createInstallationToken).toHaveBeenCalledTimes(1);
  });
});
