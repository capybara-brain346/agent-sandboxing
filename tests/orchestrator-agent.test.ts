import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  MAX_DELEGATIONS_PER_TURN,
  ModelOrchestratorAgent,
  type OrchestratorAgentInput,
} from "../src/services/agent/orchestrator-agent";
import type { WorkerResult } from "../src/types/harness.types";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: aiMocks.generateText };
});

const workerResult = (overrides: Partial<WorkerResult> = {}): WorkerResult => ({
  status: "completed",
  summary: "Did the work",
  changedFiles: [],
  testsRun: [],
  blockers: [],
  suggestedNextStep: "",
  ...overrides,
});

const baseInput = (
  overrides: Partial<OrchestratorAgentInput> = {},
): OrchestratorAgentInput => ({
  sessionId: "chat_1",
  repoRef: "./repo",
  summary: "Objective: do X",
  recentMessages: [],
  recentToolActivity: [],
  workspace: {
    hasPriorRun: false,
    lastRunStatus: null,
    lastRunSummary: null,
    changedFilesHint: [],
  },
  message: "fix the bug",
  signal: new AbortController().signal,
  delegate: vi.fn(async () => workerResult()),
  ...overrides,
});

describe("ModelOrchestratorAgent", () => {
  it("returns the model's reply without delegating when generateText calls no tools", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      text: "It's a repo-scoped chat session.",
    });
    const delegate = vi.fn(async () => workerResult());
    const signal = new AbortController().signal;
    const agent = new ModelOrchestratorAgent({} as LanguageModel);
    const decision = await agent.decide(baseInput({ delegate, signal }));
    expect(delegate).not.toHaveBeenCalled();
    expect(decision.reply).toBe("It's a repo-scoped chat session.");
    expect(decision.delegations).toEqual([]);
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: signal }),
    );
  });

  it("collects every delegation actually executed by the tool in call order", async () => {
    const delegate = vi.fn(async () => workerResult({ summary: "Fixed it" }));
    aiMocks.generateText.mockImplementationOnce(async (options) => {
      const tool = options.tools.delegate_to_code_worker;
      await tool.execute({ brief: "fix the bug" }, {} as never);
      return { text: "Fixed it" };
    });
    const agent = new ModelOrchestratorAgent({} as LanguageModel);
    const decision = await agent.decide(baseInput({ delegate }));
    expect(delegate).toHaveBeenCalledTimes(1);
    expect(decision.delegations).toEqual([
      workerResult({ summary: "Fixed it" }),
    ]);
  });

  it("hard-stops delegation at MAX_DELEGATIONS_PER_TURN without calling delegate again", async () => {
    const delegate = vi.fn(async () =>
      workerResult({ status: "blocked", blockers: ["still stuck"] }),
    );
    aiMocks.generateText.mockImplementationOnce(async (options) => {
      const tool = options.tools.delegate_to_code_worker;
      for (let i = 0; i < MAX_DELEGATIONS_PER_TURN + 1; i++) {
        await tool.execute({ brief: `attempt ${i}` }, {} as never);
      }
      return { text: "gave up" };
    });
    const agent = new ModelOrchestratorAgent({} as LanguageModel);
    const decision = await agent.decide(baseInput({ delegate }));
    expect(delegate).toHaveBeenCalledTimes(MAX_DELEGATIONS_PER_TURN);
    expect(decision.delegations.at(-1)?.blockers).toEqual([
      "max_delegations_reached",
    ]);
  });
});
