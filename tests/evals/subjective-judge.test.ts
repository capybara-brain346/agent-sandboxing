import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  formatSubjectiveJudgeInput,
  runSubjectiveJudge,
  subjectiveScoreSummary,
} from "./subjective-judge";
import type { SubjectiveJudgeInput } from "./types";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: aiMocks.generateText };
});

const input: SubjectiveJudgeInput = {
  caseId: "python-mini-fix",
  suite: "python-mini",
  task: "Fix the bug and verify it.",
  context: { fixture: "python-mini" },
  observed: {
    changedFiles: ["src/acme_tools/math_utils.py"],
    finalMessage: "Fixed the bug and ran pytest.",
  },
};

const scores = {
  task_success_1_to_5: 5,
  minimality_1_to_5: 4,
  verification_quality_1_to_5: 5,
  response_quality_1_to_5: 4,
  blocker_honesty_1_to_5: 5,
} as const;

describe("subjective eval judge", () => {
  it("sends task and observed evidence without expected case fields", async () => {
    aiMocks.generateText.mockResolvedValueOnce({ output: scores });
    const signal = new AbortController().signal;

    const result = await runSubjectiveJudge({} as LanguageModel, input, signal);

    expect(result).toMatchObject({ status: "reported", scores });
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: signal }),
    );
    const options = aiMocks.generateText.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const prompt = options.messages[0]?.content ?? "";
    expect(prompt).toContain(input.task);
    expect(prompt).toContain("changedFiles");
    expect(prompt).not.toContain("maxDelegations");
    expect(prompt).not.toContain("diffMustContain");
  });

  it("reports malformed judge output without failing the eval", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      output: { ...scores, minimality_1_to_5: 6 },
    });

    const result = await runSubjectiveJudge({} as LanguageModel, input);

    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toContain("minimality");
  });

  it("formats reported scores without defining a pass threshold", () => {
    expect(
      subjectiveScoreSummary({ status: "reported", scores, latencyMs: 2 }),
    ).toBe("5,4,5,4,5");
    expect(
      subjectiveScoreSummary({
        status: "error",
        error: "timeout",
        latencyMs: 2,
      }),
    ).toBe("error");
  });

  it("keeps the judge payload focused on the supplied case", () => {
    const prompt = formatSubjectiveJudgeInput(input);

    expect(prompt).toContain('"fixture": "python-mini"');
    expect(prompt).not.toContain("python-mini-fix");
    expect(prompt).not.toContain("expect");
  });
});
