import { describe, expect, it } from "vitest";
import {
  assertEventEvidence,
  assertProtectedPaths,
  changedFiles,
  classifyAssertions,
} from "./e2e/harness/assertions";
import {
  baselineRoot,
  cleanupTaskFixture,
  createTaskFixture,
  digestDirectory,
  writeFixtureText,
} from "./e2e/harness/fixture";
import { serializeEvalAttempt } from "./e2e/harness/report";
import type {
  CapyNodesEvalCase,
  ChatEvidence,
  EvalAttempt,
} from "./e2e/harness/types";

const event = (
  type:
    | "session_created"
    | "agent_tool_call"
    | "agent_tool_result"
    | "command_started"
    | "command_completed"
    | "command_failed"
    | "command_timed_out"
    | "command_cancelled",
  sequence: number,
  correlationId: string | null = null,
  commandId: string | null = null,
): ChatEvidence["sse"]["events"][number] => ({
  id: `evt_${sequence}`,
  streamId: "chat_test",
  streamScope: "session",
  domain: "test",
  sessionId: "chat_test",
  sandboxId: "sbox_test",
  commandId,
  messageId: "msg_test",
  artifactId: null,
  sequence,
  type,
  producerService: "agent",
  producerId: "msg_test",
  correlationId,
  payload:
    type === "session_created"
      ? {}
      : {
          tool_name: "read",
          ...(type === "agent_tool_call" ? { args: {} } : {}),
        },
  createdAt: new Date(0).toISOString(),
});

const chat = (events: ChatEvidence["sse"]["events"]): ChatEvidence =>
  ({
    session: { chatSessionId: "chat_test" },
    message: { messageId: "msg_test", processingStatus: "completed" },
    messages: [],
    result: {
      messageId: "msg_test",
      chatSessionId: "chat_test",
      status: "completed",
      diff: "",
    },
    sse: { status: 200, contentType: "text/event-stream", events },
    durationMs: 1,
  }) as unknown as ChatEvidence;

describe("CapyNodes E2E harness", () => {
  it("creates a seeded Git fixture and preserves the committed baseline", async () => {
    const evalCase = {
      id: "unit-fixture",
      level: 1,
      title: "fixture",
      prompt: "fixture",
      seed: async (root: string) =>
        writeFixtureText(root, "e2e-seed.txt", "seeded\n"),
      oracleDirectory: "tests/evals/e2e/oracles/level1",
      grading: [],
      protectedPaths: [],
      requiredPaths: [],
    } satisfies CapyNodesEvalCase;
    const fixture = await createTaskFixture(evalCase, {
      attemptId: `unit-fixture-${Date.now()}`,
    });
    try {
      expect(fixture.baselineSha).toMatch(/^[0-9a-f]{40}$/);
      expect(fixture.containerRepoRef).toContain("/workspace/evals/");
      expect(fixture.seededFiles["e2e-seed.txt"]).toBeDefined();
      expect(await digestDirectory(baselineRoot)).toBe(fixture.baselineDigest);
    } finally {
      await cleanupTaskFixture(fixture);
    }
  });

  it("detects changed files and protected-path violations", () => {
    const before = {
      "api/migrations/0001.py": "same",
      "api/views.py": "old",
      "README.md": "same",
    };
    const after = {
      "api/migrations/0001.py": "changed",
      "api/views.py": "new",
      "README.md": "same",
      "new.py": "new",
    };
    expect(changedFiles(before, after)).toEqual([
      "api/migrations/0001.py",
      "api/views.py",
      "new.py",
    ]);
    expect(
      assertProtectedPaths(before, after, ["api/migrations"])[0]?.passed,
    ).toBe(false);
  });

  it("validates ordered tool events and classifies evidence failures", () => {
    const valid = [
      event("session_created", 1),
      event("agent_tool_call", 2, "call_1"),
      event("agent_tool_result", 3, "call_1"),
    ];
    expect(assertEventEvidence("chat_test", valid, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "event sequence ordering",
          passed: true,
        }),
        expect.objectContaining({
          name: "agent tool event pairing",
          passed: true,
        }),
      ]),
    );
    const invalid = assertEventEvidence(
      "chat_test",
      [
        event("agent_tool_result", 2, "call_1"),
        event("agent_tool_call", 3, "call_1"),
      ],
      [],
    );
    expect(classifyAssertions(invalid, chat([]))).toBe("harness_failure");
  });

  it("validates ordered, interleaved command lifecycles", () => {
    const events = [
      event("session_created", 1),
      event("command_started", 2, null, "cmd_1"),
      event("command_started", 3, null, "cmd_2"),
      event("command_completed", 4, null, "cmd_1"),
      event("command_failed", 5, null, "cmd_2"),
    ];
    expect(assertEventEvidence("chat_test", events, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "command event pairing",
          passed: true,
        }),
      ]),
    );
  });

  it.each([
    [
      "terminal before start",
      [
        event("command_completed", 1, null, "cmd_1"),
        event("command_started", 2, null, "cmd_1"),
      ],
    ],
    [
      "duplicate start",
      [
        event("command_started", 1, null, "cmd_1"),
        event("command_started", 2, null, "cmd_1"),
        event("command_completed", 3, null, "cmd_1"),
      ],
    ],
    [
      "duplicate terminal",
      [
        event("command_started", 1, null, "cmd_1"),
        event("command_completed", 2, null, "cmd_1"),
        event("command_failed", 3, null, "cmd_1"),
      ],
    ],
    ["missing start", [event("command_completed", 1, null, "cmd_1")]],
    ["missing terminal", [event("command_started", 1, null, "cmd_1")]],
  ])("rejects command lifecycles with %s", (_reason, events) => {
    const assertions = assertEventEvidence("chat_test", events, []);
    expect(assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "command event pairing",
          passed: false,
        }),
      ]),
    );
    expect(classifyAssertions(assertions, chat(events))).toBe(
      "harness_failure",
    );
  });

  it("serializes reports without exposing credential-shaped details", async () => {
    const attempt = {
      attemptId: "attempt",
      caseId: "case",
      level: 1,
      title: "case",
      classification: "incorrect",
      passed: false,
      durationMs: 2,
      changedFiles: [],
      assertions: [],
      evidence: {
        changedFiles: [],
        diffBytes: 0,
        sourceIntegrity: {
          baselineUnchanged: true,
          seededSourceUnchanged: true,
        },
        sandbox: {
          sandboxId: "sbox_test",
          containerId: "container",
          containerName: "sandbox",
          checkoutRoot: "/tmp/checkout",
          grader: [
            {
              name: "test",
              command: "test",
              exitCode: 1,
              timedOut: false,
              stdout: "Authorization: bearer-secret",
              stderr: "",
              durationMs: 1,
            },
          ],
        },
      },
      recordedAt: "",
    } satisfies EvalAttempt;
    const serialized = serializeEvalAttempt(
      attempt,
      "2026-01-01T00:00:00.000Z",
    );
    expect(serialized).not.toContain("bearer-secret");
    expect(JSON.parse(serialized).recordedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
