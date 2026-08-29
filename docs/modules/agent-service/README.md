# Agent Service

## Purpose

The Agent Service owns model-backed message processing. It resolves the
configured OpenRouter model, runs the worker loop, owns orchestration and
summary-compaction decisions, proxies tools through the session sandbox, and
relays tool lifecycle events. It exposes no HTTP route and does not call the
persisted command API.

Implementation:

- [`AgentRunner`](../../../src/services/agent/agent-runner.ts) runs the model
  loop and tool registry.
- [`code-worker.ts`](../../../src/services/agent/code-worker.ts) defines the
  worker seam.
- [`orchestrator-agent.ts`](../../../src/services/agent/orchestrator-agent.ts)
  handles direct replies and bounded delegation.
- [`session-summary-compactor.ts`](../../../src/services/agent/session-summary-compactor.ts)
  maintains bounded session context.
- [`tool-event-relay.ts`](../../../src/services/agent/tool-event-relay.ts)
  persists safe tool call and result events.

## Session invariant

A chat session owns one sandbox and one working branch. Each user message may
trigger processing in that same workspace. There is no run resource.

## Runtime boundary

The message processor passes `sessionId`, `messageId`, sandbox ID, a bounded
instruction brief, and an `AbortSignal`. The runner receives only the
session-owned `simpleExec` runtime seam and the configured limits. Workspace
tools are `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`; GitHub
sessions also receive brokered pull request tools.

The worker report is prose. Changed files, pull request state, artifacts, and
terminal processing state are derived from persisted backend records rather than
worker claims.

## Processing behavior

The model receives the versioned code-worker prompt and a single user brief.
Tool execution is serialized because tools share one workspace. Cancellation is
passed through the model and runtime. Abort errors are preserved for the
message processor to mark cancellation; other provider failures become the
safe `agent_processing_failed` error.

The orchestrator can answer directly or delegate through the typed worker seam.
Blocked work may receive one narrowed retry. Failed work is terminal. Summary
compaction rewrites the bounded session summary with objective, state, result,
blockers, and capped file context.

## Tool events and safety

`ToolEventRelay` appends `agent_tool_call` before execution and
`agent_tool_result` after execution to the session stream. Result snippets are
UTF-8-safe and bounded to 500 bytes; raw provider errors, arguments, secrets,
and command environments are not persisted.

Pull request tools receive only injected session capabilities. The backend owns
repository identity, branch `agent/<sessionId>`, commit, push, and pull request
creation. Agents cannot supply tokens, remotes, or shell-based provider
commands.

## Configuration and verification

`AGENT_MODEL` and `OPENROUTER_API_KEY` are loaded centrally. The key remains in
the control plane and is never forwarded to the sandbox.

```bash
npm run typecheck
npm test -- tests/agent-runner.test.ts tests/agent-tool-relay.test.ts tests/orchestrator-agent.test.ts tests/session-summary.test.ts tests/agent-tools.test.ts
```
