import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ServiceError, notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
import { EventStore } from "../events/event-store";
import {
  noopArtifactRecorder,
  type ArtifactRecorder,
} from "../artifacts/artifact-store";
import type { SessionSandboxCollaborator } from "../sandbox/sandbox";
import type { PublicEvent } from "../../types/event.types";
import type {
  MessageProcessingFailure,
  MessageProcessingResult,
  MessageProcessor,
} from "../../types/message-processing.types";
import type { ArtifactPreview } from "../../types/artifact.types";
import type { TraceRecorderLike } from "../tracing/trace-recorder";
import type { TraceMessageFacts } from "../../types/trace.types";
import type { SandboxProvisioningSource } from "../../types/sandbox.types";

type PublishEvent = (event: PublicEvent) => void;

type GitHubInstallationTokenProvider = {
  createInstallationToken(installationId: string): Promise<string>;
};

type EnsuredSandbox = {
  sandboxId: string;
  source?: SandboxProvisioningSource;
  sessionBranch?: { baseBranch: string; defaultBranch: string | null };
};

type MessageExecution = {
  sessionId: string;
  messageId: string;
  instructions: string;
  sandboxId: string | undefined;
  controller: AbortController;
  cancellationRequested: boolean;
  processingPromise: Promise<void> | undefined;
  processingFinished: boolean;
  cancellationPromise: Promise<void> | undefined;
  cancellationCompleted: boolean;
};

