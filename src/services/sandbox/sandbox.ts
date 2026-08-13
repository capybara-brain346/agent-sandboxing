import { randomUUID } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  SandboxEventActor,
  SandboxStatus,
} from "@prisma/client";
import type { Config } from "../../config";
import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import type {
  CommandRequest,
  CreateSandboxRequest,
  CreateSandboxResponse,
  DiffResponse,
  EventType,
  StartCommandResponse,
} from "../../types/sandbox.types";
import type { StreamEvent } from "../../types/event.types";
import { ServiceError, notFound } from "../../shared/errors";
import { logQueryFailure, runQuery } from "../../shared/query-logging";
import { workspaceRoot } from "./workspace";
import { CommandExecutionService } from "./command-execution";
import { EventStore } from "../events/event-store";
import { SandboxRuntime } from "./runtime";
import { sseHub } from "../events/sse-hub";

const transitions: Record<SandboxStatus, readonly SandboxStatus[]> = {
  creating: ["ready", "failed", "stopping"],
  ready: ["stopping", "failed"],
  stopping: ["stopped", "failed"],
  stopped: ["deleted"],
  failed: ["deleted"],
  deleted: [],
};

export const canTransition = (
  from: SandboxStatus,
  to: SandboxStatus,
): boolean => transitions[from].includes(to);

const safeError = (
  error: unknown,
  operation: string,
): {
  code: string;
  message: string;
  operation: string;
  retryable: boolean;
} => ({
  code: error instanceof ServiceError ? error.code : "unknown",
  message:
    error instanceof ServiceError
      ? error.message
      : "Sandbox runtime operation failed",
  operation,
  retryable: false,
});

export type TaskSandboxCreation = {
  sandboxId: string;
  status: "creating";
  containerName: string;
  image: string;
  workspacePath: string;
  fixtureRepoPath: string;
};

export type SandboxProvisionResult =
  | { status: "ready" }
  | { status: "failed"; failure: { code: string; message: string } };

