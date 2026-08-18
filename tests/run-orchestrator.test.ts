import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_MAX_WORKER_ATTEMPTS,
  RunOrchestrator,
  type OrchestratorResponder,
} from "../src/services/chat/run-orchestrator";
import type { SessionContextBuilder } from "../src/services/chat/session-context-builder";
import type { SessionSummaryService } from "../src/services/chat/session-summary";
import type { CodeWorkerRunner } from "../src/services/agent/code-worker-runner";
import type {
  OrchestratorContext,
  WorkerResult,
} from "../src/types/harness.types";
import type { TaskRunContext } from "../src/services/task/task-runner";
import { ServiceError } from "../src/shared/errors";

const baseContext: OrchestratorContext = {
  sessionId: "chat_1",
  repoRef: "./repo",
  summary: "Objective: do X",
  recentMessages: [],
  workspace: {
    hasPriorRun: false,
    lastRunStatus: null,
    lastRunSummary: null,
    changedFilesHint: [],
  },
};

const runContext = (instructions: string): TaskRunContext => ({
  taskId: "run_1",
  sandboxId: "sbox_1",
  instructions,
  signal: new AbortController().signal,
  sessionId: "chat_1",
  messageId: "msg_1",
});

const workerResult = (overrides: Partial<WorkerResult> = {}): WorkerResult => ({
  status: "completed",
  summary: "Did the work",
  changedFiles: [],
  testsRun: [],
  blockers: [],
  suggestedNextStep: "",
  ...overrides,
});

const makeHarness = (options: {
  workerRuns?: WorkerResult[];
  responder?: OrchestratorResponder;
}) => {
  const runs = options.workerRuns ?? [workerResult()];
  let call = 0;
  const workerRun = vi.fn(async (context: TaskRunContext) => {
    const result = runs[Math.min(call, runs.length - 1)];
    call += 1;
    return { context, result };
  });
  const seenContexts: TaskRunContext[] = [];
  const worker = {
    run: vi.fn(async (context: TaskRunContext) => {
      const { context: seen, result } = await workerRun(context);
      seenContexts.push(seen);
      return result;
    }),
  } as unknown as CodeWorkerRunner;

  const contextBuilder = {
    build: vi.fn(async () => baseContext),
  } as unknown as SessionContextBuilder;

  const persisted: Array<Parameters<SessionSummaryService["rewrite"]>[0]> = [];
  const summaryService = {
    rewrite: vi.fn((input: Parameters<SessionSummaryService["rewrite"]>[0]) => {
      persisted.push(input);
      return `rewritten:${input.outcome.kind}`;
    }),
  } as unknown as SessionSummaryService;

  const updates: Array<{ sessionId: string; summary: string }> = [];
  const prisma = {
    chatSession: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { summary: string };
        }) => {
          updates.push({ sessionId: where.id, summary: data.summary });
          return { count: 1 };
        },
      ),
    },
  } as unknown as Pick<PrismaClient, "chatSession">;

  const responder =
    options.responder ??
    ({
      respond: vi.fn(async () => "clarifying reply"),
    } as OrchestratorResponder);

  const orchestrator = new RunOrchestrator(
    prisma,
    contextBuilder,
    summaryService,
    worker,
    responder,
  );

  return {
    orchestrator,
    worker,
    contextBuilder,
    summaryService,
    updates,
    responder,
    seenContexts,
  };
};

describe("RunOrchestrator", () => {
  it("throws when the run has no session scope", async () => {
    const { orchestrator } = makeHarness({});
    await expect(
      orchestrator.run({
        taskId: "run_1",
        sandboxId: "sbox_1",
        instructions: "fix it",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("RunOrchestrator requires a session-scoped run");
  });

  it("answers a clarification message without invoking the worker", async () => {
    const { orchestrator, worker, updates } = makeHarness({});
    const result = await orchestrator.run(runContext("what does this do?"));
    expect(result.summary).toBe("clarifying reply");
    expect(worker.run).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { sessionId: "chat_1", summary: "rewritten:clarification" },
    ]);
  });

  it("invokes the worker once and returns its summary when it completes on the first attempt", async () => {
    const { orchestrator, worker, updates } = makeHarness({
      workerRuns: [workerResult({ summary: "Fixed it" })],
    });
    const result = await orchestrator.run(runContext("fix the bug"));
    expect(result.summary).toBe("Fixed it");
    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      { sessionId: "chat_1", summary: "rewritten:worker_completed" },
    ]);
  });

  it("returns the raw worker report alongside the composed summary", async () => {
    const { orchestrator } = makeHarness({
      workerRuns: [
        workerResult({ summary: "Fixed it", changedFiles: ["a.ts"] }),
      ],
    });
    const result = await orchestrator.run(runContext("fix the bug"));
    expect(result.workerReport).toBeTruthy();
    expect(JSON.parse(result.workerReport ?? "{}")).toMatchObject({
      status: "completed",
      summary: "Fixed it",
      changedFiles: ["a.ts"],
    });
  });

  it("retries with a narrow correction brief when the worker reports blocked, then completes", async () => {
    const { orchestrator, worker, seenContexts } = makeHarness({
      workerRuns: [
        workerResult({
          status: "blocked",
          blockers: ["missing config"],
          suggestedNextStep: "ask for config",
        }),
        workerResult({ status: "completed", summary: "Now fixed" }),
      ],
    });
    const result = await orchestrator.run(runContext("fix the bug"));
    expect(result.summary).toBe("Now fixed");
    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(seenContexts[1]?.instructions).toContain("missing config");
    expect(seenContexts[1]?.instructions).toContain("ask for config");
  });

  it("stops after the max attempt budget and surfaces blockers when still blocked", async () => {
    const { orchestrator, worker } = makeHarness({
      workerRuns: [
        workerResult({ status: "blocked", blockers: ["still stuck"] }),
        workerResult({ status: "blocked", blockers: ["still stuck"] }),
      ],
    });
    const result = await orchestrator.run(runContext("fix the bug"));
    expect(worker.run).toHaveBeenCalledTimes(DEFAULT_MAX_WORKER_ATTEMPTS);
    expect(result.summary).toContain("still stuck");
  });

  it("throws a worker_failed ServiceError when the worker fails after exhausting attempts", async () => {
    const { orchestrator, updates } = makeHarness({
      workerRuns: [
        workerResult({ status: "failed", blockers: ["unrecoverable error"] }),
        workerResult({ status: "failed", blockers: ["unrecoverable error"] }),
      ],
    });
    await expect(orchestrator.run(runContext("fix the bug"))).rejects.toThrow(
      ServiceError,
    );
    expect(updates).toEqual([
      { sessionId: "chat_1", summary: "rewritten:worker_failed" },
    ]);
  });

  it("attaches the raw worker report to the thrown error so it can still be archived", async () => {
    const { orchestrator } = makeHarness({
      workerRuns: [
        workerResult({ status: "failed", blockers: ["unrecoverable error"] }),
        workerResult({ status: "failed", blockers: ["unrecoverable error"] }),
      ],
    });
    try {
      await orchestrator.run(runContext("fix the bug"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      const workerReport = (error as ServiceError).details.workerReport;
      expect(typeof workerReport).toBe("string");
      expect(JSON.parse(workerReport as string)).toMatchObject({
        status: "failed",
      });
    }
  });
});
