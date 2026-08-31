import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import type {
  ArtifactContent,
  ArtifactPointer,
} from "../../src/types/artifact.types";
import type {
  ChatMessage,
  CreateMessageResponse,
  CreateSessionResponse,
  SessionResult,
} from "../../src/types/chat.types";
import type { PublicEvent } from "../../src/types/event.types";
import type { SessionAgentResult } from "../../src/types/harness.types";
import {
  allRepoScoresPass,
  changedFilesFromDiff,
  scoreRepoCase,
} from "./scorers";
import {
  loadRepoCases,
  runRepoEvals,
  type RepoEvalChatSessionService,
} from "./run-repo-evals";
import type { RepoObserved } from "./types";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: aiMocks.generateText };
});

const workerReport: SessionAgentResult = {
  status: "completed",
  summary: "Updated README.md",
};

const subjectiveScores = {
  task_success_1_to_5: 5,
  minimality_1_to_5: 4,
  verification_quality_1_to_5: 4,
  response_quality_1_to_5: 5,
  blocker_honesty_1_to_5: 5,
} as const;

const event = (messageId: string, sandboxId = "sbox_eval"): PublicEvent => ({
  id: `evt_${messageId}`,
  streamId: "chat_eval",
  streamScope: "session",
  domain: "sandbox",
  sessionId: "chat_eval",
  messageId,
  artifactId: null,
  sandboxId,
  commandId: null,
  sequence: 1,
  type: "sandbox_ready",
  producerService: "sandbox",
  producerId: sandboxId,
  correlationId: "corr_eval",
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});

const message = (
  messageId: string,
  content = "Updated README.md and completed the requested change.",
): ChatMessage => ({
  messageId: `assistant_${messageId}`,
  chatSessionId: "chat_eval",
  role: "assistant",
  content,
  processingStatus: null,
  processingStartedAt: null,
  processingCompletedAt: null,
  failure: null,
  agentSummary: null,
  createdAt: "2026-01-01T00:00:01.000Z",
});

