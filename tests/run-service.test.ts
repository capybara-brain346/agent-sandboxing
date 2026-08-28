import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { RunService } from "../src/services/task/run-service";
import { ServiceError } from "../src/shared/errors";
import type { EventStore } from "../src/services/events/event-store";
import type { SessionSandboxCollaborator } from "../src/services/sandbox/sandbox";
import type { ArtifactRecorder } from "../src/services/artifacts/artifact-store";
import type { PublicEvent } from "../src/types/event.types";
import type { TaskStatus } from "../src/types/task.types";
import type {
  TaskRunContext,
  TaskRunner,
} from "../src/services/task/task-runner";
import type { EvalTraceRecorderLike } from "../src/services/eval/eval-trace-recorder";

const sessionId = "chat_1";
const runId = "run_1";
const messageId = "msg_1";

type Harness = {
  service: RunService;
  status: { value: TaskStatus };
  session: { sandboxId: string | null };
  sandbox: SessionSandboxCollaborator & {
    createForSessionInTransaction: ReturnType<typeof vi.fn>;
    ensureReadyForSession: ReturnType<typeof vi.fn>;
    diffForSession: ReturnType<typeof vi.fn>;
  };
  events: {
    type: PublicEvent["type"];
    scope: "session" | "run";
    artifactId?: string | null;
  }[];
  chatMessages: Array<{ id: string; role: string; content: string }>;
  publish: ReturnType<typeof vi.fn>;
  artifacts: ArtifactRecorder & {
    create: ReturnType<typeof vi.fn>;
  };
  github: {
    createInstallationToken: ReturnType<typeof vi.fn>;
  };
  traceRecorder: EvalTraceRecorderLike & {
    finishRun: ReturnType<typeof vi.fn>;
  };
};

