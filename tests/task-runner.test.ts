import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TaskService } from "../src/services/task/task";
import {
  PlaceholderTaskRunner,
  type TaskRunContext,
  type TaskRunner,
} from "../src/services/task/task-runner";
import type { EventStore } from "../src/services/events/event-store";
import type { SandboxService } from "../src/services/sandbox/sandbox";
import type { PublicEvent } from "../src/types/event.types";
import type { CreateTaskRequest } from "../src/types/task.types";

const input: CreateTaskRequest = {
  repoRef: "./repo",
  instructions: "Update the greeting",
};

const makeTaskEvent = (
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

describe("PlaceholderTaskRunner", () => {
  it("does no agent work and returns a null summary", async () => {
    const context: TaskRunContext = {
      taskId: "task_1",
      sandboxId: "sbox_1",
      instructions: "No-op",
      signal: new AbortController().signal,
    };

    await expect(new PlaceholderTaskRunner().run(context)).resolves.toEqual({
      summary: null,
    });
  });
});

describe("TaskService result capture", () => {
  it("returns the persisted terminal result", async () => {
    const completedAt = new Date("2026-01-01T00:00:05.000Z");
    const service = new TaskService(
      {
        task: {
          findUnique: vi.fn(async () => ({
            id: "task_1",
            status: "completed",
            repoRef: "./repo",
            instructions: "No-op",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: completedAt,
            provisioningAt: null,
            runningAt: new Date("2026-01-01T00:00:01.000Z"),
            completedAt,
            failedAt: null,
            cancelledAt: null,
            diff: "diff",
            agentSummary: null,
            exitReason: "completed",
            failureCode: null,
            failureMessage: null,
          })),
        },
      } as unknown as PrismaClient,
      {} as EventStore,
      {} as SandboxService,
      vi.fn(),
    );

    await expect(service.result("task_1")).resolves.toEqual({
      taskId: "task_1",
      status: "completed",
      diff: "diff",
      agentSummary: null,
      exitReason: "completed",
      failure: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
    });
  });

  it("runs the placeholder seam, captures the diff, completes, and stops the sandbox", async () => {
    let status: "created" | "provisioning" | "running" | "completed" =
      "created";
    let sequence = 1;
    let committed = false;
    const taskId = "task_1";
    const sandboxId = "sbox_1";
    const tx = {
      task: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (
            data.status === "provisioning" ||
            data.status === "running" ||
            data.status === "completed"
          )
            status = data.status;
          return data;
        }),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (
            data.status === "provisioning" ||
            data.status === "running" ||
            data.status === "completed"
          )
            status = data.status;
          return { count: 1 };
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
        sandboxId,
        status: "creating" as const,
        containerName: "sandbox-sbox_1",
        image: "node:22",
        workspacePath: "/workspace/repo",
        fixtureRepoPath: "./repo",
      })),
      provisionForTask: vi.fn(async () => {
        expect(committed).toBe(true);
        return { status: "ready" as const };
      }),
      diff: vi.fn(async () => ({
        sandboxId,
        diff: "diff --git a/hello.txt b/hello.txt\n",
        generatedAt: "2026-01-01T00:00:01.000Z",
      })),
      stop: vi.fn(async () => undefined),
    };
    const runner: TaskRunner = {
      run: vi.fn(async (context: TaskRunContext) => {
        expect(context).toMatchObject({
          taskId: expect.stringMatching(/^task_/),
          sandboxId,
          instructions: input.instructions,
        });
        expect(context.signal).toBeInstanceOf(AbortSignal);
        return { summary: null };
      }),
    };
    const events = {
      appendInTransaction: vi.fn(
        async (
          _transaction: unknown,
          event: { type: PublicEvent["type"]; sandboxId?: string | null },
        ) =>
          makeTaskEvent(
            event.type,
            sequence++,
            taskId,
            event.sandboxId ?? null,
          ),
      ),
    };
    const publish = vi.fn();
    const service = new TaskService(
      prisma,
      events as unknown as EventStore,
      sandbox as unknown as SandboxService,
      runner,
      publish,
    );

    await service.create(input);
    await vi.waitFor(() => expect(sandbox.stop).toHaveBeenCalledWith(sandboxId));

    expect(status).toBe("completed");
    expect(sandbox.diff).toHaveBeenCalledWith(sandboxId);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(events.appendInTransaction.mock.calls.map((call) => call[1].type)).toEqual([
      "task_created",
      "sandbox_created",
      "task_provisioning_started",
      "task_running",
      "task_completed",
      "task_result_ready",
    ]);
    expect(publish.mock.calls.map(([event]) => event.type)).toEqual([
      "task_created",
      "sandbox_created",
      "task_provisioning_started",
      "task_running",
      "task_completed",
      "task_result_ready",
    ]);
  });
});
