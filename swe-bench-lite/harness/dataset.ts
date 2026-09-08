import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SweBenchTask, TaskManifest } from "./types";

const hiddenFields = new Set([
  "patch",
  "test_patch",
  "gold_patch",
  "hints_text",
  "FAIL_TO_PASS",
  "PASS_TO_PASS",
  "eval_script",
  "test_directives",
  "environment_setup_commit",
  "version",
  "created_at",
  "tests",
]);

const allowedFields = new Set([
  "instance_id",
  "repo",
  "base_commit",
  "problem_statement",
  "split",
  "dataset_name",
  "dataset_revision",
  "dataset_task_count",
  "task_count",
  "image",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringField = (
  record: Record<string, unknown>,
  field: string,
): string => {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`manifest field ${field} must be a non-empty string`);
  return value;
};

const integerField = (
  record: Record<string, unknown>,
  field: string,
): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error(`manifest field ${field} must be a positive integer`);
  return value;
};

export const validateTaskRecord = (value: unknown): SweBenchTask => {
  if (!isRecord(value)) throw new Error("manifest record must be an object");
  for (const field of Object.keys(value)) {
    if (hiddenFields.has(field))
      throw new Error(`manifest contains hidden field ${field}`);
    if (!allowedFields.has(field))
      throw new Error(`manifest contains unsupported field ${field}`);
  }
  const instanceId = stringField(value, "instance_id");
  if (!/^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-[0-9]+$/.test(instanceId))
    throw new Error(`invalid SWE-bench instance_id ${instanceId}`);
  const repo = stringField(value, "repo");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    throw new Error(`invalid SWE-bench repository ${repo}`);
  const baseCommit = stringField(value, "base_commit");
  if (!/^[0-9a-f]{7,64}$/i.test(baseCommit))
    throw new Error(`invalid base commit for ${instanceId}`);
  const split = stringField(value, "split");
  if (split !== "dev")
    throw new Error(
      `development evaluation requires the dev split, got ${split}`,
    );
  const image =
    value.image === undefined ? undefined : stringField(value, "image");
  return {
    instance_id: instanceId,
    repo,
    base_commit: baseCommit,
    problem_statement: stringField(value, "problem_statement"),
    split: "dev",
    dataset_name: stringField(value, "dataset_name"),
    dataset_revision: stringField(value, "dataset_revision"),
    dataset_task_count: integerField(value, "dataset_task_count"),
    task_count: integerField(value, "task_count"),
    ...(image === undefined ? {} : { image }),
  };
};

export const readTaskManifest = async (
  manifestPath: string,
): Promise<TaskManifest> => {
  const absolutePath = path.resolve(manifestPath);
  const contents = await readFile(absolutePath, "utf8");
  const tasks = contents
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return validateTaskRecord(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(
          `invalid task manifest record ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    });
  if (tasks.length === 0)
    throw new Error(`task manifest ${absolutePath} is empty`);
  const first = tasks[0];
  if (!first) throw new Error(`task manifest ${absolutePath} is empty`);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.instance_id))
      throw new Error(`duplicate task ${task.instance_id} in manifest`);
    ids.add(task.instance_id);
    if (
      task.dataset_name !== first.dataset_name ||
      task.dataset_revision !== first.dataset_revision ||
      task.split !== first.split ||
      task.dataset_task_count !== first.dataset_task_count ||
      task.task_count !== first.task_count
    )
      throw new Error("task manifest records disagree on dataset metadata");
  }
  if (first.task_count !== tasks.length)
    throw new Error(
      `manifest task_count ${first.task_count} does not match ${tasks.length} records`,
    );
  return {
    path: absolutePath,
    datasetName: first.dataset_name,
    datasetRevision: first.dataset_revision,
    split: first.split,
    datasetTaskCount: first.dataset_task_count,
    taskCount: first.task_count,
    tasks,
  };
};

export const selectDevelopmentTasks = (
  manifest: TaskManifest,
  instanceIds = (
    process.env.SWE_BENCH_INSTANCE_IDS ?? process.env.SWE_BENCH_INSTANCE_ID
  )
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean),
): SweBenchTask[] => {
  if (manifest.split !== "dev")
    throw new Error(
      `development evaluation requires the dev split, got ${manifest.split}`,
    );
  if (!instanceIds || instanceIds.length === 0) return manifest.tasks;
  const tasks = instanceIds.map((instanceId) =>
    manifest.tasks.find((task) => task.instance_id === instanceId),
  );
  if (tasks.some((task) => task === undefined))
    throw new Error(
      `manifest does not contain requested task(s): ${instanceIds
        .filter(
          (instanceId) =>
            !manifest.tasks.some((task) => task.instance_id === instanceId),
        )
        .join(", ")}`,
    );
  if (new Set(instanceIds).size !== instanceIds.length)
    throw new Error("duplicate development task IDs are not allowed");
  return tasks.filter((task): task is SweBenchTask => task !== undefined);
};
