import { describe, expect, it } from "vitest";
import inspectBeforeEditCases from "./evals/cases/inspect-before-edit";
import { assertAgentEval } from "./evals/cases/harness/assertions";
import type {
  AgentEvalCase,
  AgentEvalTranscript,
} from "./evals/cases/harness/types";

const transcript = (toolCalls: string[]): AgentEvalTranscript => ({
  finalText: "done",
  toolCalls,
  commands: [],
  filesBefore: {},
  filesAfter: {},
});

const evalCase = (overrides: Partial<AgentEvalCase> = {}): AgentEvalCase => ({
  name: "test case",
  prompt: "test prompt",
  files: {},
  expected: {},
  ...overrides,
});

const inspectOrderingCase: AgentEvalCase = {
  ...inspectBeforeEditCases[0]!,
  expected: {},
};

describe("assertAgentEval", () => {
  it("appends case-provided failures", () => {
    const failures = assertAgentEval(
      evalCase({
        expected: { mustUseTools: ["read"] },
        validate: () => ["case-specific failure"],
      }),
      transcript([]),
    );

    expect(failures).toEqual([
      "expected tool read to be used",
      "case-specific failure",
    ]);
  });

  it("passes a read-then-edit transcript", () => {
    const failures = assertAgentEval(
      inspectOrderingCase,
      transcript(["read", "edit"]),
    );

    expect(failures).toEqual([]);
  });

  it("fails when edit precedes read", () => {
    const failures = assertAgentEval(
      inspectOrderingCase,
      transcript(["edit", "read"]),
    );

    expect(failures).toEqual([
      "expected the first read tool call to precede the first edit tool call",
    ]);
  });

  it("retains generic behavior without a procedure", () => {
    const failures = assertAgentEval(
      evalCase({ expected: { mustUseTools: ["read"] } }),
      transcript([]),
    );

    expect(failures).toEqual(["expected tool read to be used"]);
  });
});
