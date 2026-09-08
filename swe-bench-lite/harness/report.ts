import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  AttemptRecord,
  AttemptFailureCategory,
  CohortSummary,
  ExperimentManifest,
  OfficialRunRecord,
  Prediction,
  OfficialMetrics,
} from "./types";

const defaultRunsRoot = path.resolve("swe-bench-lite/.data/runs");

const secretValues = [
  process.env.OPENROUTER_API_KEY,
  process.env.AUTH_COOKIE_SECRET,
  process.env.E2E_AUTH_COOKIE_SECRET,
  process.env.SWE_BENCH_AUTH_COOKIE_SECRET,
].filter((value): value is string => Boolean(value && value.length > 3));

const safeText = (value: string): string => {
  let safe = value;
  for (const secret of secretValues)
    safe = safe.replaceAll(secret, "[REDACTED]");
  return safe.replaceAll(
    /(?:authorization|cookie|secret|token|password)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]",
  );
};

export const writeExperimentManifest = async (
  runRoot: string,
  manifest: ExperimentManifest,
): Promise<string> => {
  await mkdir(runRoot, { recursive: true });
  const filePath = path.join(runRoot, "manifest.json");
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return filePath;
};

export const writeAttempt = async (
  runRoot: string,
  attempt: AttemptRecord,
): Promise<string> => {
  await mkdir(runRoot, { recursive: true });
  const filePath = path.join(runRoot, "attempts.jsonl");
  await appendFile(
    filePath,
    `${JSON.stringify(attempt, (_key, value) =>
      typeof value === "string" ? safeText(value) : value,
    )}\n`,
  );
  return filePath;
};

export const readAttempts = async (
  filePath: string,
): Promise<AttemptRecord[]> => {
  const contents = await readFile(path.resolve(filePath), "utf8");
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AttemptRecord);
};

export const classifyFailure = (
  stage: "setup" | "session",
  value: unknown,
): AttemptFailureCategory => {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return /provider|model|openrouter|api.?key/i.test(text) ? "provider" : stage;
};

export const summarizeAttempts = (
  attempts: AttemptRecord[],
  expectedTaskIds: string[],
): CohortSummary => {
  const expected = new Set(expectedTaskIds);
  const seen = new Set<string>();
  if (attempts.length !== expected.size)
    throw new Error(
      `expected one terminal attempt for ${expected.size} tasks, recorded ${attempts.length}`,
    );
  for (const attempt of attempts) {
    if (!expected.has(attempt.instanceId))
      throw new Error(`attempt has unknown task ${attempt.instanceId}`);
    if (seen.has(attempt.instanceId))
      throw new Error(`duplicate terminal attempt for ${attempt.instanceId}`);
    seen.add(attempt.instanceId);
  }
  if (seen.size !== expected.size)
    throw new Error(
      "terminal attempt set does not match the selected task set",
    );
  return {
    taskCount: expected.size,
    attemptCount: attempts.length,
    predictionCount: expected.size,
    submittedCount: attempts.filter(
      (attempt) => attempt.classification === "submitted",
    ).length,
    noPatchCount: attempts.filter((attempt) => attempt.status === "no_patch")
      .length,
    setupFailureCount: attempts.filter(
      (attempt) => attempt.failureCategory === "setup",
    ).length,
    providerFailureCount: attempts.filter(
      (attempt) => attempt.failureCategory === "provider",
    ).length,
    sessionFailureCount: attempts.filter(
      (attempt) => attempt.failureCategory === "session",
    ).length,
    recordedAt: new Date().toISOString(),
  };
};

export const writeCohortSummary = async (
  runRoot: string,
  summary: CohortSummary,
): Promise<string> => {
  await mkdir(runRoot, { recursive: true });
  const filePath = path.join(runRoot, "summary.json");
  await writeFile(filePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return filePath;
};

export const buildOfficialMetrics = (input: {
  taskIds: string[];
  predictions: Prediction[];
  attempts: AttemptRecord[];
  classifications: Record<string, string>;
}): OfficialMetrics => {
  const submittedPredictions = input.predictions.filter(
    (prediction) => prediction.model_patch.trim() !== "",
  ).length;
  const officialResolved = input.taskIds.filter(
    (taskId) => input.classifications[taskId] === "resolved",
  ).length;
  const perTask = Object.fromEntries(
    input.taskIds.map((taskId) => [
      taskId,
      input.classifications[taskId] ?? "official_result_missing",
    ]),
  );
  const ratio = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;
  return {
    taskCount: input.taskIds.length,
    submittedPredictions,
    allRecordedAttempts: input.attempts.length,
    officialResolved,
    resolvedPct: ratio(officialResolved, submittedPredictions),
    completionYieldPct: ratio(officialResolved, input.attempts.length),
    noPatchCount: input.attempts.filter(
      (attempt) => attempt.status === "no_patch",
    ).length,
    setupFailureCount: input.attempts.filter(
      (attempt) => attempt.failureCategory === "setup",
    ).length,
    providerFailureCount: input.attempts.filter(
      (attempt) => attempt.failureCategory === "provider",
    ).length,
    sessionFailureCount: input.attempts.filter(
      (attempt) => attempt.failureCategory === "session",
    ).length,
    officialHarnessFailureCount: Object.values(input.classifications).filter(
      (classification) => classification === "official_harness_failed",
    ).length,
    timeoutCount: Object.values(input.classifications).filter(
      (classification) => classification === "timeout",
    ).length,
    perTask,
    estimatedUsd: null,
    costSource: "unavailable",
    costNote:
      "The public SessionResult does not expose provider cost; obtain it from the provider or trace backend separately.",
  };
};

const collectOfficialRuns = async (
  root: string,
): Promise<OfficialRunRecord[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const records: OfficialRunRecord[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      records.push(...(await collectOfficialRuns(entryPath)));
      continue;
    }
    if (entry.name !== "grade.json") continue;
    const record = await readFile(entryPath, "utf8")
      .then((contents) => JSON.parse(contents) as OfficialRunRecord)
      .catch(() => undefined);
    if (record) records.push(record);
  }
  return records;
};

export const assertRunIdFresh = async (
  runId: string,
  predictionSha256: string,
  runsRoot = defaultRunsRoot,
): Promise<void> => {
  const previous = await collectOfficialRuns(path.resolve(runsRoot));
  const collision = previous.find((record) => record.runId === runId);
  if (collision) {
    if (collision.predictionSha256 !== predictionSha256)
      throw new Error(
        `official run ID ${runId} was already used for a different prediction; choose a new run ID`,
      );
    throw new Error(
      `official run ID ${runId} was already used; choose a new run ID`,
    );
  }
};

export const safeOutput = (value: string, maxBytes = 20_000): string =>
  safeText(value).slice(-maxBytes);
