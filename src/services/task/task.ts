import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { loadConfig, type Config } from "../../config";
import { prisma } from "../../db/prisma";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import { SandboxService, sandboxService } from "../sandbox/sandbox";
import { ServiceError, notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
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
import { AgentRunner } from "../agent/agent-runner";
import { resolveAgentModel } from "../agent/model";
import { PlaceholderTaskRunner, type TaskRunner } from "./task-runner";

type TaskSandboxCollaborator = Pick<
  SandboxService,
  "createForTaskInTransaction"
> &
  Partial<Pick<SandboxService, "provisionForTask" | "diff" | "stop">>;
type PublishEvent = (event: PublicEvent) => void;
type TaskServiceConfigOrRunnerOrPublisher = Config | TaskRunner | PublishEvent;

type TaskFailure = {
  code: string;
  message: string;
};

type TaskExecution = {
  taskId: string;
  sandboxId: string;
  instructions: string;
  controller: AbortController;
  cancellationRequested: boolean;
  runPromise: Promise<void> | undefined;
  runFinished: boolean;
  cancellationPromise: Promise<void> | undefined;
  cancellationCompleted: boolean;
};

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ["provisioning", "failed", "cancelled"],
  provisioning: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const canTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  transitions[from].includes(to);

const taskId = (): string =>
  `task_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const taskFailure = (error: unknown, fallback: TaskFailure): TaskFailure => ({
  code: error instanceof ServiceError ? error.code : fallback.code,
  message: error instanceof ServiceError ? error.message : fallback.message,
});

const isTaskRunner = (value: unknown): value is TaskRunner =>
  typeof value === "object" &&
  value !== null &&
  "run" in value &&
  typeof value.run === "function";

export class TaskService implements TaskServicePort {
  private readonly publish: PublishEvent;
  private readonly runner: TaskRunner;
  private readonly executions = new Map<string, TaskExecution>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly sandbox: TaskSandboxCollaborator,
    configOrRunnerOrPublisher: TaskServiceConfigOrRunnerOrPublisher,
    runnerOrPublisher?: TaskRunner | PublishEvent,
    publish?: PublishEvent,
  ) {
    this.runner =
      (isTaskRunner(runnerOrPublisher) && runnerOrPublisher) ||
      (isTaskRunner(configOrRunnerOrPublisher) && configOrRunnerOrPublisher) ||
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
    if (this.sandbox.provisionForTask) {
      const execution: TaskExecution = {
        taskId: newTaskId,
        sandboxId: result.sandboxId,
        instructions: input.instructions,
        controller: new AbortController(),
        cancellationRequested: false,
        runPromise: undefined,
        runFinished: false,
        cancellationPromise: undefined,
        cancellationCompleted: false,
      };
      this.executions.set(newTaskId, execution);
      setImmediate(() => {
        const runPromise = this.runTask(execution);
        execution.runPromise = runPromise;
        void runPromise;
      });
    }

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

  async eventsAfter(taskId: string, after: number): Promise<PublicTaskEvent[]> {
    return this.events.listTaskEventsAfter(taskId, after);
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

    const terminalAt = task.completedAt ?? task.failedAt ?? task.cancelledAt;
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

  async cancel(taskId: string): Promise<TaskCancellationResponse> {
    const task = await runQuery("get_task_for_cancellation", { taskId }, () =>
      this.prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true, sandboxId: true },
      }),
    );
    if (!task) throw notFound("task_not_found", "Task was not found");

    if (task.status === "cancelled") return { taskId, status: "cancelled" };
    if (task.status === "completed" || task.status === "failed")
      throw new ServiceError(
        "task_already_terminal",
        "Task is already terminal and cannot be cancelled",
        409,
      );

    const execution = this.executions.get(taskId);
    if (execution) {
      execution.cancellationRequested = true;
      execution.controller.abort();
      void this.waitForCancellation(execution);
    } else {
      // This covers an active task loaded after an in-process execution was
      // lost (for example, a test double or a process hand-off). Cancellation
      // remains best effort in this phase, but the task still gets a terminal
      // result instead of dangling in an active state.
      const recovered: TaskExecution = {
        taskId,
        sandboxId: task.sandboxId ?? "",
        instructions: "",
        controller: new AbortController(),
        cancellationRequested: true,
        runPromise: undefined,
        runFinished: true,
        cancellationPromise: undefined,
        cancellationCompleted: false,
      };
      recovered.controller.abort();
      this.executions.set(taskId, recovered);
      void this.waitForCancellation(recovered);
    }

    return {
      taskId,
      status: "cancelling",
      eventsUrl: `/tasks/${taskId}/events`,
    };
  }

  private startCancellation(execution: TaskExecution): Promise<void> {
    if (execution.cancellationPromise === undefined) {
      const cancellation = this.cancelExecution(execution).catch(
        (error: unknown) => {
          execution.cancellationPromise = undefined;
          logger.error("task_cancellation_failed", {
            taskId: execution.taskId,
            error: error instanceof Error ? error.message : error,
          });
          throw error;
        },
      );
      execution.cancellationPromise = cancellation;
    }
    return execution.cancellationPromise;
  }

  private async waitForCancellation(
    execution: TaskExecution,
  ): Promise<boolean> {
    if (!execution.cancellationRequested) return false;
    try {
      await this.startCancellation(execution);
    } catch {
      // The failure is logged by startCancellation. Keep the execution entry so
      // a later cancel request can retry the persistence step.
    }
    return true;
  }

  private async runTask(execution: TaskExecution): Promise<void> {
    const { taskId, sandboxId, instructions } = execution;
    try {
      if (await this.waitForCancellation(execution)) return;

      if (!(await this.startProvisioning(taskId))) {
        await this.stopSandbox(sandboxId);
        return;
      }
      if (await this.waitForCancellation(execution)) return;

      const provision = this.sandbox.provisionForTask;
      if (!provision) return;
      const outcome = await provision.call(this.sandbox, sandboxId);
      if (await this.waitForCancellation(execution)) return;
      if (outcome?.status === "failed") {
        await this.failTask(taskId, outcome.failure, "provision_task");
        await this.stopSandbox(sandboxId);
        return;
      }

      // Keep the phase 5 provisioning seam usable with deliberately narrow
      // test doubles. The production SandboxService supplies both methods.
      if (!this.sandbox.diff) return;

      if (!(await this.startRunning(taskId))) {
        await this.stopSandbox(sandboxId);
        return;
      }
      if (await this.waitForCancellation(execution)) return;

      const runResult = await this.runner.run({
        taskId,
        sandboxId,
        instructions,
        signal: execution.controller.signal,
      });
      if (await this.waitForCancellation(execution)) return;

      const diffResult = await this.sandbox.diff.call(this.sandbox, sandboxId);
      if (await this.waitForCancellation(execution)) return;
      const summary = runResult.summary ?? null;

      if (!(await this.completeTask(taskId, diffResult.diff, summary))) {
        await this.stopSandbox(sandboxId);
        return;
      }

      // The task result is durable before cleanup starts. A cleanup failure
      // must not turn an already completed task back into a failed one.
      await this.stopSandbox(sandboxId);
    } catch (error) {
      if (await this.waitForCancellation(execution)) return;

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
      await this.stopSandbox(sandboxId);
    } finally {
      execution.runFinished = true;
      if (
        this.executions.get(taskId) === execution &&
        (!execution.cancellationRequested || execution.cancellationCompleted)
      )
        this.executions.delete(taskId);
    }
  }

  private async cancelExecution(execution: TaskExecution): Promise<void> {
    let completed = false;
    try {
      let diff = "";

      // Capture before stopping: SandboxService.diff can still read a ready or
      // stopping workspace, while cleanup may remove the container entirely.
      if (execution.sandboxId && this.sandbox.diff) {
        try {
          diff = (
            await this.sandbox.diff.call(this.sandbox, execution.sandboxId)
          ).diff;
        } catch {
          // A sandbox that is still being provisioned or has already died has
          // no readable workspace. The cancellation result remains authoritative
          // with an empty diff in that case.
        }
      }

      await this.stopSandbox(execution.sandboxId);
      await this.cancelTask(execution.taskId, diff);
      execution.cancellationCompleted = true;
      completed = true;
    } finally {
      // A recovered cancellation has no runTask finally block to remove its
      // registry entry. Normal executions remove themselves from runTask.
      if (
        completed &&
        (execution.runPromise === undefined || execution.runFinished) &&
        this.executions.get(execution.taskId) === execution
      )
        this.executions.delete(execution.taskId);
    }
  }

  private async cancelTask(taskId: string, diff: string): Promise<void> {
    const events = await runQuery("cancel_task", { taskId }, () =>
      this.prisma.$transaction(async (tx) => {
        const cancelledAt = new Date();
        const claimed = await tx.task.updateMany({
          where: {
            id: taskId,
            status: { in: ["created", "provisioning", "running"] },
          },
          data: {
            status: "cancelled",
            diff,
            agentSummary: null,
            exitReason: "cancelled",
            cancelledAt,
          },
        });
        if (claimed.count === 0) return [];
        const cancelled = await this.events.appendInTransaction(tx, {
          streamId: taskId,
          type: "task_cancelled",
          producerService: "task",
          producerId: taskId,
          taskId,
          correlationId: randomUUID(),
          payload: {
            exit_reason: "cancelled",
            operation: "cancel_task",
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
            exit_reason: "cancelled",
            diff_bytes: Buffer.byteLength(diff),
            agent_summary_present: false,
          },
        });
        return [cancelled, resultReady];
      }),
    );
    for (const event of events) this.publish(event);
  }

  private async stopSandbox(sandboxId: string): Promise<void> {
    if (!sandboxId || !this.sandbox.stop) return;
    try {
      await this.sandbox.stop.call(this.sandbox, sandboxId);
    } catch {
      // Cleanup is best effort; task cancellation/result persistence is
      // authoritative even when the container is already gone.
    }
  }

  private async startProvisioning(taskId: string): Promise<boolean> {
    const event = await runQuery("start_task_provisioning", { taskId }, () =>
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
        const claimed = await tx.task.updateMany({
          where: { id: taskId, status: task.status },
          data: { status: "provisioning", provisioningAt: now },
        });
        if (claimed.count === 0) return null;
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
    if (!event) return false;
    this.publish(event);
    return true;
  }

  private async startRunning(taskId: string): Promise<boolean> {
    const event = await runQuery("start_task_running", { taskId }, () =>
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
        const claimed = await tx.task.updateMany({
          where: { id: taskId, status: task.status },
          data: { status: "running", runningAt: now },
        });
        if (claimed.count === 0) return null;
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
    if (!event) return false;
    this.publish(event);
    return true;
  }

  private async completeTask(
    taskId: string,
    diff: string,
    summary: string | null,
  ): Promise<boolean> {
    const events = await runQuery("complete_task", { taskId }, () =>
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
        const claimed = await tx.task.updateMany({
          where: { id: taskId, status: task.status },
          data: {
            status: "completed",
            diff,
            agentSummary: summary,
            exitReason: "completed",
            completedAt,
          },
        });
        if (claimed.count === 0) return [];
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
    return events.length > 0;
  }

  private async failTask(
    taskId: string,
    failure: TaskFailure,
    operation: string,
  ): Promise<boolean> {
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
          const claimed = await tx.task.updateMany({
            where: { id: taskId, status: task.status },
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
          if (claimed.count === 0) return [];
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
    return events.length > 0;
  }
}

const taskServiceConfig = loadConfig();
const taskServiceEvents = new EventStore(prisma);
const publishTaskEvent = (event: PublicEvent): void => sseHub.publish(event);
const taskServiceRunner: TaskRunner =
  taskServiceConfig.NODE_ENV === "test"
    ? new PlaceholderTaskRunner()
    : new AgentRunner({
        config: taskServiceConfig,
        sandbox: sandboxService,
        events: taskServiceEvents,
        model: resolveAgentModel(taskServiceConfig),
        publish: publishTaskEvent,
      });

export const taskService = new TaskService(
  prisma,
  taskServiceEvents,
  sandboxService,
  taskServiceConfig,
  taskServiceRunner,
  publishTaskEvent,
);