export class SandboxService {
  private readonly commands: CommandExecutionService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly runtime: SandboxRuntime,
    private readonly config: Config,
    private readonly publish: (event: StreamEvent) => void,
  ) {
    this.commands = new CommandExecutionService(
      prisma,
      events,
      runtime,
      config,
      publish,
    );
  }

  async create(input: CreateSandboxRequest): Promise<CreateSandboxResponse> {
    const result = await runQuery("create_sandbox", {}, () =>
      this.prisma.$transaction(async (tx) => {
        const sandbox = await this.createSandboxRowInTransaction(tx, input);
        const event = await this.events.appendInTransaction(tx, {
          sandboxId: sandbox.sandboxId,
          type: "sandbox_created",
          actor: "api",
          correlationId: randomUUID(),
          payload: {
            container_name: sandbox.containerName,
            workspace_path: sandbox.workspacePath,
          },
        });
        return { sandbox, event };
      }),
    );
    this.publish(result.event);
    void this.provision(
      result.sandbox.sandboxId,
      result.sandbox.containerName,
      result.sandbox.image,
      result.sandbox.fixtureRepoPath,
    );
    return {
      sandboxId: result.sandbox.sandboxId,
      status: result.sandbox.status,
      workspacePath: result.sandbox.workspacePath,
      eventsUrl: `/sandboxes/${result.sandbox.sandboxId}/events`,
    };
  }

  /**
   * Create the sandbox row for a task-owned transaction. The task service
   * appends the task and sandbox creation events after the task/sandbox link is
   * complete so the first event in the task stream is always task_created.
   */
  async createForTaskInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateSandboxRequest,
    options: { taskId: string },
  ): Promise<TaskSandboxCreation> {
    return this.createSandboxRowInTransaction(tx, input, options.taskId);
  }

  /**
   * Compatibility helper for internal callers that already have a task row.
   * TaskService.create uses the transaction-level method above to create both
   * rows and both initial events atomically.
   */
  async provisionForTask(sandboxId: string): Promise<SandboxProvisionResult> {
    const sandbox = await runQuery("get_task_sandbox_for_provision", { sandboxId }, () =>
      this.prisma.sandbox.findUnique({ where: { id: sandboxId } }),
    );
    if (!sandbox)
      throw notFound("sandbox_not_found", "Sandbox was not found");
    if (sandbox.status === "ready") return { status: "ready" };
    if (sandbox.status === "failed")
      return {
        status: "failed",
        failure: {
          code: sandbox.failureCode ?? "sandbox_provision_failed",
          message: sandbox.failureMessage ?? "Sandbox provisioning failed",
        },
      };
    if (sandbox.status !== "creating")
      return {
        status: "failed",
        failure: {
          code: "sandbox_not_provisionable",
          message: "Sandbox is not available for provisioning",
        },
      };

    return this.provision(
      sandbox.id,
      sandbox.containerName,
      sandbox.image,
      sandbox.fixtureRepoPath,
    );
  }

  async createForTask(
    input: CreateSandboxRequest,
    options: { taskId: string },
  ): Promise<{ sandboxId: string; initialEvent: StreamEvent }> {
    const result = await runQuery(
      "create_task_sandbox",
      { taskId: options.taskId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const sandbox = await this.createForTaskInTransaction(
            tx,
            input,
            options,
          );
          await tx.task.update({
            where: { id: options.taskId },
            data: { sandboxId: sandbox.sandboxId },
          });
          const event = await this.events.appendInTransaction(tx, {
            streamId: options.taskId,
            type: "sandbox_created",
            producerService: "sandbox",
            producerId: sandbox.sandboxId,
            taskId: options.taskId,
            sandboxId: sandbox.sandboxId,
            correlationId: randomUUID(),
            payload: {
              container_name: sandbox.containerName,
              workspace_path: sandbox.workspacePath,
            },
          });
          return { sandbox, event };
        }),
    );
    this.publish(result.event);
    return { sandboxId: result.sandbox.sandboxId, initialEvent: result.event };
  }

  async get(sandboxId: string): Promise<unknown> {
    const sandbox = await runQuery("get_sandbox", { sandboxId }, () =>
      this.prisma.sandbox.findUnique({ where: { id: sandboxId } }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    return this.snapshot(sandbox);
  }

  async has(sandboxId: string): Promise<boolean> {
    const count = await runQuery("has_sandbox", { sandboxId }, () =>
      this.prisma.sandbox.count({ where: { id: sandboxId } }),
    );
    return count > 0;
  }

  async eventsAfter(sandboxId: string, after: number): Promise<StreamEvent[]> {
    if (!(await this.has(sandboxId)))
      throw notFound("sandbox_not_found", "Sandbox was not found");
    return this.events.listSandboxAfter(sandboxId, after);
  }

  async startCommand(
    sandboxId: string,
    input: CommandRequest,
  ): Promise<StartCommandResponse> {
    return this.commands.startCommand(sandboxId, input);
  }

  async getCommand(sandboxId: string, commandId: string): Promise<unknown> {
    return this.commands.getCommand(sandboxId, commandId);
  }

  async diff(sandboxId: string): Promise<DiffResponse> {
    const sandbox = await runQuery("get_sandbox_for_diff", { sandboxId }, () =>
      this.prisma.sandbox.findUnique({ where: { id: sandboxId } }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (!["ready", "stopping", "stopped", "failed"].includes(sandbox.status))
      throw new ServiceError(
        "workspace_unavailable",
        "Workspace is not available",
        409,
      );
    await this.emit({
      sandboxId,
      type: "git_diff_requested",
      actor: "api",
      payload: {},
    });
    try {
      const diff = await this.runtime.diff(sandbox.containerName);
      await this.emit({
        sandboxId,
        type: "git_diff_completed",
        actor: "runtime",
        payload: { bytes: Buffer.byteLength(diff) },
      });
      return { sandboxId, diff, generatedAt: new Date().toISOString() };
    } catch (error) {
      throw new ServiceError(
        "diff_failed",
        safeError(error, "diff").message,
        500,
      );
    }
  }

  async stop(sandboxId: string): Promise<unknown> {
    const sandbox = await runQuery("get_sandbox_for_stop", { sandboxId }, () =>
      this.prisma.sandbox.findUnique({ where: { id: sandboxId } }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (sandbox.status === "stopped") return this.snapshot(sandbox);
    if (sandbox.status === "deleted")
      throw new ServiceError("sandbox_deleted", "Sandbox was deleted", 410);
    const stopping = await runQuery("mark_sandbox_stopping", { sandboxId }, () =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.sandbox.update({
          where: { id: sandboxId },
          data: { status: "stopping", stoppingAt: new Date() },
        });
        const event = await this.events.appendInTransaction(tx, {
          sandboxId,
          type: "sandbox_stopping",
          actor: "api",
          correlationId: randomUUID(),
          payload: {},
        });
        return { row, event };
      }),
    );
    this.publish(stopping.event);
    await this.runtime.stop(
      sandbox.containerName,
      this.config.SANDBOX_STOP_GRACE_MS,
    );
    const stopped = await runQuery("mark_sandbox_stopped", { sandboxId }, () =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.sandbox.update({
          where: { id: sandboxId },
          data: { status: "stopped", stoppedAt: new Date() },
        });
        const event = await this.events.appendInTransaction(tx, {
          sandboxId,
          type: "sandbox_stopped",
          actor: "cleanup",
          correlationId: randomUUID(),
          payload: {},
        });
        return { row, event };
      }),
    );
    this.publish(stopped.event);
    return this.snapshot(stopped.row);
  }

  private async createSandboxRowInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateSandboxRequest,
    taskId?: string,
  ): Promise<TaskSandboxCreation> {
    const sandboxId = `sbox_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const containerName = `sandbox-${sandboxId}`;
    const fixtureRepoPath =
      input.fixtureRepoPath ?? this.config.FIXTURE_REPO_PATH;
    const image = input.image ?? this.config.SANDBOX_IMAGE;
    const sandbox = await tx.sandbox.create({
      data: {
        id: sandboxId,
        ...(taskId === undefined ? {} : { taskId }),
        status: "creating",
        containerName,
        image,
        workspacePath: workspaceRoot,
        fixtureRepoPath,
      },
    });
    return {
      sandboxId: sandbox.id,
      status: "creating",
      containerName: sandbox.containerName,
      image: sandbox.image,
      workspacePath: sandbox.workspacePath,
      fixtureRepoPath: sandbox.fixtureRepoPath,
    };
  }

  private async provision(
    sandboxId: string,
    containerName: string,
    image: string,
    fixturePath: string,
  ): Promise<SandboxProvisionResult> {
    try {
      await this.emit({
        sandboxId,
        type: "sandbox_provisioning_started",
        actor: "provisioner",
        payload: {},
      });
      await this.emit({
        sandboxId,
        type: "fixture_repo_copy_started",
        actor: "provisioner",
        payload: { fixture_repo_path: fixturePath },
      });
      const provisioned = await this.runtime.provision(
        sandboxId,
        containerName,
        image,
        fixturePath,
      );
      const events = await runQuery("mark_sandbox_ready", { sandboxId }, () =>
        this.prisma.$transaction(async (tx) => {
          await tx.sandbox.update({
            where: { id: sandboxId },
            data: {
              containerId: provisioned.containerId,
              status: "ready",
              readyAt: new Date(),
            },
          });
          const copied = await this.events.appendInTransaction(tx, {
            sandboxId,
            type: "fixture_repo_copied",
            actor: "provisioner",
            correlationId: randomUUID(),
            payload: { workspace_path: workspaceRoot },
          });
          const ready = await this.events.appendInTransaction(tx, {
            sandboxId,
            type: "sandbox_ready",
            actor: "provisioner",
            correlationId: randomUUID(),
            payload: { container_id: provisioned.containerId },
          });
          return [copied, ready];
        }),
      );
      events.forEach((event) => this.publish(event));
      return { status: "ready" };
    } catch (error) {
      logQueryFailure("provision_sandbox", { sandboxId }, error);
      const safe = safeError(error, "provision");
      await runQuery("mark_sandbox_failed", { sandboxId }, () =>
        this.prisma.$transaction(async (tx) => {
          await tx.sandbox.update({
            where: { id: sandboxId },
            data: {
              status: "failed",
              failedAt: new Date(),
              failureCode: safe.code,
              failureMessage: safe.message,
            },
          });
          return this.events.appendInTransaction(tx, {
            sandboxId,
            type: "sandbox_failed",
            actor: "provisioner",
            correlationId: randomUUID(),
            payload: safe,
          });
        }),
      )
        .then((event) => this.publish(event))
        .catch(() => undefined);
      return { status: "failed", failure: safe };
    }
  }

  private async emit(input: {
    sandboxId: string;
    commandId?: string;
    type: EventType;
    actor: SandboxEventActor;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const event = await this.events.append({
      ...input,
      correlationId: randomUUID(),
    });
    this.publish(event);
  }

  private snapshot(sandbox: {
    id: string;
    status: SandboxStatus;
    containerName: string;
    workspacePath: string;
    createdAt: Date;
    readyAt: Date | null;
    stoppedAt: Date | null;
    failureCode: string | null;
    failureMessage: string | null;
  }): Record<string, unknown> {
    return {
      sandboxId: sandbox.id,
      status: sandbox.status,
      containerName: sandbox.containerName,
      workspacePath: sandbox.workspacePath,
      createdAt: sandbox.createdAt.toISOString(),
      readyAt: sandbox.readyAt?.toISOString() ?? null,
      stoppedAt: sandbox.stoppedAt?.toISOString() ?? null,
      failure: sandbox.failureCode
        ? { code: sandbox.failureCode, message: sandbox.failureMessage }
        : null,
    };
  }
}

export const sandboxService = new SandboxService(
  prisma,
  new EventStore(prisma),
  new SandboxRuntime(loadConfig()),
  loadConfig(),
  (event) => sseHub.publish(event),
);
