import { access, mkdir, rm } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { SweBenchTask, TaskFixture } from "./types";

const execFile = promisify(execFileCallback);
const defaultFixtureRoot = path.resolve("swe-bench-lite/.data/fixtures");
const defaultContainerFixtureRoot = "/workspace/swe-bench-lite/fixtures";

const fixtureRoot = path.resolve(
  process.env.SWE_BENCH_FIXTURE_ROOT ?? defaultFixtureRoot,
);
const containerFixtureRoot =
  process.env.SWE_BENCH_APP_FIXTURE_ROOT ?? defaultContainerFixtureRoot;

const assertSafePathComponent = (value: string, name: string): void => {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`invalid ${name}`);
};

const assertWithin = (root: string, value: string): void => {
  const relative = path.relative(root, value);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("fixture path escaped its root");
};

const runGit = async (root: string, args: string[]): Promise<string> => {
  const result = await execFile("git", ["-C", root, ...args], {
    timeout: Number(process.env.SWE_BENCH_GIT_TIMEOUT_MS ?? 900_000),
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout.trim();
};

export const createTaskFixture = async (
  task: SweBenchTask,
  options: {
    attemptId?: string;
    repoUrl?: string;
    root?: string;
  } = {},
): Promise<TaskFixture> => {
  const attemptId =
    options.attemptId ?? `${task.instance_id}-${Date.now()}-${process.pid}`;
  assertSafePathComponent(attemptId, "fixture attempt id");
  const root = path.resolve(options.root ?? fixtureRoot);
  const taskRoot = path.join(root, attemptId);
  const sourceRoot = path.join(taskRoot, "repo");
  assertWithin(root, taskRoot);
  await mkdir(root, { recursive: true });
  await access(root);
  await mkdir(taskRoot);
  try {
    const repository = options.repoUrl ?? `https://github.com/${task.repo}.git`;
    await execFile("git", [
      "init",
      "--quiet",
      "--initial-branch=main",
      sourceRoot,
    ]);
    await runGit(sourceRoot, ["remote", "add", "origin", repository]);
    await runGit(sourceRoot, [
      "fetch",
      "--depth",
      "1",
      "--no-tags",
      "origin",
      task.base_commit,
    ]);
    await runGit(sourceRoot, ["checkout", "--detach", "FETCH_HEAD"]);
    await runGit(sourceRoot, ["remote", "remove", "origin"]);
    await runGit(sourceRoot, ["reflog", "expire", "--expire=now", "--all"]);
    await runGit(sourceRoot, ["gc", "--prune=now"]);
    const head = await runGit(sourceRoot, ["rev-parse", "HEAD"]);
    if (head.toLowerCase() !== task.base_commit.toLowerCase())
      throw new Error(
        `fixture ${task.instance_id} checked out ${head}, expected ${task.base_commit}`,
      );
    const status = await runGit(sourceRoot, ["status", "--porcelain"]);
    if (status) throw new Error(`fixture ${task.instance_id} was not clean`);
    const relativeTaskRoot = path.relative(root, taskRoot);
    if (!relativeTaskRoot || relativeTaskRoot.startsWith(".."))
      throw new Error(
        "fixture path could not be mapped into the app container",
      );
    return {
      attemptId,
      fixtureRoot: root,
      taskRoot,
      sourceRoot,
      containerRepoRef: path.posix.join(
        containerFixtureRoot,
        relativeTaskRoot.split(path.sep).join("/"),
        "repo",
      ),
      baseCommit: head,
    };
  } catch (error) {
    await rm(taskRoot, { recursive: true, force: true });
    throw error;
  }
};

export const cleanupTaskFixture = async (
  fixture: TaskFixture,
): Promise<void> => {
  assertWithin(fixture.fixtureRoot, fixture.taskRoot);
  await rm(fixture.taskRoot, { recursive: true, force: true });
};
