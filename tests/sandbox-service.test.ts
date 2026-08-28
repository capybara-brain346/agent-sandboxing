import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Config } from "../src/config";
import type { EventStore } from "../src/services/events/event-store";
import { SandboxService, canTransition } from "../src/services/sandbox/sandbox";
import type { SandboxRuntime } from "../src/services/sandbox/runtime";
import type { PublicEvent } from "../src/types/event.types";
import { logger } from "../src/logger";

const config = {
  FIXTURE_REPO_PATH: "./repo",
  SANDBOX_IMAGE: "node:22",
  SANDBOX_STOP_GRACE_MS: 1000,
} as Config;

const sandboxRow = (status: "creating" | "ready" | "stopped" = "creating") => ({
  id: "s1",
  sessionId: "chat_1",
  status,
  containerName: "sandbox-s1",
  image: "node:22",
  fixtureRepoPath: "./repo",
  workspacePath: "/workspace/repo",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  readyAt: status === "ready" ? new Date("2026-01-01T00:00:00Z") : null,
  stoppedAt: status === "stopped" ? new Date("2026-01-01T00:00:01Z") : null,
  failureCode: null,
  failureMessage: null,
});

describe("SandboxService", () => {
  it("allows only documented sandbox status transitions", () => {
    expect(canTransition("creating", "ready")).toBe(true);
    expect(canTransition("ready", "creating")).toBe(false);
  });

  it("creates only session-owned sandbox rows in the caller transaction", async () => {
    const create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    const service = new SandboxService(
      {} as PrismaClient,
      {} as EventStore,
      {} as SandboxRuntime,
      config,
      vi.fn(),
    );

    const result = await service.createForSessionInTransaction(
      { sandbox: { create } } as unknown as Prisma.TransactionClient,
      {
        source: { source: "fixture", fixtureRepoPath: "./repo" },
        image: "node:22",
      },
      { sessionId: "chat_1" },
    );

    expect(result).toEqual({
      sandboxId: expect.any(String),
      containerName: expect.stringMatching(/^sandbox-sbox_/),
      workspacePath: "/workspace/repo",
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: "chat_1",
        status: "creating",
      }),
    });
  });

  it("returns ready immediately for an already-provisioned session sandbox", async () => {
    const findFirst = vi.fn(async () => sandboxRow("ready"));
    const service = new SandboxService(
      { sandbox: { findFirst } } as unknown as PrismaClient,
      {} as EventStore,
      {} as SandboxRuntime,
      config,
      vi.fn(),
    );

    await expect(
      service.ensureReadyForSession("chat_1", "run_1", "s1"),
    ).resolves.toEqual({ status: "ready" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "s1", sessionId: "chat_1" },
    });
  });

  it("provisions a creating session sandbox and publishes run-scoped events", async () => {
    const debug = vi.spyOn(logger, "debug");
    const publish = vi.fn();
    const runtime = {
      provision: vi.fn(async () => ({ containerId: "container-1" })),
    } as unknown as SandboxRuntime;
    const events = {
      appendRunEvent: vi.fn(async (input: { type: PublicEvent["type"] }) =>
        event(input.type, 1),
      ),
      appendRunEventInTransaction: vi.fn(
        async (_tx: unknown, input: { type: PublicEvent["type"] }) =>
          event(input.type, 1),
      ),
    } as unknown as EventStore;
    const prisma = {
      sandbox: {
        findFirst: vi.fn(async () => sandboxRow("creating")),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          sandbox: {
            update: vi.fn(async () => sandboxRow("ready")),
          },
        }),
      ),
    } as unknown as PrismaClient;
    const service = new SandboxService(
      prisma,
      events,
      runtime,
      config,
      publish,
    );

    await expect(
      service.ensureReadyForSession("chat_1", "run_1", "s1"),
    ).resolves.toEqual({ status: "ready" });
    expect(runtime.provision).toHaveBeenCalledWith(
      "s1",
      "sandbox-s1",
      "node:22",
      { source: "fixture", fixtureRepoPath: "./repo" },
    );
    expect(publish).toHaveBeenCalledTimes(4);
    expect(debug).toHaveBeenCalledWith(
      "sandbox_provision_completed",
      expect.objectContaining({
        sessionId: "chat_1",
        runId: "run_1",
        sandboxId: "s1",
        durationMs: expect.any(Number),
        outcome: "ready",
      }),
    );
    debug.mockRestore();
  });

  it("provisions GitHub repositories and publishes repository lifecycle events", async () => {
    const publish = vi.fn();
    const runtime = {
      provision: vi.fn(async () => ({ containerId: "container-1" })),
    } as unknown as SandboxRuntime;
    const events = {
      appendRunEvent: vi.fn(async (input: { type: PublicEvent["type"] }) =>
        event(input.type, 1),
      ),
      appendRunEventInTransaction: vi.fn(
        async (_tx: unknown, input: { type: PublicEvent["type"] }) =>
          event(input.type, 1),
      ),
    } as unknown as EventStore;
    const prisma = {
      sandbox: {
        findFirst: vi.fn(async () => sandboxRow("creating")),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          sandbox: { update: vi.fn(async () => sandboxRow("ready")) },
        }),
      ),
    } as unknown as PrismaClient;
    const service = new SandboxService(
      prisma,
      events,
      runtime,
      config,
      publish,
    );
    const source = {
      source: "github" as const,
      owner: "octo",
      name: "repo",
      installationId: "10",
      cloneUrl: "https://github.com/octo/repo.git",
      baseBranch: "main",
      token: "installation-token",
    };

    await expect(
      service.ensureReadyForSession("chat_1", "run_1", "s1", source),
    ).resolves.toEqual({ status: "ready" });
    expect(runtime.provision).toHaveBeenCalledWith(
      "s1",
      "sandbox-s1",
      "node:22",
      source,
    );
    expect(publish.mock.calls.map(([published]) => published.type)).toEqual([
      "sandbox_provisioning_started",
      "repo_clone_started",
      "repo_clone_completed",
      "repo_checkout_completed",
      "sandbox_ready",
    ]);
  });

  it("requires session ownership and readiness for a session agent target", async () => {
    const findFirst = vi.fn(async () => sandboxRow("ready"));
    const runtime = { simpleExec: vi.fn() } as unknown as SandboxRuntime;
    const service = new SandboxService(
      { sandbox: { findFirst } } as unknown as PrismaClient,
      {} as EventStore,
      runtime,
      config,
      vi.fn(),
    );

    const target = await service.getAgentToolTarget("chat_1", "run_1", "s1");

    expect(target.containerName).toBe("sandbox-s1");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "s1", sessionId: "chat_1" },
      select: { containerName: true, status: true },
    });
  });

  it("rejects diff before the session workspace is available", async () => {
    const runtime = { diff: vi.fn() } as unknown as SandboxRuntime;
    const prisma = {
      sandbox: {
        findFirst: vi.fn(async () => sandboxRow("creating")),
      },
    } as unknown as PrismaClient;
    const service = new SandboxService(
      prisma,
      {} as EventStore,
      runtime,
      config,
      vi.fn(),
    );

    await expect(
      service.diffForSession("chat_1", "run_1", "s1"),
    ).rejects.toMatchObject({
      code: "workspace_unavailable",
    });
    expect(runtime.diff).not.toHaveBeenCalled();
  });
});

const event = (type: PublicEvent["type"], sequence: number): PublicEvent => ({
  id: `evt_${sequence}`,
  streamId: "chat_1",
  taskId: "run_1",
  sandboxId: "s1",
  commandId: null,
  sequence,
  type,
  producerService: type.startsWith("sandbox") ? "sandbox" : "cleanup",
  producerId: "s1",
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});
