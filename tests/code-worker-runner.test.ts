import { describe, expect, it, vi } from "vitest";
import {
  CodeWorkerRunner,
  parseWorkerResult,
} from "../src/services/agent/code-worker-runner";
import type {
  TaskRunContext,
  TaskRunner,
} from "../src/services/task/task-runner";

describe("parseWorkerResult", () => {
  it("validates a fenced JSON result matching the schema", () => {
    const text = [
      "Fixed the bug.",
      "```json",
      JSON.stringify({
        status: "completed",
        summary: "Fixed the bug",
        changedFiles: ["src/a.ts"],
        testsRun: [
          { command: "npm test", status: "passed", outputSummary: "ok" },
        ],
        blockers: [],
        suggestedNextStep: "",
      }),
      "```",
    ].join("\n");

    const result = parseWorkerResult(text);
    expect(result.status).toBe("completed");
    expect(result.changedFiles).toEqual(["src/a.ts"]);
    expect(result.testsRun).toHaveLength(1);
  });

  it("falls back to a completed result built from free text when no JSON is present", () => {
    const result = parseWorkerResult("Just did the work, no fence here.");
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Just did the work, no fence here.");
    expect(result.changedFiles).toEqual([]);
  });

  it("falls back gracefully when the fenced block is malformed JSON", () => {
    const text = "Some summary\n```json\n{not valid json\n```";
    const result = parseWorkerResult(text);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe(text.trim());
  });

  it("falls back to completed with an empty summary for empty text", () => {
    const result = parseWorkerResult("");
    expect(result).toEqual({
      status: "completed",
      summary: "",
      changedFiles: [],
      testsRun: [],
      blockers: [],
      suggestedNextStep: "",
    });
  });

  it("surfaces an explicit blocked status reported via valid JSON", () => {
    const text = JSON.stringify({
      status: "blocked",
      summary: "Need more info",
      changedFiles: [],
      testsRun: [],
      blockers: ["missing config"],
      suggestedNextStep: "ask for the config value",
    });
    const result = parseWorkerResult(text);
    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual(["missing config"]);
  });
});

describe("CodeWorkerRunner", () => {
  it("delegates to the underlying runner and parses its summary", async () => {
    const runner: TaskRunner = {
      run: vi.fn(async (context: TaskRunContext) => {
        expect(context.instructions).toBe("brief text");
        return { summary: "done, no fence" };
      }),
    };
    const worker = new CodeWorkerRunner(runner);
    const result = await worker.run({
      taskId: "run_1",
      sandboxId: "sbox_1",
      instructions: "brief text",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("done, no fence");
  });
});
