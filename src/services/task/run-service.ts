import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ServiceError, notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { logger } from "../../logger";
import { EventStore } from "../events/event-store";
import type { SessionSandboxCollaborator } from "../sandbox/sandbox";
import type { PublicEvent } from "../../types/event.types";
import type { TaskFailure } from "../../types/task.types";
import { canTransition } from "./task";
import type { TaskRunner } from "./task-runner";

type PublishEvent = (event: PublicEvent) => void;

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
  ) {}

  createRunForMessage(
    sessionId: string,
    runId: string,
    messageId: string,
    instructions: string,
  ): void {
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
    try {
      if (await this.waitForCancellation(execution)) return;

      const sandboxId = await this.ensureSandbox(sessionId, runId);
      execution.sandboxId = sandboxId;
      if (await this.waitForCancellation(execution)) return;

      if (!(await this.transitionStatus(runId, "provisioning"))) return;
      if (await this.waitForCancellation(execution)) return;

      const outcome = await this.sandbox.ensureReadyForSession(
        sessionId,
        runId,
        sandboxId,
      );
      if (await this.waitForCancellation(execution)) return;
      if (outcome.status === "failed") {
        await this.failRun(sessionId, runId, outcome.failure, "provision_run");
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
      if (await this.waitForCancellation(execution)) return;

      const diffResult = await this.sandbox.diffForSession(
        sessionId,
        runId,
        sandboxId,
      );
      if (await this.waitForCancellation(execution)) return;

      await this.completeRun(
        sessionId,
        runId,
        diffResult.diff,
        runResult.summary,
      );
    } catch (error) {
      if (await this.waitForCancellation(execution)) return;
      await this.failRun(
        sessionId,
        runId,
        runFailure(error, { code: "run_failed", message: "Run failed" }),
        "run_run",
      ).catch(() => undefined);
    } finally {
      execution.runFinished = true;
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
  ): Promise<string> {
    const session = await runQuery(
      "get_session_for_sandbox",
      { sessionId },
      () =>
        this.prisma.chatSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            repoRef: true,
            image: true,
            sandbox: { select: { id: true } },
          },
        }),
    );
    if (!session)
      throw notFound("chat_session_not_found", "Chat session was not found");
    if (session.sandbox) return session.sandbox.id;

    const created = await runQuery(
      "create_session_sandbox",
      { sessionId },
      () =>
        this.prisma.$transaction(async (tx) => {
          const sandbox = await this.sandbox.createForSessionInTransaction(
            tx,
            {
              fixtureRepoPath: session.repoRef,
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
    return created.sandbox.sandboxId;
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
    return updated.count > 0;
  }

  private async completeRun(
    sessionId: string,
    runId: string,
    diff: string,
    summary: string | null,
  ): Promise<boolean> {
    const messageId = msgId();
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
          ];
        }),
    );
    for (const event of events) this.publish(event);
    return events.length > 0;
  }

  private async failRun(
    sessionId: string,
    runId: string,
    failure: TaskFailure,
    operation: string,
  ): Promise<boolean> {
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
          return [runFailed, runResultReady, sessionFailed, sessionResultReady];
        }),
    );
    for (const event of events) this.publish(event);
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
    return events.length > 0;
  }
}
