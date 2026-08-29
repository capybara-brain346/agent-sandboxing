import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, SandboxStatus } from "@prisma/client";
import type { Config } from "../../config";
import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import type {
  EventType,
  SandboxDiffResult,
  SandboxProvisioningSource,
  SandboxStatus as SandboxStatusType,
  SandboxCreationInput,
} from "../../types/sandbox.types";
import type { PublicEvent } from "../../types/event.types";
import { safeError, ServiceError, notFound } from "../../shared/errors";
import { logQueryFailure, runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
import { githubSessionBranch, sameGitBranch } from "../github/branch";
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

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

export type SandboxCreation = {
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
  | "createForSessionInTransaction"
  | "ensureReadyForSession"
  | "prepareSessionBranchForSession"
  | "diffForSession"
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
    input: SandboxCreationInput,
    options: { sessionId: string },
  ): Promise<SandboxCreation> {
    const sandboxId = `sbox_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const containerName = `sandbox-${sandboxId}`;
    const fixtureRepoPath =
      input.source.source === "fixture" ? input.source.fixtureRepoPath : "";
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
    messageId: string,
    sandboxId: string,
    source?: SandboxProvisioningSource,
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
      messageId,
      sandbox.id,
      sandbox.containerName,
      sandbox.image,
      source ?? { source: "fixture", fixtureRepoPath: sandbox.fixtureRepoPath },
    );
  }

  async diffForSession(
    sessionId: string,
    messageId: string,
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
    await this.emitSession({
      sessionId,
      messageId,
      sandboxId,
      type: "git_diff_requested",
      producerService: "sandbox",
      producerId: sandboxId,
      payload: {},
    });
    try {
      const diff = await this.runtime.diff(sandbox.containerName);
      await this.emitSession({
        sessionId,
        messageId,
        sandboxId,
        type: "git_diff_completed",
        producerService: "runtime",
        producerId: sandboxId,
        payload: { bytes: Buffer.byteLength(diff) },
      });
      logger.debug("sandbox_diff_completed", {
        sessionId,
        messageId,
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
        messageId,
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

  async prepareSessionBranchForSession(
    sessionId: string,
    sandboxId: string,
    input: { baseBranch: string; defaultBranch: string | null },
  ): Promise<void> {
    const branch = githubSessionBranch(sessionId);
    if (
      sameGitBranch(input.baseBranch, branch) ||
      sameGitBranch(input.defaultBranch, branch)
    )
      throw new ServiceError(
        "protected_git_branch",
        "Refusing to use the session base branch as the working branch",
        409,
      );
    const sandbox = await runQuery(
      "get_session_sandbox_for_branch",
      { sessionId, sandboxId },
      () =>
        this.prisma.sandbox.findFirst({
          where: { id: sandboxId, sessionId },
          select: { containerName: true, status: true },
        }),
    );
    if (!sandbox) throw notFound("sandbox_not_found", "Sandbox was not found");
    if (sandbox.status !== "ready")
      throw new ServiceError("sandbox_not_ready", "Sandbox is not ready", 409);
    const current = await this.runtime.simpleExec(
      sandbox.containerName,
      "git branch --show-current",
      workspaceRoot,
      { timeoutMs: this.config.SANDBOX_COMMAND_TIMEOUT_MS },
    );
    if (current.timedOut || current.exitCode !== 0)
      throw new ServiceError(
        "github_branch_setup_failed",
        "GitHub working branch could not be prepared",
        502,
      );
    if (sameGitBranch(current.stdout.trim(), branch)) return;
    const dirty = await this.runtime.simpleExec(
      sandbox.containerName,
      "git status --porcelain=v1",
      workspaceRoot,
      { timeoutMs: this.config.SANDBOX_COMMAND_TIMEOUT_MS },
    );
    if (dirty.timedOut || dirty.exitCode !== 0)
      throw new ServiceError(
        "github_branch_setup_failed",
        "GitHub working branch could not be prepared",
        502,
      );
    if (dirty.stdout.trim())
      throw new ServiceError(
        "github_workspace_dirty",
        "Workspace changes are on the wrong Git branch",
        409,
      );
    const existing = await this.runtime.simpleExec(
      sandbox.containerName,
      `git show-ref --verify --quiet ${shellQuote(`refs/heads/${branch}`)}`,
      workspaceRoot,
      { timeoutMs: this.config.SANDBOX_COMMAND_TIMEOUT_MS },
    );
    if (
      existing.timedOut ||
      (existing.exitCode !== 0 && existing.exitCode !== 1)
    )
      throw new ServiceError(
        "github_branch_setup_failed",
        "GitHub working branch could not be prepared",
        502,
      );
    const checkoutCommand =
      existing.exitCode === 0
        ? `git checkout ${shellQuote(branch)}`
        : sameGitBranch(current.stdout.trim(), input.baseBranch)
          ? `git checkout -b ${shellQuote(branch)}`
          : null;
    if (!checkoutCommand)
      throw new ServiceError(
        "github_branch_setup_failed",
        "GitHub working branch could not be prepared",
        502,
      );
    const checkout = await this.runtime.simpleExec(
      sandbox.containerName,
      checkoutCommand,
      workspaceRoot,
      { timeoutMs: this.config.SANDBOX_COMMAND_TIMEOUT_MS },
    );
    if (checkout.timedOut || checkout.exitCode !== 0)
      throw new ServiceError(
        "github_branch_setup_failed",
        "GitHub working branch could not be prepared",
        502,
      );
  }

  private async provisionForSession(
    sessionId: string,
    messageId: string,
    sandboxId: string,
    containerName: string,
    image: string,
    source: SandboxProvisioningSource,
  ): Promise<SandboxProvisionResult> {
    const startedAt = process.hrtime.bigint();
    logger.debug("sandbox_provision_started", {
      sessionId,
      messageId,
      sandboxId,
    });
    try {
      await this.emitSession({
        sessionId,
        messageId,
        sandboxId,
        type: "sandbox_provisioning_started",
        producerService: "sandbox",
        producerId: sandboxId,
        payload: {},
      });
      if (source.source === "fixture")
        await this.emitSession({
          sessionId,
          messageId,
          sandboxId,
          type: "fixture_repo_copy_started",
          producerService: "sandbox",
          producerId: sandboxId,
          payload: { fixture_repo_path: source.fixtureRepoPath },
        });
      if (source.source === "github")
        await this.emitSession({
          sessionId,
          messageId,
          sandboxId,
          type: "repo_clone_started",
          producerService: "sandbox",
          producerId: sandboxId,
          payload: { owner: source.owner, name: source.name },
        });
      const provisioned = await this.runtime.provision(
        sandboxId,
        containerName,
        image,
        source,
      );
      if (source.source === "github") {
        await this.emitSession({
          sessionId,
          messageId,
          sandboxId,
          type: "repo_clone_completed",
          producerService: "sandbox",
          producerId: sandboxId,
          payload: { owner: source.owner, name: source.name },
        });
        await this.emitSession({
          sessionId,
          messageId,
          sandboxId,
          type: "repo_checkout_completed",
          producerService: "sandbox",
          producerId: sandboxId,
          payload: {
            owner: source.owner,
            name: source.name,
            branch: source.baseBranch,
          },
        });
      }
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
            const copied =
              source.source === "fixture"
                ? await this.events.appendSessionEventInTransaction(tx, {
                    sessionId,
                    messageId,
                    sandboxId,
                    type: "fixture_repo_copied",
                    producerService: "sandbox",
                    producerId: sandboxId,
                    correlationId: randomUUID(),
                    domain: "sandbox",
                    payload: { workspace_path: workspaceRoot },
                  })
                : null;
            const ready = await this.events.appendSessionEventInTransaction(
              tx,
              {
                sessionId,
                messageId,
                sandboxId,
                type: "sandbox_ready",
                producerService: "sandbox",
                producerId: sandboxId,
                correlationId: randomUUID(),
                domain: "sandbox",
                payload: { container_id: provisioned.containerId },
              },
            );
            return copied ? [copied, ready] : [ready];
          }),
      );
      events.forEach((event) => this.publish(event));
      logger.debug("sandbox_provision_completed", {
        sessionId,
        messageId,
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
      const failure =
        source.source === "github" && safe.code === "unknown"
          ? {
              ...safe,
              code: "github_provision_failed",
              message: "GitHub sandbox provisioning failed",
            }
          : safe;
      logger.debug("sandbox_provision_failed", {
        sessionId,
        messageId,
        sandboxId,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
        failureCode: failure.code,
      });
      await runQuery("mark_session_sandbox_failed", { sandboxId }, () =>
        this.prisma.$transaction(async (tx) => {
          await tx.sandbox.update({
            where: { id: sandboxId },
            data: {
              status: "failed",
              failedAt: new Date(),
              failureCode: failure.code,
              failureMessage: failure.message,
            },
          });
          return this.events.appendSessionEventInTransaction(tx, {
            sessionId,
            messageId,
            sandboxId,
            type: "sandbox_failed",
            producerService: "sandbox",
            producerId: sandboxId,
            correlationId: randomUUID(),
            domain: "sandbox",
            payload: failure,
          });
        }),
      )
        .then((event) => this.publish(event))
        .catch(() => undefined);
      return { status: "failed", failure };
    }
  }

  async getAgentToolTarget(
    sessionId: string,
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

  private async emitSession(input: {
    sessionId: string;
    messageId: string;
    sandboxId: string;
    type: EventType;
    producerService: "sandbox" | "runtime" | "cleanup" | "command";
    producerId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const event = await this.events.appendSessionEvent({
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
