import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../src/config";
import type { EventStore } from "../src/services/sandbox/event-store";
import { ServiceError } from "../src/shared/errors";
import { SandboxService, canTransition } from "../src/services/sandbox/sandbox";
import type { SandboxRuntime } from "../src/services/sandbox/runtime";
import type { PublicEvent } from "../src/types/sandbox.types";

const config = {
  FIXTURE_REPO_PATH: "./repo",
  SANDBOX_IMAGE: "node:22",
  SANDBOX_STOP_GRACE_MS: 1000,
} as Config;

const event = (type: string, sequence: number): PublicEvent => ({
  id: `e${sequence}`,
  sandboxId: "s1",
  commandId: null,
  sequence,
  type: type as PublicEvent["type"],
  actor: "api",
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("SandboxService", () => {
  it("allows only documented sandbox status transitions", () => {
    expect(canTransition("creating", "ready")).toBe(true);
    expect(canTransition("ready", "creating")).toBe(false);
  });

  it("publishes creation only after the transaction commits and starts provisioning", async () => {
    const publish = vi.fn();
    const runtime = {
      provision: vi.fn(
        () => new Promise<{ containerId: string }>(() => undefined),
      ),
    } as unknown as SandboxRuntime;
    const events = {
      appendInTransaction: vi.fn(async () => event("sandbox_created", 1)),
      append: vi.fn(),
      listAfter: vi.fn(),
    } as unknown as EventStore;
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback({
          sandbox: {
            create: vi.fn(async ({ data }) => ({
              ...data,
              createdAt: new Date("2026-01-01T00:00:00Z"),
            })),
          },
        }),
      ),
    } as unknown as PrismaClient;
    const service = new SandboxService(prisma, events, runtime, config, publish);

    const result = await service.create({});

    expect(result.status).toBe("creating");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sandbox_created" }),
    );
    await vi.waitFor(() => expect(runtime.provision).toHaveBeenCalled());
  });

  it("is idempotent when stopping an already stopped sandbox", async () => {
    const stoppedAt = new Date("2026-01-01T00:00:00Z");
    const runtime = { stop: vi.fn() } as unknown as SandboxRuntime;
    const prisma = {
      sandbox: {
        findUnique: vi.fn(async () => ({
          id: "s1",
          status: "stopped",
          containerName: "agent-sandbox-s1",
          workspacePath: "/workspace/repo",
          createdAt: stoppedAt,
          readyAt: stoppedAt,
          stoppedAt,
          failureCode: null,
          failureMessage: null,
        })),
      },
    } as unknown as PrismaClient;
    const service = new SandboxService(
      prisma,
      {} as EventStore,
      runtime,
      config,
      vi.fn(),
    );

    await expect(service.stop("s1")).resolves.toEqual(
      expect.objectContaining({ status: "stopped" }),
    );
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("rejects diff before the workspace is available", async () => {
    const runtime = { diff: vi.fn() } as unknown as SandboxRuntime;
    const prisma = {
      sandbox: {
        findUnique: vi.fn(async () => ({
          id: "s1",
          status: "creating",
          containerName: "agent-sandbox-s1",
        })),
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