const makeHarness = (
  runner: TaskRunner,
  options: {
    existingSandboxId?: string | null;
    repoSource?: string;
    repoOwner?: string;
    repoName?: string;
    repoInstallationId?: string | null;
    repoDefaultBranch?: string | null;
    repoBaseBranch?: string | null;
    tokenFailure?: boolean;
  } = {},
): Harness => {
  const status = { value: "created" as TaskStatus };
  const session = {
    sandboxId: options.existingSandboxId ?? null,
    activeRunId: runId as string | null,
  };
  const events: Harness["events"] = [];
  const chatMessages: Array<{ id: string; role: string; content: string }> = [];
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
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.activeRunId === null) session.activeRunId = null;
        return { count: 1 };
      }),
    },
  } as unknown as Prisma.TransactionClient;

  const prisma = {
    chatSession: {
      findUnique: vi.fn(async () => ({
        id: sessionId,
        repoSource: options.repoSource ?? "fixture",
        repoRef: "./repo",
        image: null,
        repoOwner:
          options.repoOwner ??
          (options.repoSource === "github" ? "octo" : null),
        repoName:
          options.repoName ?? (options.repoSource === "github" ? "repo" : null),
        repoDefaultBranch:
          options.repoDefaultBranch !== undefined
            ? options.repoDefaultBranch
            : options.repoSource === "github"
              ? "main"
              : null,
        repoInstallationId:
          options.repoInstallationId ??
          (options.repoSource === "github" ? "10" : null),
        repoBaseBranch:
          options.repoBaseBranch !== undefined
            ? options.repoBaseBranch
            : options.repoSource === "github"
              ? "feature"
              : null,
        sandbox: session.sandboxId ? { id: session.sandboxId } : null,
      })),
    },
    task: {
      findUnique: vi.fn(async () => ({ status: status.value })),
    },
    $transaction: vi.fn(
      async (callback: (transaction: Prisma.TransactionClient) => unknown) =>
        callback(tx),
    ),
  } as unknown as PrismaClient;

  const appendScoped =
    (scope: "session" | "run") =>
    async (
      _tx: unknown,
      input: { type: PublicEvent["type"]; artifactId?: string | null },
    ): Promise<PublicEvent> => {
      events.push({
        type: input.type,
        scope,
        artifactId: input.artifactId ?? null,
      });
      return {
        id: `evt_${sequence++}`,
        streamId: scope === "session" ? sessionId : runId,
        streamScope: scope,
        domain: scope,
        sessionId,
        runId,
        taskId: null,
        messageId: null,
        artifactId: input.artifactId ?? null,
        sandboxId: null,
        commandId: null,
        sequence,
        type: input.type,
        producerService: "task",
        producerId: runId,
        correlationId: null,
        payload: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    };

  const eventStore = {
    appendSessionEventInTransaction: vi.fn(appendScoped("session")),
    appendRunEventInTransaction: vi.fn(appendScoped("run")),
    listRunEvents: vi.fn(async () => []),
  } as unknown as EventStore;

  const sandbox = {
    createForSessionInTransaction: vi.fn(async () => {
      session.sandboxId = "sbox_new";
      return {
        sandboxId: "sbox_new",
        containerName: "sandbox-sbox_new",
        workspacePath: "/workspace/repo",
      };
    }),
    ensureReadyForSession: vi.fn(async () => ({ status: "ready" as const })),
    diffForSession: vi.fn(async () => ({
      sandboxId: session.sandboxId ?? "sbox_new",
      diff: "diff --git a b",
      generatedAt: "2026-01-01T00:00:00.000Z",
    })),
  };

  const publish = vi.fn();
  const traceRecorder = {
    startRun: vi.fn(),
    recordOrchestratorContext: vi.fn(),
    recordWorkerBrief: vi.fn(),
    recordWorkerResult: vi.fn(),
    recordOrchestratorReply: vi.fn(),
    recordUsage: vi.fn(),
    finishRun: vi.fn(async () => undefined),
  } as unknown as EvalTraceRecorderLike & {
    finishRun: ReturnType<typeof vi.fn>;
  };
  let artifactSequence = 0;
  const artifacts = {
    create: vi.fn(async (input: { kind: string }) => ({
      artifactId: `art_${artifactSequence++}`,
      kind: input.kind,
      contentType: "text/plain",
      byteSize: 10,
      truncated: false,
      redacted: false,
      preview: "preview",
    })),
  };
  const github = {
    createInstallationToken: vi.fn(async () => {
      if (options.tokenFailure) throw new Error("token was not minted");
      return "installation-token";
    }),
  };
  const service = new RunService(
    prisma,
    eventStore,
    sandbox as unknown as SessionSandboxCollaborator,
    runner,
    publish,
    artifacts,
    traceRecorder,
    github,
  );

  return {
    service,
    status,
    session,
    sandbox,
    events,
    chatMessages,
    publish,
    artifacts,
    traceRecorder,
    github,
  };
};

