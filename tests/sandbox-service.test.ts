import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Config } from "../src/config";
import type { EventStore } from "../src/services/events/event-store";
import { ServiceError } from "../src/shared/errors";
import { SandboxService, canTransition } from "../src/services/sandbox/sandbox";
import type { SandboxRuntime } from "../src/services/sandbox/runtime";
import type { PublicEvent } from "../src/types/event.types";

const config = {
  FIXTURE_REPO_PATH: "./repo",
  SANDBOX_IMAGE: "node:22",
  SANDBOX_STOP_GRACE_MS: 1000,
} as Config;

const event = (type: PublicEvent["type"], sequence: number): PublicEvent => ({
  id: `evt_${sequence}`,
  streamId: "task_1",
  taskId: "task_1",
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

const sandboxRow = (status: "creating" | "ready" | "stopped" = "creating") => ({
  id: "s1",
  taskId: "task_1",
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

  it("creates only task-owned sandbox rows in the caller transaction", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }));
    const service = new SandboxService(
      {} as PrismaClient,
      {} as EventStore,
      {} as SandboxRuntime,
      config,
      vi.fn(),
    );

    const result = await service.createForTaskInTransaction(
      { sandbox: { create } } as unknown as Prisma.TransactionClient,
      { fixtureRepoPath: "./repo", image: "node:22" },
      { taskId: "task_1" },
    );

    expect(result.status).toBe("creating");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: "task_1", status: "creating" }),
    });
  });

  it("publishes provision events as task-stream events", async () => {
    const publish = vi.fn();
    let sequence = 1;
    const runtime = {
      provision: vi.fn(async () => ({ containerId: "container-1" })),
    } as unknown as SandboxRuntime;
    const events = {
      append: vi.fn(async (input: { type: PublicEvent["type"] }) =>
        event(input.type, sequence++),
      ),
      appendInTransaction: vi.fn(
        async (_tx: unknown, input: { type: PublicEvent["type"] }) =>
          event(input.type, sequence++),
      ),
    } as unknown as EventStore;
    const prisma = {
      sandbox: {
        findUnique: vi.fn(async () => sandboxRow()),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          sandbox: {
            update: vi.fn(async () => sandboxRow("ready")),
          },
        }),
      ),
    } as unknown as PrismaClient;
    const service = new SandboxService(prisma, events, runtime, config, publish);

    await expect(service.provisionForTask("s1")).resolves.toEqual({
      status: "ready",
    });
    expect(runtime.provision).toHaveBeenCalledWith(
      "s1",
      "sandbox-s1",
      "node:22",
      "./repo",
    );
    expect(publish.mock.calls.map(([next]) => next.taskId)).toEqual([
      "task_1",
      "task_1",
      "task_1",
      "task_1",
    ]);
  });

  it("is idempotent when stopping an already stopped task sandbox", async () => {
    const runtime = { stop: vi.fn() } as unknown as SandboxRuntime;
    const prisma = {
      sandbox: {
        findUnique: vi.fn(async () => sandboxRow("stopped")),
      },
    } as unknown as PrismaClient;
    const service = new SandboxService(
      prisma,
      {} as EventStore,
      runtime,
      config,
      vi.fn(),
    );

    await expect(service.stop("s1")).resolves.toBeUndefined();
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("rejects diff before the task workspace is available", async () => {
    const runtime = { diff: vi.fn() } as unknown as SandboxRuntime;
    const prisma = {
      sandbox: {
        findUnique: vi.fn(async () => sandboxRow()),
      },
    } as unknown as PrismaClient;
    const service = new SandboxService(
      prisma,
      {} as EventStore,
      runtime,
      config,
      vi.fn(),
    );

    await expect(service.diff("s1")).rejects.toMatchObject({
      code: "workspace_unavailable",
    } satisfies Partial<ServiceError>);
    expect(runtime.diff).not.toHaveBeenCalled();
  });
});
