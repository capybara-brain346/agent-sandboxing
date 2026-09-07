import "dotenv/config";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { capyNodesEvalCases } from "./cases";
import {
  assertCapyNodesAttempt,
  assertionFailures,
  classifyAssertions,
  classifyError,
} from "./harness/assertions";
import {
  baselineRoot,
  cleanupTaskFixture,
  createTaskFixture,
  fixtureRoot,
  verifyTaskFixture,
} from "./harness/fixture";
import { evaluationAuthFromEnv, EvalHttpClient } from "./harness/client";
import {
  cleanupCheckout,
  cleanupSandbox,
  extractCheckout,
  locateSandbox,
  runGrader,
} from "./harness/sandbox";
import { capyNodesEvalReportPath, writeEvalAttempt } from "./harness/report";
import type {
  CapyNodesEvalCase,
  EvalAttempt,
  OracleSmokeResult,
  TaskFixture,
} from "./harness/types";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const image = process.env.E2E_SANDBOX_IMAGE ?? "capynodes-e2e:latest";

const commandAvailable = async (command: string): Promise<void> => {
  await execFileAsync("sh", ["-lc", `command -v ${command}`], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
};

const verifyPreflight = async (): Promise<EvalHttpClient> => {
  await access(baselineRoot);
  const baselineStat = await stat(baselineRoot);
  if (!baselineStat.isDirectory())
    throw new Error("CapyNodes baseline is not a directory");
  await commandAvailable("git");
  await commandAvailable("docker");
  await execFileAsync("docker", ["info"], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  await execFileAsync("docker", ["image", "inspect", image], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  await access("docker-compose.e2e.yml");
  const compose = await readFile("docker-compose.e2e.yml", "utf8");
  if (!compose.includes("/workspace/evals:ro"))
    throw new Error(
      "docker-compose.e2e.yml does not mount the evaluator fixture root",
    );
  const auth = evaluationAuthFromEnv();
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY is required for live E2E evaluation");
  const client = await EvalHttpClient.create(baseUrl, auth);
  const health = await client.health();
  if (health.status !== "ok")
    throw new Error("API health check did not return ok");
  await mkdir(fixtureRoot, { recursive: true });
  return client;
};

const smokePassed = (
  results: { exitCode: number | null; timedOut: boolean }[],
): boolean =>
  results.length > 0 &&
  results.every((result) => result.exitCode === 0 && !result.timedOut);

export const runOracleSmoke = async (
  evalCase: CapyNodesEvalCase,
): Promise<OracleSmokeResult> => {
  const suffix = `${Date.now()}-${process.pid}`;
  let good: TaskFixture | undefined;
  let bad: TaskFixture | undefined;
  const details: string[] = [];
  try {
    good = await createTaskFixture(evalCase, {
      attemptId: `smoke-good-${evalCase.id}-${suffix}`,
      applySeed: false,
    });
    bad = await createTaskFixture(evalCase, {
      attemptId: `smoke-bad-${evalCase.id}-${suffix}`,
    });
    const goodResults = await runGrader(evalCase, good.sourceRoot);
    const badResults = await runGrader(evalCase, bad.sourceRoot);
    const knownGoodPassed = smokePassed(goodResults);
    const knownBadFailed = badResults.some(
      (result) => result.exitCode !== 0 || result.timedOut,
    );
    details.push(
      `known-good ${knownGoodPassed ? "passed" : "failed"}`,
      `known-bad ${knownBadFailed ? "failed as expected" : "passed unexpectedly"}`,
    );
    return { caseId: evalCase.id, knownGoodPassed, knownBadFailed, details };
  } finally {
    if (good) await cleanupTaskFixture(good);
    if (bad) await cleanupTaskFixture(bad);
  }
};

const safeError = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown evaluator failure";

const failedAttempt = (
  evalCase: CapyNodesEvalCase,
  attemptId: string,
  startedAt: number,
  error: unknown,
  evidence: EvalAttempt["evidence"],
): EvalAttempt => ({
  attemptId,
  caseId: evalCase.id,
  level: evalCase.level,
  title: evalCase.title,
  classification: classifyError(error),
  passed: false,
  durationMs: Date.now() - startedAt,
  changedFiles: evidence.changedFiles,
  assertions: [],
  evidence,
  failure: safeError(error),
  recordedAt: new Date().toISOString(),
});

const runLiveCase = async (
  client: EvalHttpClient,
  evalCase: CapyNodesEvalCase,
): Promise<EvalAttempt> => {
  const startedAt = Date.now();
  const attemptId = `${evalCase.id}-${startedAt}-${process.pid}`;
  let fixture: TaskFixture | undefined;
  let sandboxId: string | undefined;
  let checkoutRoot: string | undefined;
  let attempt: EvalAttempt;
  try {
    fixture = await createTaskFixture(evalCase, { attemptId });
    const chat = await client.runSession(evalCase, fixture);
    sandboxId = chat.session.sandboxId ?? undefined;
    if (!sandboxId)
      throw new Error("completed chat session did not persist a sandbox id");
    const sandbox = await locateSandbox(sandboxId);
    checkoutRoot = await extractCheckout(sandbox);
    const grader = await runGrader(evalCase, checkoutRoot);
    const sandboxEvidence = { ...sandbox, checkoutRoot, grader };
    const asserted = await assertCapyNodesAttempt(
      evalCase,
      fixture,
      chat,
      sandboxEvidence,
      [
        process.env.E2E_AUTH_COOKIE_SECRET ??
          process.env.AUTH_COOKIE_SECRET ??
          "",
        process.env.OPENROUTER_API_KEY ?? "",
      ],
    );
    const classification = classifyAssertions(asserted.assertions, chat);
    attempt = {
      attemptId,
      caseId: evalCase.id,
      level: evalCase.level,
      title: evalCase.title,
      classification,
      passed: classification === "correct",
      durationMs: Date.now() - startedAt,
      changedFiles: asserted.attemptEvidence.changedFiles,
      assertions: asserted.assertions,
      evidence: asserted.attemptEvidence,
      failure: assertionFailures(asserted.assertions).join("; ") || undefined,
      recordedAt: new Date().toISOString(),
    };
  } catch (error) {
    sandboxId = sandboxId ?? client.lastSandboxId;
    const sourceIntegrity = fixture
      ? await verifyTaskFixture(fixture).catch(() => ({
          baselineUnchanged: false,
          seededSourceUnchanged: false,
        }))
      : { baselineUnchanged: false, seededSourceUnchanged: false };
    attempt = failedAttempt(evalCase, attemptId, startedAt, error, {
      changedFiles: [],
      diffBytes: 0,
      sourceIntegrity,
    });
  } finally {
    await cleanupCheckout(checkoutRoot);
    await cleanupSandbox(sandboxId);
    if (fixture) await cleanupTaskFixture(fixture);
  }
  return attempt;
};

const printAttempt = (attempt: EvalAttempt): void => {
  const label = attempt.passed ? "PASS" : "FAIL";
  console.log(`${label} ${attempt.caseId} ${attempt.classification}`);
  if (attempt.failure) console.log(`  ${attempt.failure}`);
  console.log(`  changed files: ${attempt.changedFiles.join(", ") || "none"}`);
  console.log(`  duration: ${attempt.durationMs}ms`);
};

const main = async (): Promise<void> => {
  let client: EvalHttpClient;
  try {
    client = await verifyPreflight();
  } catch (error) {
    console.error(`E2E preflight failed: ${safeError(error)}`);
    process.exitCode = 2;
    return;
  }
  console.log(`CapyNodes E2E evaluator using ${baseUrl}`);
  for (const evalCase of capyNodesEvalCases) {
    const smoke = await runOracleSmoke(evalCase);
    console.log(`${evalCase.id}: ${smoke.details.join(", ")}`);
    if (!smoke.knownGoodPassed || !smoke.knownBadFailed) {
      console.error(`E2E oracle smoke failed for ${evalCase.id}`);
      process.exitCode = 2;
      return;
    }
  }
  let failures = 0;
  for (const evalCase of capyNodesEvalCases) {
    const attempt = await runLiveCase(client, evalCase);
    await writeEvalAttempt(attempt);
    printAttempt(attempt);
    if (!attempt.passed) failures += 1;
  }
  console.log(
    `${capyNodesEvalCases.length - failures} passed, ${failures} failed`,
  );
  console.log(`report: ${capyNodesEvalReportPath}`);
  if (failures) process.exitCode = 1;
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
