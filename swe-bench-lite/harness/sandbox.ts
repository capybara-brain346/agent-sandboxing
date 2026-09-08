import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const docker = async (args: string[], timeout = 120_000): Promise<string> => {
  const result = await execFile("docker", args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
};

export const verifySessionSandbox = async (
  sandboxId: string,
): Promise<string> => {
  if (!/^sbox_[A-Za-z0-9]+$/.test(sandboxId))
    throw new Error("invalid persisted sandbox id");
  const output = await docker([
    "ps",
    "-aq",
    "--filter",
    `label=com.agent-sandboxing.sandbox-id=${sandboxId}`,
    "--filter",
    "label=com.agent-sandboxing.managed=true",
  ]);
  const containers = output.split(/\s+/).filter(Boolean);
  if (containers.length !== 1)
    throw new Error(`expected one session sandbox, found ${containers.length}`);
  const containerId = containers[0];
  if (!containerId) throw new Error("session sandbox container id was empty");
  await docker([
    "exec",
    "-u",
    "node",
    "-w",
    "/workspace/repo",
    containerId,
    "sh",
    "-lc",
    'test -d /workspace/repo && test -w /workspace/repo && test "$(id -un)" = node && command -v sh && command -v sleep && command -v git && command -v node && command -v python && python -m pytest --version',
  ]);
  return containerId;
};

export const cleanupSessionSandbox = async (
  sandboxId: string | undefined,
): Promise<void> => {
  if (!sandboxId || !/^sbox_[A-Za-z0-9]+$/.test(sandboxId)) return;
  const output = await docker([
    "ps",
    "-aq",
    "--filter",
    `label=com.agent-sandboxing.sandbox-id=${sandboxId}`,
    "--filter",
    "label=com.agent-sandboxing.managed=true",
  ]).catch(() => "");
  for (const containerId of output.split(/\s+/).filter(Boolean))
    await execFile("docker", ["rm", "-f", containerId], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
};
