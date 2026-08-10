import { access, lstat, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import type { RuntimeOutput, RuntimeResult } from "../../types/sandbox.types";

const execFile = (
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
    });
    child.stderr.on("data", (data: string) => {
      stderr += data;
    });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(
            new ServiceError(
              "docker_timeout",
              "Docker operation timed out",
              500,
            ),
          );
        }, options.timeoutMs)
      : undefined;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new ServiceError(
            "docker_runtime_error",
            stderr.trim() || `Docker exited with code ${code ?? "unknown"}`,
            500,
          ),
        );
    });
  });

export class SandboxRuntime {
  constructor(private readonly config: Config) {}

  async provision(
    sandboxId: string,
    containerName: string,
    image: string,
    fixturePath: string,
  ): Promise<{ containerId: string }> {
    const root = await realpath(fixturePath).catch(() => {
      throw new ServiceError(
        "fixture_missing",
        "Local fixture repo was not found",
        500,
      );
    });
    const stat = await lstat(root);
    if (!stat.isDirectory())
      throw new ServiceError(
        "fixture_invalid",
        "Local fixture repo must be a directory",
        500,
      );
    await access(path.join(root, ".")).catch(() => {
      throw new ServiceError(
        "fixture_unreadable",
        "Local fixture repo is not readable",
        500,
      );
    });
    const labels = [
      "--label",
      "com.agent-sandboxing.service=sandbox-service",
      "--label",
      `com.agent-sandboxing.sandbox-id=${sandboxId}`,
      "--label",
      "com.agent-sandboxing.managed=true",
    ];
    const created = await execFile(
      [
        "create",
        "--name",
        containerName,
        "--memory",
        String(this.config.SANDBOX_MEMORY_BYTES),
        "--cpus",
        String(this.config.SANDBOX_CPUS),
        "--pids-limit",
        String(this.config.SANDBOX_PIDS_LIMIT),
        ...labels,
        image,
        "sleep",
        "infinity",
      ],
      { timeoutMs: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
    );
    const containerId = created.stdout.trim();
    try {
      await execFile(["start", containerId], {
        timeoutMs: this.config.SANDBOX_PROVISION_TIMEOUT_MS,
      });
      await execFile([
        "exec",
        "-u",
        "0",
        containerId,
        "mkdir",
        "-p",
        "/workspace/repo",
      ]);
      // Copy the contents, including dotfiles, so the fixture's git metadata is
      // available at the workspace root rather than only its tracked files.
      await execFile(["cp", `${root}/.`, `${containerId}:/workspace/repo/`], {
        timeoutMs: this.config.SANDBOX_PROVISION_TIMEOUT_MS,
      });
      await execFile([
        "exec",
        "-u",
        "0",
        containerId,
        "test",
        "-e",
        "/workspace/repo/.git",
      ]);
      await execFile([
        "exec",
        "-u",
        "0",
        containerId,
        "chown",
        "-R",
        "node:node",
        "/workspace/repo",
      ]);
      return { containerId };
    } catch (error) {
      await this.stop(containerName, 1000).catch(() => undefined);
      throw error;
    }
  }

  async run(
    containerName: string,
    command: string,
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number,
    onOutput: (output: RuntimeOutput) => Promise<void>,
  ): Promise<RuntimeResult> {
    const args = ["exec", "-i", "-w", cwd];
    for (const [key, value] of Object.entries(env))
      args.push("-e", `${key}=${value}`);
    args.push(containerName, "sh", "-lc", command);
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let outputChain = Promise.resolve();
    const consume = (stream: "stdout" | "stderr", data: Buffer): void => {
      const chunk = data.toString("utf8");
      outputBytes += Buffer.byteLength(chunk);
      outputChain = outputChain.then(() => onOutput({ stream, chunk }));
    };
    child.stdout.on("data", (data: Buffer) => consume("stdout", data));
    child.stderr.on("data", (data: Buffer) => consume("stderr", data));
    const result = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void outputChain.then(() => resolve(code), reject);
      });
    });
    if (outputBytes > this.config.COMMAND_OUTPUT_MAX_BYTES)
      outputTruncated = true;
    return { exitCode: result, timedOut, outputBytes, outputTruncated };
  }

  async diff(containerName: string): Promise<string> {
    return (
      await execFile(
        [
          "exec",
          "-u",
          "node",
          "-w",
          "/workspace/repo",
          containerName,
          "sh",
          "-lc",
          "git diff --binary",
        ],
        { timeoutMs: this.config.SANDBOX_COMMAND_TIMEOUT_MS },
      )
    ).stdout;
  }
  async stop(containerName: string, graceMs: number): Promise<void> {
    await execFile(
      ["stop", "--time", String(Math.ceil(graceMs / 1000)), containerName],
      { timeoutMs: graceMs + 5000 },
    ).catch((error: ServiceError) => {
      if (!error.message.toLowerCase().includes("no such container"))
        throw error;
    });
    await execFile(["rm", "-f", containerName], { timeoutMs: 10000 }).catch(
      () => undefined,
    );
  }
}
