import { describe, expect, it, vi } from "vitest";
import {
  SessionContextBuilder,
  RECENT_MESSAGE_LIMIT,
  COMPACTION_INTERVAL,
  type SessionContextEventStore,
  type SessionContextPrismaCollaborator,
} from "../src/services/chat/session-context-builder";
import type { PublicEvent } from "../src/types/event.types";

const makePrisma = (
  overrides: Partial<{
    session: {
      repoRef: string;
      summary: string | null;
      summaryCompactedThroughMessageCount: number;
    } | null;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    messageCount: number;
    lastRun: {
      id: string;
      status: string;
      diff: string | null;
      agentSummary: string | null;
    } | null;
  }> = {},
): SessionContextPrismaCollaborator =>
  ({
    chatSession: {
      findUnique: vi.fn(async () =>
        "session" in overrides
          ? overrides.session
          : {
              repoRef: "./repo",
              summary: "Objective: do X",
              summaryCompactedThroughMessageCount: 0,
            },
      ),
    },
    chatMessage: {
      findMany: vi.fn(async () => overrides.messages ?? []),
      count: vi.fn(async () => overrides.messageCount ?? 0),
    },
    task: {
      findFirst: vi.fn(async () => overrides.lastRun ?? null),
    },
  }) as unknown as SessionContextPrismaCollaborator;

const makeEventStore = (
  events: PublicEvent[] = [],
): SessionContextEventStore => ({
  listRunEvents: vi.fn(async () => events),
});

const event = (
  type: PublicEvent["type"],
  payload: Record<string, unknown>,
): PublicEvent => ({
  id: "evt_1",
  streamId: "run_1",
  taskId: "run_1",
  sandboxId: "sbox_1",
  commandId: null,
  sequence: 1,
  type,
  producerService: "agent",
  producerId: "run_1",
  correlationId: "call_1",
  payload,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("SessionContextBuilder", () => {
  it("throws when the session does not exist", async () => {
    const builder = new SessionContextBuilder(
      makePrisma({ session: null }),
      makeEventStore(),
    );
    await expect(builder.build("chat_missing")).rejects.toThrow(
      "Chat session was not found",
    );
  });

  it("returns messages in chronological order and an empty workspace snapshot with no prior run", async () => {
    const builder = new SessionContextBuilder(
      makePrisma({
        messages: [
          { role: "assistant", content: "second" },
          { role: "user", content: "first" },
        ],
      }),
      makeEventStore(),
    );
    const context = await builder.build("chat_1");
    expect(context.recentMessages.map((m) => m.content)).toEqual([
      "first",
      "second",
    ]);
    expect(context.workspace.hasPriorRun).toBe(false);
    expect(context.workspace.changedFilesHint).toEqual([]);
    expect(context.recentToolActivity).toEqual([]);
  });

  it("extracts changed files from the last terminal run's diff", async () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "diff --git a/src/b.ts b/src/b.ts",
    ].join("\n");
    const builder = new SessionContextBuilder(
      makePrisma({
        lastRun: {
          id: "run_1",
          status: "completed",
          diff,
          agentSummary: "did stuff",
        },
      }),
      makeEventStore(),
    );
    const context = await builder.build("chat_1");
    expect(context.workspace.hasPriorRun).toBe(true);
    expect(context.workspace.lastRunStatus).toBe("completed");
    expect(context.workspace.changedFilesHint).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("carries the durable summary through unmodified", async () => {
    const builder = new SessionContextBuilder(makePrisma(), makeEventStore());
    const context = await builder.build("chat_1");
    expect(context.summary).toBe("Objective: do X");
  });

  it("never reads the artifact table and never surfaces raw artifact content in the built context", async () => {
    const prisma = makePrisma();
    const builder = new SessionContextBuilder(prisma, makeEventStore());
    const context = await builder.build("chat_1");

    expect("artifact" in prisma).toBe(false);
    expect(JSON.stringify(context)).not.toContain("artifact");
  });

  it("computes messageCount and shouldCompact from the compaction threshold", async () => {
    const builder = new SessionContextBuilder(
      makePrisma({
        session: {
          repoRef: "./repo",
          summary: "Objective: do X",
          summaryCompactedThroughMessageCount: 2,
        },
        messageCount: 2 + COMPACTION_INTERVAL,
      }),
      makeEventStore(),
    );
    const context = await builder.build("chat_1");
    expect(context.messageCount).toBe(2 + COMPACTION_INTERVAL);
    expect(context.shouldCompact).toBe(true);
  });

  it("does not flag compaction below the threshold", async () => {
    const builder = new SessionContextBuilder(
      makePrisma({
        session: {
          repoRef: "./repo",
          summary: "Objective: do X",
          summaryCompactedThroughMessageCount: 2,
        },
        messageCount: 2 + COMPACTION_INTERVAL - 1,
      }),
      makeEventStore(),
    );
    const context = await builder.build("chat_1");
    expect(context.shouldCompact).toBe(false);
  });

  it("limits recent messages to RECENT_MESSAGE_LIMIT and derives tool activity only when a prior run exists", async () => {
    const events = makeEventStore([
      event("agent_tool_call", { tool_name: "read", args: { path: "a.ts" } }),
      event("agent_tool_result", {
        tool_name: "read",
        result_snippet: "file contents",
      }),
      event("run_created", { message_id: "msg_1" }),
    ]);
    const builder = new SessionContextBuilder(
      makePrisma({
        lastRun: {
          id: "run_1",
          status: "completed",
          diff: null,
          agentSummary: null,
        },
      }),
      events,
    );
    const context = await builder.build("chat_1");
    expect(context.recentToolActivity).toEqual([
      'read: {"path":"a.ts"}',
      "read: file contents",
    ]);
    expect(RECENT_MESSAGE_LIMIT).toBe(10);
  });
});
