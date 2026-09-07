# Agent Service

## Purpose

The Agent Service owns model-backed message processing. It resolves the
configured OpenRouter model, runs the session-agent loop, composes bounded
session context, owns summary-compaction decisions, proxies tools through the
session sandbox, and relays tool lifecycle events. It exposes no HTTP route and
does not call the persisted command API.

Implementation:

- [`AgentRunner`](../../../src/services/agent/agent-runner.ts) runs the model
  loop through a named tool profile, returning an `AgentResult` with final text,
  usage, tool calls, and run timestamps.
- [`profile-loader.ts`](../../../src/services/agent/tools/profile-loader.ts)
  loads and validates the main and restricted tool profiles from
  [`profiles.yaml`](../../../src/services/agent/tools/profiles/profiles.yaml).
- [`tools/subagent.ts`](../../../src/services/agent/tools/subagent.ts) exposes
  the main agent's bounded, read-only repository investigation tool.
- [`session-agent.ts`](../../../src/services/agent/session-agent.ts) defines
  the session-agent runner seam.
- [`session-agent-processor.ts`](../../../src/services/chat/session-agent-processor.ts)
  composes the session context and invokes the runner once per user message.
- [`session-context-builder.ts`](../../../src/services/chat/session-context-builder.ts)
  builds bounded conversation, tool activity, and workspace context.
- [`session-summary-compactor.ts`](../../../src/services/agent/session-summary-compactor.ts)
  maintains bounded session context.
- [`tool-event-relay.ts`](../../../src/services/agent/tool-event-relay.ts)
  persists safe tool call and result events.
- [`trace-recorder.ts`](../../../src/services/tracing/trace-recorder.ts) builds
  the strict session-agent trace, including context, run timing, full redacted
  tool and subagent outputs, outcomes, and safe errors.
- [`langfuse-trace-sink.ts`](../../../src/services/tracing/langfuse-trace-sink.ts)
  exports the trace hierarchy to Langfuse without affecting message success.

## Session invariant

A chat session owns one sandbox and one working branch. Each user message may
trigger processing in that same workspace. There is no run resource.

## Runtime boundary

The message processor passes `sessionId`, `messageId`, sandbox ID, a composed
session-agent message, and an `AbortSignal`. The runner receives only the
session-owned `simpleExec` runtime seam and the configured limits. Workspace
tools are `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`; GitHub
sessions also receive brokered pull request tools.

The agent response is prose. Changed files, pull request state, artifacts, and
terminal processing state are derived from persisted backend records rather than
model claims. The main profile exposes all registered tools; restricted profiles
expose only their explicit tool lists. The main agent can call `subagent` with
only a task and optional step limit. Each subagent uses the static subagent
prompt and the `read`, `grep`, `find`, and `ls` profile, so it cannot write,
edit, run bash, or use pull request tools. Its report is capped at 20,000
characters, and its work is internal to the parent turn.

## Single-agent contract

For each user message, `SessionAgentProcessor` builds bounded session context
and invokes `AgentRunner` once with the `main` profile. `AgentRunner` returns
the final text, usage, tool calls, and run timestamps to the processor. A
`subagent` call creates a nested `AgentRunner` invocation with the restricted
profile; it returns a bounded report to the main agent and never creates a
separate user-facing message.

Normal completion stores the workspace diff and oversized tool results as
artifacts. The assistant response and trace contain the agent's report; no
separate report artifact is created.

## Processing behavior

The model receives the versioned session-agent prompt and one message containing
session summary, recent conversation, recent tool activity, workspace state,
and the user request. Tool execution is serialized because tools share one
workspace. Cancellation is passed through the model and runtime. Abort errors
are preserved for the message processor to mark cancellation; other provider
failures become the safe `agent_processing_failed` error.

Each user message runs the session agent once. Failed work is terminal. Summary
compaction rewrites the bounded session summary with objective, state, result,
blockers, and capped file context.

Subagent cancellation uses the parent message signal. Nested subagent run IDs,
tasks, tool calls, reports, timing, and safe failures are recorded in the
parent trace without creating a second user-facing transcript.
Trace sections are `identity`, `context`, `sessionAgent`, `toolCalls`,
`subagents`, `outcome`, and `errors`. The top-level, agent, subagent, and tool
sections all include ISO timestamps and millisecond durations.

