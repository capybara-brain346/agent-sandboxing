import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

describe("Terminal-Bench runner", () => {
  it("runs each task's oracle before its agent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "terminal-bench-smoke-"));
    const bin = path.join(root, "bin");
    const argsPath = path.join(root, "npm-args");
    await mkdir(bin);
    await writeFile(
      path.join(bin, "npm"),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NPM_ARGS_PATH"\n',
      "utf8",
    );
    await chmod(path.join(bin, "npm"), 0o755);
    try {
      await execFile("sh", ["terminal-bench/smoke.sh"], {
        env: {
          ...process.env,
          NPM_ARGS_PATH: argsPath,
          PATH: `${bin}:${process.env.PATH}`,
        },
      });
      const tasks = [
        "bun-sourcemap-leak",
        "cargo-flight-dispatch",
        "html-js-filter",
        "nextjs-performance",
        "wal-recovery-ordering",
      ];
      expect((await readFile(argsPath, "utf8")).trim().split("\n")).toEqual(
        tasks.flatMap((task) => [
          `run eval:terminal-bench:oracle -- ${task}`,
          `run eval:terminal-bench:run -- ${task}`,
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the custom agent through Harbor's import-path option", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "terminal-bench-run-"));
    const bin = path.join(root, "bin");
    const argsPath = path.join(root, "harbor-args");
    await mkdir(bin);
    await writeFile(path.join(bin, "npm"), "#!/bin/sh\nexit 0\n", "utf8");
    await writeFile(
      path.join(bin, "harbor"),
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$HARBOR_ARGS_PATH"\n',
      "utf8",
    );
    await chmod(path.join(bin, "npm"), 0o755);
    await chmod(path.join(bin, "harbor"), 0o755);
    try {
      await execFile("sh", ["terminal-bench/run.sh", "example-task"], {
        env: {
          ...process.env,
          HARBOR_ARGS_PATH: argsPath,
          PATH: `${bin}:${process.env.PATH}`,
        },
      });
      expect((await readFile(argsPath, "utf8")).trim().split("\n")).toEqual([
        "run",
        "-d",
        "terminal-bench/terminal-bench@4.0.0",
        "-i",
        "terminal-bench/example-task",
        "--agent-import-path",
        "agent:TerminalBenchAgent",
        "-k",
        "1",
        "-n",
        "1",
        "-o",
        "terminal-bench/.data/jobs",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
