import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { RunService } from "../src/services/task/run-service";
import { RunOrchestrator } from "../src/services/chat/run-orchestrator";
import { StaticOrchestratorAgent } from "../src/services/chat/orchestrator-agent";
import { CodeWorkerRunner } from "../src/services/agent/code-worker-runner";
import type { SessionContextBuilder } from "../src/services/chat/session-context-builder";
import { StaticSessionSummaryCompactor } from "../src/services/chat/session-summary-compactor";
import type { EventStore } from "../src/services/events/event-store";
import type { SessionSandboxCollaborator } from "../src/services/sandbox/sandbox";
import type { PublicEvent } from "../src/types/event.types";
import type { TaskStatus } from "../src/types/task.types";
import type { OrchestratorContext } from "../src/types/harness.types";
import type {
  TaskRunContext,
  TaskRunner,
} from "../src/services/task/task-runner";

const sessionId = "chat_1";
const runId = "run_1";
const messageId = "msg_1";

describe("message -> run -> worker -> assistant message -> summary update", () => {
  it("drives the full harness loop end to end with fake collaborators", async () => {
    const status = { value: "created" as TaskStatus };
    const session = {
      sandboxId: "sbox_existing" as string | null,
      activeRunId: runId as string | null,
    };
    const chatMessages: Array<{ id: string; role: string; content: string }> =
      [];
    const summaryUpdates: string[] = [];
    let sequence = 1;

    const tx = {
      task: {
        findUnique: vi.fn(async () => ({ status: status.value })),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { status?: TaskStatus | { in: TaskStatus[] } };
            data: Record<string, unknown>;
          }) => {
            const expected = where.status;
            const matches =
              expected === undefined ||
              (typeof expected === "object"
                ? expected.in.includes(status.value)
                : expected === status.value);
            if (!matches) return { count: 0 };
            if (typeof data.status === "string")
              status.value = data.status as TaskStatus;
            return { count: 1 };
          },
        ),
      },
      chatMessage: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          chatMessages.push({
            id: String(data.id),
            role: String(data.role),
            content: String(data.content),
          });
          return data;
        }),
      },
      chatSession: {
        updateMany: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => {
            if (data.activeRunId === null) session.activeRunId = null;
            return { count: 1 };
          },
        ),
      },
    } as unknown as Prisma.TransactionClient;

    const runServicePrisma = {
      chatSession: {
        findUnique: vi.fn(async () => ({
          id: sessionId,
          repoRef: "./repo",
          image: null,
          sandbox: { id: session.sandboxId },
        })),
      },
      task: { findUnique: vi.fn(async () => ({ status: status.value })) },
      $transaction: vi.fn(
        async (callback: (transaction: Prisma.TransactionClient) => unknown) =>
          callback(tx),
      ),
    } as unknown as PrismaClient;

    const appendScoped =
      (scope: "session" | "run") =>
      async (
        _tx: unknown,
        input: { type: PublicEvent["type"] },
      ): Promise<PublicEvent> => ({
        id: `evt_${sequence++}`,
        streamId: scope === "session" ? sessionId : runId,
        streamScope: scope,
        domain: scope,
        sessionId,
        runId,
        taskId: null,
        messageId: null,
        artifactId: null,
        sandboxId: null,
        commandId: null,
        sequence,
        type: input.type,
        producerService: "task",
        producerId: runId,
        correlationId: null,
        payload: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    const eventStore = {
      appendSessionEventInTransaction: vi.fn(appendScoped("session")),
      appendRunEventInTransaction: vi.fn(appendScoped("run")),
    } as unknown as EventStore;

    const sandbox = {
      createForSessionInTransaction: vi.fn(),
      ensureReadyForSession: vi.fn(async () => ({ status: "ready" as const })),
      diffForSession: vi.fn(async () => ({
        sandboxId: "sbox_existing",
        diff: "diff --git a/src/x.ts b/src/x.ts",
        generatedAt: "2026-01-01T00:00:00.000Z",
      })),
    } as unknown as SessionSandboxCollaborator;

    const orchestratorContext: OrchestratorContext = {
      sessionId,
      repoRef: "./repo",
      summary: "",
      recentMessages: [{ role: "user", content: "Fix the bug" }],
      recentToolActivity: [],
      messageCount: 1,
      shouldCompact: true,
      workspace: {
        hasPriorRun: true,
        lastRunStatus: "completed",
        lastRunSummary: "Fixed the bug in src/x.ts",
        changedFilesHint: ["src/x.ts"],
      },
    };
    const contextBuilder = {
      build: vi.fn(async () => orchestratorContext),
    } as unknown as SessionContextBuilder;

    const underlyingWorker: TaskRunner = {
      run: vi.fn(async (context: TaskRunContext) => {
        expect(context.sessionId).toBe(sessionId);
        expect(context.instructions).toContain("Fix the bug");
        return {
          summary: JSON.stringify({
            status: "completed",
            summary: "Fixed the bug in src/x.ts",
            changedFiles: ["src/x.ts"],
            testsRun: [],
            blockers: [],
            suggestedNextStep: "",
          }),
        };
      }),
    };

    const orchestratorPrisma = {
      chatSession: {
        updateMany: vi.fn(async ({ data }: { data: { summary: string } }) => {
          summaryUpdates.push(data.summary);
          return { count: 1 };
        }),
      },
    } as unknown as Pick<PrismaClient, "chatSession">;

    const orchestrator = new RunOrchestrator(
      orchestratorPrisma,
      contextBuilder,
      new StaticSessionSummaryCompactor(),
      new CodeWorkerRunner(underlyingWorker),
      new StaticOrchestratorAgent(),
    );

    const publish = vi.fn();
    const runService = new RunService(
      runServicePrisma,
      eventStore,
      sandbox,
      orchestrator,
      publish,
    );

    runService.createRunForMessage(sessionId, runId, messageId, "Fix the bug");

    await vi.waitFor(() => expect(status.value).toBe("completed"));

    expect(chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Fixed the bug in src/x.ts",
      }),
    ]);
    expect(summaryUpdates).toHaveLength(1);
    expect(summaryUpdates[0]).toContain("Objective: Fix the bug");
    expect(summaryUpdates[0]).toContain("src/x.ts");
    expect(session.activeRunId).toBeNull();
  });
});
