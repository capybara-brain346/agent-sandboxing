import { describe, expect, it, vi } from "vitest";
import { SessionAgentProcessor } from "../src/services/chat/session-agent-processor";
import type { OrchestratorContext } from "../src/types/harness.types";

const sessionContext: OrchestratorContext = {
  sessionId: "chat_1",
  repoRef: "./repo",
  summary: "Objective: fix the greeting",
  recentMessages: [
    { role: "user", content: "Find the greeting" },
    { role: "assistant", content: "I found it" },
  ],
  recentToolActivity: ["read: src/greeting.ts"],
  messageCount: 2,
  shouldCompact: false,
  workspace: {
    hasPriorProcessing: true,
    lastProcessingStatus: "completed",
    lastProcessingSummary: "Located the greeting",
    changedFilesHint: ["src/greeting.ts"],
  },
};

describe("SessionAgentProcessor", () => {
  it("composes the session context and invokes the agent runner once", async () => {
    const runner = {
      process: vi.fn(async () => ({
        finalText: "Updated the greeting",
        usage: {},
        toolCalls: [],
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      })),
    };
    const processor = new SessionAgentProcessor(
      { chatSession: { updateMany: vi.fn() } } as never,
      { build: vi.fn(async () => sessionContext) } as never,
      { compact: vi.fn() } as never,
      runner,
    );

    await expect(
      processor.process({
        sessionId: "chat_1",
        messageId: "msg_1",
        sandboxId: "sbox_1",
        instructions: "Update the greeting",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ summary: "Updated the greeting" });

    expect(runner.process).toHaveBeenCalledTimes(1);
    expect(runner.process).toHaveBeenCalledWith({
      sessionId: "chat_1",
      messageId: "msg_1",
      sandboxId: "sbox_1",
      signal: expect.any(AbortSignal),
      instructions: expect.stringContaining(
        "Session summary:\nObjective: fix the greeting",
      ),
    });
    const instructions = runner.process.mock.calls[0]?.[0]
      .instructions as string;
    expect(instructions).toContain(
      "Recent conversation:\nuser: Find the greeting",
    );
    expect(instructions).toContain(
      "Recent tool activity:\nread: src/greeting.ts",
    );
    expect(instructions).toContain("Workspace state:\nPrior processing: yes");
    expect(instructions).toContain("User request:\nUpdate the greeting");
  });

  it("compacts the summary after the agent run when the context is due", async () => {
    const compact = vi.fn(async () => "Objective: compacted");
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const runner = {
      process: vi.fn(async () => ({
        finalText: "Updated the greeting",
        usage: {},
        toolCalls: [],
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      })),
    };
    const processor = new SessionAgentProcessor(
      { chatSession: { updateMany } } as never,
      {
        build: vi.fn(async () => ({ ...sessionContext, shouldCompact: true })),
      } as never,
      { compact } as never,
      runner,
    );

    await processor.process({
      sessionId: "chat_1",
      messageId: "msg_1",
      sandboxId: "sbox_1",
      instructions: "Update the greeting",
      signal: new AbortController().signal,
    });

    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({
        previousSummary: "Objective: fix the greeting",
        messageId: "msg_1",
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "chat_1" },
      data: {
        summary: "Objective: compacted",
        summaryCompactedThroughMessageCount: 2,
      },
    });
  });
});
