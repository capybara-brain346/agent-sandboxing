import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalProcessRuntime } from "../terminal-bench/runtime";

describe("Terminal-Bench local runtime", () => {
  it("runs in the task workspace and keeps shared output bounds", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "terminal-bench-"));
    try {
      await writeFile(path.join(workspace, "input.txt"), "workspace", "utf8");
      const runtime = new LocalProcessRuntime(workspace, 5);
      await expect(
        runtime.simpleExec(
          "local",
          "cat /workspace/repo/input.txt",
          "/workspace/repo",
        ),
      ).resolves.toMatchObject({ stdout: "works", truncated: true });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("stops commands at the configured timeout", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "terminal-bench-"));
    try {
      const runtime = new LocalProcessRuntime(workspace, 1024);
      await expect(
        runtime.simpleExec("local", "sleep 1", "/workspace/repo", {
          timeoutMs: 10,
        }),
      ).resolves.toMatchObject({ exitCode: null, timedOut: true });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
