import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
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
import type { TaskFailure } from "../../types/task.types";
import type { ArtifactPreview } from "../../types/artifact.types";
import { canTransition } from "./task";
import type { TaskRunner, TaskRunResult } from "./task-runner";
import type { EvalTraceRecorderLike } from "../eval/eval-trace-recorder";
import type { EvalTraceRunFacts } from "../../types/eval-trace.types";
import type { SandboxProvisioningSource } from "../../types/sandbox.types";

type PublishEvent = (event: PublicEvent) => void;

type GitHubInstallationTokenProvider = {
  createInstallationToken(installationId: string): Promise<string>;
};

type EnsuredSandbox = {
  sandboxId: string;
  source?: SandboxProvisioningSource;
};

type RunExecution = {
  sessionId: string;
  runId: string;
  messageId: string;
  instructions: string;
  sandboxId: string | undefined;
  controller: AbortController;
  cancellationRequested: boolean;
  runPromise: Promise<void> | undefined;
  runFinished: boolean;
  cancellationPromise: Promise<void> | undefined;
  cancellationCompleted: boolean;
};

const msgId = (): string =>
  `msg_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

const runFailure = (error: unknown, fallback: TaskFailure): TaskFailure => ({
  code: error instanceof ServiceError ? error.code : fallback.code,
  message: error instanceof ServiceError ? error.message : fallback.message,
});

const workerReportFrom = (error: unknown): string | null => {
  if (!(error instanceof ServiceError)) return null;
  const report = error.details.workerReport;
  return typeof report === "string" ? report : null;
};

/**
 * Owns run-owned execution against a session-owned sandbox: sandbox
 * provisioning, worker invocation, diff/result capture, assistant message
 * creation, terminal transitions, and session lock release. The sandbox is
 * never stopped here; it is reused by later runs in the same session.
 */
export class RunService {
  private readonly executions = new Map<string, RunExecution>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventStore,
    private readonly sandbox: SessionSandboxCollaborator,
    private readonly runner: TaskRunner,
    private readonly publish: PublishEvent = () => undefined,
    private readonly artifacts: ArtifactRecorder = noopArtifactRecorder,
    private readonly traceRecorder?: EvalTraceRecorderLike,
    private readonly github?: GitHubInstallationTokenProvider,
  ) {}

  createRunForMessage(
    sessionId: string,
    runId: string,
    messageId: string,
    instructions: string,
  ): void {
    this.traceRecorder?.startRun({
      sessionId,
      runId,
      userPrompt: instructions,
    });
    const execution: RunExecution = {
      sessionId,
      runId,
      messageId,
      instructions,
      sandboxId: undefined,
      controller: new AbortController(),
      cancellationRequested: false,
      runPromise: undefined,
      runFinished: false,
      cancellationPromise: undefined,
      cancellationCompleted: false,
    };
    this.executions.set(runId, execution);
    logger.debug("run_scheduled", { sessionId, runId, messageId });
    setImmediate(() => {
      const runPromise = this.runRun(execution);
      execution.runPromise = runPromise;
      void runPromise;
    });
  }

  /** Aborts an in-flight run. Returns false if no execution is tracked for it. */
  requestCancellation(sessionId: string, runId: string): boolean {
    const execution = this.executions.get(runId);
    if (!execution || execution.sessionId !== sessionId) return false;
    execution.cancellationRequested = true;
    execution.controller.abort();
    void this.waitForCancellation(execution);
    return true;
  }

  /** Cancels a run that has no tracked in-flight execution. */
  async cancelDirectly(sessionId: string, runId: string): Promise<boolean> {
    return this.cancelRunRow(sessionId, runId, "");
  }

  private async runRun(execution: RunExecution): Promise<void> {
    const { sessionId, runId, messageId, instructions } = execution;
    const startedAt = process.hrtime.bigint();
    logger.debug("run_execution_started", { sessionId, runId, messageId });
    try {
      if (await this.waitForCancellation(execution)) return;

      const sandbox = await this.ensureSandbox(sessionId, runId);
      const sandboxId = sandbox.sandboxId;
      execution.sandboxId = sandboxId;
      if (await this.waitForCancellation(execution)) return;

      if (!(await this.transitionStatus(runId, "provisioning"))) return;
      if (await this.waitForCancellation(execution)) return;

      const outcome = sandbox.source
        ? await this.sandbox.ensureReadyForSession(
            sessionId,
            runId,
            sandboxId,
            sandbox.source,
          )
        : await this.sandbox.ensureReadyForSession(sessionId, runId, sandboxId);
      if (await this.waitForCancellation(execution)) return;
      if (outcome.status === "failed") {
        await this.failRun(
          sessionId,
          runId,
          outcome.failure,
          "provision_run",
          null,
        );
        return;
      }

      if (!(await this.transitionStatus(runId, "running"))) return;
      if (await this.waitForCancellation(execution)) return;

      const runResult = await this.runner.run({
        taskId: runId,
        sandboxId,
        instructions,
        signal: execution.controller.signal,
        sessionId,
        messageId,
      });
      logger.debug("run_worker_finished", {
        sessionId,
        runId,
        sandboxId,
        summaryPresent: runResult.summary !== null,
        workerReportPresent: Boolean(runResult.workerReport),
      });
      if (await this.waitForCancellation(execution)) return;

      const diffResult = await this.sandbox.diffForSession(
        sessionId,
        runId,
        sandboxId,
      );
      if (await this.waitForCancellation(execution)) return;

      await this.completeRun(sessionId, runId, diffResult.diff, runResult);
    } catch (error) {
      if (await this.waitForCancellation(execution)) return;
      await this.failRun(
        sessionId,
        runId,
        runFailure(error, { code: "run_failed", message: "Run failed" }),
        "run_run",
        workerReportFrom(error),
      ).catch(() => undefined);
    } finally {
      execution.runFinished = true;
      logger.debug("run_execution_finished", {
        sessionId,
        runId,
        messageId,
        durationMs: Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1e6,
        ),
        outcome: execution.cancellationCompleted ? "cancelled" : "finished",
        cancellationRequested: execution.cancellationRequested,
        cancellationCompleted: execution.cancellationCompleted,
      });
      if (
        this.executions.get(runId) === execution &&
        (!execution.cancellationRequested || execution.cancellationCompleted)
      )
        this.executions.delete(runId);
    }
  }

  private startCancellation(execution: RunExecution): Promise<void> {
    if (execution.cancellationPromise === undefined) {
      const cancellation = this.cancelExecution(execution).catch(
        (error: unknown) => {
          execution.cancellationPromise = undefined;
          logger.error("run_cancellation_failed", {
            runId: execution.runId,
            error: error instanceof Error ? error.message : error,
          });
          throw error;
        },
      );
      execution.cancellationPromise = cancellation;
    }
    return execution.cancellationPromise;
  }

  private async waitForCancellation(execution: RunExecution): Promise<boolean> {
    if (!execution.cancellationRequested) return false;
    try {
      await this.startCancellation(execution);
    } catch {
      return true;
    }
    return true;
  }

  private async cancelExecution(execution: RunExecution): Promise<void> {
    let completed = false;
    try {
      let diff = "";
      if (execution.sandboxId) {
        try {
          diff = (
            await this.sandbox.diffForSession(
              execution.sessionId,
              execution.runId,
              execution.sandboxId,
            )
          ).diff;
        } catch {
          diff = "";
        }
      }
      await this.cancelRunRow(execution.sessionId, execution.runId, diff);
      execution.cancellationCompleted = true;
      completed = true;
    } finally {
      if (
        completed &&
        (execution.runPromise === undefined || execution.runFinished) &&
        this.executions.get(execution.runId) === execution
      )
        this.executions.delete(execution.runId);
    }
  }

  private async ensureSandbox(
    sessionId: string,
    runId: string,
  ): Promise<EnsuredSandbox> {
    const session = await runQuery(
      "get_session_for_sandbox",
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
            sandbox: { select: { id: true, status: true } },
          },
        }),
    );
    if (!session)
      throw notFound("chat_session_not_found", "Chat session was not found");
    const source = async (): Promise<SandboxProvisioningSource> => {
      if (session.repoSource !== "github")
        return { source: "fixture", fixtureRepoPath: session.repoRef };
      const owner = session.repoOwner?.trim();
      const name = session.repoName?.trim();
      const installationId = session.repoInstallationId?.trim();
      const baseBranch =
        session.repoBaseBranch?.trim() || session.repoDefaultBranch?.trim();
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
        token,
      };
    };
    if (session.sandbox && session.sandbox.status !== "creating") {
      logger.debug("run_sandbox_reused", {
        sessionId,
        runId,
        sandboxId: session.sandbox.id,
      });
      return { sandboxId: session.sandbox.id };
    }
    const provisioningSource = await source();
    if (session.sandbox)
      return { sandboxId: session.sandbox.id, source: provisioningSource };

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
          const event = await this.events.appendRunEventInTransaction(tx, {
            sessionId,
            runId,
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
    logger.debug("run_sandbox_created", {
      sessionId,
      runId,
      sandboxId: created.sandbox.sandboxId,
    });
    return {
      sandboxId: created.sandbox.sandboxId,
      source: provisioningSource,
    };
  }

  private async transitionStatus(
    runId: string,
    status: "provisioning" | "running",
  ): Promise<boolean> {
    const timestamp =
      status === "provisioning" ? "provisioningAt" : "runningAt";
    const updated = await runQuery(
      `transition_chat_run_${status}`,
      { runId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const run = await tx.task.findUnique({
            where: { id: runId },
            select: { status: true },
          });
          if (!run || !canTransition(run.status, status)) return { count: 0 };
          return tx.task.updateMany({
            where: { id: runId, status: run.status },
            data: { status, [timestamp]: new Date() },
          });
        }),
    );
    const changed = updated.count > 0;
    logger.debug("run_status_transitioned", { runId, status, changed });
    return changed;
  }

  private async recordArtifacts(
    sessionId: string,
    runId: string,
    diff: string,
    workerReport: string | null | undefined,
  ): Promise<ArtifactPreview[]> {
    const jobs: Array<Promise<ArtifactPreview>> = [];
    if (diff.trim())
      jobs.push(
        this.artifacts.create({
          sessionId,
          runId,
          kind: "diff",
          contentType: "text/x-diff",
          content: diff,
        }),
      );
    if (workerReport)
      jobs.push(
        this.artifacts.create({
          sessionId,
          runId,
          kind: "worker_report",
          contentType: "application/json",
          content: workerReport,
        }),
      );
    if (jobs.length === 0) return [];
    try {
      return await Promise.all(jobs);
    } catch (error) {
      logger.error("run_artifact_capture_failed", {
        runId,
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  // Event sequence allocation locks the stream row `FOR UPDATE` but does not
  // self-block within the same transaction, so concurrent appends on one
  // transaction can read the same next-sequence value before either commits
  // its increment. Appends within a transaction must run sequentially.
  private async artifactCreatedEvents(
    tx: Prisma.TransactionClient,
    sessionId: string,
    runId: string,
    artifacts: ArtifactPreview[],
  ): Promise<PublicEvent[]> {
    const events: PublicEvent[] = [];
    for (const artifact of artifacts) {
      const payload = {
        artifact_id: artifact.artifactId,
        kind: artifact.kind,
        content_type: artifact.contentType,
        byte_size: artifact.byteSize,
        truncated: artifact.truncated,
        redacted: artifact.redacted,
        preview: artifact.preview,
      };
      events.push(
        await this.events.appendRunEventInTransaction(tx, {
          sessionId,
          runId,
          artifactId: artifact.artifactId,
          type: "artifact_created",
          producerService: "task",
          producerId: artifact.artifactId,
          correlationId: randomUUID(),
          domain: "artifact",
          payload,
        }),
      );
      events.push(
        await this.events.appendSessionEventInTransaction(tx, {
          sessionId,
          runId,
          artifactId: artifact.artifactId,
          type: "artifact_created",
          producerService: "task",
          producerId: artifact.artifactId,
          correlationId: randomUUID(),
          domain: "artifact",
          payload,
        }),
      );
    }
    return events;
  }

  private async completeRun(
    sessionId: string,
    runId: string,
    diff: string,
    runResult: TaskRunResult,
  ): Promise<boolean> {
    const { summary } = runResult;
    const messageId = msgId();
    const artifacts = await this.recordArtifacts(
      sessionId,
      runId,
      diff,
      runResult.workerReport,
    );
    const events = await runQuery(
      "complete_chat_run",
      { sessionId, runId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const run = await tx.task.findUnique({
            where: { id: runId },
            select: { status: true },
          });
          if (!run || !canTransition(run.status, "completed")) return [];

          const claimed = await tx.task.updateMany({
            where: { id: runId, status: run.status },
            data: {
              status: "completed",
              diff,
              agentSummary: summary,
              exitReason: "completed",
              completedAt: new Date(),
            },
          });
          if (claimed.count === 0) return [];

          await tx.chatMessage.create({
            data: {
              id: messageId,
              sessionId,
              runId,
              role: "assistant",
              content: summary ?? "Run completed with no summary.",
            },
          });
          await tx.chatSession.updateMany({
            where: { id: sessionId, activeRunId: runId },
            data: { activeRunId: null, lockedAt: null },
          });

          const messageCreated =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              messageId,
              type: "message_created",
              producerService: "task",
              producerId: messageId,
              correlationId: randomUUID(),
              domain: "message",
              payload: { role: "assistant", content: summary ?? "" },
            });
          const runCompleted = await this.events.appendRunEventInTransaction(
            tx,
            {
              sessionId,
              runId,
              type: "run_completed",
              producerService: "task",
              producerId: runId,
              correlationId: randomUUID(),
              domain: "run",
              payload: { exit_reason: "completed" },
            },
          );
          const runResultReady = await this.events.appendRunEventInTransaction(
            tx,
            {
              sessionId,
              runId,
              type: "run_result_ready",
              producerService: "task",
              producerId: runId,
              correlationId: randomUUID(),
              domain: "run",
              payload: {
                exit_reason: "completed",
                diff_bytes: Buffer.byteLength(diff),
                agent_summary_present: summary !== null,
              },
            },
          );
          const sessionCompleted =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              type: "run_completed",
              producerService: "task",
              producerId: runId,
              correlationId: randomUUID(),
              domain: "run",
              payload: { exit_reason: "completed" },
            });
          const sessionResultReady =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              type: "run_result_ready",
              producerService: "task",
              producerId: runId,
              correlationId: randomUUID(),
              domain: "run",
              payload: {
                exit_reason: "completed",
                diff_bytes: Buffer.byteLength(diff),
                agent_summary_present: summary !== null,
              },
            });
          return [
            messageCreated,
            runCompleted,
            runResultReady,
            sessionCompleted,
            sessionResultReady,
            ...(await this.artifactCreatedEvents(
              tx,
              sessionId,
              runId,
              artifacts,
            )),
          ];
        }),
    );
    for (const event of events) this.publish(event);
    logger.debug("run_completion_recorded", {
      sessionId,
      runId,
      terminalRecorded: events.length > 0,
      eventCount: events.length,
      artifactCount: artifacts.length,
      diffBytes: Buffer.byteLength(diff),
      summaryPresent: summary !== null,
    });
    if (events.length > 0)
      await this.finalizeTrace(runId, {
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
        finalMessage: summary ?? "Run completed with no summary.",
      });
    return events.length > 0;
  }

  private async failRun(
    sessionId: string,
    runId: string,
    failure: TaskFailure,
    operation: string,
    workerReport: string | null,
  ): Promise<boolean> {
    const artifacts = workerReport
      ? await this.recordArtifacts(sessionId, runId, "", workerReport)
      : [];
    const events = await runQuery(
      "fail_chat_run",
      { sessionId, runId, code: failure.code, operation },
      () =>
        this.prisma.$transaction(async (tx) => {
          const run = await tx.task.findUnique({
            where: { id: runId },
            select: { status: true },
          });
          if (!run || !canTransition(run.status, "failed")) return [];

          const claimed = await tx.task.updateMany({
            where: { id: runId, status: run.status },
            data: {
              status: "failed",
              diff: "",
              agentSummary: null,
              exitReason: "failed",
              failureCode: failure.code,
              failureMessage: failure.message,
              failedAt: new Date(),
            },
          });
          if (claimed.count === 0) return [];
          await tx.chatSession.updateMany({
            where: { id: sessionId, activeRunId: runId },
            data: { activeRunId: null, lockedAt: null },
          });

          const runFailed = await this.events.appendRunEventInTransaction(tx, {
            sessionId,
            runId,
            type: "run_failed",
            producerService: "task",
            producerId: runId,
            correlationId: randomUUID(),
            domain: "run",
            payload: {
              code: failure.code,
              message: failure.message,
              operation,
            },
          });
          const runResultReady = await this.events.appendRunEventInTransaction(
            tx,
            {
              sessionId,
              runId,
              type: "run_result_ready",
              producerService: "task",
              producerId: runId,
              correlationId: randomUUID(),
              domain: "run",
              payload: {
                exit_reason: "failed",
                diff_bytes: 0,
                agent_summary_present: false,
              },
            },
          );
          const sessionFailed =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              type: "run_failed",
              producerService: "task",
              producerId: runId,
              correlationId: randomUUID(),
              domain: "run",
              payload: { code: failure.code, message: failure.message },
            });
          const sessionResultReady =
            await this.events.appendSessionEventInTransaction(tx, {
              sessionId,
              runId,
              type: "run_result_ready",
              producerService: "task",
              producerId: runId,
              correlationId: randomUUID(),
              domain: "run",
              payload: {
                exit_reason: "failed",
                diff_bytes: 0,
                agent_summary_present: false,
              },
            });
          return [
            runFailed,
            runResultReady,
            sessionFailed,
            sessionResultReady,
            ...(await this.artifactCreatedEvents(
              tx,
              sessionId,
              runId,
              artifacts,
            )),
          ];
        }),
    );
    for (const event of events) this.publish(event);
    logger.debug("run_failure_recorded", {
      sessionId,
      runId,
      operation,
      failureCode: failure.code,
      terminalRecorded: events.length > 0,
      eventCount: events.length,
      artifactCount: artifacts.length,
      workerReportPresent: Boolean(workerReport),
    });
    if (events.length > 0)
      await this.finalizeTrace(runId, {
        status: "failed",
        exitReason: "failed",
        diffBytes: 0,
        diffPresent: false,
        artifacts: artifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          byteSize: artifact.byteSize,
          truncated: artifact.truncated,
          redacted: artifact.redacted,
        })),
      });
    return events.length > 0;
  }

  private async cancelRunRow(
    sessionId: string,
    runId: string,
    diff: string,
  ): Promise<boolean> {
    const events = await runQuery("cancel_chat_run", { sessionId, runId }, () =>
      this.prisma.$transaction(async (tx) => {
        const claimed = await tx.task.updateMany({
          where: {
            id: runId,
            sessionId,
            status: { in: ["created", "provisioning", "running"] },
          },
          data: {
            status: "cancelled",
            diff,
            agentSummary: null,
            exitReason: "cancelled",
            cancelledAt: new Date(),
          },
        });
        if (claimed.count === 0) return [];
        await tx.chatSession.updateMany({
          where: { id: sessionId, activeRunId: runId },
          data: { activeRunId: null, lockedAt: null },
        });
        const sessionCancelled =
          await this.events.appendSessionEventInTransaction(tx, {
            sessionId,
            runId,
            type: "run_cancelled",
            producerService: "task",
            producerId: runId,
            correlationId: randomUUID(),
            domain: "run",
            payload: { exit_reason: "cancelled" },
          });
        const sessionResult = await this.events.appendSessionEventInTransaction(
          tx,
          {
            sessionId,
            runId,
            type: "run_result_ready",
            producerService: "task",
            producerId: runId,
            correlationId: randomUUID(),
            domain: "run",
            payload: { exit_reason: "cancelled" },
          },
        );
        const runCancelled = await this.events.appendRunEventInTransaction(tx, {
          sessionId,
          runId,
          type: "run_cancelled",
          producerService: "task",
          producerId: runId,
          correlationId: randomUUID(),
          domain: "run",
          payload: { exit_reason: "cancelled" },
        });
        const runResultReady = await this.events.appendRunEventInTransaction(
          tx,
          {
            sessionId,
            runId,
            type: "run_result_ready",
            producerService: "task",
            producerId: runId,
            correlationId: randomUUID(),
            domain: "run",
            payload: { exit_reason: "cancelled" },
          },
        );
        return [sessionCancelled, sessionResult, runCancelled, runResultReady];
      }),
    );
    for (const event of events) this.publish(event);
    logger.debug("run_cancellation_recorded", {
      sessionId,
      runId,
      terminalRecorded: events.length > 0,
      eventCount: events.length,
      diffBytes: Buffer.byteLength(diff),
    });
    if (events.length > 0)
      await this.finalizeTrace(runId, {
        status: "cancelled",
        exitReason: "cancelled",
        diffBytes: Buffer.byteLength(diff),
        diffPresent: diff.trim().length > 0,
        artifacts: [],
      });
    return events.length > 0;
  }

  private async finalizeTrace(
    runId: string,
    terminal: EvalTraceRunFacts,
  ): Promise<void> {
    if (!this.traceRecorder) return;
    try {
      const events = await this.events.listRunEvents(runId, 0);
      await this.traceRecorder.finishRun({ runId, terminal, events });
    } catch (error) {
      logger.warn("eval_trace_finalize_failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
