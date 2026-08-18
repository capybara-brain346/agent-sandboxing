import { describe, expect, it } from "vitest";
import {
  formatAndCap,
  StaticSessionSummaryCompactor,
  type CompactionInput,
} from "../src/services/chat/session-summary-compactor";

const baseInput = (
  overrides: Partial<CompactionInput> = {},
): CompactionInput => ({
  previousSummary: "",
  recentMessages: [],
  recentToolActivity: [],
  workspace: {
    hasPriorRun: false,
    lastRunStatus: null,
    lastRunSummary: null,
    changedFilesHint: [],
  },
  ...overrides,
});

describe("formatAndCap", () => {
  it("caps files to MAX_FILES, keeping the most recent", () => {
    const files = Array.from({ length: 20 }, (_, i) => `src/file-${i}.ts`);
    const text = formatAndCap({
      objective: "Do X",
      state: "in progress",
      lastResult: "",
      files,
      blockers: [],
    });
    expect(text).toContain("src/file-19.ts");
    expect(text).not.toContain("src/file-0.ts");
  });

  it("caps blockers to MAX_BLOCKERS", () => {
    const blockers = Array.from({ length: 10 }, (_, i) => `blocker-${i}`);
    const text = formatAndCap({
      objective: "Do X",
      state: "blocked",
      lastResult: "",
      files: [],
      blockers,
    });
    expect(text).toContain("blocker-0");
    expect(text).not.toContain("blocker-9");
  });

  it("stays within the 4000-byte budget by dropping oldest files first", () => {
    const files = Array.from({ length: 500 }, (_, i) => `src/file-${i}.ts`);
    const text = formatAndCap({
      objective: "Do X",
      state: "in progress",
      lastResult:
        "a fairly long free-text description of the work that was done",
      files,
      blockers: [],
    });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(4000);
  });

  it("renders none for empty files and blockers", () => {
    const text = formatAndCap({
      objective: "Do X",
      state: "awaiting clarification",
      lastResult: "",
      files: [],
      blockers: [],
    });
    expect(text).toContain("Files: none");
    expect(text).toContain("Blockers: none");
  });
});

describe("StaticSessionSummaryCompactor", () => {
  it("carries the previous Objective forward when one exists", async () => {
    const compactor = new StaticSessionSummaryCompactor();
    const summary = await compactor.compact(
      baseInput({ previousSummary: "Objective: Add auth middleware" }),
    );
    expect(summary).toContain("Objective: Add auth middleware");
  });

  it("falls back to the first recent message when there is no previous summary", async () => {
    const compactor = new StaticSessionSummaryCompactor();
    const summary = await compactor.compact(
      baseInput({
        recentMessages: [{ role: "user", content: "Add auth middleware" }],
      }),
    );
    expect(summary).toContain("Objective: Add auth middleware");
  });

  it("unions the workspace's changed-files hint into Files", async () => {
    const compactor = new StaticSessionSummaryCompactor();
    const summary = await compactor.compact(
      baseInput({
        previousSummary: "Objective: Add auth\nFiles: src/auth.ts",
        workspace: {
          hasPriorRun: true,
          lastRunStatus: "completed",
          lastRunSummary: "Added middleware",
          changedFilesHint: ["src/auth.ts", "tests/auth.test.ts"],
        },
      }),
    );
    expect(summary).toContain("src/auth.ts");
    expect(summary).toContain("tests/auth.test.ts");
  });

  it("surfaces a synthetic blocker when the last run failed", async () => {
    const compactor = new StaticSessionSummaryCompactor();
    const summary = await compactor.compact(
      baseInput({
        workspace: {
          hasPriorRun: true,
          lastRunStatus: "failed",
          lastRunSummary: null,
          changedFilesHint: [],
        },
      }),
    );
    expect(summary).toContain("Blockers: last worker run failed");
  });
});
