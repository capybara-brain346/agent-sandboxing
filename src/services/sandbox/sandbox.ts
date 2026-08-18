import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, SandboxStatus } from "@prisma/client";
import type { Config } from "../../config";
import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import type {
  CommandRequest,
  CommandStartResult,
  EventType,
  SandboxDiffResult,
  SandboxStatus as SandboxStatusType,
  TaskSandboxInput,
} from "../../types/sandbox.types";
import type { PublicEvent } from "../../types/event.types";
import { safeError, ServiceError, notFound } from "../../shared/errors";
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
  from: SandboxStatusType,
  to: SandboxStatusType,
): boolean => transitions[from].includes(to);

export type TaskSandboxCreation = {
  sandboxId: string;
  containerName: string;
  workspacePath: string;
};

export type SandboxProvisionResult =
  | { status: "ready" }
  | { status: "failed"; failure: { code: string; message: string } };

export type AgentToolTarget = {
  containerName: string;
  runtime: Pick<SandboxRuntime, "simpleExec">;
};

export class SandboxService {
  private readonly commands: CommandExecutionService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly runtime: SandboxRuntime,
    private readonly config: Config,
    private readonly publish: (event: PublicEvent) => void,
  ) {
    this.commands = new CommandExecutionService(
      prisma,
      events,
      runtime,
      config,
      publish,
    );
  }

  async createForTaskInTransaction(
    tx: Prisma.TransactionClient,
    input: TaskSandboxInput,
    options: { taskId: string },
  ): Promise<TaskSandboxCreation> {
    const sandboxId = `sbox_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const containerName = `sandbox-${sandboxId}`;
    const fixtureRepoPath =
      input.fixtureRepoPath ?? this.config.FIXTURE_REPO_PATH;
    const image = input.image ?? this.config.SANDBOX_IMAGE;
    const sandbox = await tx.sandbox.create({
      data: {
        id: sandboxId,
        taskId: options.taskId,
        status: "creating",
        containerName,
        image,
        workspacePath: workspaceRoot,
        fixtureRepoPath,
      },
    });
    return {
      sandboxId: sandbox.id,
      containerName: sandbox.containerName,
      workspacePath: sandbox.workspacePath,
    };
  }

  async provisionForTask(sandboxId: string): Promise<SandboxProvisionResult> {
    const sandbox = await runQuery(
      "get_task_sandbox_for_provision",
      { sandboxId },
      () => this.prisma.sandbox.findUnique({ where: { id: sandboxId } }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (!sandbox.taskId)
      throw new ServiceError(
        "sandbox_not_task_owned",
        "Sandbox is not owned by a task",
        409,
      );
    const taskId = sandbox.taskId;
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
      taskId,
      sandbox.id,
      sandbox.containerName,
      sandbox.image,
      sandbox.fixtureRepoPath,
    );
  }

  async getAgentToolTarget(
    taskId: string,
    sandboxId: string,
  ): Promise<AgentToolTarget> {
    const sandbox = await runQuery(
      "get_agent_tool_target",
      { taskId, sandboxId },
      () =>
        this.prisma.sandbox.findFirst({
          where: { id: sandboxId, taskId },
          select: { containerName: true, status: true },
        }),
    );
    if (!sandbox)
      throw notFound("sandbox_not_found", "Task sandbox was not found");
    if (sandbox.status !== "ready")
      throw new ServiceError(
        "sandbox_not_ready",
        "Task sandbox is not ready",
        409,
      );

    return {
      containerName: sandbox.containerName,
      runtime: { simpleExec: this.runtime.simpleExec.bind(this.runtime) },
    };
  }

  async runCommand(
    taskId: string,
    input: CommandRequest,
  ): Promise<CommandStartResult> {
    return this.commands.runCommand(taskId, input);
  }

  async getCommand(
    taskId: string,
    commandId: string,
  ): ReturnType<CommandExecutionService["getCommand"]> {
    return this.commands.getCommand(taskId, commandId);
  }

  async diff(sandboxId: string): Promise<SandboxDiffResult> {
    const sandbox = await runQuery(
      "get_task_sandbox_for_diff",
      { sandboxId },
      () => this.prisma.sandbox.findUnique({ where: { id: sandboxId } }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (!sandbox.taskId)
      throw new ServiceError(
        "sandbox_not_task_owned",
        "Sandbox is not owned by a task",
        409,
      );
    const taskId = sandbox.taskId;
    if (!["ready", "stopping", "stopped", "failed"].includes(sandbox.status))
      throw new ServiceError(
        "workspace_unavailable",
        "Workspace is not available",
        409,
      );
    await this.emit({
      taskId,
      sandboxId,
      type: "git_diff_requested",
      producerService: "sandbox",
      producerId: sandboxId,
      payload: {},
    });
    try {
      const diff = await this.runtime.diff(sandbox.containerName);
      await this.emit({
        taskId,
        sandboxId,
        type: "git_diff_completed",
        producerService: "runtime",
        producerId: sandboxId,
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

  async stop(sandboxId: string): Promise<void> {
    const sandbox = await runQuery(
      "get_task_sandbox_for_stop",
      { sandboxId },
      () => this.prisma.sandbox.findUnique({ where: { id: sandboxId } }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (!sandbox.taskId)
      throw new ServiceError(
        "sandbox_not_task_owned",
        "Sandbox is not owned by a task",
        409,
      );
    const taskId = sandbox.taskId;
    if (sandbox.status === "stopped") return;
    if (sandbox.status === "deleted")
      throw new ServiceError("sandbox_deleted", "Sandbox was deleted", 410);
    if (sandbox.status === "stopping") return;

    const stopping = await runQuery(
      "mark_sandbox_stopping",
      { sandboxId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const claimed = await tx.sandbox.updateMany({
            where: {
              id: sandboxId,
              status: { notIn: ["stopping", "stopped", "deleted"] },
            },
            data: { status: "stopping", stoppingAt: new Date() },
          });
          if (claimed.count === 0) return null;

          return this.events.appendInTransaction(tx, {
            taskId,
            sandboxId,
            type: "sandbox_stopping",
            producerService: "sandbox",
            producerId: sandboxId,
            correlationId: randomUUID(),
            payload: {},
          });
        }),
    );
    if (stopping === null) return;
    this.publish(stopping);
    await this.runtime.stop(
      sandbox.containerName,
      this.config.SANDBOX_STOP_GRACE_MS,
    );
    const stopped = await runQuery("mark_sandbox_stopped", { sandboxId }, () =>
      this.prisma.$transaction(async (tx) => {
        const claimed = await tx.sandbox.updateMany({
          where: { id: sandboxId, status: "stopping" },
          data: { status: "stopped", stoppedAt: new Date() },
        });
        if (claimed.count === 0) return null;

        return this.events.appendInTransaction(tx, {
          taskId,
          sandboxId,
          type: "sandbox_stopped",
          producerService: "cleanup",
          producerId: sandboxId,
          correlationId: randomUUID(),
          payload: {},
        });
      }),
    );
    if (stopped !== null) this.publish(stopped);
  }

  private async provision(
    taskId: string,
    sandboxId: string,
    containerName: string,
    image: string,
    fixturePath: string,
  ): Promise<SandboxProvisionResult> {
    try {
      await this.emit({
        taskId,
        sandboxId,
        type: "sandbox_provisioning_started",
        producerService: "sandbox",
        producerId: sandboxId,
        payload: {},
      });
      await this.emit({
        taskId,
        sandboxId,
        type: "fixture_repo_copy_started",
        producerService: "sandbox",
        producerId: sandboxId,
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
            taskId,
            sandboxId,
            type: "fixture_repo_copied",
            producerService: "sandbox",
            producerId: sandboxId,
            correlationId: randomUUID(),
            payload: { workspace_path: workspaceRoot },
          });
          const ready = await this.events.appendInTransaction(tx, {
            taskId,
            sandboxId,
            type: "sandbox_ready",
            producerService: "sandbox",
            producerId: sandboxId,
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
            taskId,
            sandboxId,
            type: "sandbox_failed",
            producerService: "sandbox",
            producerId: sandboxId,
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
    taskId: string;
    sandboxId: string;
    commandId?: string;
    type: EventType;
    producerService: "sandbox" | "runtime" | "cleanup" | "command";
    producerId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const event = await this.events.append({
      ...input,
      correlationId: randomUUID(),
    });
    this.publish(event);
  }
}

export const sandboxService = new SandboxService(
  prisma,
  new EventStore(prisma),
  new SandboxRuntime(loadConfig()),
  loadConfig(),
  (event) => sseHub.publish(event),
);