const fakeService = (
  repositoryPaths: string[],
  resultDiff = "diff --git a/README.md b/README.md\n+Acme Tools is ready for teams.",
  assistantContent = "Updated README.md and completed the requested change.",
  snapshotSandboxId: string | null = "sbox_eval",
): RepoEvalChatSessionService => {
  const session: CreateSessionResponse = {
    chatSessionId: "chat_eval",
    title: null,
    repo: {
      source: "fixture",
      ref: "",
      provider: null,
      owner: null,
      name: null,
      repoId: null,
      defaultBranch: null,
      installationId: null,
      baseBranch: null,
      baseSha: null,
    },
    status: "active",
    sandboxId: null,
    eventsUrl: "/chat-sessions/chat_eval/events",
    messagesUrl: "/chat-sessions/chat_eval/messages",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const messageId = "msg_eval";
  const result: SessionResult = {
    messageId,
    chatSessionId: "chat_eval",
    status: "completed",
    diff: resultDiff,
    artifacts: [
      {
        artifactId: "art_worker",
        kind: "worker_report",
        contentType: "application/json",
        byteSize: 100,
        truncated: false,
        redacted: false,
      } satisfies ArtifactPointer,
    ],
    agentSummary: message(messageId, assistantContent).content,
    exitReason: "completed",
    failure: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
  };
  const workerArtifact: ArtifactContent = {
    artifactId: "art_worker",
    sessionId: "chat_eval",
    messageId,
    kind: "worker_report",
    contentType: "application/json",
    content: JSON.stringify(workerReport),
    byteSize: 100,
    truncated: false,
    redacted: false,
    createdAt: "2026-01-01T00:00:01.000Z",
  };

  return {
    createSession: vi.fn(async (_userId, input) => {
      repositoryPaths.push(input.repo.ref);
      return { ...session, repo: { ...session.repo, ref: input.repo.ref } };
    }),
    appendMessage: vi.fn(async (): Promise<CreateMessageResponse> => ({
      message: {
        messageId,
        chatSessionId: "chat_eval",
        role: "user",
        content: "Append the sentence.",
        processingStatus: "queued",
        processingStartedAt: null,
        processingCompletedAt: null,
        failure: null,
        agentSummary: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      sessionUrl: "/chat-sessions/chat_eval",
      messagesUrl: "/chat-sessions/chat_eval/messages",
      eventsUrl: "/chat-sessions/chat_eval/events",
    })),
    sessionResult: vi.fn(async () => result),
    listMessages: vi.fn(
      async (): Promise<{
        items: ChatMessage[];
        nextCursor: string | null;
      }> => ({
        items: [message(messageId, assistantContent)],
        nextCursor: null,
      }),
    ),
    sessionEventsAfter: vi.fn(async (): Promise<PublicEvent[]> => [
      event(messageId, snapshotSandboxId ?? "sbox_eval"),
    ]),
    getArtifact: vi.fn(async (): Promise<ArtifactContent> => workerArtifact),
  };
};

describe("repo eval suite", () => {
  it("loads ten repository cases", () => {
    const cases = loadRepoCases();
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(10);
  });

  it("scores required diff, worker, and response facts", () => {
    const testCase = loadRepoCases().find(
      (candidate) => candidate.id === "python-mini-add-readme-sentence",
    );
    if (!testCase) throw new Error("repo case not found");
    const observed: RepoObserved = {
      processingStatus: "completed",
      workerStatus: "completed",
      delegationCount: 1,
      changedFiles: ["README.md"],
      diff: "diff --git a/README.md b/README.md\n+Acme Tools is ready for teams.",
      testsRun: [],
      postProcessingChecks: [],
      workerReports: [workerReport],
      toolEvents: [],
      messageIds: ["msg_1"],
      finalMessage: "Updated README.md and completed the requested change.",
      assistantMessages: [
        "Updated README.md and completed the requested change.",
      ],
    };

    expect(allRepoScoresPass(scoreRepoCase(testCase, observed))).toBe(true);
    expect(changedFilesFromDiff(observed.diff)).toEqual(["README.md"]);
  });

  it("collects message processing, writes JSONL, and removes the copied repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "repo-evals-test-"));
    const resultsDir = join(directory, "results");
    const paths: string[] = [];
    const casesPath = join(directory, "cases.jsonl");
    const source = join(process.cwd(), "tests/evals/fixtures");
    try {
      await writeFile(
        casesPath,
        `${JSON.stringify(loadRepoCases()[2])}\n`,
        "utf8",
      );
      const result = await runRepoEvals({
        service: fakeService(paths),
        casesPath,
        fixturesDir: source,
        resultsDir,
        timeoutMs: 100,
        pollIntervalMs: 1,
        now: new Date("2026-01-01T00:00:00.000Z"),
      });

      expect(result.results[0]?.status).toBe("passed");
      expect(result.results[0]?.observed.changedFiles).toEqual(["README.md"]);
      expect(
        JSON.parse((await readFile(result.resultsPath, "utf8")).trim()),
      ).toMatchObject({
        caseId: "python-mini-add-readme-sentence",
        status: "passed",
      });
      expect(paths).toHaveLength(1);
      await expect(access(paths[0] ?? "")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports subjective scores without changing deterministic gating", async () => {
    const directory = await mkdtemp(join(tmpdir(), "repo-evals-judge-test-"));
    const casesPath = join(directory, "cases.jsonl");
    const resultsPath = join(directory, "results.jsonl");
    const paths: string[] = [];
    try {
      await writeFile(
        casesPath,
        `${JSON.stringify(loadRepoCases()[2])}\n`,
        "utf8",
      );
      aiMocks.generateText.mockResolvedValueOnce({
        output: subjectiveScores,
      });

      const result = await runRepoEvals({
        service: fakeService(paths),
        casesPath,
        fixturesDir: join(process.cwd(), "tests/evals/fixtures"),
        resultsPath,
        judgeModel: {} as LanguageModel,
        timeoutMs: 100,
        pollIntervalMs: 1,
      });

      expect(result.results[0]?.status).toBe("passed");
      expect(result.results[0]?.subjectiveJudge).toMatchObject({
        status: "reported",
        scores: subjectiveScores,
      });
      expect(
        JSON.parse((await readFile(resultsPath, "utf8")).trim()),
      ).toMatchObject({
        subjectiveJudge: { status: "reported", scores: subjectiveScores },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs post-run checks and resumes passing cases", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "repo-evals-post-run-test-"),
    );
    const resultsPath = join(directory, "results.jsonl");
    const casesPath = join(directory, "cases.jsonl");
    const paths: string[] = [];
    const base = loadRepoCases()[2];
    if (!base) throw new Error("repo case not found");
    const testCase = {
      ...base,
      expect: {
        ...base.expect,
        changedFiles: ["eval-marker.txt"],
        diffMustContain: ["marker"],
        postProcessingCommands: ["grep -F marker eval-marker.txt"],
      },
    };
    const markerDiff =
      "diff --git a/eval-marker.txt b/eval-marker.txt\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/eval-marker.txt\n@@ -0,0 +1 @@\n+marker\n";
    try {
      await writeFile(casesPath, `${JSON.stringify(testCase)}\n`, "utf8");
      const service = fakeService(paths, markerDiff, "Verified with pytest.");
      const options = {
        service,
        casesPath,
        fixturesDir: join(process.cwd(), "tests/evals/fixtures"),
        resultsPath,
        timeoutMs: 100,
        pollIntervalMs: 1,
      };
      const first = await runRepoEvals(options);
      expect(first.results[0]?.status).toBe("passed");
      expect(first.results[0]?.observed.postProcessingChecks).toMatchObject([
        { passed: true, command: testCase.expect.postProcessingCommands[0] },
      ]);

      const second = await runRepoEvals({ ...options, resume: true });
      expect(second.results[0]?.status).toBe("passed");
      expect(paths).toHaveLength(1);
      expect(
        (await readFile(resultsPath, "utf8")).trim().split("\n"),
      ).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses session event sandbox id for post-processing checks", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "repo-evals-event-sandbox-"),
    );
    const resultsPath = join(directory, "results.jsonl");
    const casesPath = join(directory, "cases.jsonl");
    const paths: string[] = [];
    const base = loadRepoCases()[2];
    if (!base) throw new Error("repo case not found");
    const testCase = {
      ...base,
      expect: {
        ...base.expect,
        postProcessingCommands: ["python -m pytest tests/test_cli.py"],
      },
    };
    try {
      await writeFile(casesPath, `${JSON.stringify(testCase)}\n`, "utf8");
      const service = fakeService(
        paths,
        "diff --git a/README.md b/README.md\n+Acme Tools is ready for teams.",
        "Verified with pytest.",
        null,
      );
      service.postProcessingCommand = vi.fn(async () => ({
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
        truncated: false,
      }));

      await runRepoEvals({
        service,
        casesPath,
        fixturesDir: join(process.cwd(), "tests/evals/fixtures"),
        resultsPath,
        timeoutMs: 100,
        pollIntervalMs: 1,
      });

      expect(service.postProcessingCommand).toHaveBeenCalledWith(
        expect.objectContaining({ sandboxId: "sbox_eval" }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
