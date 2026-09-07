import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CapyNodesEvalCase, FixtureSnapshot, TaskFixture } from "./types";

const execFileAsync = promisify(execFile);
const defaultBaselineRoot = path.resolve("repo/capynodes-backend");
const defaultFixtureRoot = path.resolve(".data/evals/e2e/fixtures");
const defaultContainerFixtureRoot = "/workspace/evals";

const resolvedPath = (value: string): string => path.resolve(value);

const isWithin = (root: string, value: string): boolean => {
  const relative = path.relative(root, value);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const assertWithin = (root: string, value: string): void => {
  if (!isWithin(root, value)) throw new Error("fixture path escaped its root");
};

const assertCaseId = (value: string): void => {
  if (!/^[a-z0-9-]+$/.test(value))
    throw new Error("invalid evaluation case id");
};

const walkSnapshot = async (
  root: string,
  current: string,
  snapshot: FixtureSnapshot,
): Promise<void> => {
  const directory = path.join(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const relative = path.join(current, entry.name);
    const absolute = path.join(root, relative);
    if (entry.isDirectory()) {
      await walkSnapshot(root, relative, snapshot);
      continue;
    }
    if (!entry.isFile())
      throw new Error(`unsupported fixture entry: ${relative}`);
    snapshot[relative] = createHash("sha256")
      .update(await readFile(absolute))
      .digest("hex");
  }
};

export const snapshotDirectory = async (
  root: string,
): Promise<FixtureSnapshot> => {
  const snapshot: FixtureSnapshot = {};
  await walkSnapshot(root, "", snapshot);
  return snapshot;
};

export const digestSnapshot = (snapshot: FixtureSnapshot): string => {
  const hash = createHash("sha256");
  for (const [relative, digest] of Object.entries(snapshot).sort(
    ([left], [right]) => left.localeCompare(right),
  ))
    hash.update(`${relative}\0${digest}\0`);
  return hash.digest("hex");
};

export const digestDirectory = async (root: string): Promise<string> =>
  digestSnapshot(await snapshotDirectory(root));

export const replaceFixtureText = async (
  root: string,
  relative: string,
  from: string,
  to: string,
): Promise<void> => {
  const absolute = path.resolve(root, relative);
  assertWithin(resolvedPath(root), absolute);
  const current = await readFile(absolute, "utf8");
  const occurrences = current.split(from).length - 1;
  if (occurrences !== 1)
    throw new Error(
      `expected one seed match in ${relative}, got ${occurrences}`,
    );
  await writeFile(absolute, current.replace(from, to));
};

export const writeFixtureText = async (
  root: string,
  relative: string,
  content: string,
): Promise<void> => {
  const absolute = path.resolve(root, relative);
  assertWithin(resolvedPath(root), absolute);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
};

const runGit = async (root: string, args: string[]): Promise<string> => {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
};

export const baselineRoot = resolvedPath(
  process.env.CAPYNODES_BASELINE_ROOT ?? defaultBaselineRoot,
);
export const fixtureRoot = resolvedPath(
  process.env.E2E_FIXTURE_ROOT ?? defaultFixtureRoot,
);
export const containerFixtureRoot =
  process.env.E2E_APP_FIXTURE_ROOT ?? defaultContainerFixtureRoot;

export const createTaskFixture = async (
  evalCase: CapyNodesEvalCase,
  options: { attemptId?: string; applySeed?: boolean } = {},
): Promise<TaskFixture> => {
  assertCaseId(evalCase.id);
  const attemptId =
    options.attemptId ?? `${evalCase.id}-${Date.now()}-${process.pid}`;
  if (!/^[a-z0-9-]+$/.test(attemptId))
    throw new Error("invalid fixture attempt id");
  await access(baselineRoot);
  const baselineStat = await stat(baselineRoot);
  if (!baselineStat.isDirectory())
    throw new Error("CapyNodes baseline is not a directory");
  await mkdir(fixtureRoot, { recursive: true });
  const taskRoot = path.join(fixtureRoot, attemptId);
  const sourceRoot = path.join(taskRoot, "repo");
  assertWithin(fixtureRoot, taskRoot);
  await mkdir(taskRoot);
  const baselineDigest = await digestDirectory(baselineRoot);
  await cp(baselineRoot, sourceRoot, { recursive: true });
  if (options.applySeed !== false) await evalCase.seed(sourceRoot);
  const seededFiles = await snapshotDirectory(sourceRoot);
  const seededDigest = digestSnapshot(seededFiles);
  await runGit(sourceRoot, ["init", "-b", "main"]);
  await runGit(sourceRoot, [
    "config",
    "user.email",
    "capynodes-e2e@example.invalid",
  ]);
  await runGit(sourceRoot, ["config", "user.name", "CapyNodes E2E"]);
  await runGit(sourceRoot, ["add", "--all"]);
  await runGit(sourceRoot, ["commit", "--message", `baseline ${evalCase.id}`]);
  const baselineSha = await runGit(sourceRoot, ["rev-parse", "HEAD"]);
  const relativeTaskRoot = path.relative(fixtureRoot, taskRoot);
  if (!relativeTaskRoot || relativeTaskRoot.startsWith(".."))
    throw new Error("fixture path could not be mapped into the app container");
  return {
    attemptId,
    taskRoot,
    sourceRoot,
    containerRepoRef: path.posix.join(
      containerFixtureRoot,
      relativeTaskRoot.split(path.sep).join("/"),
      "repo",
    ),
    baselineDigest,
    seededDigest,
    baselineSha,
    seededFiles,
  };
};

export const verifyTaskFixture = async (
  fixture: TaskFixture,
): Promise<{ baselineUnchanged: boolean; seededSourceUnchanged: boolean }> => {
  const baselineUnchanged =
    (await digestDirectory(baselineRoot)) === fixture.baselineDigest;
  const seededSourceUnchanged =
    (await digestDirectory(fixture.sourceRoot)) === fixture.seededDigest;
  return { baselineUnchanged, seededSourceUnchanged };
};

export const cleanupTaskFixture = async (
  fixture: TaskFixture,
): Promise<void> => {
  assertWithin(fixtureRoot, fixture.taskRoot);
  await rm(fixture.taskRoot, { recursive: true, force: true });
};

export const temporaryDirectory = async (
  prefix: string,
  parent = os.tmpdir(),
): Promise<string> => {
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, prefix));
};
