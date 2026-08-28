import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFile, spawn } = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile, spawn }));

import type { Config } from "../src/config";
import { SandboxRuntime } from "../src/services/sandbox/runtime";

type FakeStream = EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
type FakeChild = EventEmitter & {
  stdout: FakeStream;
  stderr: FakeStream;
  stdin: { end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

const fakeStream = (): FakeStream => {
  const stream = new EventEmitter() as FakeStream;
  stream.setEncoding = vi.fn();
  return stream;
};

const fakeChild = (): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  child.stdout = fakeStream();
  child.stderr = fakeStream();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  return child;
};

const runtime = (maxBytes = 1024): SandboxRuntime =>
  new SandboxRuntime({ COMMAND_OUTPUT_MAX_BYTES: maxBytes } as Config);

const provisionConfig = {
  COMMAND_OUTPUT_MAX_BYTES: 1024,
  SANDBOX_MEMORY_BYTES: 1024,
  SANDBOX_CPUS: 1,
  SANDBOX_PIDS_LIMIT: 10,
  SANDBOX_PROVISION_TIMEOUT_MS: 1000,
} as Config;

describe("SandboxRuntime.simpleExec", () => {
  beforeEach(() => {
    execFile.mockReset();
    spawn.mockReset();
  });

  it("constructs docker exec arguments and captures both streams asynchronously", async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const resultPromise = runtime().simpleExec(
      "sandbox-1",
      "printf hello",
      "/workspace/repo",
      { env: { FOO: "bar", COUNT: "2" } },
    );

    child.stdout.emit("data", Buffer.from("hello"));
    child.stderr.emit("data", Buffer.from("warning"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "hello",
      stderr: "warning",
      exitCode: 0,
      timedOut: false,
      truncated: false,
    });
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      [
        "exec",
        "-i",
        "-w",
        "/workspace/repo",
        "-e",
        "FOO=bar",
        "-e",
        "COUNT=2",
        "sandbox-1",
        "sh",
        "-lc",
        "printf hello",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  });

  it("resolves a non-zero command exit as a normal result", async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const resultPromise = runtime().simpleExec(
      "sandbox-1",
      "false",
      "/workspace/repo",
    );
    child.stderr.emit("data", "failed");
    child.emit("close", 7);

    await expect(resultPromise).resolves.toMatchObject({
      stderr: "failed",
      exitCode: 7,
      timedOut: false,
    });
  });

  it("passes stdin through the Docker pipe without adding it to process arguments", async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const resultPromise = runtime().simpleExec(
      "sandbox-1",
      "cat",
      "/workspace/repo",
      { stdin: "secret-token" },
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({ exitCode: 0 });
    expect(child.stdin.end).toHaveBeenCalledWith("secret-token");
    expect(spawn.mock.calls[0]?.[1]).not.toContain("secret-token");
  });

  it("truncates combined output at a valid UTF-8 boundary", async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const resultPromise = runtime(4).simpleExec(
      "sandbox-1",
      "printf output",
      "/workspace/repo",
    );
    child.stdout.emit("data", Buffer.from("ééé", "utf8"));
    child.stderr.emit("data", Buffer.from("ignored"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "éé",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      truncated: true,
    });
  });

  it("returns a timed-out result after killing the docker process", async () => {
    const child = fakeChild();
    child.kill.mockImplementation(() => {
      child.emit("close", null);
      return true;
    });
    spawn.mockReturnValue(child);

    const resultPromise = runtime().simpleExec(
      "sandbox-1",
      "sleep 10",
      "/workspace/repo",
      { timeoutMs: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: null,
      timedOut: true,
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects without spawning when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runtime().simpleExec("sandbox-1", "echo no", "/workspace/repo", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("kills and rejects an in-flight command when aborted", async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const controller = new AbortController();
    const resultPromise = runtime().simpleExec(
      "sandbox-1",
      "sleep 10",
      "/workspace/repo",
      { signal: controller.signal },
    );

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects Docker process-spawn failures", async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const failure = new Error("docker unavailable");
    const resultPromise = runtime().simpleExec(
      "sandbox-1",
      "echo hello",
      "/workspace/repo",
    );
    child.emit("error", failure);

    await expect(resultPromise).rejects.toBe(failure);
  });

  it("rejects synchronous spawn failures", async () => {
    const failure = new Error("docker executable missing");
    spawn.mockImplementation(() => {
      throw failure;
    });

    await expect(
      runtime().simpleExec("sandbox-1", "echo hello", "/workspace/repo"),
    ).rejects.toBe(failure);
  });

  it("clones, checks out, normalizes origin, and configures ownership for GitHub", async () => {
    execFile.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (
          error: null,
          result: { stdout: string; stderr: string },
        ) => void,
      ) =>
        callback(null, {
          stdout: args[0] === "create" ? "container-1\n" : "",
          stderr: "",
        }),
    );
    await expect(
      new SandboxRuntime(provisionConfig).provision(
        "s1",
        "sandbox-s1",
        "node:22",
        {
          source: "github",
          owner: "octo",
          name: "repo",
          installationId: "10",
          cloneUrl: "https://github.com/octo/repo.git",
          baseBranch: "feature/test",
          token: "installation-token",
        },
      ),
    ).resolves.toEqual({ containerId: "container-1" });

    const calls = execFile.mock.calls.map((call) => call[1] as string[]);
    expect(calls.find((args) => args.includes("clone"))).toEqual(
      expect.arrayContaining([
        "clone",
        "--no-checkout",
        expect.stringContaining("installation-token"),
      ]),
    );
    const remoteCall = calls.find((args) => args.includes("set-url"));
    expect(remoteCall).toEqual(
      expect.arrayContaining([
        "set-url",
        "origin",
        "https://github.com/octo/repo.git",
      ]),
    );
    expect(remoteCall?.join(" ")).not.toContain("installation-token");
    expect(calls.at(-1)).toEqual([
      "exec",
      "-u",
      "node",
      "container-1",
      "git",
      "config",
      "--global",
      "--add",
      "safe.directory",
      "/workspace/repo",
    ]);
  });

  it("returns a safe clone failure without the installation token", async () => {
    execFile.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, result?: unknown) => void,
      ) => {
        if (args.includes("clone"))
          callback(new Error("clone failed installation-token"));
        else
          callback(null, {
            stdout: args[0] === "create" ? "container-1\n" : "",
            stderr: "",
          });
      },
    );

    await expect(
      new SandboxRuntime(provisionConfig).provision(
        "s1",
        "sandbox-s1",
        "node:22",
        {
          source: "github",
          owner: "octo",
          name: "repo",
          installationId: "10",
          cloneUrl: "https://github.com/octo/repo.git",
          baseBranch: "main",
          token: "installation-token",
        },
      ),
    ).rejects.toMatchObject({
      code: "github_clone_failed",
      message: expect.not.stringContaining("installation-token"),
    });
    expect(
      execFile.mock.calls.some((call) =>
        ["stop", "rm"].includes((call[1] as string[])[0]),
      ),
    ).toBe(false);
  });

  it("returns a safe failure when Git is unavailable", async () => {
    execFile.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, result?: unknown) => void,
      ) => {
        if (args.includes("--version")) callback(new Error("git missing"));
        else
          callback(null, {
            stdout: args[0] === "create" ? "container-1\n" : "",
            stderr: "",
          });
      },
    );

    await expect(
      new SandboxRuntime(provisionConfig).provision(
        "s1",
        "sandbox-s1",
        "node:22",
        {
          source: "github",
          owner: "octo",
          name: "repo",
          installationId: "10",
          cloneUrl: "https://github.com/octo/repo.git",
          baseBranch: "main",
          token: "installation-token",
        },
      ),
    ).rejects.toMatchObject({ code: "github_git_unavailable" });
  });

  it("returns a safe checkout failure", async () => {
    execFile.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, result?: unknown) => void,
      ) => {
        if (args.includes("checkout")) callback(new Error("branch missing"));
        else
          callback(null, {
            stdout: args[0] === "create" ? "container-1\n" : "",
            stderr: "",
          });
      },
    );

    await expect(
      new SandboxRuntime(provisionConfig).provision(
        "s1",
        "sandbox-s1",
        "node:22",
        {
          source: "github",
          owner: "octo",
          name: "repo",
          installationId: "10",
          cloneUrl: "https://github.com/octo/repo.git",
          baseBranch: "missing",
          token: "installation-token",
        },
      ),
    ).rejects.toMatchObject({ code: "github_checkout_failed" });
  });
});
