import { access, lstat, realpath } from "node:fs/promises";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import path from "node:path";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import { takeUtf8Prefix } from "../../shared/utf8";
import type {
  RuntimeOutput,
  RuntimeResult,
  SandboxProvisioningSource,
  SimpleExecOptions,
  SimpleExecResult,
} from "../../types/sandbox.types";

class OutputBudget {
  remaining: number;
  truncated = false;

  constructor(maxBytes: number) {
    this.remaining = maxBytes;
  }
}

class BoundedOutput {
  private readonly decoder = new StringDecoder("utf8");
  private readonly chunks: string[] = [];

  constructor(private readonly budget: OutputBudget) {}

  append(data: Buffer | Uint8Array | string): void {
    const buffer =
      typeof data === "string"
        ? Buffer.from(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
    this.consume(this.decoder.write(buffer));
  }

  finish(): void {
    this.consume(this.decoder.end());
  }

  value(): string {
    return this.chunks.join("");
  }

  private consume(text: string): void {
    if (!text) return;

    if (this.budget.remaining <= 0) {
      this.budget.truncated = true;
      return;
    }

    const bounded = takeUtf8Prefix(text, this.budget.remaining);
    this.chunks.push(bounded);
    this.budget.remaining -= Buffer.byteLength(bounded);
    if (bounded.length < text.length) this.budget.truncated = true;
  }
}

const abortError = (): Error => {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
};

const execFile = promisify(execFileCallback);

export class SandboxRuntime {
  constructor(private readonly config: Config) {}

  async simpleExec(
    containerName: string,
    command: string,
    cwd: string,
    options: SimpleExecOptions = {},
  ): Promise<SimpleExecResult> {
    if (options.signal?.aborted) throw abortError();

    const args = ["exec", "-i", "-u", "node", "-w", cwd];
    for (const [key, value] of Object.entries(options.env ?? {}))
      args.push("-e", `${key}=${value}`);
    args.push(containerName, "sh", "-lc", command);

    return new Promise<SimpleExecResult>((resolve, reject) => {
      const budget = new OutputBudget(this.config.COMMAND_OUTPUT_MAX_BYTES);
      const stdout = new BoundedOutput(budget);
      const stderr = new BoundedOutput(budget);
      let timedOut = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let child: ReturnType<typeof spawn>;

      const clearResources = (): void => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const resolveResult = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        clearResources();
        stdout.finish();
        stderr.finish();
        resolve({
          stdout: stdout.value(),
          stderr: stderr.value(),
          exitCode: timedOut ? null : exitCode,
          timedOut,
          truncated: budget.truncated,
        });
      };

      const rejectWith = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearResources();
        reject(error);
      };

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        clearResources();
        child.kill("SIGKILL");
        reject(abortError());
      };

