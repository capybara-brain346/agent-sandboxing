import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTerminalBenchSummary,
  classifyTerminalBenchFailure,
  parseHarborRun,
  writeTerminalBenchSummary,
} from "../terminal-bench/report";

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
};

describe("Terminal-Bench report", () => {
  it("parses trial results, trajectories, verifier logs, and costs", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "terminal-bench-report-"),
    );
    try {
      await writeJson(path.join(root, "result.json"), {
        stats: { cost_usd: 0.75 },
        trial_results: [],
      });
      await writeJson(path.join(root, "trial-a", "result.json"), {
        task_name: "task-a",
        trial_name: "trial-a",
        agent_result: { cost_usd: 0.5 },
        verifier_result: { rewards: { reward: 1 } },
      });
      await writeJson(path.join(root, "trial-a", "agent", "trajectory.json"), {
        schema_version: "ATIF-v1.0",
        steps: [],
      });
      await writeJson(path.join(root, "trial-b", "result.json"), {
        task_name: "task-b",
        trial_name: "trial-b",
        agent_result: { cost_usd: null },
        verifier_result: null,
        exception_info: {
          exception_type: "VerifierError",
          exception_message: "verifier failed",
        },
      });
      await writeJson(path.join(root, "trial-b", "agent", "trajectory.json"), {
        schema_version: "ATIF-v1.0",
        steps: [],
      });
      await mkdir(path.join(root, "trial-b", "verifier"), { recursive: true });
      await writeFile(
        path.join(root, "trial-b", "verifier", "test-stderr.txt"),
        "verifier failed\n",
        "utf8",
      );

      const summary = buildTerminalBenchSummary(await parseHarborRun(root));
      expect(summary).toMatchObject({
        attempted: 2,
        resolved: 1,
        unresolved: 1,
        resolved_pct: 0.5,
        setup_failure_count: 0,
        provider_failure_count: 0,
        agent_failure_count: 0,
        timeout_failure_count: 0,
        verifier_failure_count: 1,
        total_model_cost_usd: 0.75,
        model_cost_source: "harbor",
        compute_cost_usd: null,
        compute_cost_source: "unavailable",
      });
      expect(summary.failed_trajectories).toEqual([
        path.join(root, "trial-b", "agent", "trajectory.json"),
      ]);
      expect(summary.failed_verifier_logs).toEqual([
        path.join(root, "trial-b", "verifier", "test-stderr.txt"),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps provider, timeout, and setup failures distinct from agent failures", () => {
    expect(
      classifyTerminalBenchFailure({
        result: { exception_info: { exception_type: "ProviderError" } },
        reward: null,
        verifierLogPaths: [],
        trajectoryPath: null,
      }),
    ).toBe("provider");
    expect(
      classifyTerminalBenchFailure({
        result: { exception_info: { exception_type: "AgentTimeoutError" } },
        reward: null,
        verifierLogPaths: [],
        trajectoryPath: null,
      }),
    ).toBe("timeout");
    expect(
      classifyTerminalBenchFailure({
        result: { exception_info: { exception_type: "EnvironmentSetupError" } },
        reward: null,
        verifierLogPaths: [],
        trajectoryPath: null,
      }),
    ).toBe("setup");
    expect(
      classifyTerminalBenchFailure({
        result: { exception_info: { exception_type: "AgentError" } },
        reward: null,
        verifierLogPaths: [],
        trajectoryPath: null,
      }),
    ).toBe("agent");
    expect(
      classifyTerminalBenchFailure({
        result: {
          agent_result: {},
          verifier_result: { rewards: { reward: 0 } },
        },
        reward: 0,
        verifierLogPaths: [],
        trajectoryPath: null,
      }),
    ).toBeNull();
  });

  it("writes the summary to a requested path", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "terminal-bench-report-"),
    );
    try {
      const summary = buildTerminalBenchSummary({
        jobPath: root,
        jobResult: null,
        tasks: [],
        setupParseFailures: 0,
      });
      const output = await writeTerminalBenchSummary(
        path.join(root, "run", "summary.json"),
        summary,
      );
      expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
        attempted: 0,
        resolved_pct: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
