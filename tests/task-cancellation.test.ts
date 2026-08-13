import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TaskService } from "../src/services/task/task";
import type { EventStore } from "../src/services/events/event-store";
import type { SandboxService } from "../src/services/sandbox/sandbox";
import type { PublicEvent } from "../src/types/event.types";
import type {
  CreateTaskRequest,
  TaskStatus,
} from "../src/types/task.types";
import type { TaskRunContext, TaskRunner } from "../src/services/task/task-runner";

const input: CreateTaskRequest = {
  repoRef: "./repo",
  instructions: "Cancel this task",
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

type CancellationHarness = {
  service: TaskService;
  status: { value: TaskStatus };
  runner: TaskRunner;
  stop: ReturnType<typeof vi.fn>;
  events: ReturnType<typeof vi.fn>;
};

const makeHarness = (runner: TaskRunner): CancellationHarness => {
  const status = { value: "created" as TaskStatus };
  let taskId = "task_unknown";
  let sequence = 1;
  const tx = {
    task: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        taskId = String(data.id);
        return data;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.status === "string") status.value = data.status as TaskStatus;
        return data;
      }),
      findUnique: vi.fn(async () => ({ status: status.value })),
    },
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    task: {
      findUnique: vi.fn(async () => ({
        status: status.value,
        sandboxId: "sbox_1",
      })),
    },
    $transaction: vi.fn(
      async (callback: (transaction: Prisma.TransactionClient) => unknown) =>
        callback(tx),
    ),
  } as unknown as PrismaClient;
  const stop = vi.fn(async () => undefined);
  const sandbox = {
    createForTaskInTransaction: vi.fn(async () => ({
      sandboxId: "sbox_1",
      status: "creating" as const,
      containerName: "sandbox-sbox_1",
      image: "node:22",
      workspacePath: "/workspace/repo",
      fixtureRepoPath: "./repo",
    })),
    provisionForTask: vi.fn(async () => ({ status: "ready" as const })),
    diff: vi.fn(async () => ({
      sandboxId: "sbox_1",
      diff: "diff",
      generatedAt: "2026-01-01T00:00:00.000Z",
    })),
    stop,
  };
  const events = vi.fn(
    async (
      _transaction: unknown,
      event: { type: PublicEvent["type"]; sandboxId?: string | null },
    ) => makeEvent(event.type, sequence++, taskId, event.sandboxId ?? null),
  );
  const service = new TaskService(
    prisma,
    { appendInTransaction: events } as unknown as EventStore,
    sandbox as unknown as SandboxService,
    runner,
    vi.fn(),
  );

  return { service, status, runner, stop, events };
};

describe("TaskService cancellation", () => {
  it("cancels a running runner through its AbortSignal and persists the result", async () => {
    let context: TaskRunContext | undefined;
    const runner: TaskRunner = {
      run: vi.fn(
        (nextContext: TaskRunContext) =>
          new Promise((resolve) => {
            context = nextContext;
            nextContext.signal.addEventListener(
              "abort",
              () => resolve({ summary: null }),
              { once: true },
            );
          }),
      ),
    };
    const harness = makeHarness(runner);
    const created = await harness.service.create(input);

    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(1));
    await expect(harness.service.cancel(created.taskId)).resolves.toEqual({
      taskId: created.taskId,
      status: "cancelling",
      eventsUrl: `/tasks/${created.taskId}/events`,
    });
    await vi.waitFor(() => expect(harness.status.value).toBe("cancelled"));

    expect(context?.signal.aborted).toBe(true);
    expect(harness.stop).toHaveBeenCalledWith("sbox_1");
    expect(harness.events.mock.calls.map((call) => call[1].type)).toContain(
      "task_cancelled",
    );
    expect(harness.events.mock.calls.map((call) => call[1].type)).toContain(
      "task_result_ready",
    );

    await expect(harness.service.cancel(created.taskId)).resolves.toEqual({
      taskId: created.taskId,
      status: "cancelled",
    });
  });

  it("cancels before provisioning starts without invoking the runner", async () => {
    const runner: TaskRunner = {
      run: vi.fn(async () => ({ summary: null })),
    };
    const harness = makeHarness(runner);
    const created = await harness.service.create(input);

    await expect(harness.service.cancel(created.taskId)).resolves.toMatchObject({
      status: "cancelling",
    });
    await vi.waitFor(() => expect(harness.status.value).toBe("cancelled"));

    expect(runner.run).not.toHaveBeenCalled();
  });

  it("rejects cancellation after a task reaches an unchangeable terminal state", async () => {
    const prisma = {
      task: {
        findUnique: vi.fn(async () => ({ status: "completed", sandboxId: "sbox_1" })),
      },
    } as unknown as PrismaClient;
    const service = new TaskService(
      prisma,
      {} as EventStore,
      {} as SandboxService,
      vi.fn(),
    );

    await expect(service.cancel("task_1")).rejects.toMatchObject({
      code: "task_already_terminal",
      status: 409,
    });
  });
});
