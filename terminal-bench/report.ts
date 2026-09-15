import { fileURLToPath } from "node:url";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type FailureCategory =
  "setup" | "provider" | "agent" | "timeout" | "verifier";

type JsonRecord = Record<string, unknown>;

export type ParsedTask = {
  taskId: string;
  trialId: string;
  trialPath: string;
  trajectoryPath: string | null;
  verifierLogPaths: string[];
  reward: number | null;
  resolved: boolean;
  modelCostUsd: number | null;
  failureCategory: FailureCategory | null;
};

export type ParsedHarborRun = {
  jobPath: string;
  jobResult: JsonRecord | null;
  tasks: ParsedTask[];
  setupParseFailures: number;
};

export type TerminalBenchSummary = {
  job_path: string;
  attempted: number;
  resolved: number;
  unresolved: number;
  resolved_pct: number | null;
  setup_failure_count: number;
  provider_failure_count: number;
  agent_failure_count: number;
  timeout_failure_count: number;
  verifier_failure_count: number;
  failure_counts: Record<FailureCategory, number>;
  total_model_cost_usd: number | null;
  per_task_model_cost_usd: Record<string, number | null>;
  model_cost_source: "harbor" | "unavailable";
  compute_cost_usd: number | null;
  compute_cost_source: "environment_provider" | "unavailable";
  failed_trajectories: string[];
  failed_verifier_logs: string[];
  tasks: Array<{
    task_id: string;
    trial_id: string;
    reward: number | null;
    resolved: boolean;
    model_cost_usd: number | null;
    failure_category: FailureCategory | null;
    trial_path: string;
    trajectory_path: string | null;
    verifier_log_paths: string[];
  }>;
  recorded_at: string;
};

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const numberAt = (value: unknown, key: string): number | null => {
  const current = asRecord(value);
  return current ? asNumber(current[key]) : null;
};

const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const result = asNumber(value);
    if (result !== null) return result;
  }
  return null;
};

const filesBelow = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
};

const readJson = async (filePath: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
};

const trialResult = (value: unknown): JsonRecord | null => {
  const result = asRecord(value);
  if (!result) return null;
  return asString(result.trial_name) || asString(result.task_name)
    ? result
    : null;
};

const trialPathFromUri = (value: unknown): string | null => {
  const uri = asString(value);
  if (!uri) return null;
  try {
    return uri.startsWith("file:") ? fileURLToPath(uri) : path.resolve(uri);
  } catch {
    return null;
  }
};

const artifactPath = async (candidates: string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
};

const trajectoryPath = async (trialPath: string): Promise<string | null> => {
  const candidates = [
    path.join(trialPath, "agent", "trajectory.json"),
    path.join(trialPath, "trajectory.json"),
  ];
  for (const candidate of candidates)
    if ((await readJson(candidate)) !== null) return candidate;
  return artifactPath(candidates);
};

const rewardFromFile = async (filePath: string): Promise<number | null> => {
  const text = await readFile(filePath, "utf8").catch(() => "");
  if (!text) return null;
  const parsed = await readJson(filePath);
  if (parsed !== null) {
    const object = asRecord(parsed);
    const rewards = asRecord(object?.rewards);
    const reward = firstNumber(object?.reward, rewards?.reward, parsed);
    if (reward !== null) return reward;
  }
  return asNumber(text.trim());
};

const rewardFromResult = (result: JsonRecord): number | null => {
  const verifier = asRecord(result.verifier_result);
  const rewards = asRecord(verifier?.rewards);
  return firstNumber(rewards?.reward, verifier?.reward, result.reward);
};

const modelCostFromResult = (result: JsonRecord): number | null => {
  const contexts: unknown[] = [];
  if (result.agent_result !== null && result.agent_result !== undefined)
    contexts.push(result.agent_result);
  else if (Array.isArray(result.step_results))
    for (const step of result.step_results) {
      const stepResult = asRecord(step);
      if (
        stepResult?.agent_result !== null &&
        stepResult?.agent_result !== undefined
      )
        contexts.push(stepResult.agent_result);
    }
  const costs = contexts
    .map((context) => numberAt(context, "cost_usd"))
    .filter((cost): cost is number => cost !== null);
  return costs.length > 0
    ? costs.reduce((total, cost) => total + cost, 0)
    : null;
};

const errorText = (result: JsonRecord): string =>
  JSON.stringify([
    result.exception_info,
    result.environment_setup,
    result.agent_setup,
    result.agent_execution,
    result.verifier,
  ]);

