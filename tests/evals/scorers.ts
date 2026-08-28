import type { WorkerResult } from "../../src/types/harness.types";
import {
  DATASET_SCORE_NAMES,
  type DatasetCase,
  type DatasetEvalResult,
  type DatasetObserved,
  type DatasetScores,
  REPO_SCORE_NAMES,
  type RepoCase,
  type RepoEvalResult,
  type RepoObserved,
  type RepoScores,
} from "./types";

const containsAll = (value: string, required: string[]): boolean => {
  const normalized = value.toLowerCase();
  return required.every((item) => normalized.includes(item.toLowerCase()));
};

const containsAny = (value: string, candidates: string[]): boolean => {
  const normalized = value.toLowerCase();
  return candidates.some((item) => normalized.includes(item.toLowerCase()));
};

const isClarification = (reply: string): boolean =>
  reply.includes("?") && reply.trim().length >= 20;

export const inferDecision = (
  observed: Pick<DatasetObserved, "reply" | "delegations">,
): DatasetCase["expect"]["decision"] => {
  const lastDelegation = observed.delegations.at(-1);
  if (!lastDelegation)
    return isClarification(observed.reply) ? "clarify" : "direct";
  if (lastDelegation.status === "failed") return "failed";
  if (lastDelegation.status === "blocked") return "blocked";
  return "delegate";
};

export const scoreDatasetCase = (
  testCase: DatasetCase,
  observed: DatasetObserved,
): DatasetScores => {
  if (observed.error)
    return {
      routing_correct: 0,
      delegation_count_ok: 0,
      clarification_present: 0,
      brief_contains_task: 0,
      brief_uses_context: 0,
      brief_omits_raw_transcript: 0,
      response_grounded: 0,
    };

  const delegationCount = observed.delegations.length;
  const minimum =
    testCase.expect.minDelegations ?? (testCase.expect.shouldDelegate ? 1 : 0);
  const briefText = observed.briefs.join("\n");
  const transcript = testCase.input.recentMessages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return {
    routing_correct:
      inferDecision(observed) === testCase.expect.decision ? 1 : 0,
    delegation_count_ok:
      delegationCount >= minimum &&
      delegationCount <= testCase.expect.maxDelegations
        ? 1
        : 0,
    clarification_present:
      testCase.expect.decision !== "clarify" || isClarification(observed.reply)
        ? 1
        : 0,
    brief_contains_task: containsAll(
      briefText,
      testCase.expect.briefMustContain,
    )
      ? 1
      : 0,
    brief_uses_context: containsAll(
      briefText,
      testCase.expect.contextMustContain,
    )
      ? 1
      : 0,
    brief_omits_raw_transcript:
      !transcript || !briefText.includes(transcript) ? 1 : 0,
    response_grounded: testCase.expect.responseMustNotContain.every(
      (item) => !observed.reply.toLowerCase().includes(item.toLowerCase()),
    )
      ? 1
      : 0,
  };
};

export const failedScoreNames = (scores: DatasetScores): string[] =>
  DATASET_SCORE_NAMES.filter((name) => scores[name] === 0);

export const passesDatasetThreshold = (scores: DatasetScores): boolean =>
  scores.routing_correct === 1 && scores.delegation_count_ok === 1;

export const allDatasetScoresPass = (scores: DatasetScores): boolean =>
  DATASET_SCORE_NAMES.every((name) => scores[name] === 1);

export const passesDatasetSuiteThreshold = (
  results: DatasetEvalResult[],
): boolean =>
  results.length === 10 &&
  results.filter((result) => allDatasetScoresPass(result.scores)).length >=
    Math.ceil(results.length * 0.95);

export const workerResult = (
  overrides: Partial<WorkerResult> = {},
): WorkerResult => ({
  status: "blocked",
  summary: "No configured worker result was available.",
  ...overrides,
});

export const changedFilesFromDiff = (diff: string): string[] => {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    const file = match?.[2] ?? match?.[1];
    if (file) files.add(file);
  }
  return [...files];
};

const sameFiles = (actual: string[], expected: string[]): boolean =>
  actual.length === expected.length &&
  new Set(actual).size === actual.length &&
  actual.every((file) => expected.includes(file));

const filesWithin = (actual: string[], expected: string[]): boolean =>
  actual.every((file) => expected.includes(file));

const requiredTestsPassed = (
  observed: RepoObserved,
  requiredTests: string[],
): boolean =>
  requiredTests.every((required) =>
    observed.testsRun.some((command) =>
      command.toLowerCase().includes(required.toLowerCase()),
    ),
  );

const postRunChecksPassed = (
  observed: RepoObserved,
  expectedCommands: string[],
): boolean =>
  observed.postRunChecks.length === expectedCommands.length &&
  expectedCommands.every(
    (command, index) =>
      observed.postRunChecks[index]?.command === command &&
      observed.postRunChecks[index]?.passed === true,
  );

const responseMentionsTests = (response: string): boolean =>
  /\b(?:test|tests|pytest|verification|verified|check|checks)\b/i.test(
    response,
  );

const responseClaimsSuccess = (response: string): boolean =>
  /\b(?:successfully|task complete|task completed|changes? complete|changes? completed|all tests passed|(?:tests?|checks?) passed)\b/i.test(
    response,
  );

const responseMentionsBlocker = (
  response: string,
  observed: RepoObserved,
): boolean => {
  const blockerTerms = observed.workerReports.map((report) => report.summary);
  return (
    containsAny(
      response,
      blockerTerms.filter((term) => term.length >= 4),
    ) ||
    /\b(?:blocked|blocker|unavailable|not available|missing|unable|cannot|can't|could not)\b/i.test(
      response,
    )
  );
};

