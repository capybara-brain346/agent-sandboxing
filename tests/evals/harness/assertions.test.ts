import { describe, expect, it } from "vitest";
import inspectBeforeEdit from "../cases/inspect-before-edit";
import { assertAgentEval } from "./assertions";
import type { AgentEvalCase, AgentEvalTranscript } from "./types";

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
  ...inspectBeforeEdit,
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
