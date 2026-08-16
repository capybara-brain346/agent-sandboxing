import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn }));

import type { Config } from "../src/config";
import { SandboxRuntime } from "../src/services/sandbox/runtime";

type FakeStream = EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
type FakeChild = EventEmitter & {
  stdout: FakeStream;
  stderr: FakeStream;
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
  child.kill = vi.fn();
  return child;
};

const runtime = (maxBytes = 1024): SandboxRuntime =>
  new SandboxRuntime({ COMMAND_OUTPUT_MAX_BYTES: maxBytes } as Config);

describe("SandboxRuntime.simpleExec", () => {
  beforeEach(() => {
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
      { stdio: ["ignore", "pipe", "pipe"] },
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
});