## Tool events and safety

`ToolEventRelay` appends `agent_tool_call` before execution and
`agent_tool_result` after execution to the session stream. Result snippets are
UTF-8-safe and bounded to 500 bytes. Failed tools include a safe error marker;
known service errors include their public code and message, while raw provider
errors, secrets, and command environments are not persisted. The `bash` tool
returns non-zero command output with its exit code instead of converting it to a
tool failure, and plain `find` terms match filename substrings case-insensitively.

Pull request tools receive only injected session capabilities. The backend owns
repository identity, branch `agent/<sessionId>`, commit, push, and pull request
creation or update. Agents cannot supply tokens, remotes, or shell-based
provider commands.

## Configuration and verification

`AGENT_MODEL` and `OPENROUTER_API_KEY` are loaded centrally. The key remains in
the control plane and is never forwarded to the sandbox.

Agent evals live under [`tests/evals`](../../../tests/evals). Their policy
harness lives beside the cases in
[`tests/evals/cases/harness`](../../../tests/evals/cases/harness). They run
`AgentRunner` against the real configured model with an in-memory runtime that
implements only the command forms emitted by the agent tools. They intentionally
exclude the real sandbox service, GitHub service, workspace lifecycle, Prisma,
and HTTP routes. Add new behavior checks to the appropriate category module
under [`tests/evals/cases`](../../../tests/evals/cases); add new category
modules to the case index. Each category module is declarative and exports an
`AgentEvalCase[]`, currently containing its one existing case. The index owns
the catalogue and flattens those arrays in category order; it does not execute
evals. Cases are declarative by default; a case may supply a narrowly scoped
validation procedure when behavior cannot be expressed by shared expectations.
The catalogue currently contains 15 policy categories and 15 cases. The future
target is ten independently reported variants per category, for 150 model
runs, while `runAgentEval` and `assertAgentEval` remain single-case APIs.

Local trace export, when enabled, writes JSONL to `.data/traces.jsonl` by
default. Langfuse export uses the existing `LANGFUSE_*` configuration.
Open `tests/evals/results-viewer.html` locally and select
`.data/evals/agent-service.jsonl` to inspect the latest result for each eval
case without starting the application.

Policy evals and full-stack E2E evals are separate. Policy evals exercise the
agent runner with a fake runtime and cover prompt, tool-policy, and reporting
behavior. The CapyNodes E2E evaluator under
[`tests/evals/e2e`](../../../tests/evals/e2e) drives the authenticated public
chat-session API, provisions a real session sandbox from a task Git fixture,
collects session SSE events, and runs hidden deterministic oracles in an
isolated no-network container. It does not call agent or sandbox services
directly. For every command ID in a command start or terminal event, the SSE
evidence must contain exactly one `command_started` followed by exactly one
terminal event (`command_completed`, `command_failed`, `command_timed_out`, or
`command_cancelled`).

Build the dedicated image before starting the test-only Compose override:

```bash
docker build -f tests/evals/e2e/Dockerfile -t capynodes-e2e:latest .
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build
E2E_SANDBOX_IMAGE=capynodes-e2e:latest BASE_URL=http://localhost:3000 npm run eval:e2e
```

The evaluator requires a healthy API, Docker, the mounted
`.data/evals/e2e/fixtures` root, `OPENROUTER_API_KEY`, and the matching
`AUTH_COOKIE_SECRET`. It runs known-good and known-bad hidden-oracle smoke
checks before live model calls, executes the four cases sequentially, writes
`.data/evals/e2e/capynodes.jsonl`, and removes evaluator-created fixtures and
sandbox containers after each case. The committed CapyNodes snapshot is
`repo/capynodes-backend`; hidden tests are staged only in the grader checkout.

```bash
npm run eval:agent
npm test -- tests/agent-runner.test.ts tests/message-processing.test.ts tests/chat-session-service.test.ts
npm run typecheck
npm run lint
npm test
npm run build
```