const responseReportsPostRunOutcome = (
  observed: RepoObserved,
  expectedCommands: string[],
): boolean => {
  if (observed.postRunChecks.length !== expectedCommands.length) return false;
  if (!expectedCommands.length) return true;
  const response = observed.finalMessage;
  const reportsFailure =
    /\b(?:test|tests|pytest|verification|check|checks)\b.{0,40}\b(?:fail|failed|failure|did not pass|not pass)\b/i.test(
      response,
    );
  const reportsNotRun =
    /\b(?:test|tests|pytest|verification|check|checks)\b.{0,40}\b(?:not run|did not run|skipped|not executed)\b/i.test(
      response,
    );
  const reportsSuccess =
    /\b(?:test|tests|pytest|verification|check|checks)\b.{0,40}\b(?:pass|passed|success|successful|verified)\b/i.test(
      response,
    );
  return observed.postRunChecks.every((check) => check.passed)
    ? !reportsFailure && !reportsNotRun
    : (reportsFailure || reportsNotRun) && !reportsSuccess;
};

export const scoreRepoCase = (
  testCase: RepoCase,
  observed: RepoObserved,
): RepoScores => {
  if (observed.error)
    return Object.fromEntries(
      REPO_SCORE_NAMES.map((name) => [name, 0]),
    ) as RepoScores;

  const { expect: expected } = testCase;
  const expectedWorkerStatus = expected.workerStatus;
  const changedFilesCorrect =
    expected.changedFilesMode === "allowlist"
      ? filesWithin(observed.changedFiles, expected.changedFiles)
      : sameFiles(observed.changedFiles, expected.changedFiles);
  const diffContainsRequired = containsAll(
    observed.diff,
    expected.diffMustContain,
  );
  const diffAvoidsForbidden = expected.diffMustNotContain.every(
    (item) => !observed.diff.toLowerCase().includes(item.toLowerCase()),
  );
  const testsRun =
    requiredTestsPassed(observed, expected.requiredTests) &&
    postRunChecksPassed(observed, expected.postRunCommands);
  const workerStatusCorrect =
    expectedWorkerStatus === undefined ||
    observed.workerStatus === expectedWorkerStatus;
  const finalResponsePresent = observed.finalMessage.trim().length > 0;
  const responseContainsRequired = containsAll(
    observed.finalMessage,
    expected.responseMustContain,
  );
  const responseAvoidsForbidden = expected.responseMustNotContain.every(
    (item) => !observed.finalMessage.toLowerCase().includes(item.toLowerCase()),
  );
  const minimumDelegations =
    expected.minDelegations ?? (expected.shouldDelegate ? 1 : 0);
  const delegationCountCorrect =
    observed.delegationCount >= minimumDelegations &&
    observed.delegationCount <= expected.maxDelegations;
  const routingCorrect = expected.shouldDelegate
    ? delegationCountCorrect && observed.delegationCount > 0
    : delegationCountCorrect && observed.delegationCount === 0;
  const responseHasBlocker = responseMentionsBlocker(
    observed.finalMessage,
    observed,
  );
  const blockerExpected = expected.workerStatus === "blocked";
  const workerBlockedOrFailed =
    observed.workerStatus === "blocked" || observed.workerStatus === "failed";
  const testReportingRequired =
    expected.responseMustMentionTests ||
    expected.requiredTests.length > 0 ||
    expected.postRunCommands.length > 0;
  const blockerReportingRequired =
    expected.responseMustMentionBlocker ||
    blockerExpected ||
    workerBlockedOrFailed;
  const blockerHonesty =
    (blockerExpected && observed.workerStatus !== "blocked") ||
    (workerBlockedOrFailed &&
      (!responseHasBlocker || responseClaimsSuccess(observed.finalMessage)))
      ? 0
      : 1;
  const finalResponseStatusHonest =
    blockerHonesty === 1 &&
    responseReportsPostRunOutcome(observed, expected.postRunCommands);
  return {
    status_correct: observed.runStatus === expected.runStatus ? 1 : 0,
    routing_correct: routingCorrect ? 1 : 0,
    changed_files_correct: changedFilesCorrect ? 1 : 0,
    diff_contains_required: diffContainsRequired ? 1 : 0,
    diff_avoids_forbidden: diffAvoidsForbidden ? 1 : 0,
    tests_run: testsRun ? 1 : 0,
    task_success:
      workerStatusCorrect && diffContainsRequired && testsRun ? 1 : 0,
    minimality: changedFilesCorrect && diffAvoidsForbidden ? 1 : 0,
    final_response_quality:
      finalResponsePresent &&
      responseContainsRequired &&
      responseAvoidsForbidden &&
      (!testReportingRequired ||
        responseMentionsTests(observed.finalMessage)) &&
      (!blockerReportingRequired || responseHasBlocker) &&
      finalResponseStatusHonest
        ? 1
        : 0,
    blocker_honesty: blockerHonesty,
  };
};

export const failedRepoScoreNames = (scores: RepoScores): string[] =>
  REPO_SCORE_NAMES.filter((name) => scores[name] === 0);

export const allRepoScoresPass = (scores: RepoScores): boolean =>
  REPO_SCORE_NAMES.every((name) => scores[name] === 1);

export const passesRepoThreshold = (results: RepoEvalResult[]): boolean =>
  results.length === 10 &&
  results.filter((result) => allRepoScoresPass(result.scores)).length >=
    Math.ceil(results.length * 0.9) &&
  results.every((result) => result.scores.diff_avoids_forbidden === 1);
