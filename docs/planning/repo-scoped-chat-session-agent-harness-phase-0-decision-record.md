# Repo-Scoped Chat Session Agent Harness: Phase 0 Decisions

Status: accepted for Phase 1 implementation

Date: 2026-08-18

This record resolves the Phase 0 decisions in the [master plan](repo-scoped-chat-session-agent-harness-plan.md). It is the naming and boundary contract for the session migration. It does not implement the data model, routes, event migration, or harness.

## Decisions

### Product and domain names

The new product is session-first:

| Term          | Meaning                                                              | Ownership                                                                        |
| ------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ChatSession` | Durable repo-scoped conversation and workspace owner                 | Repo metadata, messages, summary, sandbox, session event stream, active-run lock |
| `ChatMessage` | User-facing conversation message                                     | Session; optionally the run that produced it                                     |
| `TaskRun`     | One execution turn started by a message                              | Session; lifecycle, result, diff snapshot, failure, checks, and run event stream |
| `Sandbox`     | Reusable workspace for one session                                   | Session; reused by later runs                                                    |
| `Artifact`    | On-demand operational output such as logs, diffs, and worker reports | Session and optionally a run                                                     |

`TaskRun` is the internal execution name. The existing Prisma `Task` model and `/tasks` routes are legacy compatibility details only; they must not become the name or ownership model of `ChatSession`.

### Public route prefix

New public routes use `/chat-sessions`:

- `/chat-sessions`
- `/chat-sessions/:sessionId/messages`
- `/chat-sessions/:sessionId/runs/:runId`
- `/chat-sessions/:sessionId/events`
- `/chat-sessions/:sessionId/runs/:runId/events`

There is no parallel `/sessions` product prefix. Run-specific routes stay nested under the owning session so cross-session access can be rejected at the route/service boundary.

### Session and sandbox lifecycle

Creating a session creates repo metadata and the durable conversation owner. It does not create or start a sandbox. The first message that starts a run provisions the session sandbox as part of that run. Later runs reuse the same session sandbox and do not stop it when they finish.

The MVP does not accept an `initialMessage` on session creation. Session creation and message submission are separate operations: `POST /chat-sessions` creates the session, and `POST /chat-sessions/:sessionId/messages` persists the user message and starts its run by default.

GitHub-shaped repository fields may be stored for the future integration, but only the currently supported local/fixture source can provision a workspace. Unsupported sources return the documented `repo_source_not_supported` error rather than creating a misleading runnable session.

### Concurrency

Only one active mutating run is allowed per session. A second run request is rejected with HTTP `409` and error code `session_run_in_progress`; it is not queued or merged into the existing run.

The session owns the lock through `activeRunId`, `lockedAt`, and a version or equivalent compare-and-set guard. The lock is claimed before provisioning, released for every terminal outcome including cancellation, and never inferred from in-memory process state alone.

### Compatibility

`/tasks` remains only as a short-lived compatibility adapter while the session API and frontend migrate. It is not a second product surface and receives no new behavior. The adapter resolves legacy task identifiers to the transitional run representation where possible and preserves the current response/error contract until its removal point.

The removal gate is Phase 8: the session -> message -> run -> result path, session/run SSE, and migrated frontend must have equivalent acceptance coverage before `/tasks` routes and task-first frontend terminology are removed.

### Event streams

There are two first-class ordered streams:

| Stream  | Owner         | Contains                                                                                      |
| ------- | ------------- | --------------------------------------------------------------------------------------------- |
| Session | `ChatSession` | Session/message events and compact run milestones for chat and workspace views                |
| Run     | `TaskRun`     | Sandbox, command, agent-tool, artifact, diff, verification, and detailed run lifecycle events |

Each event carries its session and run context where applicable, plus optional message and artifact identifiers. Sequence numbers are monotonic within one stream; there is no fabricated global order between a session stream and a run stream.

Session SSE is the default chat stream. Run SSE is the detailed harness stream. Raw command output, Docker output, and tool traces stay in the run/artifact plane and are never copied into session messages or included in model context by default.

State changes and their lifecycle events are written in one transaction. Events are published to `SseHub` only after that transaction commits. Legacy task events may be adapted during migration, but new event writes use session/run ownership.

### Artifact storage

The MVP uses DB-backed `Artifact` rows with bounded text content and metadata. This matches the current DB-centric task result and command-output persistence and avoids making a sandbox filesystem part of durable application storage.

Artifact events carry an artifact identifier, bounded preview, content type, byte size, truncation status, and redaction status. Session messages contain only human-facing summaries and references, never raw logs or full tool output. Artifact content is selected explicitly by the context builder or fetched by an artifact API.

The first implementation must apply existing output limits and explicit artifact size limits before writing text to Postgres. If artifacts exceed those limits or retention/throughput requires it, a later phase can move content behind an object/blob store without changing message or event contracts. Files in the disposable sandbox are not the MVP artifact store.

## Boundary consequences

- `ChatSessionService` owns session metadata, messages, summary, the session lock, and session-scoped events.
- `RunService`/`TaskRun` owns one run lifecycle and coordinates the session-owned sandbox.
- The orchestrator may classify, plan, select context, invoke workers, review results, and write assistant messages; it never edits code.
- `CodeWorker` receives a focused brief and selected workspace facts, not the full session transcript or raw event history.
- Existing `TaskService` behavior is a migration source and compatibility seam, not the target ownership model.
- Phase 1 may keep the Prisma table name `Task` temporarily to minimize migration risk, but new service, API, event, and test vocabulary must use `TaskRun`/run terms. A later rename is not required for Phase 1 correctness.

## Explicit non-goals

Phase 0 does not implement:

- Prisma models or migrations.
- `/chat-sessions` routes or request schemas.
- Session/run SSE changes.
- The orchestrator, CodeWorker, or summary/context builder.
- GitHub authentication, cloning, pushing, or pull requests.
- Queues, retries, multi-run concurrency, or a second sandbox runtime.
- Filesystem or object-storage artifact infrastructure.

## Phase 1 implementation gate

Phase 1 is ready to start when its design and tests preserve these terms and invariants:

1. A session can exist without a provisioned sandbox.
2. The first run creates the session sandbox; later runs reuse it.
3. A session has at most one active mutating run, enforced transactionally.
4. Messages are separate from operational events and artifacts.
5. Session and run event sequences are independently ordered and replayable.
6. Legacy task support is isolated as an adapter with a documented removal gate.
7. Artifact content is bounded and never enters default chat/model context.
