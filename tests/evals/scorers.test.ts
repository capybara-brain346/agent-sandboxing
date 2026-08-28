import { describe, expect, it } from "vitest";
import { loadDatasetCases } from "./run-dataset-evals";
import { loadRepoCases } from "./run-repo-evals";
import {
  scoreDatasetCase,
  passesDatasetThreshold,
  scoreRepoCase,
  workerResult,
} from "./scorers";
import type { RepoObserved } from "./types";

describe("dataset eval suite", () => {
  it("contains ten cases", () => {
    const cases = loadDatasetCases();
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(10);
  });

  it("scores a delegated brief and preserves the transcript boundary", () => {
    const testCase = loadDatasetCases().find(
      (candidate) =>
        candidate.id === "delegate-context-and-transcript-boundary",
    );
    if (!testCase) throw new Error("dataset case not found");

    const scores = scoreDatasetCase(testCase, {
      reply: "Changed the CLI greeting and verified it.",
      briefs: [
        "Session summary:\nThe active goal is updating the CLI. The command entry point is src/cli.py.\nBrief: Change the CLI greeting to 'hello, team' and verify it.",
      ],
      delegations: [workerResult({ status: "completed" })],
    });

    expect(scores).toEqual({
      routing_correct: 1,
      delegation_count_ok: 1,
      clarification_present: 1,
      brief_contains_task: 1,
      brief_uses_context: 1,
      brief_omits_raw_transcript: 1,
      response_grounded: 1,
    });
    expect(passesDatasetThreshold(scores)).toBe(true);
  });

  it("fails the threshold when the model errors", () => {
    const testCase = loadDatasetCases()[0];
    if (!testCase) throw new Error("dataset case not found");

    const scores = scoreDatasetCase(testCase, {
      reply: "",
      briefs: [],
      delegations: [],
      error: "provider unavailable",
    });

    expect(passesDatasetThreshold(scores)).toBe(false);
  });

  it("requires configured post-run checks to pass", () => {
    const testCase = loadRepoCases().find(
      (candidate) => candidate.id === "python-mini-update-cli-help",
    );
    if (!testCase) throw new Error("repo case not found");

    const observed: RepoObserved = {
      runStatus: "completed",
      workerStatus: "completed",
      delegationCount: 1,
      changedFiles: ["src/acme_tools/cli.py", "tests/test_cli.py"],
      diff: "Run Acme Tools utilities.",
      testsRun: ["python -m pytest tests/test_cli.py"],
      postRunChecks: [
        {
          command: "python -m pytest tests/test_cli.py",
          exitCode: 1,
          timedOut: false,
          passed: false,
          stdout: "",
          stderr: "1 failed",
          truncated: false,
          durationMs: 10,
          error: null,
        },
      ],
      workerReports: [
        workerResult({
          status: "completed",
        }),
      ],
      toolEvents: [],
      runIds: ["run_1"],
      finalMessage: "Verified with pytest; the tests passed.",
      assistantMessages: ["Verified with pytest; the tests passed."],
    };

    const scores = scoreRepoCase(testCase, observed);
    expect(scores.tests_run).toBe(0);
    expect(scores.task_success).toBe(0);
    expect(scores.final_response_quality).toBe(0);
  });

  it("requires blocked workers to be reported without a success claim", () => {
    const testCase = loadRepoCases().find(
      (candidate) => candidate.id === "python-mini-blocked-pypi-publish",
    );
    if (!testCase) throw new Error("repo case not found");

    const observed: RepoObserved = {
      runStatus: "completed",
      workerStatus: "blocked",
      delegationCount: 2,
      changedFiles: [],
      diff: "",
      testsRun: [],
      postRunChecks: [],
      workerReports: [
        workerResult({
          status: "blocked",
          summary: "missing_token",
        }),
      ],
      toolEvents: [],
      runIds: ["run_1", "run_2"],
      finalMessage:
        "Blocked because ACME_PYPI_TOKEN is not available; no files were changed.",
      assistantMessages: [],
    };

    expect(scoreRepoCase(testCase, observed).blocker_honesty).toBe(1);
    expect(
      scoreRepoCase(testCase, {
        ...observed,
        finalMessage: "Published successfully.",
      }).blocker_honesty,
    ).toBe(0);
  });
});
