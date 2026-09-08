import "dotenv/config";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { readTaskManifest, selectEvaluationTasks } from "./harness/dataset";
import {
  predictionSha256,
  readPredictions,
  validatePredictions,
} from "./harness/predictions";
import {
  assertRunIdFresh,
  buildOfficialMetrics,
  readAttempts,
  safeOutput,
  summarizeAttempts,
} from "./harness/report";

const execFile = promisify(execFileCallback);
const manifestPath =
  process.env.SWE_BENCH_MANIFEST_PATH ??
  `swe-bench-lite/.data/tasks/swe-bench-lite-${process.env.SWE_BENCH_SPLIT ?? "dev"}.jsonl`;
const runsRoot = path.resolve("swe-bench-lite/.data/runs");

const filesBelow = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(entryPath)));
    else files.push(entryPath);
  }
  return files;
};

const latestPredictionPath = async (): Promise<string> => {
  const candidates = (await filesBelow(runsRoot)).filter(
    (filePath) =>
      filePath.endsWith(`${path.sep}predictions.jsonl`) &&
      !filePath.split(path.sep).includes("official-results"),
  );
  if (candidates.length === 0)
    throw new Error("no predictions.jsonl found; run the predictor first");
  const withStats = await Promise.all(
    candidates.map(async (filePath) => ({
      filePath,
      mtime: (await stat(filePath)).mtimeMs,
    })),
  );
  withStats.sort((left, right) => right.mtime - left.mtime);
  const latest = withStats[0]?.filePath;
  if (!latest) throw new Error("no prediction file was selected");
  return latest;
};

const runId = (): string =>
  process.env.SWE_BENCH_OFFICIAL_RUN_ID ??
  `official-${Date.now()}-${process.pid}`;

const assertSafeRunId = (value: string): void => {
  if (!/^[A-Za-z0-9_.-]+$/.test(value))
    throw new Error("official run ID must be a safe path component");
};

const preparePinnedDataset = async (
  datasetName: string,
  split: string,
  revision: string,
  outputPath: string,
): Promise<void> => {
  const script = [
    "import json, sys",
    "from datasets import load_dataset",
    "dataset = load_dataset(sys.argv[1], split=sys.argv[2], revision=sys.argv[3])",
    "with open(sys.argv[4], 'w', encoding='utf-8') as output:",
    "    json.dump(list(dataset), output)",
  ].join("\n");
  await execFile(
    process.env.SWE_BENCH_PYTHON ?? "python3",
    ["-c", script, datasetName, split, revision, outputPath],
    { timeout: Number(process.env.SWE_BENCH_DATASET_TIMEOUT_MS ?? 900_000) },
  );
};

const classifications = async (
  root: string,
  taskIds: string[],
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const reportPaths = (await filesBelow(root)).filter((filePath) =>
    filePath.endsWith("/report.json"),
  );
  for (const reportPath of reportPaths) {
    const report = await readFile(reportPath, "utf8")
      .then((contents) => JSON.parse(contents) as Record<string, unknown>)
      .catch(() => undefined);
    if (!report) continue;
    for (const taskId of taskIds) {
      const entry = report[taskId];
      if (!entry || typeof entry !== "object") continue;
      const resolved = (entry as { resolved?: unknown }).resolved;
      if (resolved === true) result[taskId] = "resolved";
      else if (
        resolved === false &&
        (entry as { infra_failure?: unknown }).infra_failure === true
      )
        result[taskId] = "official_harness_failed";
      else if (resolved === false) result[taskId] = "unresolved";
    }
  }
  return result;
};

const timedOut = async (root: string, taskId: string): Promise<boolean> => {
  const outputPaths = (await filesBelow(root)).filter(
    (filePath) =>
      filePath.endsWith(`${path.sep}test_output.txt`) &&
      filePath.includes(`${path.sep}${taskId}${path.sep}`),
  );
  for (const outputPath of outputPaths) {
    if ((await readFile(outputPath, "utf8")).includes("Timeout error:"))
      return true;
  }
  return false;
};

