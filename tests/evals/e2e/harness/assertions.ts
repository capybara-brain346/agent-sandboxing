import type { PublicEvent } from "../../../../src/types/event.types";
import { snapshotDirectory, verifyTaskFixture } from "./fixture";
import type {
  Assertion,
  CapyNodesEvalCase,
  ChatEvidence,
  EvalAttempt,
  EvalClassification,
  FixtureSnapshot,
  SandboxEvidence,
  TaskFixture,
} from "./types";

const terminalEventTypes = new Set([
  "command_completed",
  "command_failed",
  "command_timed_out",
  "command_cancelled",
]);

const valueAt = (
  snapshot: FixtureSnapshot,
  relative: string,
): string | undefined => snapshot[relative];

const subtreeAt = (snapshot: FixtureSnapshot, relative: string): string =>
  JSON.stringify(
    Object.entries(snapshot)
      .filter(
        ([candidate]) =>
          candidate === relative || candidate.startsWith(`${relative}/`),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );

const hasPath = (snapshot: FixtureSnapshot, relative: string): boolean =>
  Object.keys(snapshot).some(
    (candidate) =>
      candidate === relative || candidate.startsWith(`${relative}/`),
  );

const eventPayload = (event: PublicEvent, key: string): unknown =>
  event.payload[key];

const stringPayload = (event: PublicEvent, key: string): string | null => {
  const value = eventPayload(event, key);
  return typeof value === "string" ? value : null;
};

const eventAssertions = (
  sessionId: string,
  events: PublicEvent[],
  sensitiveValues: string[],
): Assertion[] => {
  const assertions: Assertion[] = [];
  const sequences = events.map((event) => event.sequence);
  const ordered = sequences.every(
    (sequence, index) => index === 0 || sequence > (sequences[index - 1] ?? -1),
  );
  assertions.push({
    name: "event sequence ordering",
    passed: ordered && new Set(sequences).size === sequences.length,
    detail: ordered ? undefined : "SSE events were duplicated or out of order",
  });
  assertions.push({
    name: "event stream scope",
    passed: events.every(
      (event) =>
        event.streamScope === "session" &&
        event.streamId === sessionId &&
        event.sessionId === sessionId,
    ),
    detail: "An event escaped the session stream",
  });

  const eventText = JSON.stringify(events);
  const leaked = sensitiveValues.find(
    (value) => value.length > 3 && eventText.includes(value),
  );
  const credentialPattern =
    /(?:Bearer\s+|sk-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;
  assertions.push({
    name: "event credential redaction",
    passed: !leaked && !credentialPattern.test(eventText),
    detail: "SSE evidence contained a credential-shaped value",
  });

  const starts = new Map<string, PublicEvent>();
  const ends = new Map<string, PublicEvent>();
  const callCount = events.filter(
    (event) => event.type === "agent_tool_call" && event.correlationId,
  ).length;
  const resultCount = events.filter(
    (event) => event.type === "agent_tool_result" && event.correlationId,
  ).length;
  for (const event of events) {
    if (event.type === "agent_tool_call" && event.correlationId)
      starts.set(event.correlationId, event);
    if (event.type === "agent_tool_result" && event.correlationId)
      ends.set(event.correlationId, event);
  }
  const paired =
    callCount === starts.size &&
    resultCount === ends.size &&
    starts.size === ends.size &&
    [...ends.entries()].every(([correlationId, result]) => {
      const call = starts.get(correlationId);
      return (
        call !== undefined &&
        stringPayload(call, "tool_name") ===
          stringPayload(result, "tool_name") &&
        call.sequence < result.sequence
      );
    });
  assertions.push({
    name: "agent tool event pairing",
    passed: paired,
    detail: paired
      ? undefined
      : "Agent tool call and result events were not paired in order",
  });

  const commandLifecycles = new Map<
    string,
    { starts: number[]; terminals: number[] }
  >();
  for (const [index, event] of events.entries()) {
    if (
      !event.commandId ||
      (event.type !== "command_started" && !terminalEventTypes.has(event.type))
    )
      continue;
    const lifecycle = commandLifecycles.get(event.commandId) ?? {
      starts: [],
      terminals: [],
    };
    if (event.type === "command_started") lifecycle.starts.push(index);
    else lifecycle.terminals.push(index);
    commandLifecycles.set(event.commandId, lifecycle);
  }
  const commandsPaired = [...commandLifecycles.values()].every(
    ({ starts, terminals }) =>
      starts.length === 1 &&
      terminals.length === 1 &&
      (starts[0] ?? -1) < (terminals[0] ?? -1),
  );
  assertions.push({
    name: "command event pairing",
    passed: commandsPaired,
    detail: "Command lifecycle events were not paired",
  });
  return assertions;
};

export const assertEventEvidence = eventAssertions;

export const assertProtectedPaths = (
  before: FixtureSnapshot,
  after: FixtureSnapshot,
  protectedPaths: string[],
): Assertion[] =>
  protectedPaths.map((protectedPath) => ({
    name: `protected path ${protectedPath}`,
    passed:
      subtreeAt(before, protectedPath) === subtreeAt(after, protectedPath),
    detail: `Protected path ${protectedPath} changed`,
  }));

const lifecycleAssertions = (chat: ChatEvidence): Assertion[] => {
  const events = chat.sse.events;
  const types = new Set(events.map((event) => event.type));
  const expected = [
    "session_created",
    "message_created",
    "message_processing_requested",
    "message_processing_started",
    "sandbox_created",
    "sandbox_provisioning_started",
    "fixture_repo_copy_started",
    "fixture_repo_copied",
    "sandbox_ready",
    "message_result_ready",
  ];
  const terminal =
    chat.result.status === "completed"
      ? "message_processing_completed"
      : chat.result.status === "failed"
        ? "message_processing_failed"
        : "message_processing_cancelled";
  expected.push(terminal);
  return [
    {
      name: "message lifecycle",
      passed: expected.every((type) => types.has(type as PublicEvent["type"])),
      detail: "The real message lifecycle was incomplete",
    },
    {
      name: "terminal result identity",
      passed:
        chat.result.messageId === chat.message.messageId &&
        chat.result.chatSessionId === chat.session.chatSessionId &&
        chat.message.processingStatus === chat.result.status,
      detail: "The persisted result did not match the processed message",
    },
    {
      name: "completed outcome",
      passed: chat.result.status === "completed",
      detail: `Session ended with ${chat.result.status}`,
    },
    {
      name: "SSE response",
      passed:
        chat.sse.status === 200 &&
        chat.sse.contentType.includes("text/event-stream") &&
        chat.sse.events.length > 0,
      detail: "The session SSE response was not usable",
    },
  ];
};

const checkoutAssertions = (
  evalCase: CapyNodesEvalCase,
  fixture: TaskFixture,
  sandbox: SandboxEvidence,
  before: FixtureSnapshot,
  after: FixtureSnapshot,
  sourceIntegrity: {
    baselineUnchanged: boolean;
    seededSourceUnchanged: boolean;
  },
): Assertion[] => {
  const assertions: Assertion[] = [
    {
      name: "baseline source integrity",
      passed: sourceIntegrity.baselineUnchanged,
      detail: "The committed CapyNodes baseline changed during evaluation",
    },
    {
      name: "seeded source integrity",
      passed: sourceIntegrity.seededSourceUnchanged,
      detail: "The mounted task source changed during evaluation",
    },
    {
      name: "sandbox checkout",
      passed: sandbox.sandboxId.length > 0 && hasPath(after, "manage.py"),
      detail: "The extracted sandbox checkout was incomplete",
    },
  ];
  assertions.push(
    ...assertProtectedPaths(before, after, evalCase.protectedPaths),
  );
  for (const requiredPath of evalCase.requiredPaths)
    assertions.push({
      name: `required path ${requiredPath}`,
      passed:
        hasPath(after, requiredPath) &&
        valueAt(before, requiredPath) !== valueAt(after, requiredPath),
      detail: `Required path ${requiredPath} was not changed`,
    });
  return assertions;
};

const graderAssertions = (sandbox: SandboxEvidence): Assertion[] =>
  sandbox.grader.map((result) => ({
    name: `grader ${result.name}`,
    passed: result.exitCode === 0 && !result.timedOut,
    detail:
      result.exitCode === 0 && !result.timedOut
        ? undefined
        : `${result.name} exited ${result.exitCode ?? "without an exit code"}`,
  }));

export const changedFiles = (
  before: FixtureSnapshot,
  after: FixtureSnapshot,
): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((relative) => before[relative] !== after[relative])
    .sort();

export const assertCapyNodesAttempt = async (
  evalCase: CapyNodesEvalCase,
  fixture: TaskFixture,
  chat: ChatEvidence,
  sandbox: SandboxEvidence,
  sensitiveValues: string[] = [],
): Promise<{
  assertions: Assertion[];
  attemptEvidence: EvalAttempt["evidence"];
}> => {
  const before = fixture.seededFiles;
  const after = await snapshotDirectory(sandbox.checkoutRoot);
  const sourceIntegrity = await verifyTaskFixture(fixture);
  const assertions = [
    ...lifecycleAssertions(chat),
    ...eventAssertions(
      chat.session.chatSessionId,
      chat.sse.events,
      sensitiveValues,
    ),
    ...checkoutAssertions(
      evalCase,
      fixture,
      sandbox,
      before,
      after,
      sourceIntegrity,
    ),
    ...graderAssertions(sandbox),
  ];
  const changed = changedFiles(before, after);
  return {
    assertions,
    attemptEvidence: {
      chat,
      sandbox,
      changedFiles: changed,
      diffBytes: Buffer.byteLength(chat.result.diff),
      sourceIntegrity,
    },
  };
};

export const classifyAssertions = (
  assertions: Assertion[],
  chat?: ChatEvidence,
): EvalClassification => {
  if (assertions.every((assertion) => assertion.passed)) return "correct";
  if (
    !chat ||
    chat.result.status !== "completed" ||
    assertions.some(
      (assertion) =>
        assertion.name.includes("lifecycle") ||
        assertion.name.includes("event") ||
        assertion.name.includes("source integrity") ||
        assertion.name === "sandbox checkout" ||
        assertion.name === "SSE response" ||
        assertion.name.includes("timed out"),
    )
  )
    return "harness_failure";
  return "incorrect";
};

export const classifyError = (error: unknown): EvalClassification => {
  void error;
  return "harness_failure";
};

export const assertionFailures = (assertions: Assertion[]): string[] =>
  assertions
    .filter((assertion) => !assertion.passed)
    .map((assertion) => `${assertion.name}: ${assertion.detail ?? "failed"}`);
