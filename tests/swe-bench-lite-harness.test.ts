import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  selectDevelopmentTasks,
  selectEvaluationTasks,
  validateTaskRecord,
} from "../swe-bench-lite/harness/dataset";
import {
  cleanupTaskFixture,
  createTaskFixture,
} from "../swe-bench-lite/harness/fixture";
import {
  predictionForResult,
  readPredictions,
  validatePredictions,
  writePredictions,
} from "../swe-bench-lite/harness/predictions";
import {
  classifyFailure,
  assertRunIdFresh,
  buildOfficialMetrics,
  summarizeAttempts,
  writeAttempt,
} from "../swe-bench-lite/harness/report";
import type {
  SweBenchTask,
  TaskManifest,
} from "../swe-bench-lite/harness/types";

const execFile = promisify(execFileCallback);

const task = (
  baseCommit: string,
  split: "dev" | "test" = "dev",
): SweBenchTask => ({
  instance_id: "owner__repo-1",
  repo: "owner/repo",
  base_commit: baseCommit,
  problem_statement: "Fix the issue.",
  split,
  dataset_name: "SWE-bench/SWE-bench_Lite",
  dataset_revision: "b0dde1093fe417d83b7184254edf8199c1f0dff5",
  dataset_task_count: 1,
  task_count: 1,
});

const makeRepository = async (): Promise<{
  root: string;
  commit: string;
  futureCommit: string;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "swe-bench-lite-repo-"));
  await execFile("git", ["init", "-b", "main", root]);
  await writeFile(path.join(root, "README.md"), "base\n", "utf8");
  await execFile("git", ["-C", root, "add", "README.md"]);
  await execFile("git", [
    "-C",
    root,
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "user.name=SWE-bench test",
    "commit",
    "-m",
    "base",
  ]);
  const result = await execFile("git", ["-C", root, "rev-parse", "HEAD"]);
  await writeFile(path.join(root, "README.md"), "future\n", "utf8");
  await execFile("git", ["-C", root, "add", "README.md"]);
  await execFile("git", [
    "-C",
    root,
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "user.name=SWE-bench test",
    "commit",
    "-m",
    "future",
  ]);
  const future = await execFile("git", ["-C", root, "rev-parse", "HEAD"]);
  return {
    root,
    commit: result.stdout.trim(),
    futureCommit: future.stdout.trim(),
  };
};