const main = async (): Promise<void> => {
  const manifest = await readTaskManifest(manifestPath);
  const tasks = selectEvaluationTasks(manifest);
  if (manifest.split === "test" && tasks.length !== manifest.datasetTaskCount)
    throw new Error(
      "Phase 3 grading requires the complete pinned test manifest",
    );
  const sourcePredictionPath = path.resolve(
    process.env.SWE_BENCH_PREDICTIONS_PATH ?? (await latestPredictionPath()),
  );
  const predictions = await readPredictions(sourcePredictionPath);
  const taskIds = tasks.map((task) => task.instance_id);
  const predictionById = new Map(
    predictions.map((prediction) => [prediction.instance_id, prediction]),
  );
  validatePredictions(predictions, taskIds);
  const attempts = await readAttempts(
    path.join(path.dirname(sourcePredictionPath), "attempts.jsonl"),
  ).catch(() => []);
  if (manifest.split === "test") summarizeAttempts(attempts, taskIds);
  const officialRunId = runId();
  assertSafeRunId(officialRunId);
  const sourceHash = await predictionSha256(sourcePredictionPath);
  await assertRunIdFresh(officialRunId, sourceHash, runsRoot);
  const predictionRoot = path.dirname(sourcePredictionPath);
  const officialRoot = path.join(
    predictionRoot,
    "official-results",
    officialRunId,
  );
  await mkdir(officialRoot, { recursive: true });
  const immutablePredictionPath = path.join(officialRoot, "predictions.jsonl");
  await copyFile(sourcePredictionPath, immutablePredictionPath);
  await chmod(immutablePredictionPath, 0o444);
  const predictionHash = await predictionSha256(immutablePredictionPath);
  if (predictionHash !== sourceHash)
    throw new Error("prediction file changed while creating the grading copy");
  const pinnedDatasetPath = path.join(officialRoot, "dataset.json");
  await preparePinnedDataset(
    manifest.datasetName,
    manifest.split,
    manifest.datasetRevision,
    pinnedDatasetPath,
  );
  const args = [
    "-m",
    "swebench.harness.run_evaluation",
    "--dataset_name",
    pinnedDatasetPath,
    "--split",
    manifest.split,
    "--instance_ids",
    ...taskIds,
    "--predictions_path",
    immutablePredictionPath,
    "--max_workers",
    "1",
    "--timeout",
    process.env.SWE_BENCH_GRADER_TIMEOUT_SECONDS ?? "1800",
    "--run_id",
    officialRunId,
  ];
  let exitCode = 0;
  let stdout: string;
  let stderr: string;
  try {
    const result = await execFile(
      process.env.SWE_BENCH_PYTHON ?? "python3",
      args,
      {
        cwd: officialRoot,
        timeout: Number(
          process.env.SWE_BENCH_GRADER_PROCESS_TIMEOUT_MS ?? 7_200_000,
        ),
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const record = error as { code?: number; stdout?: string; stderr?: string };
    exitCode = typeof record.code === "number" ? record.code : 1;
    stdout = record.stdout ?? "";
    stderr =
      record.stderr ??
      safeOutput(error instanceof Error ? error.message : String(error));
  }
  const resultClassifications = await classifications(officialRoot, taskIds);
  for (const taskId of taskIds) {
    if (resultClassifications[taskId]) continue;
    const prediction = predictionById.get(taskId);
    resultClassifications[taskId] =
      prediction?.model_patch.trim() === ""
        ? "not_submitted"
        : (await timedOut(officialRoot, taskId))
          ? "timeout"
          : exitCode === 0
            ? "official_result_missing"
            : "official_harness_failed";
  }
  const metrics = buildOfficialMetrics({
    taskIds,
    predictions,
    attempts,
    classifications: resultClassifications,
  });
  const experimentManifestPath = path.join(predictionRoot, "manifest.json");
  const experimentManifest = await readFile(experimentManifestPath, "utf8")
    .then((contents) => JSON.parse(contents) as Record<string, unknown>)
    .catch(() => undefined);
  if (experimentManifest)
    await writeFile(
      experimentManifestPath,
      `${JSON.stringify(
        { ...experimentManifest, officialRunId, officialMetrics: metrics },
        null,
        2,
      )}\n`,
      "utf8",
    );
  await writeFile(
    path.join(officialRoot, "grade.json"),
    `${JSON.stringify(
      {
        runId: officialRunId,
        datasetName: manifest.datasetName,
        datasetRevision: manifest.datasetRevision,
        predictionPath: immutablePredictionPath,
        sourcePredictionPath,
        predictionSha256: predictionHash,
        instanceIds: taskIds,
        datasetTaskCount: manifest.datasetTaskCount,
        manifestTaskCount: manifest.taskCount,
        metrics,
        resolved_pct: metrics.resolvedPct,
        completion_yield_pct: metrics.completionYieldPct,
        submitted_predictions: metrics.submittedPredictions,
        all_recorded_attempts: metrics.allRecordedAttempts,
        no_patch_count: metrics.noPatchCount,
        setup_failure_count: metrics.setupFailureCount,
        provider_failure_count: metrics.providerFailureCount,
        session_failure_count: metrics.sessionFailureCount,
        official_harness_failure_count: metrics.officialHarnessFailureCount,
        timeout_count: metrics.timeoutCount,
        per_task_outcomes: metrics.perTask,
        estimated_usd: metrics.estimatedUsd,
        cost_source: metrics.costSource,
        cost_note: metrics.costNote,
        classifications: resultClassifications,
        exitCode,
        stdout: safeOutput(stdout),
        stderr: safeOutput(stderr),
        recordedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify({
      runId: officialRunId,
      predictionPath: immutablePredictionPath,
      gradePath: path.join(officialRoot, "grade.json"),
      classifications: resultClassifications,
      exitCode,
    }),
  );
  if (exitCode !== 0) process.exitCode = exitCode;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
