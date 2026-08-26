import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LanguageModel } from "ai";
import {
  workerResultSchema,
  type WorkerResult,
} from "../../src/types/harness.types";
import type { ArtifactContent } from "../../src/types/artifact.types";
import type {
  ChatMessage,
  CreateMessageResponse,
  CreateSessionResponse,
  Page,
  RunResult,
  RunSnapshot,
} from "../../src/types/chat.types";
import type { PublicEvent } from "../../src/types/event.types";
import type { TaskStatus } from "../../src/types/task.types";
import { takeUtf8Prefix } from "../../src/shared/utf8";
import type { SimpleExecResult } from "../../src/types/sandbox.types";
import { loadAgentModelConfig } from "../../src/config";
import { resolveAgentModel } from "../../src/services/agent/model";
import {
  allRepoScoresPass,
  changedFilesFromDiff,
  failedRepoScoreNames,
  passesRepoThreshold,
  scoreRepoCase,
} from "./scorers";
import { runSubjectiveJudge, subjectiveScoreSummary } from "./subjective-judge";
import {
  repoCaseSchema,
  type RepoCase,
  type RepoEvalResult,
  type RepoObserved,
  type RepoPostRunCheck,
  type RepoToolEvent,
} from "./types";
import { appendResult, prepareResultFile } from "./result-files";

const DEFAULT_CASES_PATH = join(process.cwd(), "tests/evals/cases/repo.jsonl");
const DEFAULT_FIXTURES_DIR = join(process.cwd(), "tests/evals/fixtures");
const DEFAULT_RESULTS_DIR = join(process.cwd(), "tests/evals/results");
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_RUN_TIMEOUT_MS = 180000;
const DEFAULT_POST_RUN_TIMEOUT_MS = 120000;
const POST_RUN_OUTPUT_MAX_BYTES = 16_384;
const TERMINAL_STATUSES = new Set<TaskStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export type RepoEvalChatSessionService = {
  createSession(input: {
    repo: { source: "fixture"; ref: string };
    image?: string;
  }): Promise<CreateSessionResponse>;
  appendMessage(
    sessionId: string,
    input: { content: string; startRun: true },
  ): Promise<CreateMessageResponse>;
  getRun(sessionId: string, runId: string): Promise<RunSnapshot>;
  result(sessionId: string, runId: string): Promise<RunResult>;
  listMessages(
    sessionId: string,
    query: { limit: number },
  ): Promise<Page<ChatMessage>>;
  runEventsAfter(
    sessionId: string,
    runId: string,
    after: number,
  ): Promise<PublicEvent[]>;
  getArtifact(sessionId: string, artifactId: string): Promise<ArtifactContent>;
  runPostRunCommand?(input: {
    sessionId: string;
    runId: string;
    sandboxId: string;
    command: string;
    timeoutMs: number;
  }): Promise<SimpleExecResult>;
  cancelRun?(sessionId: string, runId: string): Promise<unknown>;
};

