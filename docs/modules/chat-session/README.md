# Chat Session Service

## Purpose

The Chat Session Service is the session-first public boundary for repo-scoped
chat workspaces. It owns session metadata, durable user-facing messages, the
transitional `Task` rows used as task runs, and session/run event publication.
It is implemented in
[`src/services/chat/chat-session.ts`](../../../src/services/chat/chat-session.ts)
and exposed by
[`src/routes/chat-session.routes.ts`](../../../src/routes/chat-session.routes.ts).

Phase 3 provides the REST and SSE contract. It creates sessions without a
sandbox, persists a user message and a `created` run in one transaction when
execution is requested, and enforces one active run per session.

Phase 4 adds run-owned execution against a session-owned sandbox. It is
implemented in
[`src/services/task/run-service.ts`](../../../src/services/task/run-service.ts)
and the session-scoped additions to
[`src/services/sandbox/sandbox.ts`](../../../src/services/sandbox/sandbox.ts).
`ChatSessionService.appendMessage` starts `RunService.createRunForMessage`
once the message/run/lock transaction commits. `RunService` then:

- provisions the session's sandbox on the first run
  (`SandboxService.createForSessionInTransaction` + `ensureReadyForSession`)
  and reuses it unchanged on later runs;
- runs the worker (`AgentRunner`/`TaskRunner`) against that sandbox with
  `sessionId`, `runId`, and `messageId` in its context, so agent tool events
  land on the run's event stream instead of the legacy task stream;
- captures a diff (`diffForSession`), writes the assistant chat message, marks
  the run terminal, and releases the session lock;
- never stops the sandbox on completion, so the next message in the session
  reuses it.

Cancellation aborts the tracked in-flight execution's `AbortSignal` through
`RunService.requestCancellation` and falls back to a direct terminal-state
transition (`RunService.cancelDirectly`) for a run with no tracked execution
(for example, after a process restart). Either path performs a best-effort
diff capture, marks the run `cancelled`, and releases the session lock without
stopping the sandbox.

The Phase 3 schema additions are in
[`20260818020000_repo_scoped_chat_session_phase3_api`](../../../prisma/migrations/20260818020000_repo_scoped_chat_session_phase3_api/migration.sql).
Phase 4 reuses that schema; the session-owned `Sandbox` row and the `Task`
row's transitional `sessionId`/`runId` event scoping were already in place.

## Public API

The primary routes are:

```text
POST   /chat-sessions
GET    /chat-sessions
GET    /chat-sessions/:sessionId
PATCH  /chat-sessions/:sessionId
GET    /chat-sessions/:sessionId/messages
POST   /chat-sessions/:sessionId/messages
GET    /chat-sessions/:sessionId/runs
GET    /chat-sessions/:sessionId/runs/:runId
GET    /chat-sessions/:sessionId/runs/:runId/result
DELETE /chat-sessions/:sessionId/runs/:runId
GET    /chat-sessions/:sessionId/events
GET    /chat-sessions/:sessionId/runs/:runId/events
GET    /chat-sessions/:sessionId/artifacts/:artifactId
```

Session creation accepts a strict `repo` object with a `fixture` or `github`
source. Fixture sessions require the existing local repository reference.
GitHub-shaped fields are stored in the request contract for future integration,
but GitHub execution currently returns `501 repo_source_not_supported`.

Session creation does not accept an initial message. Send a message separately;
`startRun` defaults to `true`. A message-only request returns `201`, while a
message that creates a run returns `202` with both resources.

Messages are the chat history API. Command output, tool traces, Docker output,
and other operational data remain run events or artifacts and are not copied
into message content.

## Run lock and ownership

The session `activeRunId` is claimed transactionally before a run row is
returned. A second mutating message returns `409 session_run_in_progress` with
the active run identifier and event URL. Nested run routes filter by both
session and run identifier, so a run from another session returns
`404 run_not_found`.

Cancellation marks the transitional run `cancelled`, clears the session lock,
and writes session and run cancellation/result events after the transaction
commits.

## Event streams

The session SSE route replays the ordered `session` stream. The nested run SSE
route replays the ordered `run` stream. Both use numeric `after` cursors or the
`Last-Event-ID` header and share the Event Service subscribe-before-replay
delivery contract.

Lifecycle state changes and their events are persisted in one transaction. The
`SseHub` receives events only after commit.

## Phase 5: orchestrator-worker harness

`RunService` no longer hands the raw user message straight to the agent tool
loop. It hands the `RunOrchestrator`
([`src/services/chat/run-orchestrator.ts`](../../../src/services/chat/run-orchestrator.ts)),
which implements the same `TaskRunner` interface so it drops into `RunService`
unchanged:

- `SessionContextBuilder` loads a bounded, explicitly-selected context: repo
  identity, the durable session summary, the last `RECENT_MESSAGE_LIMIT` chat
  messages, and a compact workspace snapshot (last run status + changed-file
  hints parsed from its diff). It never reads raw event/command history.
- `classifyMessage` is a small heuristic that reads a message as a
  `clarification` only when it is a plain question with no action verb;
  everything else defaults to `code`.
