import { randomUUID } from "node:crypto";
import type {
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
  PublicEvent,
  StartCommandResponse,
} from "../../types/sandbox.types";
import { ServiceError, notFound } from "../../shared/errors";
import { workspaceRoot } from "./workspace";
import { CommandExecutionService } from "./command-execution-service";
import { EventStore } from "./event-store";
import { SandboxRuntime } from "./runtime";
import { sseHub } from "./sse-hub";

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
): { code: string; message: string; operation: string; retryable: boolean } => ({
  code: error instanceof ServiceError ? error.code : "unknown",
  message:
    error instanceof ServiceError
      ? error.message
      : "Sandbox runtime operation failed",
  operation,
  retryable: false,
});

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

  async create(input: CreateSandboxRequest): Promise<CreateSandboxResponse> {
    const id = `sbox_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const containerName = `agent-sandbox-${id}`;
    const fixtureRepoPath =
      input.fixtureRepoPath ?? this.config.FIXTURE_REPO_PATH;
    const image = input.image ?? this.config.SANDBOX_IMAGE;
    const result = await this.prisma.$transaction(async (tx) => {
      const sandbox = await tx.sandbox.create({
        data: {
          id,
          status: "creating",
          containerName,
          image,
          workspacePath: workspaceRoot,
          fixtureRepoPath,
        },
      });
      const event = await this.events.appendInTransaction(tx, {
        sandboxId: id,
        type: "sandbox_created",
        actor: "api",
        correlationId: randomUUID(),
        payload: {
          container_name: containerName,
          workspace_path: sandbox.workspacePath,
        },
      });
      return { sandbox, event };
    });
    this.publish(result.event);
    void this.provision(
      result.sandbox.id,
      containerName,
      image,
      fixtureRepoPath,
    );
    return {
      sandboxId: result.sandbox.id,
      status: result.sandbox.status,
      workspacePath: result.sandbox.workspacePath,
      eventsUrl: `/sandboxes/${result.sandbox.id}/events`,
    };
  }

  async get(sandboxId: string): Promise<unknown> {
    const sandbox = await this.prisma.sandbox.findUnique({
      where: { id: sandboxId },
    });
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    return this.snapshot(sandbox);
  }

  async has(sandboxId: string): Promise<boolean> {
    return (await this.prisma.sandbox.count({ where: { id: sandboxId } })) > 0;
  }

  async eventsAfter(sandboxId: string, after: number): Promise<PublicEvent[]> {
    if (!(await this.has(sandboxId)))
      throw notFound("sandbox_not_found", "Sandbox was not found");
    return this.events.listAfter(sandboxId, after);
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
    const sandbox = await this.prisma.sandbox.findUnique({
      where: { id: sandboxId },
    });
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
    const sandbox = await this.prisma.sandbox.findUnique({
      where: { id: sandboxId },
    });
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (sandbox.status === "stopped") return this.snapshot(sandbox);
    if (sandbox.status === "deleted")
      throw new ServiceError("sandbox_deleted", "Sandbox was deleted", 410);
    const stopping = await this.prisma.$transaction(async (tx) => {
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
    });
    this.publish(stopping.event);
    await this.runtime.stop(
      sandbox.containerName,
      this.config.SANDBOX_STOP_GRACE_MS,
    );
    const stopped = await this.prisma.$transaction(async (tx) => {
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
    });
    this.publish(stopped.event);
    return this.snapshot(stopped.row);
  }

  private async provision(
    sandboxId: string,
    containerName: string,
    image: string,
    fixturePath: string,
  ): Promise<void> {
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
      const events = await this.prisma.$transaction(async (tx) => {
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
      });
      events.forEach((event) => this.publish(event));
    } catch (error) {
      const safe = safeError(error, "provision");
      await this.prisma
        .$transaction(async (tx) => {
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
        })
        .then((event) => this.publish(event))
        .catch(() => undefined);
    }
  }

  private async emit(input: {
    sandboxId: string;
    commandId?: string;
    type: EventType;
    actor: SandboxEventActor;
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.publish(
      await this.events.append({ ...input, correlationId: randomUUID() }),
    );
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