export type RepoEvalOptions = {
  service?: RepoEvalChatSessionService;
  casesPath?: string;
  fixturesDir?: string;
  resultsDir?: string;
  image?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  postRunTimeoutMs?: number;
  resultsPath?: string;
  resume?: boolean;
  judgeModel?: LanguageModel;
  now?: Date;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

export const loadRepoCases = (path = DEFAULT_CASES_PATH): RepoCase[] =>
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [repoCaseSchema.parse(JSON.parse(line))];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Invalid repo case at ${path}:${index + 1}: ${message}`,
          { cause: error },
        );
      }
    });

export const waitForTerminalRun = async (
  service: Pick<RepoEvalChatSessionService, "getRun">,
  sessionId: string,
  runId: string,
  timeoutMs = DEFAULT_RUN_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
): Promise<RunSnapshot> => {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await service.getRun(sessionId, runId);
  while (!TERMINAL_STATUSES.has(snapshot.status)) {
    if (Date.now() >= deadline)
      throw new Error(`Run ${runId} did not reach a terminal state in time`);
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    snapshot = await service.getRun(sessionId, runId);
  }
  return snapshot;
};

const emptyObserved = (): RepoObserved => ({
  runStatus: null,
  workerStatus: null,
  delegationCount: 0,
  changedFiles: [],
  diff: "",
  testsRun: [],
  postRunChecks: [],
  workerReports: [],
  toolEvents: [],
  runIds: [],
  finalMessage: "",
  assistantMessages: [],
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type LocalCommandResult = {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  error: string | null;
};

const appendBounded = (
  current: string,
  chunk: Buffer | Uint8Array | string,
): { value: string; truncated: boolean } => {
  const full =
    current +
    (typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
  const value = takeUtf8Prefix(full, POST_RUN_OUTPUT_MAX_BYTES);
  return { value, truncated: value.length < full.length };
};

const runLocalProcess = (
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  input?: string,
): Promise<LocalCommandResult> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const timerRef: { current?: NodeJS.Timeout } = {};

    const finish = (exitCode: number | null, error: string | null): void => {
      if (settled) return;
      settled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      resolve({
        exitCode: timedOut ? null : exitCode,
        timedOut,
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - startedAt,
        error,
      });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        cwd,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      finish(null, errorMessage(error));
      return;
    }

    timerRef.current = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer | Uint8Array | string) => {
      const bounded = appendBounded(stdout, chunk);
      stdout = bounded.value;
      truncated ||= bounded.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer | Uint8Array | string) => {
      const bounded = appendBounded(stderr, chunk);
      stderr = bounded.value;
      truncated ||= bounded.truncated;
    });
    child.once("error", (error) => finish(null, errorMessage(error)));
    child.once("close", (exitCode) => finish(exitCode, null));
    if (input !== undefined) child.stdin?.end(input);
  });

const runLocalPostRunCommand = async (
  repositoryPath: string,
  command: string,
  timeoutMs: number,
): Promise<RepoPostRunCheck> => {
  const result = await runLocalProcess(
    "sh",
    ["-lc", command],
    repositoryPath,
    timeoutMs,
  );
  return {
    command,
    ...result,
    passed: result.exitCode === 0 && !result.timedOut,
  };
};

const postRunFailure = (
  command: string,
  error: unknown,
  durationMs: number,
): RepoPostRunCheck => ({
  command,
  exitCode: null,
  timedOut: false,
  passed: false,
  stdout: "",
  stderr: "",
  truncated: false,
  durationMs,
  error: errorMessage(error),
});

const applyDiff = async (
  repositoryPath: string,
  diff: string,
): Promise<void> => {
  if (!diff) return;
  const result = await runLocalProcess(
    "git",
    ["apply", "--binary", "--whitespace=nowarn", "-"],
    repositoryPath,
    DEFAULT_POST_RUN_TIMEOUT_MS,
    diff,
  );
  if (result.exitCode !== 0 || result.timedOut)
    throw new Error(
      `Unable to apply captured diff: ${result.stderr || result.error || "git apply failed"}`,
    );
};

const toolEventsFrom = (events: PublicEvent[]): RepoToolEvent[] =>
  events.flatMap((event) => {
    if (event.type !== "agent_tool_call" && event.type !== "agent_tool_result")
      return [];
    const toolName =
      typeof event.payload.tool_name === "string"
        ? event.payload.tool_name
        : "unknown";
    const base = {
      type: event.type,
      toolName,
      correlationId: event.correlationId,
    } as const;
    if (event.type === "agent_tool_call") return [base];
    const exitCode =
      typeof event.payload.exit_code === "number" ||
      event.payload.exit_code === null
        ? event.payload.exit_code
        : null;
    const durationMs =
      typeof event.payload.duration_ms === "number"
        ? Math.max(0, event.payload.duration_ms)
        : 0;
    const resultSnippet = event.payload.result_snippet;
    return [
      {
        ...base,
        exitCode,
        truncated: event.payload.truncated === true,
        durationMs,
        ...(typeof resultSnippet === "string" ? { resultSnippet } : {}),
      },
    ];
  });

const readWorkerReport = async (
  service: Pick<RepoEvalChatSessionService, "getArtifact">,
  sessionId: string,
  result: RunResult,
): Promise<WorkerResult | null> => {
  const artifact = result.artifacts.find(
    (candidate) => candidate.kind === "worker_report",
  );
  if (!artifact) return null;
  try {
    const content = await service.getArtifact(sessionId, artifact.artifactId);
    return workerResultSchema.parse(JSON.parse(content.content));
  } catch {
    return null;
  }
};

const initializeRepository = async (repositoryPath: string): Promise<void> => {
  const commands = [
    ["init", "--quiet"],
    ["add", "--all"],
    [
      "-c",
      "user.name=agent-eval",
      "-c",
      "user.email=agent-eval@example.test",
      "commit",
      "--quiet",
      "-m",
      "fixture baseline",
    ],
  ];
  for (const args of commands) {
    const result = await runLocalProcess(
      "git",
      args,
      repositoryPath,
      DEFAULT_POST_RUN_TIMEOUT_MS,
    );
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error(
        `Unable to initialize copied fixture repository: ${result.stderr || result.error || "git command failed"}`,
      );
  }
};

const runRepoCase = async (
  service: RepoEvalChatSessionService,
  testCase: RepoCase,
  options: Required<
    Pick<
      RepoEvalOptions,
      "fixturesDir" | "timeoutMs" | "pollIntervalMs" | "postRunTimeoutMs"
    >
  > &
    Pick<RepoEvalOptions, "image">,
  judgeModel?: LanguageModel,
): Promise<RepoEvalResult> => {
  const observed = emptyObserved();
  let temporaryRoot: string | undefined;
  let activeRun: { sessionId: string; runId: string } | undefined;
  let finalRun:
    { sessionId: string; runId: string; sandboxId: string } | undefined;
  try {
    const fixturePath = resolve(options.fixturesDir, testCase.fixture);
    await access(fixturePath);
    temporaryRoot = await mkdtemp(join(tmpdir(), "agent-repo-eval-"));
    const repositoryPath = join(temporaryRoot, "repo");
    await cp(fixturePath, repositoryPath, { recursive: true });
    await initializeRepository(repositoryPath);
    await access(join(repositoryPath, ".git"));

    const session = await service.createSession({
      repo: { source: "fixture", ref: repositoryPath },
      ...(options.image ? { image: options.image } : {}),
    });

    for (const message of testCase.messages) {
      const created = await service.appendMessage(session.chatSessionId, {
        content: message.content,
        startRun: true,
      });
      if (!created.run)
        throw new Error(`Message did not create a run: ${testCase.id}`);
      const runId = created.run.taskRunId;
      activeRun = { sessionId: session.chatSessionId, runId };
      const snapshot = await waitForTerminalRun(
        service,
        session.chatSessionId,
        runId,
        options.timeoutMs,
        options.pollIntervalMs,
      );
      activeRun = undefined;
      if (snapshot.sandboxId)
        finalRun = {
          sessionId: session.chatSessionId,
          runId,
          sandboxId: snapshot.sandboxId,
        };
      const result = await service.result(session.chatSessionId, runId);
      const events = await service.runEventsAfter(
        session.chatSessionId,
        runId,
        0,
      );
      const messages = await service.listMessages(session.chatSessionId, {
        limit: 100,
      });
      const report = await readWorkerReport(
        service,
        session.chatSessionId,
        result,
      );
      const assistant = messages.items.find(
        (candidate) =>
          candidate.taskRunId === runId && candidate.role === "assistant",
      );

      observed.runStatus = snapshot.status;
      observed.workerStatus = report?.status ?? null;
      observed.runIds.push(runId);
      observed.toolEvents.push(...toolEventsFrom(events));
      if (report) {
        observed.delegationCount += 1;
        observed.workerReports.push(report);
        observed.testsRun.push(...report.testsRun.map((test) => test.command));
      }
      observed.assistantMessages.push(
        assistant?.content ?? result.agentSummary ?? "",
      );
      observed.finalMessage = assistant?.content ?? result.agentSummary ?? "";
      observed.diff = result.diff;
      observed.changedFiles = changedFilesFromDiff(result.diff);
    }
    if (testCase.expect.postRunCommands.length) {
      if (service.runPostRunCommand && finalRun) {
        for (const command of testCase.expect.postRunCommands) {
          const startedAt = Date.now();
          try {
            const result = await service.runPostRunCommand({
              ...finalRun,
              command,
              timeoutMs: options.postRunTimeoutMs,
            });
            observed.postRunChecks.push({
              command,
              ...result,
              durationMs: Date.now() - startedAt,
              error: null,
              passed: result.exitCode === 0 && !result.timedOut,
            });
          } catch (error) {
            observed.postRunChecks.push(
              postRunFailure(command, error, Date.now() - startedAt),
            );
          }
        }
      } else {
        await applyDiff(repositoryPath, observed.diff);
        for (const command of testCase.expect.postRunCommands)
          observed.postRunChecks.push(
            await runLocalPostRunCommand(
              repositoryPath,
              command,
              options.postRunTimeoutMs,
            ),
          );
      }
    }
    observed.testsRun = [...new Set(observed.testsRun)];
  } catch (error) {
    observed.error = errorMessage(error);
    if (activeRun && service.cancelRun) {
      await service
        .cancelRun(activeRun.sessionId, activeRun.runId)
        .catch(() => undefined);
      await waitForTerminalRun(
        service,
        activeRun.sessionId,
        activeRun.runId,
        options.timeoutMs,
        options.pollIntervalMs,
      ).catch(() => undefined);
    }
  } finally {
    if (temporaryRoot)
      await rm(temporaryRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
  }

  const scores = scoreRepoCase(testCase, observed);
  const result: RepoEvalResult = {
    caseId: testCase.id,
    suite: testCase.suite,
    status: allRepoScoresPass(scores) ? "passed" : "failed",
    scores,
    observed,
  };
  if (!judgeModel) return result;
  return {
    ...result,
    subjectiveJudge: await runSubjectiveJudge(judgeModel, {
      caseId: testCase.id,
      suite: testCase.suite,
      task: testCase.messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n"),
      context: { fixture: testCase.fixture },
      observed,
    }),
  };
};

const printReport = (results: RepoEvalResult[], resultsPath: string): void => {
  console.log(`Repo eval results: ${resultsPath}`);
  console.log(
    "case\tstatus\tfailed scores\tdelegations\tchanged files\ttests run\tpost-run\tsubjective scores",
  );
  for (const result of results)
    console.log(
      `${result.caseId}\t${result.status}\t${failedRepoScoreNames(result.scores).join(",") || "-"}\t${result.observed.delegationCount}\t${result.observed.changedFiles.join(",") || "-"}\t${result.observed.testsRun.join(",") || "-"}\t${result.observed.postRunChecks.map((check) => `${check.command}:${check.passed ? "passed" : "failed"}`).join(",") || "-"}\t${subjectiveScoreSummary(result.subjectiveJudge)}`,
    );
  const passed = results.filter((result) =>
    allRepoScoresPass(result.scores),
  ).length;
  console.log(`Repo threshold: ${passed}/${results.length} cases passed`);
};

const defaultService = async (): Promise<RepoEvalChatSessionService> => {
  const chat = await import("../../src/services/chat/chat-session");
  const sandbox = await import("../../src/services/sandbox/sandbox");
  return Object.assign(chat.chatSessionService, {
    runPostRunCommand: async (input: {
      sessionId: string;
      runId: string;
      sandboxId: string;
      command: string;
      timeoutMs: number;
    }): Promise<SimpleExecResult> => {
      const target = await sandbox.sandboxService.getAgentToolTarget(
        input.sessionId,
        input.runId,
        input.sandboxId,
      );
      return target.runtime.simpleExec(
        target.containerName,
        input.command,
        "/workspace/repo",
        { timeoutMs: input.timeoutMs },
      );
    },
  });
};

export const runRepoEvals = async (
  options: RepoEvalOptions = {},
): Promise<{
  results: RepoEvalResult[];
  resultsPath: string;
  passed: boolean;
}> => {
  const cases = loadRepoCases(options.casesPath);
  const service = options.service ?? (await defaultService());
  const timestamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const resultsPath =
    options.resultsPath ??
    join(options.resultsDir ?? DEFAULT_RESULTS_DIR, `repo-${timestamp}.jsonl`);
  const runOptions = {
    fixturesDir: options.fixturesDir ?? DEFAULT_FIXTURES_DIR,
    ...(options.image ? { image: options.image } : {}),
    timeoutMs: options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    postRunTimeoutMs: options.postRunTimeoutMs ?? DEFAULT_POST_RUN_TIMEOUT_MS,
  };
  const previousResults = await prepareResultFile<RepoEvalResult>(
    resultsPath,
    options.resume === true,
  );

  const results: RepoEvalResult[] = [];
  for (const testCase of cases) {
    const previous = previousResults.get(testCase.id);
    if (
      previous?.status === "passed" &&
      (!options.judgeModel || previous.subjectiveJudge?.status === "reported")
    ) {
      results.push(previous);
      continue;
    }
    const result = await runRepoCase(
      service,
      testCase,
      runOptions,
      options.judgeModel,
    );
    results.push(result);
    await appendResult(resultsPath, result);
  }

  printReport(results, resultsPath);
  return { results, resultsPath, passed: passesRepoThreshold(results) };
};

const main = async (): Promise<void> => {
  const judgeEnabled = process.argv.includes("--judge");
  const model = judgeEnabled
    ? resolveAgentModel(loadAgentModelConfig())
    : undefined;
  const result = await runRepoEvals(model ? { judgeModel: model } : {});
  if (!result.passed) process.exitCode = 1;
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
