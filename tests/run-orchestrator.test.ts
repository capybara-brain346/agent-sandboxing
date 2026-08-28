import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RunOrchestrator } from "../src/services/chat/run-orchestrator";
import type { OrchestratorAgent } from "../src/services/agent/orchestrator-agent";
import type { SessionContextBuilder } from "../src/services/chat/session-context-builder";
import type { SessionSummaryCompactor } from "../src/services/agent/session-summary-compactor";
import type { CodeWorker } from "../src/services/agent/code-worker";
import type {
  OrchestratorContext,
  WorkerResult,
} from "../src/types/harness.types";
import type { TaskRunContext } from "../src/services/task/task-runner";
import { ServiceError } from "../src/shared/errors";
import type { EvalTraceRecorderLike } from "../src/services/eval/eval-trace-recorder";

const baseContext = (
  overrides: Partial<OrchestratorContext> = {},
): OrchestratorContext => ({
  sessionId: "chat_1",
  repoRef: "./repo",
  summary: "Objective: do X",
  recentMessages: [],
  recentToolActivity: [],
  messageCount: 3,
  shouldCompact: false,
  workspace: {
    hasPriorRun: false,
    lastRunStatus: null,
    lastRunSummary: null,
    changedFilesHint: [],
  },
  ...overrides,
});

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
  ...overrides,
});

const makeHarness = (options: {
  context?: OrchestratorContext;
  decision?: { reply: string; delegations: WorkerResult[] };
  traceRecorder?: EvalTraceRecorderLike;
}) => {
  const context = options.context ?? baseContext();
  const decision = options.decision ?? { reply: "ok", delegations: [] };

  const contextBuilder = {
    build: vi.fn(async () => context),
  } as unknown as SessionContextBuilder;

  const agent = {
    decide: vi.fn(async () => decision),
  } as unknown as OrchestratorAgent;

  const compactor = {
    compact: vi.fn(async () => "compacted summary"),
  } as unknown as SessionSummaryCompactor;

  const updates: Array<{
    sessionId: string;
    summary: string;
    summaryCompactedThroughMessageCount: number;
  }> = [];
  const prisma = {
    chatSession: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            summary: string;
            summaryCompactedThroughMessageCount: number;
          };
        }) => {
          updates.push({
            sessionId: where.id,
            summary: data.summary,
            summaryCompactedThroughMessageCount:
              data.summaryCompactedThroughMessageCount,
          });
          return { count: 1 };
        },
      ),
    },
  } as unknown as Pick<PrismaClient, "chatSession">;

  const worker: CodeWorker = { run: vi.fn(async () => workerResult()) };

  const orchestrator = new RunOrchestrator(
    prisma,
    contextBuilder,
    compactor,
    worker,
    agent,
    options.traceRecorder,
  );

  return { orchestrator, contextBuilder, agent, compactor, updates };
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

  it("passes the built context and message through to the agent", async () => {
    const context = baseContext({ summary: "Objective: ship it" });
    const { orchestrator, agent } = makeHarness({ context });
    const signal = new AbortController().signal;
    await orchestrator.run({
      ...runContext("what did you change last turn?"),
      signal,
    });
    expect(agent.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Objective: ship it",
        message: "what did you change last turn?",
        signal,
        delegate: expect.any(Function),
      }),
    );
  });

  it("returns the agent's reply directly when it never delegated", async () => {
    const { orchestrator } = makeHarness({
      decision: { reply: "clarifying reply", delegations: [] },
    });
    const result = await orchestrator.run(runContext("what does this do?"));
    expect(result.summary).toBe("clarifying reply");
    expect(result.workerReport).toBeUndefined();
  });

  it("captures the exact delegated brief and result", async () => {
    const traceRecorder = {
      recordOrchestratorContext: vi.fn(),
      recordWorkerBrief: vi.fn(),
      recordWorkerResult: vi.fn(),
      recordOrchestratorReply: vi.fn(),
    } as unknown as EvalTraceRecorderLike;
    const context = baseContext();
    const contextBuilder = {
      build: vi.fn(async () => context),
    } as unknown as SessionContextBuilder;
    const result = workerResult({ summary: "Fixed a.ts" });
    const worker: CodeWorker = { run: vi.fn(async () => result) };
    const agent: OrchestratorAgent = {
      decide: vi.fn(async (input) => {
        const delegated = await input.delegate("exact worker brief");
        return { reply: "done", delegations: [delegated] };
      }),
    };
    const compactor = {
      compact: vi.fn(async () => "summary"),
    } as unknown as SessionSummaryCompactor;
    const prisma = {
      chatSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    } as unknown as Pick<PrismaClient, "chatSession">;
    const orchestrator = new RunOrchestrator(
      prisma,
      contextBuilder,
      compactor,
      worker,
      agent,
      traceRecorder,
    );

    await orchestrator.run(runContext("fix it"));

    expect(traceRecorder.recordWorkerBrief).toHaveBeenCalledWith({
      runId: "run_1",
      brief: "exact worker brief",
    });
    expect(traceRecorder.recordWorkerResult).toHaveBeenCalledWith({
      runId: "run_1",
      result,
    });
    expect(traceRecorder.recordOrchestratorReply).toHaveBeenCalledWith({
      runId: "run_1",
      reply: "done",
      delegated: true,
    });
  });

  it("returns the raw worker report alongside the composed reply on completion", async () => {
    const { orchestrator } = makeHarness({
      decision: {
        reply: "Fixed it",
        delegations: [workerResult({ summary: "Fixed it" })],
      },
    });
    const result = await orchestrator.run(runContext("fix the bug"));
    expect(result.summary).toBe("Fixed it");
    expect(JSON.parse(result.workerReport ?? "{}")).toMatchObject({
      status: "completed",
      summary: "Fixed it",
    });
  });

  it("throws a worker_failed ServiceError when the last delegation failed", async () => {
    const { orchestrator } = makeHarness({
      decision: {
        reply: "it failed",
        delegations: [
          workerResult({ status: "failed", summary: "unrecoverable error" }),
        ],
      },
    });
    await expect(orchestrator.run(runContext("fix the bug"))).rejects.toThrow(
      ServiceError,
    );
  });

  it("attaches the raw worker report to the thrown error", async () => {
    const { orchestrator } = makeHarness({
      decision: {
        reply: "it failed",
        delegations: [
          workerResult({ status: "failed", summary: "unrecoverable error" }),
        ],
      },
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

  it("does not compact the summary on a turn below the compaction threshold", async () => {
    const context = baseContext({ shouldCompact: false });
    const { orchestrator, compactor, updates } = makeHarness({ context });
    await orchestrator.run(runContext("fix the bug"));
    expect(compactor.compact).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("compacts the summary and advances the compaction watermark when the threshold is reached", async () => {
    const context = baseContext({
      shouldCompact: true,
      messageCount: 12,
      recentToolActivity: ["read: did stuff"],
    });
    const { orchestrator, compactor, updates } = makeHarness({ context });
    const signal = new AbortController().signal;
    await orchestrator.run({ ...runContext("fix the bug"), signal });
    expect(compactor.compact).toHaveBeenCalledWith({
      previousSummary: context.summary,
      recentMessages: context.recentMessages,
      recentToolActivity: context.recentToolActivity,
      runId: "run_1",
      signal,
    });
    expect(updates).toEqual([
      {
        sessionId: "chat_1",
        summary: "compacted summary",
        summaryCompactedThroughMessageCount: 12,
      },
    ]);
  });
});
