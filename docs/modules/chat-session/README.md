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

- provisions the session's sandbox on the first run (`SandboxService.createForSessionInTransaction`
  - `ensureReadyForSession`) and reuses it unchanged on later runs;
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

## Compatibility

The old `/tasks` routes remain as a temporary compatibility surface. They emit
deprecation headers and retain their existing task response contract. New API
and frontend work must use session, message, and run terminology.

## Verification

Run the focused API tests and repository checks from the project root:

```bash
npm test -- tests/chat-routes.test.ts tests/chat-session-service.test.ts tests/run-service.test.ts tests/sandbox-service.test.ts
npm run typecheck
npm run lint
npm test
npm run build
```