export const classifyTerminalBenchFailure = (input: {
  result: JsonRecord;
  reward: number | null;
  verifierLogPaths: string[];
  trajectoryPath: string | null;
}): FailureCategory | null => {
  const result = input.result;
  const text = errorText(result).toLowerCase();
  if (/timeout|timed.?out|deadline/.test(text)) return "timeout";
  if (
    /provider|openrouter|api.?key|rate.?limit|quota|unauthori[sz]ed|\b(401|403|408|429|500|502|503|504)\b/.test(
      text,
    )
  )
    return "provider";
  if (/verifier|grader|reward/.test(text)) return "verifier";
  if (
    /environment|setup|healthcheck|docker|container|install|dependency/.test(
      text,
    )
  )
    return "setup";
  if (result.exception_info !== null && result.exception_info !== undefined)
    return "agent";
  const hasAgentResult =
    (result.agent_result !== null && result.agent_result !== undefined) ||
    (Array.isArray(result.step_results) &&
      result.step_results.some((step) => {
        const record = asRecord(step);
        return (
          record?.agent_result !== null && record?.agent_result !== undefined
        );
      }));
  const hasVerifierResult =
    result.verifier_result !== null && result.verifier_result !== undefined;
  if (input.reward === null && hasVerifierResult) return "verifier";
  if (input.reward === null && !hasAgentResult && !input.trajectoryPath)
    return input.verifierLogPaths.length > 0 ? "verifier" : "setup";
  if (input.reward === null) return "verifier";
  return null;
};

const parseTrial = async (
  result: JsonRecord,
  trialPath: string,
): Promise<ParsedTask> => {
  const verifierPath = path.join(trialPath, "verifier");
  const verifierLogPaths = await filesBelow(verifierPath);
  const trajectory = await trajectoryPath(trialPath);
  const rewardJson = await rewardFromFile(
    path.join(verifierPath, "reward.json"),
  );
  const rewardText = await rewardFromFile(
    path.join(verifierPath, "reward.txt"),
  );
  const reward = firstNumber(rewardFromResult(result), rewardJson, rewardText);
  const trialId =
    asString(result.trial_name) ??
    asString(result.id) ??
    path.basename(trialPath);
  const taskId =
    asString(result.task_name) ?? asString(result.task_id) ?? trialId;
  return {
    taskId,
    trialId,
    trialPath,
    trajectoryPath: trajectory,
    verifierLogPaths,
    reward,
    resolved: reward === 1,
    modelCostUsd: modelCostFromResult(result),
    failureCategory: classifyTerminalBenchFailure({
      result,
      reward,
      verifierLogPaths,
      trajectoryPath: trajectory,
    }),
  };
};

const pathFromTrial = (
  result: JsonRecord,
  resultPath: string,
  root: string,
): string =>
  path.dirname(resultPath) !== root
    ? path.dirname(resultPath)
    : (trialPathFromUri(result.trial_uri) ??
      path.join(
        root,
        asString(result.trial_name) ?? asString(result.task_name) ?? "trial",
      ));

const failedResult = (resultPath: string): ParsedTask => {
  const trialPath = path.dirname(resultPath);
  const trialId = path.basename(trialPath);
  return {
    taskId: trialId,
    trialId,
    trialPath,
    trajectoryPath: null,
    verifierLogPaths: [],
    reward: null,
    resolved: false,
    modelCostUsd: null,
    failureCategory: "setup",
  };
};

export const parseHarborRun = async (
  jobPath: string,
): Promise<ParsedHarborRun> => {
  const root = path.resolve(jobPath);
  try {
    await readdir(root);
  } catch {
    throw new Error(`Harbor job path not found: ${jobPath}`);
  }
  const jobResultPath = path.join(root, "result.json");
  const parsedJob = asRecord(await readJson(jobResultPath));
  const resultPaths = (await filesBelow(root)).filter(
    (filePath) =>
      path.basename(filePath) === "result.json" && filePath !== jobResultPath,
  );
  const tasks: ParsedTask[] = [];
  let setupParseFailures = 0;
  for (const resultPath of resultPaths) {
    const parsed = trialResult(await readJson(resultPath));
    if (!parsed) {
      tasks.push(failedResult(resultPath));
      continue;
    }
    tasks.push(
      await parseTrial(parsed, pathFromTrial(parsed, resultPath, root)),
    );
  }
  if (tasks.length === 0) {
    const embedded = parsedJob?.trial_results;
    if (Array.isArray(embedded))
      for (const value of embedded) {
        const parsed = trialResult(value);
        if (!parsed) {
          setupParseFailures += 1;
          continue;
        }
        const trialPath = pathFromTrial(parsed, root, root);
        tasks.push(await parseTrial(parsed, trialPath));
      }
  }
  return {
    jobPath: root,
    jobResult: parsedJob,
    tasks,
    setupParseFailures,
  };
};

