import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TaskService } from "../src/services/task/task";
import type { EventStore } from "../src/services/events/event-store";
import type { SandboxService } from "../src/services/sandbox/sandbox";
import type { CreateTaskRequest } from "../src/types/task.types";
import type { PublicEvent } from "../src/types/event.types";

const input: CreateTaskRequest = {
  repoRef: "./repo",
  instructions: "No-op",
  image: "node:22",
};

const makeEvent = (
  type: PublicEvent["type"],
  sequence: number,
  taskId: string,
  sandboxId: string | null,
): PublicEvent => ({
  id: `evt_${sequence}`,
  streamId: taskId,
  taskId,
  sandboxId,
  commandId: null,
  sequence,
  type,
  producerService: sandboxId ? "sandbox" : "task",
  producerId: sandboxId ?? taskId,
  correlationId: null,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("TaskService provisioning", () => {
  it("marks a created task provisioning and invokes the sandbox in-process after commit", async () => {
    let status = "created";
    let committed = false;
    const tx = {
      task: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (typeof data.status === "string") status = data.status;
          return data;
        }),
        findUnique: vi.fn(async () => ({ status })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => {
        const result = await callback(tx);
        committed = true;
        return result;
      }),
    } as unknown as PrismaClient;
    const sandbox = {
      createForTaskInTransaction: vi.fn(async () => ({
        sandboxId: "sbox_1",
        status: "creating" as const,
        containerName: "sandbox-sbox_1",
        image: "node:22",
        workspacePath: "/workspace/repo",
        fixtureRepoPath: "./repo",
      })),
      provisionForTask: vi.fn(async () => {
        expect(committed).toBe(true);
        expect(status).toBe("provisioning");
        return { status: "ready" as const };
      }),
    };
    const events = {
      appendInTransaction: vi.fn(async (_transaction: unknown, input: { type: PublicEvent["type"] }) =>
        makeEvent(input.type, 1, "task_1", null),
      ),
    };
    const publish = vi.fn();
    const service = new TaskService(
      prisma,
      events as unknown as EventStore,
      sandbox as unknown as SandboxService,
      publish,
    );

    const response = await service.create(input);
    await vi.waitFor(() => expect(sandbox.provisionForTask).toHaveBeenCalledWith("sbox_1"));

    expect(response.status).toBe("created");
    expect(status).toBe("provisioning");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task_provisioning_started" }),
    );
  });

  it("fails the task when in-process sandbox provisioning fails", async () => {
    let status = "created";
    const tx = {
      task: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (typeof data.status === "string") status = data.status;
          return data;
        }),
        findUnique: vi.fn(async () => ({ status })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
    } as unknown as PrismaClient;
    const sandbox = {
      createForTaskInTransaction: vi.fn(async () => ({
        sandboxId: "sbox_1",
        status: "creating" as const,
        containerName: "sandbox-sbox_1",
        image: "node:22",
        workspacePath: "/workspace/repo",
        fixtureRepoPath: "./repo",
      })),
      provisionForTask: vi.fn(async () => ({
        status: "failed" as const,
        failure: { code: "fixture_missing", message: "Local fixture repo was not found" },
      })),
    };
    const events = {
      appendInTransaction: vi.fn(async (_transaction: unknown, input: { type: PublicEvent["type"] }) =>
        makeEvent(input.type, 1, "task_1", null),
      ),
    };
    const publish = vi.fn();
    const service = new TaskService(
      prisma,
      events as unknown as EventStore,
      sandbox as unknown as SandboxService,
      publish,
    );

    await service.create(input);
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "task_result_ready" }),
      ),
    );

    expect(status).toBe("failed");
    expect(events.appendInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: "task_failed",
        payload: expect.objectContaining({ code: "fixture_missing" }),
      }),
    );
  });
});

describe("TaskService create", () => {
  it("creates and links one sandbox in the same transaction", async () => {
    const calls: string[] = [];
    let committed = false;
    const tx = {
      task: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          calls.push("task.create");
          return data;
        }),
        update: vi.fn(async () => {
          calls.push("task.update");
          return {};
        }),
      },
    };
    const sandbox = {
      createForTaskInTransaction: vi.fn(
        async (
          _transaction: unknown,
          sandboxInput: { fixtureRepoPath?: string; image?: string },
          options: { taskId: string },
        ) => {
          calls.push("sandbox.create");
          expect(sandboxInput).toEqual({
            fixtureRepoPath: "./repo",
            image: "node:22",
          });
          return {
            sandboxId: "sbox_1",
            status: "creating" as const,
            containerName: "sandbox-sbox_1",
            image: "node:22",
            workspacePath: "/workspace/repo",
            fixtureRepoPath: "./repo",
            taskId: options.taskId,
          };
        },
      ),
    };
    const events = {
      appendInTransaction: vi.fn(
        async (
          _transaction: unknown,
          event: {
            type: PublicEvent["type"];
            taskId?: string;
            sandboxId?: string;
          },
        ) => {
          calls.push(`event:${event.type}`);
          return makeEvent(
            event.type,
            event.type === "task_created" ? 1 : 2,
            event.taskId ?? "task_1",
            event.sandboxId ?? null,
          );
        },
      ),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => {
        const result = await callback(tx);
        committed = true;
        return result;
      }),
    } as unknown as PrismaClient;
    const publish = vi.fn((event: PublicEvent) => {
      expect(committed).toBe(true);
      expect(event.sequence).toBeGreaterThan(0);
    });
    const service = new TaskService(
      prisma,
      events as unknown as EventStore,
      sandbox as unknown as SandboxService,
      publish,
    );

    const response = await service.create(input);

    expect(response).toMatchObject({
      status: "created",
      eventsUrl: `/tasks/${response.taskId}/events`,
    });
    expect(response.taskId).toMatch(/^task_/);
    expect(calls).toEqual([
      "task.create",
      "sandbox.create",
      "task.update",
      "event:task_created",
      "event:sandbox_created",
    ]);
    expect(events.appendInTransaction).toHaveBeenNthCalledWith(
      1,
      tx,
      expect.objectContaining({
        streamId: response.taskId,
        taskId: response.taskId,
        producerService: "task",
        producerId: response.taskId,
      }),
    );
    expect(events.appendInTransaction).toHaveBeenNthCalledWith(
      2,
      tx,
      expect.objectContaining({
        streamId: response.taskId,
        taskId: response.taskId,
        sandboxId: "sbox_1",
        producerService: "sandbox",
        producerId: "sbox_1",
      }),
    );
    expect(publish).toHaveBeenCalledTimes(2);
    expect(response).not.toHaveProperty("sandboxId");
  });

  it("does not publish events when the creation transaction fails", async () => {
    const prisma = {
      $transaction: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    } as unknown as PrismaClient;
    const publish = vi.fn();
    const service = new TaskService(
      prisma,
      {} as EventStore,
      {} as SandboxService,
      publish,
    );

    await expect(service.create(input)).rejects.toMatchObject({
      code: "create_task_failed",
      status: 500,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
