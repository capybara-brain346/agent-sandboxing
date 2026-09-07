import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TraceRecorder,
  normalizeToolEvents,
} from "../src/services/tracing/trace-recorder";
import { LocalTraceSink } from "../src/services/tracing/local-trace-sink";
import { langfuseTraceMetadata } from "../src/services/tracing/langfuse-trace-sink";
import type { Trace, TraceSink } from "../src/types/trace.types";
import type { PublicEvent } from "../src/types/event.types";

const event = (
  type: PublicEvent["type"],
  payload: Record<string, unknown>,
  correlationId: string,
  createdAt: string,
): PublicEvent =>
  ({
    id: `${type}_1`,
    streamId: "chat_1",
    streamScope: "session",
    domain: "agent",
    sessionId: "chat_1",
    messageId: "msg_1",
    sandboxId: "sbox_1",
    commandId: null,
    artifactId: null,
    sequence: type === "agent_tool_call" ? 1 : 2,
    type,
    producerService: "agent",
    producerId: "msg_1",
    correlationId,
    payload,
    createdAt,
  }) as PublicEvent;

const emptyTrace = (): Trace => ({
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:01.000Z",
  durationMs: 1000,
  identity: {
    sessionId: "chat_1",
    messageId: "msg_1",
    agentRunId: "agent_1",
  },
  context: {
    userRequest: "hello",
    summary: {
      summaryPresent: false,
      summaryChars: 0,
      recentMessageCount: 0,
      recentToolActivityCount: 0,
      workspaceHasPriorProcessing: false,
    },
  },
  sessionAgent: {
    agentRunId: "agent_1",
    input: "hello",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    usage: [],
  },
  toolCalls: [],
  subagents: [],
  outcome: "completed",
  errors: [],
  tags: [],
});

describe("trace normalization", () => {
  it("pairs persisted tool events and preserves timing", () => {
    expect(
      normalizeToolEvents([
        event(
          "agent_tool_call",
          { tool_name: "bash", args: { command: "npm test" } },
          "call_1",
          "2026-01-01T00:00:00.000Z",
        ),
        event(
          "agent_tool_result",
          {
            tool_name: "bash",
            result_snippet: "passed",
            exit_code: 0,
            truncated: false,
            duration_ms: 12,
            artifact_id: "art_1",
          },
          "call_1",
          "2026-01-01T00:00:01.000Z",
        ),
      ]),
    ).toEqual([
      expect.objectContaining({
        toolName: "bash",
        args: { command: "npm test" },
        output: "passed",
        resultSnippet: "passed",
        exitCode: 0,
        truncated: false,
        artifactId: "art_1",
        correlationId: "call_1",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 12,
      }),
    ]);
  });

  it("records the new taxonomy with full redacted outputs", async () => {
    const sink: TraceSink = { finishTrace: vi.fn() };
    const recorder = new TraceRecorder(sink, {
      includeContextSnapshot: true,
      tags: ["environment:test"],
    });
    recorder.startProcessing({
      sessionId: "chat_1",
      messageId: "msg_1",
      userPrompt: "Fix the issue",
    });
    const agentRunId = recorder.getAgentRunId("msg_1");
    expect(agentRunId).toEqual(expect.stringContaining("agent_"));
    recorder.recordContext({
      messageId: "msg_1",
      contextSummary: {
        summaryPresent: true,
        summaryChars: 12,
        recentMessageCount: 2,
        recentToolActivityCount: 1,
        workspaceHasPriorProcessing: true,
      },
      contextSnapshot: {
        summary: "Objective: fix",
        recentMessages: [{ role: "user", content: "Fix the issue" }],
        recentToolActivity: ["read"],
        workspace: {
          hasPriorProcessing: true,
          lastProcessingStatus: "completed",
          changedFilesHint: ["a.ts"],
        },
      },
    });
    recorder.startAgentRun({
      messageId: "msg_1",
      agentRunId: agentRunId!,
      startedAt: "2026-01-01T00:00:00.000Z",
      input: "Fix the issue",
    });
    recorder.recordToolCallStart({
      messageId: "msg_1",
      agentRunId: agentRunId!,
      correlationId: "call_1",
      toolName: "read",
      args: { path: "src/a.ts" },
      startedAt: "2026-01-01T00:00:00.100Z",
    });
    recorder.recordToolCallEnd({
      messageId: "msg_1",
      agentRunId: agentRunId!,
      correlationId: "call_1",
      toolName: "read",
      output: { content: "api_key=abcdefghijklmnop" },
      resultSnippet: "redacted",
      exitCode: 0,
      truncated: false,
      completedAt: "2026-01-01T00:00:00.200Z",
      durationMs: 100,
    });
    recorder.startAgentRun({
      messageId: "msg_1",
      agentRunId: "subagent_1",
      subagentRunId: "subagent_1",
      task: "Inspect the repository",
      input: "Inspect the repository",
      startedAt: "2026-01-01T00:00:00.300Z",
    });
    recorder.finishAgentRun({
      messageId: "msg_1",
      agentRunId: "subagent_1",
      completedAt: "2026-01-01T00:00:00.400Z",
      output: "Found src/a.ts",
    });
    recorder.finishAgentRun({
      messageId: "msg_1",
      agentRunId: agentRunId!,
      completedAt: "2026-01-01T00:00:00.500Z",
      output: "Fixed it",
    });
    await recorder.finishProcessing({
      messageId: "msg_1",
      terminal: {
        status: "completed",
        exitReason: "completed",
        diffBytes: 10,
        diffPresent: true,
        artifacts: [],
        finalMessage: "Fixed it",
      },
      events: [],
    });

    const trace = vi.mocked(sink.finishTrace).mock.calls[0]?.[0];
    expect(trace).toMatchObject({
      identity: {
        sessionId: "chat_1",
        messageId: "msg_1",
        agentRunId,
      },
      context: {
        summary: { workspaceHasPriorProcessing: true },
        snapshot: { summary: "Objective: fix" },
      },
      sessionAgent: {
        agentRunId,
        output: "Fixed it",
        durationMs: 500,
      },
      toolCalls: [{ output: { content: "[REDACTED]" } }],
      subagents: [{ subagentRunId: "subagent_1", summary: "Found src/a.ts" }],
      outcome: "completed",
    });
    expect(trace).not.toHaveProperty("orchestrator");
    expect(trace).not.toHaveProperty("worker");
  });

  it("maps identity and outcome metadata for Langfuse", () => {
    expect(langfuseTraceMetadata(emptyTrace())).toMatchObject({
      identity: {
        sessionId: "chat_1",
        messageId: "msg_1",
        agentRunId: "agent_1",
      },
      outcome: "completed",
      sessionAgent: { agentRunId: "agent_1", durationMs: 1000 },
    });
  });

  it("does not fail a turn when trace export fails", async () => {
    const sink: TraceSink = {
      finishTrace: vi.fn().mockRejectedValue(new Error("export unavailable")),
    };
    const recorder = new TraceRecorder(sink);

    await expect(
      recorder.finishProcessing({
        messageId: "msg_1",
        terminal: {
          status: "completed",
          exitReason: "completed",
          diffBytes: 0,
          diffPresent: false,
          artifacts: [],
        },
        events: [],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("local trace export", () => {
  it("writes one JSON trace per completed message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-traces-"));
    const path = join(directory, "traces.jsonl");
    try {
      await new LocalTraceSink(path).finishTrace(emptyTrace());
      const lines = (await readFile(path, "utf8")).trim().split("\n");
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        identity: { messageId: "msg_1" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
