import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

describe("Terminal-Bench manifest", () => {
  it("pins the run inputs and rejects an existing run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "terminal-bench-runs-"));
    const environment = {
      ...process.env,
      TERMINAL_BENCH_RUNS_ROOT: root,
      TERMINAL_BENCH_RUN_ID: "test-run",
      AGENT_MODEL: "openrouter:deepseek/deepseek-v4-flash",
      TERMINAL_BENCH_CONCURRENCY: "1",
      TERMINAL_BENCH_GPUS: "0",
    };
    try {
      await execFile("python3", ["terminal-bench/manifest.py"], {
        env: environment,
      });
      const manifest = JSON.parse(
        await readFile(path.join(root, "test-run", "manifest.json"), "utf8"),
      );
      expect(manifest).toMatchObject({
        dataset: "terminal-bench/terminal-bench@4.0.0",
        model: {
          identifier: "openrouter:deepseek/deepseek-v4-flash",
          provider_route: "OpenRouter",
        },
        limits: { retry_policy: "none" },
        resources: { concurrency: 1, gpus: 0 },
      });
      await expect(
        execFile("python3", ["terminal-bench/manifest.py"], {
          env: environment,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("already exists"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