      try {
        child = spawn("docker", args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        rejectWith(error);
        return;
      }

      child.stdout?.on("data", (data: Buffer | Uint8Array | string) =>
        stdout.append(data),
      );
      child.stderr?.on("data", (data: Buffer | Uint8Array | string) =>
        stderr.append(data),
      );
      child.once("error", (error) => {
        if (!timedOut) rejectWith(error);
      });
      child.once("close", (code) => resolveResult(code));
      child.stdin?.end(options.stdin);

      if (options.signal) {
        options.signal.addEventListener("abort", onAbort, { once: true });
        if (options.signal.aborted) onAbort();
      }

      if (!settled && options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (settled) return;
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs);
      }
    });
  }

  async provision(
    sandboxId: string,
    containerName: string,
    image: string,
    source: SandboxProvisioningSource,
  ): Promise<{ containerId: string }> {
    let root: string | undefined;
    if (source.source === "fixture") {
      root = await realpath(source.fixtureRepoPath).catch(() => {
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
    }
    const labels = [
      "--label",
      "com.agent-sandboxing.service=sandbox-service",
      "--label",
      `com.agent-sandboxing.sandbox-id=${sandboxId}`,
      "--label",
      "com.agent-sandboxing.managed=true",
    ];
    const created = await execFile(
      "docker",
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
      { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
    );
    const containerId = created.stdout.trim();
    await execFile("docker", ["start", containerId], {
      timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS,
    });
    await execFile(
      "docker",
      ["exec", "-u", "0", containerId, "mkdir", "-p", "/workspace/repo"],
      { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
    );
    if (source.source === "fixture") {
      await execFile(
        "docker",
        ["cp", `${root}/.`, `${containerId}:/workspace/repo/`],
        {
          timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS,
        },
      );
    } else {
      try {
        await execFile(
          "docker",
          ["exec", "-u", "0", containerId, "git", "--version"],
          { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
        );
      } catch {
        throw new ServiceError(
          "github_git_unavailable",
          "The sandbox image does not include Git",
          500,
        );
      }
      const safeCloneUrl = new URL(source.cloneUrl);
      safeCloneUrl.username = "";
      safeCloneUrl.password = "";
      const authenticatedUrl = new URL(safeCloneUrl);
      authenticatedUrl.username = "x-access-token";
      authenticatedUrl.password = source.token;
      try {
        await execFile(
          "docker",
          [
            "exec",
            "-u",
            "0",
            containerId,
            "git",
            "clone",
            "--no-checkout",
            authenticatedUrl.toString(),
            "/workspace/repo",
          ],
          { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
        );
        await execFile(
          "docker",
          [
            "exec",
            "-u",
            "0",
            containerId,
            "git",
            "-C",
            "/workspace/repo",
            "remote",
            "set-url",
            "origin",
            safeCloneUrl.toString(),
          ],
          { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
        );
      } catch {
        await execFile(
          "docker",
          [
            "exec",
            "-u",
            "0",
            containerId,
            "git",
            "-C",
            "/workspace/repo",
            "remote",
            "set-url",
            "origin",
            safeCloneUrl.toString(),
          ],
          { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
        ).catch(() => undefined);
        throw new ServiceError(
          "github_clone_failed",
          "GitHub repository could not be cloned",
          502,
        );
      }
      try {
        await execFile(
          "docker",
          [
            "exec",
            "-u",
            "0",
            containerId,
            "git",
            "-C",
            "/workspace/repo",
            "checkout",
            "--force",
            "-B",
            source.baseBranch,
            `origin/${source.baseBranch}`,
          ],
          { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
        );
      } catch {
        throw new ServiceError(
          "github_checkout_failed",
          "GitHub base branch could not be checked out",
          502,
        );
      }
      if (source.baseSha) {
        let checkedOutSha: string;
        try {
          const checkedOut = await execFile(
            "docker",
            [
              "exec",
              "-u",
              "0",
              containerId,
              "git",
              "-C",
              "/workspace/repo",
              "rev-parse",
              "HEAD",
            ],
            { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
          );
          checkedOutSha = checkedOut.stdout.trim().toLowerCase();
        } catch {
          throw new ServiceError(
            "github_checkout_failed",
            "GitHub checked-out commit could not be verified",
            502,
          );
        }
        const expectedSha = source.baseSha.toLowerCase();
        if (
          !checkedOutSha ||
          (checkedOutSha !== expectedSha &&
            !(
              expectedSha.length < checkedOutSha.length &&
              checkedOutSha.startsWith(expectedSha)
            ))
        )
          throw new ServiceError(
            "github_base_sha_mismatch",
            "GitHub base branch changed since it was selected",
            409,
          );
      }
    }
    await execFile(
      "docker",
      ["exec", "-u", "0", containerId, "test", "-e", "/workspace/repo/.git"],
      { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
    );
    await execFile(
      "docker",
      [
        "exec",
        "-u",
        "0",
        containerId,
        "chown",
        "-R",
        "node:node",
        "/workspace/repo",
      ],
      { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
    );
    await execFile(
      "docker",
      [
        "exec",
        "-u",
        "node",
        containerId,
        "git",
        "config",
        "--global",
        "--add",
        "safe.directory",
        "/workspace/repo",
      ],
      { timeout: this.config.SANDBOX_PROVISION_TIMEOUT_MS },
    );
    return { containerId };
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
        "docker",
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
        { timeout: this.config.SANDBOX_COMMAND_TIMEOUT_MS },
      )
    ).stdout;
  }

  async stop(containerName: string, graceMs: number): Promise<void> {
    await execFile(
      "docker",
      ["stop", "--time", String(Math.ceil(graceMs / 1000)), containerName],
      { timeout: graceMs + 5000 },
    ).catch((error: ServiceError) => {
      if (!error.message.toLowerCase().includes("no such container"))
        throw error;
    });

    await execFile("docker", ["rm", "-f", containerName], {
      timeout: 10000,
    }).catch(() => undefined);
  }
}
