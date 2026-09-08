import "dotenv/config";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cpus, totalmem } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { evaluationAuthFromEnv, EvalHttpClient } from "./harness/client";
import { readTaskManifest, selectEvaluationTasks } from "./harness/dataset";
import { cleanupTaskFixture, createTaskFixture } from "./harness/fixture";
import {
  buildAgentImage,
  ensureTaskImage,
  verifyDocker,
} from "./harness/image";
import { predictionForResult, writePredictions } from "./harness/predictions";
import { cleanupSessionSandbox, verifySessionSandbox } from "./harness/sandbox";
import {
  classifyFailure,
  safeOutput,
  summarizeAttempts,
  writeAttempt,
  writeCohortSummary,
  writeExperimentManifest,
} from "./harness/report";
import type {
  AttemptRecord,
  ExperimentManifest,
  SweBenchTask,
  TaskFixture,
} from "./harness/types";

const execFile = promisify(execFileCallback);
const promptProfile = "prompts/session-agent.yaml";
const toolConfigPath = "src/services/agent/tools/profiles/profiles.yaml";
const manifestPath =
  process.env.SWE_BENCH_MANIFEST_PATH ??
  `swe-bench-lite/.data/tasks/swe-bench-lite-${process.env.SWE_BENCH_SPLIT ?? "dev"}.jsonl`;
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const runsRoot = path.resolve("swe-bench-lite/.data/runs");
const model =
  process.env.SWE_BENCH_MODEL_NAME ??
  process.env.AGENT_MODEL ??
  "agent-sandboxing";
const timeoutMs = Number(process.env.SWE_BENCH_ATTEMPT_TIMEOUT_MS ?? 1_800_000);

const safeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const repositorySha = async (): Promise<string> => {
  const result = await execFile("git", ["rev-parse", "HEAD"], {
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
};

const fileSha256 = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path.resolve(filePath)))
    .digest("hex");

const experimentId = (split: string): string =>
  process.env.SWE_BENCH_EXPERIMENT_ID ??
  `${split}-${Date.now()}-${process.pid}`;

const assertSafeId = (value: string, name: string): void => {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`invalid ${name}`);
};

const attemptId = (task: SweBenchTask): string =>
  `${task.instance_id}-${Date.now()}-${process.pid}`;

const initialManifest = (
  id: string,
  repositoryShaValue: string,
  datasetName: string,
  datasetRevision: string,
  split: "dev" | "test",
  taskIds: string[],
  promptDigest: string,
  toolConfigDigest: string,
): ExperimentManifest => ({
  experimentId: id,
  repositorySha: repositoryShaValue,
  evaluatorVersion:
    split === "test" ? "swe-bench-lite-phase-3" : "swe-bench-lite-phase-2",
  datasetName,
  datasetRevision,
  split,
  taskIds,
  model,
  promptProfile,
  promptDigest,
  toolProfile: "main",
  toolConfigPath,
  toolConfigDigest,
  maxSteps: Number(process.env.AGENT_MAX_STEPS ?? 25),
  timeoutMs,
  retryPolicy: "none",
  wrapperImages: {},
  machineResources: {
    cpuCount: cpus().length,
    memoryBytes: totalmem(),
  },
  cacheCondition:
    process.env.SWE_BENCH_CACHE_CONDITION ??
    "unspecified; record before grading",
  createdAt: new Date().toISOString(),
});