- On a clarification turn, the orchestrator answers directly
  (`OrchestratorResponder`: `ModelResponder` in production, `StaticResponder`
  in tests) and never invokes the worker — the orchestrator never edits code.
  `ModelResponder`'s system prompt is loaded from
  [`prompts/orchestrator.yaml`](../../../prompts/orchestrator.yaml) via
  [`getPromptText`](../../../src/prompts/load-prompt.ts), the same versioned
  YAML loading path used for the CodeWorker's system prompt — see
  [Agent Service](../agent-service/README.md#system-prompt-loading).
- On a code turn, `buildWorkerBrief` composes a focused brief (session
  summary + workspace hint + the instruction, not the chat transcript) and
  hands it to `CodeWorkerRunner`, which wraps the existing agent tool loop
  (`taskServiceRunner`) and parses its free text into a schema-validated
  `WorkerResult` (`status`, `summary`, `changedFiles`, `testsRun`, `blockers`,
  `suggestedNextStep`). A worker that skips the JSON fence still produces a
  usable `completed` result from its free text; only an explicit
  `blocked`/`failed` status changes the run outcome.
- If the worker reports `blocked`, the orchestrator retries once with a
  narrow correction brief built from the worker's blockers/suggested next
  step (`DEFAULT_MAX_WORKER_ATTEMPTS`, currently 2). If it still isn't
  `completed` after the attempt budget, `blocked` becomes an actionable
  assistant message and `failed` becomes a thrown `ServiceError` so
  `RunService` marks the run failed instead of silently completing it.
- After every turn the orchestrator rewrites (not appends to) the session's
  bounded `ChatSession.summary` via `SessionSummaryService`: `Objective` is
  set once and carried forward, `State`/`LastResult`/`Blockers` reflect only
  the current turn, and `Files` is a capped union across turns. The rewrite
  is trimmed under a 4 KB budget by dropping the oldest files first.

## Phase 6: artifact handling

Operational output is stored outside the chat/prompt path in `Artifact` rows
via `ArtifactStore`
([`src/services/artifacts/artifact-store.ts`](../../../src/services/artifacts/artifact-store.ts)).
`ArtifactStore.create` caps content at `ARTIFACT_MAX_BYTES` (64 KB), scrubs
common secret shapes (API keys, bearer tokens, AWS access keys, PEM private
keys) before writing, and returns a bounded pointer + preview
(`ARTIFACT_PREVIEW_MAX_BYTES`, 500 bytes) — never the full body. Full content
is only readable through `ArtifactStore.get`/`GET
/chat-sessions/:sessionId/artifacts/:artifactId`, scoped to the owning
session.

Callers:

- `RunService.completeRun`/`failRun` record a `diff` artifact (when the diff
  is non-empty) and a `worker_report` artifact (the orchestrator's raw,
  unparsed `WorkerResult` JSON, carried through `TaskRunResult.workerReport`
  — including on a `worker_failed` `ServiceError`, via `error.details`) and
  emit an `artifact_created` event on both the run and session streams for
  each one.
- `ToolEventRelay` stores the full tool result as a `tool_output` artifact
  only when the session-scoped 500-byte event snippet would otherwise
  truncate it, and attaches the artifact id/byte size to the
  `agent_tool_result` event payload.
- `ChatSessionService.result()` already includes `Task.artifacts` pointers
  regardless of event wiring, so a `worker_report` artifact is visible on the
  run result even when the run ends in `worker_failed`.

`SessionContextBuilder` never reads the `Artifact` table, so artifacts cannot
enter the orchestrator's prompt context by default.

## Phase 8: compatibility removal

The old `/tasks` routes and the standalone `TaskService` were removed once
this module's session -> message -> run -> result path, session/run SSE, and
the migrated frontend reached equivalent acceptance coverage (see the
[master plan](../../planning/repo-scoped-chat-session-agent-harness-plan.md)
and the [Phase 0 decision record](../../planning/repo-scoped-chat-session-agent-harness-phase-0-decision-record.md)).
`/tasks/*` and the retired `/sandboxes/*` routes now return
`404 not_found`. There is one product path — session, message, and run
terminology only. The historical `/tasks` contract is documented for
reference in [`docs/modules/task-service/README.md`](../task-service/README.md#history).

`src/services/task/task.ts` still exists as shared execution runtime
(`canTransition`, `taskServiceRunner`, `taskServiceArtifacts`) consumed only
by this module — see
[`docs/modules/task-service/README.md`](../task-service/README.md) for what
remains and why.

## Verification

Run the focused API tests and repository checks from the project root:

```bash
npm test -- tests/chat-routes.test.ts tests/chat-session-service.test.ts tests/run-service.test.ts tests/sandbox-service.test.ts
npm test -- tests/run-orchestrator.test.ts tests/session-context-builder.test.ts tests/session-summary.test.ts tests/code-worker-runner.test.ts tests/message-classifier.test.ts tests/harness-integration.test.ts
npm test -- tests/artifact-store.test.ts tests/agent-tool-relay.test.ts
npm run typecheck
npm run lint
npm test
npm run build
```