const messageId = (): string =>
  `msg_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const processingFailure = (
  error: unknown,
  fallback: MessageProcessingFailure,
): MessageProcessingFailure => ({
  code: error instanceof ServiceError ? error.code : fallback.code,
  message: error instanceof ServiceError ? error.message : fallback.message,
});

export class MessageProcessingService {
  private readonly executions = new Map<string, MessageExecution>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly sandbox: SessionSandboxCollaborator,
    private readonly processor: MessageProcessor,
    private readonly publish: PublishEvent = () => undefined,
    private readonly artifacts: ArtifactRecorder = noopArtifactRecorder,
    private readonly traceRecorder?: TraceRecorderLike,
    private readonly github?: GitHubInstallationTokenProvider,
  ) {}

  processMessage(
    sessionId: string,
    activeMessageId: string,
    instructions: string,
  ): void {
    this.traceRecorder?.startProcessing({
      sessionId,
      messageId: activeMessageId,
      userPrompt: instructions,
    });
    const execution: MessageExecution = {
      sessionId,
      messageId: activeMessageId,
      instructions,
      sandboxId: undefined,
      controller: new AbortController(),
      cancellationRequested: false,
      processingPromise: undefined,
      processingFinished: false,
      cancellationPromise: undefined,
      cancellationCompleted: false,
    };
    this.executions.set(activeMessageId, execution);
    logger.debug("message_processing_scheduled", {
      sessionId,
      messageId: activeMessageId,
    });
    setImmediate(() => {
      const processingPromise = this.processMessageInBackground(execution);
      execution.processingPromise = processingPromise;
      void processingPromise;
    });
  }

  requestCancellation(sessionId: string, activeMessageId: string): boolean {
    const execution = this.executions.get(activeMessageId);
    if (!execution || execution.sessionId !== sessionId) return false;
    execution.cancellationRequested = true;
    execution.controller.abort();
    void this.waitForCancellation(execution);
    return true;
  }

  async cancelDirectly(
    sessionId: string,
    activeMessageId: string,
  ): Promise<boolean> {
    return this.cancelCurrentMessage(sessionId, activeMessageId, "");
  }

  private async processMessageInBackground(
    execution: MessageExecution,
  ): Promise<void> {
    const { sessionId, messageId: activeMessageId, instructions } = execution;
    const startedAt = process.hrtime.bigint();
    logger.debug("message_processing_started", {
      sessionId,
      messageId: activeMessageId,
    });
    try {
      if (await this.waitForCancellation(execution)) return;

      const sandbox = await this.ensureSandbox(sessionId, activeMessageId);
      execution.sandboxId = sandbox.sandboxId;
      if (await this.waitForCancellation(execution)) return;

      const outcome = sandbox.source
        ? await this.sandbox.ensureReadyForSession(
            sessionId,
            activeMessageId,
            sandbox.sandboxId,
            sandbox.source,
          )
        : await this.sandbox.ensureReadyForSession(
            sessionId,
            activeMessageId,
            sandbox.sandboxId,
          );
      if (await this.waitForCancellation(execution)) return;
      if (outcome.status === "failed") {
        await this.failMessageProcessing(
          sessionId,
          activeMessageId,
          outcome.failure,
          "sandbox_provision",
        );
        return;
      }

      if (sandbox.sessionBranch)
        await this.sandbox.prepareSessionBranchForSession(
          sessionId,
          sandbox.sandboxId,
          sandbox.sessionBranch,
        );
      if (await this.waitForCancellation(execution)) return;
      if (!(await this.startMessageProcessing(sessionId, activeMessageId)))
        return;
      if (await this.waitForCancellation(execution)) return;

      const processingResult = await this.processor.process({
        sessionId,
        messageId: activeMessageId,
        sandboxId: sandbox.sandboxId,
        instructions,
        signal: execution.controller.signal,
      });
      logger.debug("message_processor_finished", {
        sessionId,
        messageId: activeMessageId,
        sandboxId: sandbox.sandboxId,
        summaryPresent: processingResult.summary !== null,
      });
      if (await this.waitForCancellation(execution)) return;

      const diffResult = await this.sandbox.diffForSession(
        sessionId,
        activeMessageId,
        sandbox.sandboxId,
      );
      if (await this.waitForCancellation(execution)) return;

      await this.completeMessageProcessing(
        sessionId,
        activeMessageId,
        diffResult.diff,
        processingResult,
      );
    } catch (error) {
      if (await this.waitForCancellation(execution)) return;
      await this.failMessageProcessing(
        sessionId,
        activeMessageId,
        processingFailure(error, {
          code: "message_processing_failed",
          message: "Message processing failed",
        }),
        "message_processing",
      ).catch(() => undefined);
    } finally {
      execution.processingFinished = true;
      logger.debug("message_processing_finished", {
        sessionId,
        messageId: activeMessageId,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
        outcome: execution.cancellationCompleted ? "cancelled" : "finished",
        cancellationRequested: execution.cancellationRequested,
        cancellationCompleted: execution.cancellationCompleted,
      });
      if (
        this.executions.get(activeMessageId) === execution &&
        (!execution.cancellationRequested || execution.cancellationCompleted)
      )
        this.executions.delete(activeMessageId);
    }
  }

  private startCancellation(execution: MessageExecution): Promise<void> {
    if (execution.cancellationPromise === undefined) {
      const cancellation = this.cancelExecution(execution).catch(
        (error: unknown) => {
          execution.cancellationPromise = undefined;
          logger.error("message_cancellation_failed", {
            sessionId: execution.sessionId,
            messageId: execution.messageId,
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
    execution: MessageExecution,
  ): Promise<boolean> {
    if (!execution.cancellationRequested) return false;
    try {
      await this.startCancellation(execution);
    } catch {
      return true;
    }
    return true;
  }

  private async cancelExecution(execution: MessageExecution): Promise<void> {
    let completed = false;
    try {
      let diff = "";
      if (execution.sandboxId) {
        try {
          diff = (
            await this.sandbox.diffForSession(
              execution.sessionId,
              execution.messageId,
              execution.sandboxId,
            )
          ).diff;
        } catch {
          diff = "";
        }
      }
      await this.cancelCurrentMessage(
        execution.sessionId,
        execution.messageId,
        diff,
      );
      execution.cancellationCompleted = true;
      completed = true;
    } finally {
      if (
        completed &&
        (execution.processingPromise === undefined ||
          execution.processingFinished) &&
        this.executions.get(execution.messageId) === execution
      )
        this.executions.delete(execution.messageId);
    }
  }

  private async ensureSandbox(
    sessionId: string,
    activeMessageId: string,
  ): Promise<EnsuredSandbox> {
    const session = await runQuery(
      "get_session_for_message_processing",
      { sessionId },
      () =>
        this.prisma.chatSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            repoSource: true,
            repoRef: true,
            image: true,
            repoOwner: true,
            repoName: true,
            repoDefaultBranch: true,
            repoInstallationId: true,
            repoBaseBranch: true,
            repoBaseSha: true,
            sandbox: { select: { id: true, status: true } },
          },
        }),
    );
    if (!session)
      throw notFound("chat_session_not_found", "Chat session was not found");

    const baseBranch =
      session.repoBaseBranch?.trim() || session.repoDefaultBranch?.trim();
    const sessionBranch =
      session.repoSource === "github" && baseBranch
        ? {
            baseBranch,
            defaultBranch: session.repoDefaultBranch?.trim() || null,
          }
        : undefined;
    const source = async (): Promise<SandboxProvisioningSource> => {
      if (session.repoSource !== "github")
        return { source: "fixture", fixtureRepoPath: session.repoRef };
      const owner = session.repoOwner?.trim();
      const name = session.repoName?.trim();
      const installationId = session.repoInstallationId?.trim();
      const baseSha = session.repoBaseSha?.trim();
      if (!baseBranch)
        throw new ServiceError(
          "github_base_branch_missing",
          "A GitHub base branch is required for provisioning",
          400,
        );
      if (!owner || !name || !installationId || !/^\d+$/.test(installationId))
        throw new ServiceError(
          "github_repository_metadata_missing",
          "GitHub repository metadata is incomplete",
          400,
        );
      if (!this.github)
        throw new ServiceError(
          "github_installation_token_failed",
          "GitHub installation token could not be created",
          502,
        );
      let token: string;
      try {
        token = await this.github.createInstallationToken(installationId);
      } catch {
        throw new ServiceError(
          "github_installation_token_failed",
          "GitHub installation token could not be created",
          502,
        );
      }
      if (typeof token !== "string" || !token)
        throw new ServiceError(
          "github_installation_token_failed",
          "GitHub installation token could not be created",
          502,
        );
      return {
        source: "github",
        owner,
        name,
        installationId,
        cloneUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}.git`,
        baseBranch,
        ...(baseSha ? { baseSha } : {}),
        token,
      };
    };

    if (session.sandbox)
      return {
        sandboxId: session.sandbox.id,
        ...(sessionBranch ? { sessionBranch } : {}),
      };

    const provisioningSource = await source();
    const created = await runQuery(
      "create_session_sandbox",
      { sessionId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const sandbox = await this.sandbox.createForSessionInTransaction(
            tx,
            {
              source: provisioningSource,
              image: session.image ?? undefined,
            },
            { sessionId },
          );
          const event = await this.events.appendSessionEventInTransaction(tx, {
            sessionId,
            messageId: activeMessageId,
            sandboxId: sandbox.sandboxId,
            type: "sandbox_created",
            producerService: "sandbox",
            producerId: sandbox.sandboxId,
            correlationId: randomUUID(),
            domain: "sandbox",
            payload: {
              container_name: sandbox.containerName,
              workspace_path: sandbox.workspacePath,
            },
          });
          return { sandbox, event };
        }),
    );
    this.publish(created.event);
    logger.debug("message_sandbox_created", {
      sessionId,
      messageId: activeMessageId,
      sandboxId: created.sandbox.sandboxId,
    });
    return {
      sandboxId: created.sandbox.sandboxId,
      source: provisioningSource,
      ...(sessionBranch ? { sessionBranch } : {}),
    };
  }

  private async startMessageProcessing(
    sessionId: string,
    activeMessageId: string,
  ): Promise<boolean> {
    const event = await runQuery(
      "start_message_processing",
      { sessionId, messageId: activeMessageId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.chatMessage.updateMany({
            where: { id: activeMessageId, processingStatus: "queued" },
            data: {
              processingStatus: "working",
              processingStartedAt: new Date(),
            },
          });
          if (updated.count === 0) return null;
          return this.events.appendSessionEventInTransaction(tx, {
            sessionId,
            messageId: activeMessageId,
            type: "message_processing_started",
            producerService: "chat",
            producerId: activeMessageId,
            correlationId: randomUUID(),
            domain: "message",
            payload: {},
          });
        }),
    );
    if (!event) return false;
    this.publish(event);
    return true;
  }

  private async recordArtifacts(
    sessionId: string,
    activeMessageId: string,
    diff: string,
  ): Promise<ArtifactPreview[]> {
    const jobs: Array<Promise<ArtifactPreview>> = [];
    if (diff.trim())
      jobs.push(
        this.artifacts.create({
          sessionId,
          messageId: activeMessageId,
          kind: "diff",
          contentType: "text/x-diff",
          content: diff,
        }),
      );
    if (jobs.length === 0) return [];
    try {
      return await Promise.all(jobs);
    } catch (error) {
      logger.error("message_artifact_capture_failed", {
        sessionId,
        messageId: activeMessageId,
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  private async artifactCreatedEvents(
    tx: Parameters<EventStore["appendSessionEventInTransaction"]>[0],
    sessionId: string,
    activeMessageId: string,
    artifacts: ArtifactPreview[],
  ): Promise<PublicEvent[]> {
    const events: PublicEvent[] = [];
    for (const artifact of artifacts) {
      if (!artifact.artifactId) continue;
      events.push(
        await this.events.appendSessionEventInTransaction(tx, {
          sessionId,
          messageId: activeMessageId,
          artifactId: artifact.artifactId,
          type: "artifact_created",
          producerService: "chat",
          producerId: artifact.artifactId,
          correlationId: randomUUID(),
          domain: "artifact",
          payload: {
            artifact_id: artifact.artifactId,
            kind: artifact.kind,
            content_type: artifact.contentType,
            byte_size: artifact.byteSize,
            truncated: artifact.truncated,
            redacted: artifact.redacted,
            preview: artifact.preview,
          },
        }),
      );
    }
    return events;
  }

  private async completeMessageProcessing(
    sessionId: string,
    activeMessageId: string,
    diff: string,
    result: MessageProcessingResult,
  ): Promise<boolean> {
    const artifacts = await this.recordArtifacts(
      sessionId,
      activeMessageId,
      diff,
    );
    const assistantMessageId = messageId();
    const events = await runQuery(
      "complete_message_processing",
      { sessionId, messageId: activeMessageId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.chatMessage.updateMany({
            where: { id: activeMessageId, processingStatus: "working" },
            data: {
              processingStatus: "completed",
              processingCompletedAt: new Date(),
              agentSummary: result.summary,
              diff,
              exitReason: "completed",
              failureCode: null,
              failureMessage: null,
            },
          });
          if (updated.count === 0) return [];
          await tx.chatMessage.create({
            data: {
              id: assistantMessageId,
              sessionId,
              role: "assistant",
              content:
                result.summary ??
                "Message processing completed with no summary.",
            },
          });
          await tx.chatSession.updateMany({
            where: { id: sessionId, activeMessageId },
            data: { activeMessageId: null, lockedAt: null },
          });
          const messageCreated =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              messageId: assistantMessageId,
              type: "message_created",
              producerService: "chat",
              producerId: assistantMessageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: { role: "assistant", content: result.summary ?? "" },
            });
          const processingCompleted =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              messageId: activeMessageId,
              type: "message_processing_completed",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: { exit_reason: "completed" },
            });
          const resultReady = await this.events.appendSessionEventInTransaction(
            tx,
            {
              sessionId,
              messageId: activeMessageId,
              type: "message_result_ready",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: {
                exit_reason: "completed",
                diff_bytes: Buffer.byteLength(diff),
                agent_summary_present: result.summary !== null,
              },
            },
          );
          return [
            messageCreated,
            processingCompleted,
            resultReady,
            ...(await this.artifactCreatedEvents(
              tx,
              sessionId,
              activeMessageId,
              artifacts,
            )),
          ];
        }),
    );
    events.forEach((event) => this.publish(event));
    if (events.length > 0)
      await this.finalizeTrace(sessionId, activeMessageId, {
        status: "completed",
        exitReason: "completed",
        diffBytes: Buffer.byteLength(diff),
        diffPresent: diff.trim().length > 0,
        artifacts: artifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          byteSize: artifact.byteSize,
          truncated: artifact.truncated,
          redacted: artifact.redacted,
        })),
        finalMessage:
          result.summary ?? "Message processing completed with no summary.",
      });
    return events.length > 0;
  }

  private async failMessageProcessing(
    sessionId: string,
    activeMessageId: string,
    failure: MessageProcessingFailure,
    operation: string,
  ): Promise<boolean> {
    const events = await runQuery(
      "fail_message_processing",
      { sessionId, messageId: activeMessageId, code: failure.code, operation },
      () =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.chatMessage.updateMany({
            where: {
              id: activeMessageId,
              processingStatus: { in: ["queued", "working"] },
            },
            data: {
              processingStatus: "failed",
              processingCompletedAt: new Date(),
              diff: "",
              agentSummary: null,
              exitReason: "failed",
              failureCode: failure.code,
              failureMessage: failure.message,
            },
          });
          if (updated.count === 0) return [];
          await tx.chatSession.updateMany({
            where: { id: sessionId, activeMessageId },
            data: { activeMessageId: null, lockedAt: null },
          });
          const processingFailed =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              messageId: activeMessageId,
              type: "message_processing_failed",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: {
                code: failure.code,
                message: failure.message,
                operation,
              },
            });
          const resultReady = await this.events.appendSessionEventInTransaction(
            tx,
            {
              sessionId,
              messageId: activeMessageId,
              type: "message_result_ready",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: {
                exit_reason: "failed",
                diff_bytes: 0,
                agent_summary_present: false,
              },
            },
          );
          return [processingFailed, resultReady];
        }),
    );
    events.forEach((event) => this.publish(event));
    if (events.length > 0)
      await this.finalizeTrace(sessionId, activeMessageId, {
        status: "failed",
        exitReason: "failed",
        diffBytes: 0,
        diffPresent: false,
        artifacts: [],
        error: {
          code: failure.code,
          message: failure.message,
          stage: operation,
        },
      });
    return events.length > 0;
  }

  private async cancelCurrentMessage(
    sessionId: string,
    activeMessageId: string,
    diff: string,
  ): Promise<boolean> {
    const events = await runQuery(
      "cancel_current_message",
      { sessionId, messageId: activeMessageId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.chatMessage.updateMany({
            where: {
              id: activeMessageId,
              sessionId,
              processingStatus: { in: ["queued", "working"] },
            },
            data: {
              processingStatus: "cancelled",
              processingCompletedAt: new Date(),
              diff,
              agentSummary: null,
              exitReason: "cancelled",
              failureCode: null,
              failureMessage: null,
            },
          });
          if (updated.count === 0) return [];
          await tx.chatSession.updateMany({
            where: { id: sessionId, activeMessageId },
            data: { activeMessageId: null, lockedAt: null },
          });
          const processingCancelled =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              messageId: activeMessageId,
              type: "message_processing_cancelled",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: { exit_reason: "cancelled" },
            });
          const resultReady = await this.events.appendSessionEventInTransaction(
            tx,
            {
              sessionId,
              messageId: activeMessageId,
              type: "message_result_ready",
              producerService: "chat",
              producerId: activeMessageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: { exit_reason: "cancelled" },
            },
          );
          return [processingCancelled, resultReady];
        }),
    );
    events.forEach((event) => this.publish(event));
    if (events.length > 0)
      await this.finalizeTrace(sessionId, activeMessageId, {
        status: "cancelled",
        exitReason: "cancelled",
        diffBytes: Buffer.byteLength(diff),
        diffPresent: diff.trim().length > 0,
        artifacts: [],
      });
    return events.length > 0;
  }

  private async finalizeTrace(
    sessionId: string,
    activeMessageId: string,
    terminal: TraceMessageFacts,
  ): Promise<void> {
    if (!this.traceRecorder) return;
    try {
      const events = (await this.events.listSessionEvents(sessionId, 0)).filter(
        (event) => event.messageId === activeMessageId,
      );
      await this.traceRecorder.finishProcessing({
        messageId: activeMessageId,
        terminal,
        events,
      });
    } catch (error) {
      logger.warn("trace_finalize_failed", {
        messageId: activeMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