const main = async (): Promise<void> => {
  const startedAt = new Date().toISOString();
  const manifest = await readTaskManifest(manifestPath);
  const tasks = selectEvaluationTasks(manifest);
  if (manifest.split === "test" && tasks.length !== manifest.datasetTaskCount)
    throw new Error(
      "Phase 3 test measurement requires the complete pinned test manifest",
    );
  const id = experimentId(manifest.split);
  assertSafeId(id, "experiment ID");
  const runRoot = path.join(runsRoot, id);
  await access(runRoot).then(
    () => {
      throw new Error(`experiment ${id} already exists; choose a new ID`);
    },
    () => undefined,
  );
  const taskIds = tasks.map((task) => task.instance_id);
  const [promptDigest, toolConfigDigest] = await Promise.all([
    fileSha256(promptProfile),
    fileSha256(toolConfigPath),
  ]);
  const experimentManifest = initialManifest(
    id,
    await repositorySha(),
    manifest.datasetName,
    manifest.datasetRevision,
    manifest.split,
    taskIds,
    promptDigest,
    toolConfigDigest,
  );
  await writeExperimentManifest(runRoot, experimentManifest);
  const predictions = tasks.map((task) => predictionForResult(task, "", model));
  const predictionPath = await writePredictions(
    path.join(runRoot, "predictions.jsonl"),
    predictions,
    taskIds,
  );
  const attempts: AttemptRecord[] = [];
  let failed = false;

  for (const [index, task] of tasks.entries()) {
    const started = Date.now();
    const currentAttemptId = attemptId(task);
    let fixture: TaskFixture | undefined;
    let sandboxId: string | undefined;
    let client: EvalHttpClient | undefined;
    let stage: "setup" | "session" = "setup";
    let attempt: AttemptRecord = {
      attemptId: currentAttemptId,
      instanceId: task.instance_id,
      status: "failed",
      predictionPath,
      model,
      promptProfile,
      diffBytes: 0,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date().toISOString(),
    };
    try {
      if (!process.env.OPENROUTER_API_KEY)
        throw new Error("OPENROUTER_API_KEY is required for a live attempt");
      await verifyDocker();
      const baseImage = await ensureTaskImage(task);
      const agent = await buildAgentImage(task, baseImage);
      experimentManifest.wrapperImages[task.instance_id] =
        `${agent.image}@${agent.digest}`;
      await writeExperimentManifest(runRoot, experimentManifest);
      client = await EvalHttpClient.create(baseUrl, evaluationAuthFromEnv());
      const health = await client.health();
      if (health.status !== "ok")
        throw new Error("API health check did not return ok");
      fixture = await createTaskFixture(task, { attemptId: currentAttemptId });
      stage = "session";
      const chat = await client.runSession(task, fixture, agent.image);
      sandboxId = chat.session.sandboxId ?? client.lastSandboxId;
      if (!sandboxId) throw new Error("session did not persist a sandbox id");
      await verifySessionSandbox(sandboxId);
      const diff = chat.result.diff;
      predictions[index] = predictionForResult(task, diff, model);
      await writePredictions(predictionPath, predictions, taskIds);
      const completed = chat.result.status === "completed";
      const hasPatch = diff.trim() !== "";
      const failure = completed
        ? hasPatch
          ? undefined
          : "completed session returned an empty diff"
        : (chat.result.failure?.message ?? "session did not complete");
      attempt = {
        ...attempt,
        status:
          completed && hasPatch
            ? "completed"
            : completed
              ? "no_patch"
              : "failed",
        sessionId: chat.session.chatSessionId,
        sandboxId,
        diffBytes: Buffer.byteLength(diff),
        durationMs: Date.now() - started,
        classification:
          completed && hasPatch
            ? "submitted"
            : completed
              ? "no_patch"
              : "session_failed",
        ...(completed
          ? {}
          : {
              failureCategory: classifyFailure("session", chat.result.failure),
            }),
        ...(failure ? { failure } : {}),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      failed = true;
      sandboxId = sandboxId ?? client?.lastSandboxId;
      if (client && !sandboxId)
        sandboxId = await client.recoverSandboxId().catch(() => undefined);
      attempt = {
        ...attempt,
        status: "failed",
        ...(sandboxId ? { sandboxId } : {}),
        durationMs: Date.now() - started,
        classification: "setup_or_session_failed",
        failureCategory: classifyFailure(stage, error),
        failure: safeOutput(safeError(error)),
        completedAt: new Date().toISOString(),
      };
    } finally {
      failed ||= attempt.status === "failed";
      try {
        await writeAttempt(runRoot, attempt);
        attempts.push(attempt);
      } finally {
        await cleanupSessionSandbox(sandboxId);
        if (fixture) await cleanupTaskFixture(fixture);
      }
    }
  }

  const summary = summarizeAttempts(attempts, taskIds);
  const summaryPath = await writeCohortSummary(runRoot, summary);

  console.log(
    JSON.stringify({
      experimentId: id,
      taskIds,
      status: failed ? "failed" : "completed",
      predictionPath,
      reportPath: path.join(runRoot, "attempts.jsonl"),
      summaryPath,
      summary,
      wrapperImages: experimentManifest.wrapperImages,
      startedAt,
    }),
  );
  if (failed) process.exitCode = 1;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
