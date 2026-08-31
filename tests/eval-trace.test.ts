import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EvalTraceRecorder,
  normalizeToolEvents,
} from "../src/services/eval/eval-trace-recorder";
import { LocalTraceSink } from "../src/services/eval/local-trace-sink";
import { langfuseTraceMetadata } from "../src/services/eval/langfuse-trace-sink";
import type { EvalTraceSink } from "../src/types/eval-trace.types";
import type { PublicEvent } from "../src/types/event.types";
import type { SessionAgentResult } from "../src/types/harness.types";

const workerResult: SessionAgentResult = {
  status: "completed",
  summary: "Updated the file",
};

const event = (
  type: PublicEvent["type"],
  payload: Record<string, unknown>,
  correlationId: string,
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
    sequence: type === "agent_tool_call" ? 1 : 2,
    type,
    producerService: "agent",
    producerId: "msg_1",
    correlationId,
    payload,
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as PublicEvent;

const sinkWithSpies = (): EvalTraceSink =>
  ({
    startProcessing: vi.fn(),
    recordOrchestratorContext: vi.fn(),
    recordWorkerBrief: vi.fn(),
    recordWorkerResult: vi.fn(),
    recordOrchestratorReply: vi.fn(),
    recordUsage: vi.fn(),
    finishProcessing: vi.fn(),
  }) as EvalTraceSink;

describe("eval trace normalization", () => {
  it("pairs persisted tool events by correlation while preserving event order", () => {
    expect(
      normalizeToolEvents([
        event(
          "agent_tool_call",
          {
            tool_name: "bash",
            args: { command: "npm test" },
          },
          "call_1",
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
        ),
      ]),
    ).toEqual([
      {
        toolName: "bash",
        kind: "call",
        args: { command: "npm test" },
        correlationId: "call_1",
      },
      {
        toolName: "bash",
        kind: "result",
        resultSnippet: "passed",
        exitCode: 0,
        truncated: false,
        durationMs: 12,
        artifactId: "art_1",
        correlationId: "call_1",
      },
    ]);
  });

  it("exports a bounded trace with direct and delegated facts", async () => {
    const sink = sinkWithSpies();
    const recorder = new EvalTraceRecorder(sink, {
      includeContextSnapshot: true,
      tags: ["environment:test"],
    });
    recorder.startProcessing({
      sessionId: "chat_1",
      messageId: "msg_1",
      userPrompt: "Fix the issue",
    });
    recorder.recordOrchestratorContext({
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
    recorder.recordWorkerBrief({
      messageId: "msg_1",
      brief: "Inspect and fix",
    });
    recorder.recordWorkerResult({ messageId: "msg_1", result: workerResult });
    recorder.recordOrchestratorReply({
      messageId: "msg_1",
      reply: "Fixed it",
      delegated: true,
    });
    recorder.recordUsage({
      messageId: "msg_1",
      stage: "sessionAgent",
      usage: { model: "test-model", inputTokens: 3, latencyMs: 8 },
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

    const trace = vi.mocked(sink.finishProcessing).mock.calls[0]?.[0];
    expect(trace).toMatchObject({
      traceId: "msg_1",
      messageId: "msg_1",
      sessionId: "chat_1",
      input: "Fix the issue",
      output: "Fixed it",
      tags: ["environment:test", "status:completed"],
      orchestrator: {
        delegated: true,
        workerBriefs: ["Inspect and fix"],
        workerResults: [workerResult],
        contextSummary: { workspaceHasPriorProcessing: true },
      },
      usage: [
        {
          stage: "sessionAgent",
          usage: { model: "test-model", inputTokens: 3, latencyMs: 8 },
        },
      ],
    });
    expect(trace?.orchestrator.contextSnapshot?.summary).toBe("Objective: fix");
  });

  it("maps trace facts to Langfuse-safe metadata", () => {
    const metadata = langfuseTraceMetadata({
      traceId: "msg_1",
      messageId: "msg_1",
      sessionId: "chat_1",
      name: "chat_message",
      input: "Fix it",
      tags: [],
      metadata: { source: "chat" },
      orchestrator: {
        delegated: false,
        workerBriefs: [],
        workerResults: [],
      },
      usage: [],
      tools: [],
    });
    expect(metadata).toMatchObject({
      source: "chat",
      messageId: "msg_1",
      chatSessionId: "chat_1",
      sessionId: "chat_1",
      traceId: "msg_1",
      orchestrator: { delegated: false },
    });
  });
});

describe("local trace export", () => {
  it("writes one JSON trace per completed message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-traces-"));
    const path = join(directory, "traces.jsonl");
    try {
      const sink = new LocalTraceSink(path);
      await sink.finishProcessing({
        traceId: "msg_1",
        messageId: "msg_1",
        sessionId: "chat_1",
        name: "chat_message",
        input: "hello",
        tags: [],
        metadata: {},
        orchestrator: {
          delegated: false,
          workerBriefs: [],
          workerResults: [],
        },
        usage: [],
        tools: [],
      });
      const lines = (await readFile(path, "utf8")).trim().split("\n");
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        messageId: "msg_1",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
