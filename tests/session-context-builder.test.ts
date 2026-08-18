import { describe, expect, it, vi } from "vitest";
import {
  SessionContextBuilder,
  type SessionContextPrismaCollaborator,
} from "../src/services/chat/session-context-builder";

const makePrisma = (
  overrides: Partial<{
    session: { repoRef: string; summary: string | null } | null;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    lastRun: {
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
          : { repoRef: "./repo", summary: "Objective: do X" },
      ),
    },
    chatMessage: {
      findMany: vi.fn(async () => overrides.messages ?? []),
    },
    task: {
      findFirst: vi.fn(async () => overrides.lastRun ?? null),
    },
  }) as unknown as SessionContextPrismaCollaborator;

describe("SessionContextBuilder", () => {
  it("throws when the session does not exist", async () => {
    const builder = new SessionContextBuilder(makePrisma({ session: null }));
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
    );
    const context = await builder.build("chat_1");
    expect(context.recentMessages.map((m) => m.content)).toEqual([
      "first",
      "second",
    ]);
    expect(context.workspace.hasPriorRun).toBe(false);
    expect(context.workspace.changedFilesHint).toEqual([]);
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
        lastRun: { status: "completed", diff, agentSummary: "did stuff" },
      }),
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
    const builder = new SessionContextBuilder(makePrisma());
    const context = await builder.build("chat_1");
    expect(context.summary).toBe("Objective: do X");
  });

  it("never reads the artifact table and never surfaces raw artifact content in the built context", async () => {
    const prisma = makePrisma();
    const builder = new SessionContextBuilder(prisma);
    const context = await builder.build("chat_1");

    expect("artifact" in prisma).toBe(false);
    expect(JSON.stringify(context)).not.toContain("artifact");
  });
});
