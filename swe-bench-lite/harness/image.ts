import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { SweBenchTask } from "./types";

const execFile = promisify(execFileCallback);
const dockerTimeoutMs = Number(
  process.env.SWE_BENCH_DOCKER_TIMEOUT_MS ?? 1_800_000,
);

const docker = async (
  args: string[],
  timeout = dockerTimeoutMs,
): Promise<string> => {
  const result = await execFile("docker", args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
};

const safeImagePart = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]+/g, "-")
    .slice(0, 100);

export const taskImage = (task: SweBenchTask): string =>
  task.image ??
  process.env.SWE_BENCH_TASK_IMAGE ??
  `swebench/sweb.eval.x86_64.${task.instance_id}:latest`;

export const verifyDocker = async (): Promise<void> => {
  await docker(["info"], 30_000);
};

export const ensureTaskImage = async (task: SweBenchTask): Promise<string> => {
  const image = taskImage(task);
  try {
    await docker(["image", "inspect", image], 30_000);
  } catch {
    await docker(["pull", image]);
  }
  return image;
};

export const buildAgentImage = async (
  task: SweBenchTask,
  baseImage: string,
): Promise<{ image: string; digest: string }> => {
  const image =
    process.env.SWE_BENCH_AGENT_IMAGE ??
    `swe-bench-lite/agent:${safeImagePart(task.instance_id)}`;
  if (!process.env.SWE_BENCH_AGENT_IMAGE) {
    const context = path.resolve("swe-bench-lite");
    await docker([
      "build",
      "--build-arg",
      `SWEBENCH_TASK_IMAGE=${baseImage}`,
      "--file",
      path.join(context, "Dockerfile.agent"),
      "--tag",
      image,
      context,
    ]);
  }
  await docker(
    [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      image,
      "-lc",
      'test -d /workspace/repo && test -w /workspace/repo && test "$(stat -c \'%U\' /workspace/repo)" = node && test "$(id -un)" = node && command -v sh && command -v sleep && command -v git && node --version',
    ],
    120_000,
  );
  const inspected = JSON.parse(
    await docker(["image", "inspect", image]),
  ) as Array<{
    Id?: string;
  }>;
  const digest = inspected[0]?.Id;
  if (!digest) throw new Error(`agent image ${image} had no local image ID`);
  return { image, digest };
};