const computeCost = (
  jobResult: JsonRecord | null,
): { value: number | null; source: "environment_provider" | "unavailable" } => {
  const stats = asRecord(jobResult?.stats);
  const billing = asRecord(jobResult?.billing);
  const environment = asRecord(jobResult?.environment);
  const value = firstNumber(
    jobResult?.compute_cost_usd,
    jobResult?.environment_cost_usd,
    stats?.compute_cost_usd,
    stats?.environment_cost_usd,
    billing?.compute_cost_usd,
    environment?.compute_cost_usd,
  );
  return value === null
    ? { value: null, source: "unavailable" }
    : { value, source: "environment_provider" };
};

const totalModelCost = (
  run: ParsedHarborRun,
): { value: number | null; source: "harbor" | "unavailable" } => {
  const jobCost = numberAt(run.jobResult?.stats, "cost_usd");
  if (jobCost !== null) return { value: jobCost, source: "harbor" };
  const costs = run.tasks
    .map((task) => task.modelCostUsd)
    .filter((cost): cost is number => cost !== null);
  return costs.length === 0
    ? { value: null, source: "unavailable" }
    : {
        value: costs.reduce((total, cost) => total + cost, 0),
        source: "harbor",
      };
};

export const buildTerminalBenchSummary = (
  run: ParsedHarborRun,
): TerminalBenchSummary => {
  const expected = Math.max(
    run.tasks.length + run.setupParseFailures,
    numberAt(run.jobResult, "n_total_trials") ?? 0,
  );
  const missing = Math.max(
    0,
    expected - run.tasks.length - run.setupParseFailures,
  );
  const attempted = run.tasks.length + run.setupParseFailures + missing;
  const counts: Record<FailureCategory, number> = {
    setup: run.setupParseFailures + missing,
    provider: 0,
    agent: 0,
    timeout: 0,
    verifier: 0,
  };
  for (const task of run.tasks)
    if (task.failureCategory) counts[task.failureCategory] += 1;
  const resolved = run.tasks.filter((task) => task.resolved).length;
  const failed = run.tasks.filter(
    (task) => task.failureCategory !== null || !task.resolved,
  );
  const unique = (values: string[]): string[] => [...new Set(values)];
  const modelCost = totalModelCost(run);
  const compute = computeCost(run.jobResult);
  const perTaskModelCostUsd = Object.fromEntries(
    run.tasks.map((task) => [task.taskId, task.modelCostUsd]),
  );
  return {
    job_path: run.jobPath,
    attempted,
    resolved,
    unresolved: attempted - resolved,
    resolved_pct: attempted === 0 ? null : resolved / attempted,
    setup_failure_count: counts.setup,
    provider_failure_count: counts.provider,
    agent_failure_count: counts.agent,
    timeout_failure_count: counts.timeout,
    verifier_failure_count: counts.verifier,
    failure_counts: counts,
    total_model_cost_usd: modelCost.value,
    per_task_model_cost_usd: perTaskModelCostUsd,
    model_cost_source: modelCost.source,
    compute_cost_usd: compute.value,
    compute_cost_source: compute.source,
    failed_trajectories: unique(
      failed.flatMap((task) =>
        task.trajectoryPath ? [task.trajectoryPath] : [],
      ),
    ),
    failed_verifier_logs: unique(
      failed.flatMap((task) => task.verifierLogPaths),
    ),
    tasks: run.tasks.map((task) => ({
      task_id: task.taskId,
      trial_id: task.trialId,
      reward: task.reward,
      resolved: task.resolved,
      model_cost_usd: task.modelCostUsd,
      failure_category: task.failureCategory,
      trial_path: task.trialPath,
      trajectory_path: task.trajectoryPath,
      verifier_log_paths: task.verifierLogPaths,
    })),
    recorded_at: new Date().toISOString(),
  };
};

export const writeTerminalBenchSummary = async (
  outputPath: string,
  summary: TerminalBenchSummary,
): Promise<string> => {
  const target = path.resolve(outputPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return target;
};

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("-") ? value : null;
};

const main = async (): Promise<void> => {
  const jobPath =
    argument("--job") ??
    process.env.TERMINAL_BENCH_JOB_PATH ??
    process.argv.slice(2).find((value) => !value.startsWith("-"));
  if (!jobPath) throw new Error("Harbor job path is required");
  const run = await parseHarborRun(jobPath);
  const runId = argument("--run-id") ?? process.env.TERMINAL_BENCH_RUN_ID;
  if (runId && !/^[A-Za-z0-9_.-]+$/.test(runId))
    throw new Error("run ID contains unsupported characters");
  const outputPath =
    argument("--output") ??
    process.env.TERMINAL_BENCH_SUMMARY_PATH ??
    (runId
      ? path.join("terminal-bench/.data/runs", runId, "summary.json")
      : path.join(jobPath, "summary.json"));
  const summary = buildTerminalBenchSummary(run);
  const summaryPath = await writeTerminalBenchSummary(outputPath, summary);
  process.stdout.write(`${JSON.stringify({ summaryPath, summary })}\n`);
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
