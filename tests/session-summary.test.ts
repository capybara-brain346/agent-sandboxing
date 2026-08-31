import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  ModelSessionSummaryCompactor,
  type CompactionInput,
} from "../src/services/agent/session-summary-compactor";
import type { TraceRecorderLike } from "../src/services/tracing/trace-recorder";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: aiMocks.generateText };
});

const baseInput = (
  overrides: Partial<CompactionInput> = {},
): CompactionInput => ({
  previousSummary: "",
  recentMessages: [],
  recentToolActivity: [],
  messageId: "msg_1",
  signal: new AbortController().signal,
  ...overrides,
});

describe("ModelSessionSummaryCompactor", () => {
  it("passes the run signal to the model and formats the result", async () => {
    const output = {
      objective: "Add auth",
      state: "complete",
      lastResult: "Added middleware",
      files: ["src/auth.ts"],
      blockers: [],
    };
    aiMocks.generateText.mockResolvedValueOnce({ output });
    const signal = new AbortController().signal;
    const compactor = new ModelSessionSummaryCompactor({} as LanguageModel);

    const summary = await compactor.compact(baseInput({ signal }));

    expect(summary).toContain("Objective: Add auth");
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: signal }),
    );
  });

  it("bounds the model's summary fields before persistence", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      output: {
        objective: "Do X",
        state: "in progress",
        lastResult: "",
        files: Array.from({ length: 500 }, (_, i) => `src/file-${i}.ts`),
        blockers: Array.from({ length: 10 }, (_, i) => `blocker-${i}`),
      },
    });
    const compactor = new ModelSessionSummaryCompactor({} as LanguageModel);

    const summary = await compactor.compact(baseInput());

    expect(summary).toContain("src/file-499.ts");
    expect(summary).not.toContain("src/file-0.ts");
    expect(summary).toContain("blocker-0");
    expect(summary).not.toContain("blocker-9");
    expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(4000);
  });

  it("records summary compaction usage", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      output: {
        objective: "Do X",
        state: "complete",
        lastResult: "",
        files: [],
        blockers: [],
      },
      usage: { inputTokens: 5, outputTokens: 3 },
    });
    const recorder = {
      recordUsage: vi.fn(),
    } as unknown as TraceRecorderLike;
    const compactor = new ModelSessionSummaryCompactor(
      {} as LanguageModel,
      recorder,
    );

    await compactor.compact(baseInput());

    expect(recorder.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg_1",
        stage: "summaryCompaction",
        usage: expect.objectContaining({ inputTokens: 5, outputTokens: 3 }),
      }),
    );
  });
});
