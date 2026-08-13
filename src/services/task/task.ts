import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { loadConfig, type Config } from "../../config";
import { prisma } from "../../db/prisma";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import {
  SandboxService,
  sandboxService,
} from "../sandbox/sandbox";
import { ServiceError, notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import type {
  CreateTaskRequest,
  TaskCancellationResponse,
  CreateTaskResponse,
  TaskExitReason,
  TaskResult,
  TaskServicePort,
  TaskSnapshot,
  PublicTaskEvent,
  TaskStatus,
} from "../../types/task.types";
import type { PublicEvent } from "../../types/event.types";
import {
  PlaceholderTaskRunner,
  type TaskRunner,
} from "./task-runner";

// The task service only needs these internal SandboxService methods. The
// result/cleanup methods are optional for the phase 5 compatibility seam used
// by focused provisioning tests; the production collaborator implements all
// of them.
type TaskSandboxCollaborator = Pick<
  SandboxService,
  "createForTaskInTransaction"
> &
  Partial<Pick<SandboxService, "provisionForTask" | "diff" | "stop">>;
type PublishEvent = (event: PublicEvent) => void;
type TaskServiceConfigOrRunnerOrPublisher =
  | Config
  | TaskRunner
  | PublishEvent;

type TaskFailure = {
  code: string;
  message: string;
};

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ["provisioning", "failed", "cancelled"],
  provisioning: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

/** The single source of truth for legal task lifecycle transitions. */
export const canTransition = (
  from: TaskStatus,
  to: TaskStatus,
): boolean => transitions[from].includes(to);

const taskId = (): string =>
  `task_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const taskFailure = (
  error: unknown,
  fallback: TaskFailure,
): TaskFailure => ({
  code: error instanceof ServiceError ? error.code : fallback.code,
  message: error instanceof ServiceError ? error.message : fallback.message,
});

const isTaskRunner = (value: unknown): value is TaskRunner =>
  typeof value === "object" &&
  value !== null &&
  "run" in value &&
  typeof value.run === "function";

/**
 * Task lifecycle orchestration. The create transaction commits the task and
 * linked sandbox together; the asynchronous flow then provisions, runs the
 * current runner seam, captures a result, and cleans up the sandbox.
 */
export class TaskService implements TaskServicePort {
  private readonly publish: PublishEvent;
  private readonly runner: TaskRunner;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly sandbox: TaskSandboxCollaborator,
    configOrRunnerOrPublisher: TaskServiceConfigOrRunnerOrPublisher,
    runnerOrPublisher?: TaskRunner | PublishEvent,
    publish?: PublishEvent,
  ) {
    // Support the short constructor used by focused tests as well as the
    // explicit (prisma, events, sandbox, config, runner, publish) shape. The
    // config is reserved for later task-run limits; phase 6 needs no values.
    this.runner =
      (isTaskRunner(runnerOrPublisher) && runnerOrPublisher) ||
      (isTaskRunner(configOrRunnerOrPublisher) &&
        configOrRunnerOrPublisher) ||
      new PlaceholderTaskRunner();
    this.publish =
      publish ??
      (typeof runnerOrPublisher === "function"
        ? runnerOrPublisher
        : typeof configOrRunnerOrPublisher === "function"
          ? configOrRunnerOrPublisher
          : () => undefined);
  }

  async create(input: CreateTaskRequest): Promise<CreateTaskResponse> {
    const newTaskId = taskId();

    let result: { sandboxId: string; events: PublicEvent[] };
    try {
      result = await runQuery("create_task", { taskId: newTaskId }, () =>
        this.prisma.$transaction(async (tx) => {
          // Task.sandboxId and Sandbox.taskId form a cycle. Insert the task,
          // create the linked sandbox, then fill in Task.sandboxId before the
          // transaction can become visible.
          await tx.task.create({
            data: {
              id: newTaskId,
              status: "created",
              repoRef: input.repoRef,
              instructions: input.instructions,
              image: input.image ?? null,
              nextEventSequence: 1,
            },
          });

          const sandboxInput = {
            fixtureRepoPath: input.repoRef,
            ...(input.image === undefined ? {} : { image: input.image }),
          };
          const sandbox = await this.sandbox.createForTaskInTransaction(
            tx,
            sandboxInput,
            { taskId: newTaskId },
          );

          await tx.task.update({
            where: { id: newTaskId },
            data: { sandboxId: sandbox.sandboxId },
          });

          // Both initial events are part of the same transaction as both rows.
          const taskCreated = await this.events.appendInTransaction(tx, {
            streamId: newTaskId,
            type: "task_created",
            producerService: "task",
            producerId: newTaskId,
            taskId: newTaskId,
            correlationId: randomUUID(),
            payload: {},
          });
          const sandboxCreated = await this.events.appendInTransaction(tx, {
            streamId: newTaskId,
            type: "sandbox_created",
            producerService: "sandbox",
            producerId: sandbox.sandboxId,
            taskId: newTaskId,
            sandboxId: sandbox.sandboxId,
            correlationId: randomUUID(),
            payload: {
              container_name: sandbox.containerName,
              workspace_path: sandbox.workspacePath,
            },
          });

          return {
            sandboxId: sandbox.sandboxId,
            events: [taskCreated, sandboxCreated],
          };
        }),
      );
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "create_task_failed",
        "Task could not be created",
        500,
      );
    }

    // Publishing is intentionally outside the transaction. Subscribers can
    // only observe events after the database has committed both rows.
    for (const event of result.events) this.publish(event);

    // A task-owned sandbox is never provisioned through an HTTP request. The
    // run starts only after the create transaction has committed and initial
    // events have been published.
    if (this.sandbox.provisionForTask)
      setImmediate(() => {
        void this.runTask(newTaskId, result.sandboxId, input.instructions);
      });

    return {
      taskId: newTaskId,
      status: "created",
      eventsUrl: `/tasks/${newTaskId}/events`,
    };
  }

  async get(taskId: string): Promise<TaskSnapshot> {
    const task = await runQuery("get_task", { taskId }, () =>
      this.prisma.task.findUnique({ where: { id: taskId } }),
    );
    if (!task) throw notFound("task_not_found", "Task was not found");

    return {
      taskId: task.id,
      status: task.status,
      repoRef: task.repoRef,
      instructions: task.instructions,
      eventsUrl: `/tasks/${task.id}/events`,
      resultUrl: `/tasks/${task.id}/result`,
      createdAt: task.createdAt.toISOString(),
      provisioningAt: task.provisioningAt?.toISOString() ?? null,
      runningAt: task.runningAt?.toISOString() ?? null,
      completedAt:
        task.completedAt?.toISOString() ??
        task.failedAt?.toISOString() ??
        task.cancelledAt?.toISOString() ??
        null,
      failure: task.failureCode
        ? {
            code: task.failureCode,
            message: task.failureMessage ?? "Task failed",
          }
        : null,
    };
  }

  async eventsAfter(
    taskId: string,
    after: number,
  ): Promise<PublicTaskEvent[]> {
    const exists = await runQuery("has_task", { taskId }, () =>
      this.prisma.task.count({ where: { id: taskId } }),
    );
    if (exists === 0) throw notFound("task_not_found", "Task was not found");
    return this.events.listTaskEvents(taskId, after);
  }

  async result(taskId: string): Promise<TaskResult> {
    const task = await runQuery("get_task_result", { taskId }, () =>
      this.prisma.task.findUnique({ where: { id: taskId } }),
    );
    if (!task) throw notFound("task_not_found", "Task was not found");
    if (
      task.status !== "completed" &&
      task.status !== "failed" &&
      task.status !== "cancelled"
    )
      throw new ServiceError(
        "task_not_terminal",
        "Task result is not available until the task is terminal",
        409,
      );

    const terminalAt =
      task.completedAt ?? task.failedAt ?? task.cancelledAt;
    if (!terminalAt)
      throw new ServiceError(
        "task_result_unavailable",
        "Task result metadata is incomplete",
        500,
      );

    const storedExitReason = task.exitReason;
    const exitReason: TaskExitReason =
      storedExitReason === "completed" ||
      storedExitReason === "failed" ||
      storedExitReason === "cancelled" ||
      storedExitReason === "timed_out"
        ? storedExitReason
        : task.status === "completed"
          ? "completed"
          : task.status === "cancelled"
            ? "cancelled"
            : "failed";

    return {
      taskId: task.id,
      status: task.status,
      diff: task.diff ?? "",
      agentSummary: task.agentSummary ?? null,
      exitReason,
      failure: task.failureCode
        ? {
            code: task.failureCode,
            message: task.failureMessage ?? "Task failed",
          }
        : null,
      createdAt: task.createdAt.toISOString(),
      completedAt: terminalAt.toISOString(),
    };
  }

  async cancel(_taskId: string): Promise<TaskCancellationResponse> {
    return this.unavailable();
  }

  private async runTask(
    taskId: string,
    sandboxId: string,
    instructions: string,
  ): Promise<void> {
    try {
      await this.startProvisioning(taskId);
      const provision = this.sandbox.provisionForTask;
      if (!provision) return;
      const stop = this.sandbox.stop;

      const outcome = await provision.call(this.sandbox, sandboxId);
      if (outcome?.status === "failed") {
        await this.failTask(taskId, outcome.failure, "provision_task");
        if (stop)
          await stop.call(this.sandbox, sandboxId).catch(() => undefined);
        return;
      }

      // Keep the phase 5 provisioning seam usable with deliberately narrow
      // test doubles. The production SandboxService supplies both methods.
      const diff = this.sandbox.diff;
      if (!diff) return;

      await this.startRunning(taskId);
      const controller = new AbortController();
      const runResult = await this.runner.run({
        taskId,
        sandboxId,
        instructions,
        signal: controller.signal,
      });
      const diffResult = await diff.call(this.sandbox, sandboxId);
      const summary = runResult.summary ?? null;

      await this.completeTask(taskId, diffResult.diff, summary);

      // The task result is durable before cleanup starts. A cleanup failure
      // must not turn an already completed task back into a failed one.
      if (stop)
        await stop.call(this.sandbox, sandboxId).catch(() => undefined);
    } catch (error) {
      // The asynchronous run must not become an unhandled rejection. Any
      // known or unexpected runner/result error is represented as a terminal
      // task failure, and failure persistence is best effort if the database
      // itself is unavailable.
      await this.failTask(
        taskId,
        taskFailure(error, {
          code: "task_run_failed",
          message: "Task run failed",
        }),
        "run_task",
      ).catch(() => undefined);
      const stop = this.sandbox.stop;
      if (stop)
        await stop.call(this.sandbox, sandboxId).catch(() => undefined);
    }
  }

  private async startProvisioning(taskId: string): Promise<void> {
    const event = await runQuery(
      "start_task_provisioning",
      { taskId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const task = await tx.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          if (!task) throw notFound("task_not_found", "Task was not found");
          if (!canTransition(task.status, "provisioning")) {
            throw new ServiceError(
              "invalid_task_transition",
              `Cannot transition task from ${task.status} to provisioning`,
              409,
            );
          }

          const now = new Date();
          await tx.task.update({
            where: { id: taskId },
            data: { status: "provisioning", provisioningAt: now },
          });
          return this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "task_provisioning_started",
            producerService: "task",
            producerId: taskId,
            taskId,
            correlationId: randomUUID(),
            payload: {},
          });
        }),
    );
    this.publish(event);
  }

  private async startRunning(taskId: string): Promise<void> {
    const event = await runQuery(
      "start_task_running",
      { taskId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const task = await tx.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          if (!task) throw notFound("task_not_found", "Task was not found");
          if (!canTransition(task.status, "running")) {
            throw new ServiceError(
              "invalid_task_transition",
              `Cannot transition task from ${task.status} to running`,
              409,
            );
          }

          const now = new Date();
          await tx.task.update({
            where: { id: taskId },
            data: { status: "running", runningAt: now },
          });
          return this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "task_running",
            producerService: "task",
            producerId: taskId,
            taskId,
            correlationId: randomUUID(),
            payload: {},
          });
        }),
    );
    this.publish(event);
  }

  private async completeTask(
    taskId: string,
    diff: string,
    summary: string | null,
  ): Promise<void> {
    const events = await runQuery(
      "complete_task",
      { taskId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const task = await tx.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          if (!task) throw notFound("task_not_found", "Task was not found");
          if (!canTransition(task.status, "completed")) {
            throw new ServiceError(
              "invalid_task_transition",
              `Cannot transition task from ${task.status} to completed`,
              409,
            );
          }

          const completedAt = new Date();
          await tx.task.update({
            where: { id: taskId },
            data: {
              status: "completed",
              diff,
              agentSummary: summary,
              exitReason: "completed",
              completedAt,
            },
          });
          const completed = await this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "task_completed",
            producerService: "task",
            producerId: taskId,
            taskId,
            correlationId: randomUUID(),
            payload: {
              exit_reason: "completed",
              agent_summary_present: summary !== null,
            },
          });
          const resultReady = await this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "task_result_ready",
            producerService: "task",
            producerId: taskId,
            taskId,
            correlationId: randomUUID(),
            payload: {
              exit_reason: "completed",
              diff_bytes: Buffer.byteLength(diff),
              agent_summary_present: summary !== null,
            },
          });
          return [completed, resultReady];
        }),
    );
    for (const event of events) this.publish(event);
  }

  private async failTask(
    taskId: string,
    failure: TaskFailure,
    operation: string,
  ): Promise<void> {
    const events = await runQuery(
      "fail_task",
      { taskId, code: failure.code, operation },
      () =>
        this.prisma.$transaction(async (tx) => {
          const task = await tx.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          if (!task || !canTransition(task.status, "failed")) return [];

          const failedAt = new Date();
          await tx.task.update({
            where: { id: taskId },
            data: {
              status: "failed",
              diff: "",
              agentSummary: null,
              exitReason: "failed",
              failureCode: failure.code,
              failureMessage: failure.message,
              failedAt,
            },
          });
          const failed = await this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "task_failed",
            producerService: "task",
            producerId: taskId,
            taskId,
            correlationId: randomUUID(),
            payload: {
              code: failure.code,
              message: failure.message,
              operation,
              retryable: false,
            },
          });
          const resultReady = await this.events.appendInTransaction(tx, {
            streamId: taskId,
            type: "task_result_ready",
            producerService: "task",
            producerId: taskId,
            taskId,
            correlationId: randomUUID(),
            payload: {
              exit_reason: "failed",
              diff_bytes: 0,
              agent_summary_present: false,
            },
          });
          return [failed, resultReady];
        }),
    );
    for (const event of events) this.publish(event);
  }

  private unavailable(): never {
    throw new ServiceError(
      "task_service_unavailable",
      "Task Service operation is not implemented",
      501,
    );
  }
}

export const taskService = new TaskService(
  prisma,
  new EventStore(prisma),
  sandboxService,
  loadConfig(),
  undefined,
  (event) => sseHub.publish(event),
);
