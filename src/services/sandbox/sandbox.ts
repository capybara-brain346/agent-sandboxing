import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, SandboxStatus } from "@prisma/client";
import type { Config } from "../../config";
import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import type {
  EventType,
  SandboxDiffResult,
  SandboxStatus as SandboxStatusType,
  TaskSandboxInput,
} from "../../types/sandbox.types";
import type { PublicEvent } from "../../types/event.types";
import { safeError, ServiceError, notFound } from "../../shared/errors";
import { logQueryFailure, runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
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

export type SessionSandboxCollaborator = Pick<
  SandboxService,
  "createForSessionInTransaction" | "ensureReadyForSession" | "diffForSession"
>;

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

  async createForSessionInTransaction(
    tx: Prisma.TransactionClient,
    input: TaskSandboxInput,
    options: { sessionId: string },
  ): Promise<TaskSandboxCreation> {
    const sandboxId = `sbox_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const containerName = `sandbox-${sandboxId}`;
    const fixtureRepoPath =
      input.fixtureRepoPath ?? this.config.FIXTURE_REPO_PATH;
    const image = input.image ?? this.config.SANDBOX_IMAGE;
    const sandbox = await tx.sandbox.create({
      data: {
        id: sandboxId,
        sessionId: options.sessionId,
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

  async ensureReadyForSession(
    sessionId: string,
    runId: string,
    sandboxId: string,
  ): Promise<SandboxProvisionResult> {
    const sandbox = await runQuery(
      "get_session_sandbox_for_provision",
      { sessionId, sandboxId },
      () =>
        this.prisma.sandbox.findFirst({
          where: { id: sandboxId, sessionId },
        }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
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

    return this.provisionForSession(
      sessionId,
      runId,
      sandbox.id,
      sandbox.containerName,
      sandbox.image,
      sandbox.fixtureRepoPath,
    );
  }

  async diffForSession(
    sessionId: string,
    runId: string,
    sandboxId: string,
  ): Promise<SandboxDiffResult> {
    const startedAt = process.hrtime.bigint();
    const sandbox = await runQuery(
      "get_session_sandbox_for_diff",
      { sessionId, sandboxId },
      () =>
        this.prisma.sandbox.findFirst({
          where: { id: sandboxId, sessionId },
        }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (!["ready", "stopping", "stopped", "failed"].includes(sandbox.status))
      throw new ServiceError(
        "workspace_unavailable",
        "Workspace is not available",
        409,
      );
    await this.emitRun({
      sessionId,
      runId,
      sandboxId,
      type: "git_diff_requested",
      producerService: "sandbox",
      producerId: sandboxId,
      payload: {},
    });
    try {
      const diff = await this.runtime.diff(sandbox.containerName);
      await this.emitRun({
        sessionId,
        runId,
        sandboxId,
        type: "git_diff_completed",
        producerService: "runtime",
        producerId: sandboxId,
        payload: { bytes: Buffer.byteLength(diff) },
      });
      logger.debug("sandbox_diff_completed", {
        sessionId,
        runId,
        sandboxId,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
        diffBytes: Buffer.byteLength(diff),
      });
      return { sandboxId, diff, generatedAt: new Date().toISOString() };
    } catch (error) {
      logger.debug("sandbox_diff_failed", {
        sessionId,
        runId,
        sandboxId,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
      });
      throw new ServiceError(
        "diff_failed",
        safeError(error, "diff").message,
        500,
      );
    }
  }

  private async provisionForSession(
    sessionId: string,
    runId: string,
    sandboxId: string,
    containerName: string,
    image: string,
    fixturePath: string,
  ): Promise<SandboxProvisionResult> {
    const startedAt = process.hrtime.bigint();
    logger.debug("sandbox_provision_started", { sessionId, runId, sandboxId });
    try {
      await this.emitRun({
        sessionId,
        runId,
        sandboxId,
        type: "sandbox_provisioning_started",
        producerService: "sandbox",
        producerId: sandboxId,
        payload: {},
      });
      await this.emitRun({
        sessionId,
        runId,
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
      const events = await runQuery(
        "mark_session_sandbox_ready",
        { sandboxId },
        () =>
          this.prisma.$transaction(async (tx) => {
            await tx.sandbox.update({
              where: { id: sandboxId },
              data: {
                containerId: provisioned.containerId,
                status: "ready",
                readyAt: new Date(),
              },
            });
            const copied = await this.events.appendRunEventInTransaction(tx, {
              sessionId,
              runId,
              sandboxId,
              type: "fixture_repo_copied",
              producerService: "sandbox",
              producerId: sandboxId,
              correlationId: randomUUID(),
              domain: "sandbox",
              payload: { workspace_path: workspaceRoot },
            });
            const ready = await this.events.appendRunEventInTransaction(tx, {
              sessionId,
              runId,
              sandboxId,
              type: "sandbox_ready",
              producerService: "sandbox",
              producerId: sandboxId,
              correlationId: randomUUID(),
              domain: "sandbox",
              payload: { container_id: provisioned.containerId },
            });
            return [copied, ready];
          }),
      );
      events.forEach((event) => this.publish(event));
      logger.debug("sandbox_provision_completed", {
        sessionId,
        runId,
        sandboxId,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
        outcome: "ready",
      });
      return { status: "ready" };
    } catch (error) {
      logQueryFailure("provision_session_sandbox", { sandboxId }, error);
      const safe = safeError(error, "provision");
      logger.debug("sandbox_provision_failed", {
        sessionId,
        runId,
        sandboxId,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
        failureCode: safe.code,
      });
      await runQuery("mark_session_sandbox_failed", { sandboxId }, () =>
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
          return this.events.appendRunEventInTransaction(tx, {
            sessionId,
            runId,
            sandboxId,
            type: "sandbox_failed",
            producerService: "sandbox",
            producerId: sandboxId,
            correlationId: randomUUID(),
            domain: "sandbox",
            payload: safe,
          });
        }),
      )
        .then((event) => this.publish(event))
        .catch(() => undefined);
      return { status: "failed", failure: safe };
    }
  }

  async getAgentToolTarget(
    sessionId: string,
    runId: string,
    sandboxId: string,
  ): Promise<AgentToolTarget> {
    const sandbox = await runQuery(
      "get_agent_tool_target",
      { sessionId, sandboxId },
      () =>
        this.prisma.sandbox.findFirst({
          where: { id: sandboxId, sessionId },
          select: { containerName: true, status: true },
        }),
    );
    if (!sandbox)
      throw notFound("sandbox_not_found", "Session sandbox was not found");
    if (sandbox.status !== "ready")
      throw new ServiceError("sandbox_not_ready", "Sandbox is not ready", 409);

    return {
      containerName: sandbox.containerName,
      runtime: { simpleExec: this.runtime.simpleExec.bind(this.runtime) },
    };
  }

  private async emitRun(input: {
    sessionId: string;
    runId: string;
    sandboxId: string;
    type: EventType;
    producerService: "sandbox" | "runtime" | "cleanup" | "command";
    producerId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const event = await this.events.appendRunEvent({
      ...input,
      domain: "sandbox",
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
