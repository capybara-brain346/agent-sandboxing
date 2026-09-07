import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { snapshotDirectory, temporaryDirectory } from "./fixture";
import type { CapyNodesEvalCase, GraderResult, SandboxEvidence } from "./types";

const execFileAsync = promisify(execFile);
const sandboxLabel = "com.agent-sandboxing.sandbox-id";
const managedLabel = "com.agent-sandboxing.managed=true";

type LocatedSandbox = {
  sandboxId: string;
  containerId: string;
  containerName: string;
};

const outputText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : value instanceof Error
      ? value.message
      : "";

const docker = async (args: string[], timeout = 30_000): Promise<string> => {
  const result = await execFileAsync("docker", args, {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout.trim();
};

const listedContainers = async (sandboxId: string): Promise<string[]> => {
  const output = await docker([
    "ps",
    "-aq",
    "--filter",
    `label=${sandboxLabel}=${sandboxId}`,
    "--filter",
    `label=${managedLabel}`,
  ]);
  return output.split(/\s+/).filter(Boolean);
};

export const locateSandbox = async (
  sandboxId: string,
): Promise<LocatedSandbox> => {
  if (!/^sbox_[A-Za-z0-9]+$/.test(sandboxId))
    throw new Error("invalid persisted sandbox id");
  const containers = await listedContainers(sandboxId);
  if (containers.length !== 1)
    throw new Error(
      `expected one managed sandbox container, found ${containers.length}`,
    );
  const containerId = containers[0];
  if (!containerId) throw new Error("sandbox container id was empty");
  const labels = JSON.parse(
    await docker([
      "inspect",
      "--format",
      "{{json .Config.Labels}}",
      containerId,
    ]),
  ) as Record<string, string>;
  if (
    labels[sandboxLabel] !== sandboxId ||
    labels["com.agent-sandboxing.managed"] !== "true"
  )
    throw new Error(
      "sandbox container labels did not match persisted ownership",
    );
  const rawName = await docker([
    "inspect",
    "--format",
    "{{.Name}}",
    containerId,
  ]);
  return {
    sandboxId,
    containerId,
    containerName: rawName.replace(/^\//, ""),
  };
};

export const extractCheckout = async (
  sandbox: LocatedSandbox,
): Promise<string> => {
  const checkoutRoot = await temporaryDirectory("capynodes-e2e-checkout-");
  await docker(
    ["cp", `${sandbox.containerId}:/workspace/repo/.`, checkoutRoot],
    120_000,
  );
  const snapshot = await snapshotDirectory(checkoutRoot);
  if (Object.keys(snapshot).length === 0)
    throw new Error("sandbox checkout was empty");
  return checkoutRoot;
};

const graderScript = (command: string): string =>
  [
    "set -eu",
    "rm -rf /tmp/capynodes-e2e-repo",
    "cp -a /workspace/repo /tmp/capynodes-e2e-repo",
    "if [ -d /opt/capynodes-frontend/node_modules ]; then cp -a /opt/capynodes-frontend/node_modules /tmp/capynodes-e2e-repo/capynodes-frontend/node_modules; fi",
    "cd /tmp/capynodes-e2e-repo",
    command,
  ].join("\n");

export const runGrader = async (
  evalCase: CapyNodesEvalCase,
  checkoutRoot: string,
): Promise<GraderResult[]> => {
  const graderRoot = await temporaryDirectory(
    "capynodes-e2e-grader-",
    path.resolve(".data/evals/e2e/grader"),
  );
  const graderRepo = `${graderRoot}/repo`;
  try {
    await mkdir(graderRepo, { recursive: true });
    await cp(checkoutRoot, graderRepo, { recursive: true });
    await mkdir(`${graderRepo}/e2e_hidden`, { recursive: true });
    await cp(evalCase.oracleDirectory, `${graderRepo}/e2e_hidden`, {
      recursive: true,
    });
    const image =
      evalCase.image ?? process.env.E2E_SANDBOX_IMAGE ?? "capynodes-e2e:latest";
    const results: GraderResult[] = [];
    for (const grading of evalCase.grading) {
      const startedAt = Date.now();
      try {
        const result = await execFileAsync(
          "docker",
          [
            "run",
            "--rm",
            "--network",
            "none",
            "--label",
            "com.agent-sandboxing.evaluator=true",
            "--mount",
            `type=bind,source=${graderRepo},target=/workspace/repo,readonly`,
            "-w",
            "/workspace/repo",
            image,
            "sh",
            "-lc",
            graderScript(grading.command),
          ],
          {
            timeout:
              evalCase.timeoutMs ??
              Number(process.env.E2E_GRADER_TIMEOUT_MS ?? 900_000),
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        results.push({
          name: grading.name,
          command: grading.command,
          exitCode: 0,
          timedOut: false,
          stdout: result.stdout.slice(-20_000),
          stderr: result.stderr.slice(-20_000),
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const record = error as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
          signal?: string;
        };
        results.push({
          name: grading.name,
          command: grading.command,
          exitCode: typeof record.code === "number" ? record.code : null,
          timedOut: record.killed === true || record.signal === "SIGTERM",
          stdout: outputText(record.stdout).slice(-20_000),
          stderr: outputText(record.stderr).slice(-20_000),
          durationMs: Date.now() - startedAt,
        });
      }
    }
    return results;
  } finally {
    await rm(graderRoot, { recursive: true, force: true });
  }
};

export const evaluateSandbox = async (
  evalCase: CapyNodesEvalCase,
  sandboxId: string,
): Promise<SandboxEvidence> => {
  const located = await locateSandbox(sandboxId);
  const checkoutRoot = await extractCheckout(located);
  const grader = await runGrader(evalCase, checkoutRoot);
  return { ...located, checkoutRoot, grader };
};

export const cleanupSandbox = async (
  sandboxId: string | undefined,
): Promise<void> => {
  if (!sandboxId || !/^sbox_[A-Za-z0-9]+$/.test(sandboxId)) return;
  const containers = await listedContainers(sandboxId).catch(() => []);
  for (const containerId of containers)
    await execFileAsync("docker", ["rm", "-f", containerId], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
};

export const cleanupCheckout = async (
  checkoutRoot: string | undefined,
): Promise<void> => {
  if (checkoutRoot) await rm(checkoutRoot, { recursive: true, force: true });
};