describe("RunService", () => {
  it("provisions GitHub runs instead of using fixture provisioning", async () => {
    const runner: TaskRunner = {
      run: vi.fn(async () => ({ summary: "Provisioned GitHub workspace" })),
    };
    const harness = makeHarness(runner, { repoSource: "github" });

    harness.service.createRunForMessage(sessionId, runId, messageId, "Fix it");

    await vi.waitFor(() => expect(harness.status.value).toBe("completed"));
    expect(runner.run).toHaveBeenCalled();
    expect(harness.sandbox.createForSessionInTransaction).toHaveBeenCalled();
    expect(harness.sandbox.createForSessionInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        source: {
          source: "github",
          owner: "octo",
          name: "repo",
          installationId: "10",
          cloneUrl: "https://github.com/octo/repo.git",
          baseBranch: "feature",
          token: "installation-token",
        },
        image: undefined,
      },
      { sessionId },
    );
    expect(harness.sandbox.ensureReadyForSession).toHaveBeenCalledWith(
      sessionId,
      runId,
      "sbox_new",
      expect.objectContaining({ source: "github", baseBranch: "feature" }),
    );
    expect(harness.events.map((event) => event.type)).toContain(
      "run_completed",
    );
  });

  it("accepts valid GitHub repository names with leading punctuation", async () => {
    const harness = makeHarness(
      { run: vi.fn(async () => ({ summary: "Provisioned repository" })) },
      { repoSource: "github", repoName: "_repo" },
    );

    harness.service.createRunForMessage(sessionId, runId, messageId, "Fix it");

    await vi.waitFor(() => expect(harness.status.value).toBe("completed"));
    expect(harness.sandbox.ensureReadyForSession).toHaveBeenCalledWith(
      sessionId,
      runId,
      "sbox_new",
      expect.objectContaining({ source: "github", name: "_repo" }),
    );
  });

  it("falls back to the GitHub default branch when no base branch is selected", async () => {
    const harness = makeHarness(
      { run: vi.fn(async () => ({ summary: "Checked out default" })) },
      {
        repoSource: "github",
        repoBaseBranch: null,
        repoDefaultBranch: "trunk",
      },
    );

    harness.service.createRunForMessage(sessionId, runId, messageId, "Inspect");

    await vi.waitFor(() => expect(harness.status.value).toBe("completed"));
    expect(harness.sandbox.ensureReadyForSession).toHaveBeenCalledWith(
      sessionId,
      runId,
      "sbox_new",
      expect.objectContaining({ baseBranch: "trunk" }),
    );
  });

  it("fails safely when the GitHub installation token cannot be minted", async () => {
    const harness = makeHarness(
      { run: vi.fn() },
      { repoSource: "github", tokenFailure: true },
    );

    harness.service.createRunForMessage(sessionId, runId, messageId, "Inspect");

    await vi.waitFor(() => expect(harness.status.value).toBe("failed"));
    expect(
      harness.sandbox.createForSessionInTransaction,
    ).not.toHaveBeenCalled();
    expect(harness.sandbox.ensureReadyForSession).not.toHaveBeenCalled();
    expect(harness.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "run_failed" })]),
    );
  });

  it("fails safely when both GitHub branch fields are missing", async () => {
    const harness = makeHarness(
      { run: vi.fn() },
      {
        repoSource: "github",
        repoBaseBranch: null,
        repoDefaultBranch: null,
      },
    );

    harness.service.createRunForMessage(sessionId, runId, messageId, "Inspect");

    await vi.waitFor(() => expect(harness.status.value).toBe("failed"));
    expect(harness.github.createInstallationToken).not.toHaveBeenCalled();
    expect(
      harness.sandbox.createForSessionInTransaction,
    ).not.toHaveBeenCalled();
  });

  it("provisions a session sandbox on first run, runs the worker, and completes without stopping it", async () => {
    const runner: TaskRunner = {
      run: vi.fn(async (context: TaskRunContext) => {
        expect(context.sessionId).toBe(sessionId);
        expect(context.messageId).toBe(messageId);
        expect(context.taskId).toBe(runId);
        return { summary: "Fixed the failing test" };
      }),
    };
    const harness = makeHarness(runner);

    harness.service.createRunForMessage(sessionId, runId, messageId, "Fix it");

    await vi.waitFor(() => expect(harness.status.value).toBe("completed"));
    await vi.waitFor(() =>
      expect(harness.traceRecorder.finishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId,
          terminal: expect.objectContaining({
            status: "completed",
            exitReason: "completed",
            diffPresent: true,
          }),
        }),
      ),
    );

    expect(harness.sandbox.createForSessionInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        source: { source: "fixture", fixtureRepoPath: "./repo" },
        image: undefined,
      },
      { sessionId },
    );
    expect(harness.sandbox.ensureReadyForSession).toHaveBeenCalledWith(
      sessionId,
      runId,
      "sbox_new",
      { source: "fixture", fixtureRepoPath: "./repo" },
    );
    expect(harness.session.activeRunId).toBeNull();
    expect(harness.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Fixed the failing test",
      }),
    ]);
    expect(harness.events.map((event) => event.type)).toContain(
      "run_completed",
    );
    expect(harness.events.map((event) => event.type)).toContain(
      "run_result_ready",
    );
  });

  it("reuses an existing session sandbox instead of creating a new one", async () => {
    const runner: TaskRunner = {
      run: vi.fn(async () => ({ summary: "Reused sandbox" })),
    };
    const harness = makeHarness(runner, { existingSandboxId: "sbox_existing" });

    harness.service.createRunForMessage(sessionId, runId, messageId, "Fix it");

    await vi.waitFor(() => expect(harness.status.value).toBe("completed"));

    expect(
      harness.sandbox.createForSessionInTransaction,
    ).not.toHaveBeenCalled();
    expect(harness.sandbox.ensureReadyForSession).toHaveBeenCalledWith(
      sessionId,
      runId,
      "sbox_existing",
    );
  });

  it("aborts an in-flight run and releases the session lock on cancellation", async () => {
    let context: TaskRunContext | undefined;
    const runner: TaskRunner = {
      run: vi.fn(
        (nextContext: TaskRunContext) =>
          new Promise((resolve) => {
            context = nextContext;
            nextContext.signal.addEventListener(
              "abort",
              () => resolve({ summary: null }),
              { once: true },
            );
          }),
      ),
    };
    const harness = makeHarness(runner);

    harness.service.createRunForMessage(sessionId, runId, messageId, "Fix it");
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(1));

    expect(harness.service.requestCancellation(sessionId, runId)).toBe(true);
    await vi.waitFor(() => expect(harness.status.value).toBe("cancelled"));
    await vi.waitFor(() =>
      expect(harness.traceRecorder.finishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId,
          terminal: expect.objectContaining({
            status: "cancelled",
            exitReason: "cancelled",
          }),
        }),
      ),
    );

    expect(context?.signal.aborted).toBe(true);
    expect(harness.session.activeRunId).toBeNull();
    expect(harness.events.map((event) => event.type)).toContain(
      "run_cancelled",
    );
  });

  it("cancels directly when no in-flight execution is tracked", async () => {
    const harness = makeHarness({ run: vi.fn() });

    expect(harness.service.requestCancellation(sessionId, runId)).toBe(false);
    await expect(
      harness.service.cancelDirectly(sessionId, runId),
    ).resolves.toBe(true);

    expect(harness.status.value).toBe("cancelled");
    expect(harness.session.activeRunId).toBeNull();
  });

  it("stores a diff artifact and emits artifact_created on both streams", async () => {
    const runner: TaskRunner = {
      run: vi.fn(async () => ({ summary: "Fixed it" })),
    };
    const harness = makeHarness(runner);

    harness.service.createRunForMessage(sessionId, runId, messageId, "Fix it");
    await vi.waitFor(() => expect(harness.status.value).toBe("completed"));

    expect(harness.artifacts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        runId,
        kind: "diff",
        content: "diff --git a b",
      }),
    );
    const artifactEvents = harness.events.filter(
      (event) => event.type === "artifact_created",
    );
    expect(artifactEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "run",
          artifactId: expect.any(String),
        }),
        expect.objectContaining({
          scope: "session",
          artifactId: expect.any(String),
        }),
      ]),
    );
  });

  it("stores a worker_report artifact when a run fails with a raw report attached", async () => {
    const runner: TaskRunner = {
      run: vi.fn(async () => {
        throw new ServiceError("worker_failed", "CodeWorker failed", 502, {
          workerReport: '{"status":"failed"}',
        });
      }),
    };
    const harness = makeHarness(runner);

    harness.service.createRunForMessage(sessionId, runId, messageId, "Fix it");
    await vi.waitFor(() => expect(harness.status.value).toBe("failed"));
    await vi.waitFor(() =>
      expect(harness.traceRecorder.finishRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId,
          terminal: expect.objectContaining({
            status: "failed",
            exitReason: "failed",
          }),
        }),
      ),
    );

    expect(harness.artifacts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        runId,
        kind: "worker_report",
        content: '{"status":"failed"}',
      }),
    );
    expect(
      harness.events.some((event) => event.type === "artifact_created"),
    ).toBe(true);
  });
});