describe("SWE-bench Lite harness", () => {
  it("rejects hidden dataset fields", () => {
    expect(() =>
      validateTaskRecord({
        ...task("0123456789abcdef0123456789abcdef01234567"),
        patch: "gold patch",
      }),
    ).toThrow(/hidden field patch/);
  });

  it("selects the requested development tasks without changing manifest order", () => {
    const first = task("0123456789abcdef0123456789abcdef01234567");
    const second: SweBenchTask = {
      ...first,
      instance_id: "owner__repo-2",
    };
    const manifest: TaskManifest = {
      path: "manifest.jsonl",
      datasetName: first.dataset_name,
      datasetRevision: first.dataset_revision,
      split: "dev",
      datasetTaskCount: 2,
      taskCount: 2,
      tasks: [first, second],
    };
    expect(selectDevelopmentTasks(manifest, [second.instance_id])).toEqual([
      second,
    ]);
    expect(() =>
      selectDevelopmentTasks(manifest, [first.instance_id, first.instance_id]),
    ).toThrow(/duplicate/);
  });

  it("accepts and selects a complete pinned test manifest", () => {
    const first = task("0123456789abcdef0123456789abcdef01234567", "test");
    const second: SweBenchTask = {
      ...first,
      instance_id: "owner__repo-2",
    };
    const manifest: TaskManifest = {
      path: "manifest.jsonl",
      datasetName: first.dataset_name,
      datasetRevision: first.dataset_revision,
      split: "test",
      datasetTaskCount: 2,
      taskCount: 2,
      tasks: [first, second],
    };
    expect(selectEvaluationTasks(manifest)).toEqual([first, second]);
    expect(validateTaskRecord({ ...first, split: "test" }).split).toBe("test");
  });

  it("isolates fixtures and checks out the requested commit", async () => {
    const repository = await makeRepository();
    const root = await mkdtemp(
      path.join(os.tmpdir(), "swe-bench-lite-fixtures-"),
    );
    try {
      const first = await createTaskFixture(task(repository.commit), {
        attemptId: "attempt-one",
        repoUrl: repository.root,
        root,
      });
      const second = await createTaskFixture(task(repository.commit), {
        attemptId: "attempt-two",
        repoUrl: repository.root,
        root,
      });
      await writeFile(
        path.join(first.sourceRoot, "README.md"),
        "changed\n",
        "utf8",
      );
      const head = await execFile("git", [
        "-C",
        second.sourceRoot,
        "rev-parse",
        "HEAD",
      ]);
      expect(head.stdout.trim()).toBe(repository.commit);
      expect(
        await readFile(path.join(second.sourceRoot, "README.md"), "utf8"),
      ).toBe("base\n");
      await expect(
        execFile("git", [
          "-C",
          first.sourceRoot,
          "cat-file",
          "-e",
          `${repository.futureCommit}^{commit}`,
        ]),
      ).rejects.toThrow();
      const refs = await execFile("git", [
        "-C",
        first.sourceRoot,
        "rev-list",
        "--all",
        "--count",
      ]);
      expect(refs.stdout.trim()).toBe("1");
      await cleanupTaskFixture(first);
      await cleanupTaskFixture(second);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(repository.root, { recursive: true, force: true });
    }
  });

  it("writes the official prediction fields and rejects duplicate task IDs", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "swe-bench-lite-predictions-"),
    );
    try {
      const prediction = predictionForResult(
        task("0123456789abcdef0123456789abcdef01234567"),
        "diff --git a/a b/a\n",
        "test-agent",
      );
      const predictionPath = await writePredictions(
        path.join(root, "predictions.jsonl"),
        [prediction],
        [prediction.instance_id],
      );
      expect(
        Object.keys((await readPredictions(predictionPath))[0] ?? {}).sort(),
      ).toEqual(["instance_id", "model_name_or_path", "model_patch"]);
      expect(() =>
        validatePredictions([prediction, prediction], [prediction.instance_id]),
      ).toThrow(/duplicate prediction/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records failed attempts and rejects changed predictions under one run ID", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "swe-bench-lite-reports-"),
    );
    try {
      await writeAttempt(root, {
        attemptId: "attempt-one",
        instanceId: "owner__repo-1",
        status: "failed",
        diffBytes: 0,
        failure: "provider failure",
        startedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:01.000Z",
      });
      expect(
        await readFile(path.join(root, "attempts.jsonl"), "utf8"),
      ).toContain("provider failure");
      await mkdir(path.join(root, "old", "official-results"), {
        recursive: true,
      });
      await writeFile(
        path.join(root, "old", "official-results", "grade.json"),
        JSON.stringify({ runId: "run-1", predictionSha256: "old" }),
        "utf8",
      );
      await expect(assertRunIdFresh("run-1", "new", root)).rejects.toThrow(
        /different prediction/,
      );
      await expect(
        assertRunIdFresh("run-2", "new", root),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("summarizes one terminal attempt per development task", () => {
    const attempts = [
      {
        attemptId: "attempt-one",
        instanceId: "owner__repo-1",
        status: "completed" as const,
        classification: "submitted",
        diffBytes: 10,
        startedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:01.000Z",
      },
      {
        attemptId: "attempt-two",
        instanceId: "owner__repo-2",
        status: "failed" as const,
        classification: "setup_failed",
        failureCategory: "setup" as const,
        diffBytes: 0,
        startedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:01.000Z",
      },
      {
        attemptId: "attempt-three",
        instanceId: "owner__repo-3",
        status: "failed" as const,
        classification: "provider_failed",
        failureCategory: "provider" as const,
        diffBytes: 0,
        startedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:01.000Z",
      },
      {
        attemptId: "attempt-four",
        instanceId: "owner__repo-4",
        status: "no_patch" as const,
        classification: "no_patch",
        diffBytes: 0,
        startedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:01.000Z",
      },
    ];
    expect(
      summarizeAttempts(attempts, [
        "owner__repo-1",
        "owner__repo-2",
        "owner__repo-3",
        "owner__repo-4",
      ]),
    ).toMatchObject({
      taskCount: 4,
      attemptCount: 4,
      predictionCount: 4,
      submittedCount: 1,
      noPatchCount: 1,
      setupFailureCount: 1,
      providerFailureCount: 1,
      sessionFailureCount: 0,
    });
    expect(classifyFailure("session", { code: "agent_provider_failed" })).toBe(
      "provider",
    );
    expect(() =>
      summarizeAttempts(attempts.slice(0, 3), [
        "owner__repo-1",
        "owner__repo-2",
        "owner__repo-3",
        "owner__repo-4",
      ]),
    ).toThrow(/one terminal attempt/);
  });

  it("reports Phase 3 ratios with explicit denominators and costs", () => {
    const predictions = [
      predictionForResult(
        task("0123456789abcdef0123456789abcdef01234567"),
        "diff",
        "agent",
      ),
      predictionForResult(
        {
          ...task("0123456789abcdef0123456789abcdef01234567"),
          instance_id: "owner__repo-2",
        },
        "",
        "agent",
      ),
    ];
    const metrics = buildOfficialMetrics({
      taskIds: ["owner__repo-1", "owner__repo-2"],
      predictions,
      attempts: [
        {
          attemptId: "attempt-one",
          instanceId: "owner__repo-1",
          status: "completed",
          diffBytes: 4,
          startedAt: "2026-09-08T00:00:00.000Z",
          completedAt: "2026-09-08T00:00:01.000Z",
        },
        {
          attemptId: "attempt-two",
          instanceId: "owner__repo-2",
          status: "no_patch",
          diffBytes: 0,
          startedAt: "2026-09-08T00:00:00.000Z",
          completedAt: "2026-09-08T00:00:01.000Z",
        },
      ],
      classifications: {
        "owner__repo-1": "resolved",
        "owner__repo-2": "not_submitted",
      },
    });
    expect(metrics).toMatchObject({
      submittedPredictions: 1,
      allRecordedAttempts: 2,
      officialResolved: 1,
      resolvedPct: 1,
      completionYieldPct: 0.5,
      noPatchCount: 1,
      estimatedUsd: null,
      costSource: "unavailable",
    });
  });
});
