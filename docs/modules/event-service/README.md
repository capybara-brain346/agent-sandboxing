# Event Service

## Purpose

The Event Service provides durable, ordered event logs for chat sessions and
task runs, plus the live Server-Sent Events (SSE) delivery layer. It is
implemented as two
collaborators rather than a standalone HTTP service:

- [`EventStore`](../../../src/services/events/event-store.ts) persists and
  replays events in Postgres.
- [`SseHub`](../../../src/services/events/sse-hub.ts) fans committed events out
  to open SSE responses in the current process.

The existing public compatibility stream is exposed by
[`GET /tasks/:taskId/events`](../../../src/routes/task.routes.ts). New callers
use [`GET /chat-sessions/:sessionId/events`](../../../src/routes/chat-session.routes.ts)
for chat milestones and the nested run event route for detailed execution
telemetry. The task route remains a deprecated compatibility adapter.

## Design invariants

The following rules define the event contract:

1. Canonical streams use `streamScope` plus `streamId`: `session` streams are
   keyed by `ChatSession.id`, and `run` streams are keyed by the transitional
   `Task.id` used as the TaskRun identifier. Legacy `task` streams remain
   readable during migration.
2. Sequences are positive integers, start at `1`, and are strictly increasing
   within one scoped stream. Session and run streams have independent cursors.
3. A state mutation and its lifecycle event are committed in the same database
   transaction.
4. Events are published to `SseHub` only after that transaction commits.
5. The Postgres `Event` row is canonical. SSE is transient delivery and may be
   disconnected, replayed, or resumed from a cursor.
6. Events are append-only. Consumers must use `type`, `producerService`, and
   `payload` to interpret an event; they must not infer state from delivery
   timing.

## Architecture

```text
Session/Run services / TaskService / SandboxService / CommandExecutionService
                         / AgentRunner
                         |
                         v
              state + scoped EventStore append in transaction
                         |
                         v
                    Postgres commit
                         |
                         v
                    publish(event)
                         |
                         v
                      SseHub
                         |
                         v
                   open SSE clients

Reconnect: client cursor -> EventStore replay -> SseHub buffered live events
```

`EventStore` has no Express or SSE dependency. Producers receive an
`EventStore` and a publish callback through their constructors. The
`ToolEventRelay` used by AgentRunner follows the same standalone append-then-
publish contract for tool lifecycle events. The production `EventStore` and
`SseHub` instances are created at module load; tests replace them with plain
collaborators.

## Persistence and sequence allocation

The [`Event`](../../../prisma/schema.prisma) model stores:

| Field                     | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `id`                      | Public event identifier with the `evt_` prefix.               |
| `streamId`                | Ordered stream identifier within the stream scope.            |
| `streamScope`             | `session`, `run`, or legacy `task`.                           |
| `domain`                  | Event domain such as `session`, `run`, `command`, or `agent`. |
| `sequence`                | Per-stream replay cursor and ordering key.                    |
| `type`                    | One member of `EVENT_TYPES`.                                  |
| `producerService`         | Service that produced the event.                              |
| `producerId`              | ID of the producing task, sandbox, or command.                |
| `taskId`                  | Nullable legacy task relation.                                |
| `sessionId`, `runId`      | Session owner and optional transitional run relationship.     |
| `messageId`, `artifactId` | Optional conversation and artifact relationships.             |
| `sandboxId`, `commandId`  | Optional related resource IDs.                                |
| `correlationId`           | Optional ID for tracing one operation across events.          |
| `payload`                 | Event-specific JSON object.                                   |
| `createdAt`               | Database creation timestamp.                                  |

`ChatSession.nextEventSequence` owns session allocation and
`Task.nextEventSequence` owns transitional run allocation. Inside the caller's
transaction, `EventStore`:

1. locks the owning session or run row with `SELECT ... FOR UPDATE`;
2. reads `next_event_sequence`;
3. creates the event with that sequence; and
4. increments `next_event_sequence`.

The database enforces `@@unique([streamScope, streamId, sequence])`.
Concurrent producers therefore serialize on the stream owner row and cannot
allocate duplicate positions in one stream.

Use `appendSessionEventInTransaction` for session milestones and
`appendRunEventInTransaction` for detailed run events. The legacy
`appendTaskEventInTransaction` wrapper keeps existing task producers working
until they migrate.

The Phase 1 event migration also adds indexed message and artifact pointers.
Large operational output belongs in artifacts and must not be copied into
session messages or default model context.

Use the corresponding `append*InTransaction` method when an event is part of
another state change. The standalone `append*` methods create their own
transaction. No EventStore method publishes automatically; producers publish
returned events only after the transaction resolves successfully.

## Public event shape

`PublicEvent` is defined in
[`src/types/event.types.ts`](../../../src/types/event.types.ts):

```json
{
  "id": "evt_<id>",
  "streamScope": "run",
  "streamId": "run_<id>",
  "domain": "run",
  "sessionId": "chat_<id>",
  "runId": "run_<id>",
  "taskId": "task_<id>",
  "sandboxId": "sbox_<id>",
  "commandId": null,
  "messageId": null,
  "artifactId": null,
  "sequence": 4,
  "type": "task_running",
  "producerService": "task",
  "producerId": "task_<id>",
  "correlationId": "<id>",
  "payload": {},
  "createdAt": "2026-08-16T00:00:00.100Z"
}
```

The top-level fields are stable correlation and ordering metadata. Payload
keys use the existing snake_case convention and are specific to the event
type. Examples include:

- command output: `stream`, `chunk`, `chunk_index`, and `truncated`;
- command completion: `exit_code`, `timeout_ms`, `output_bytes`, and
  `output_truncated`; and
- failure events: `code`, `message`, `operation`, and `retryable`.

Agent tool events use the run-stream envelope. `agent_tool_call` payloads
contain only `tool_name` and an argument object. `agent_tool_result` payloads
contain `tool_name`, a UTF-8-safe `result_snippet` capped at 500 characters,
`truncated`, `exit_code`, and non-negative integer `duration_ms`. The call/result
correlation belongs in the envelope's `correlationId`; it is not duplicated in
either payload. These payload schemas are defined in
[`src/types/agent.types.ts`](../../../src/types/agent.types.ts).

Runtime failures are converted to safe payloads before they cross the service
boundary. Do not put secrets, command environment values, or raw provider
errors into an event payload.

## Event taxonomy

The [`EVENT_TYPES`](../../../src/types/event.types.ts) constant is the source
of truth for allowed event names.

| Area                     | Event types                                                                                                                         | Producer services    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Session and messages     | `session_created`, `message_created`, `run_requested`                                                                               | `task`               |
| Run lifecycle            | `run_created`, `run_completed`, `run_failed`, `run_cancelled`, `run_result_ready`                                                   | `task`               |
| Task lifecycle           | `task_created`, `task_provisioning_started`, `task_running`, `task_completed`, `task_failed`, `task_cancelled`, `task_result_ready` | `task`               |
| Sandbox lifecycle        | `sandbox_created`, `sandbox_provisioning_started`, `sandbox_ready`, `sandbox_failed`, `sandbox_stopping`, `sandbox_stopped`         | `sandbox`, `cleanup` |
| Fixture setup            | `fixture_repo_copy_started`, `fixture_repo_copied`                                                                                  | `sandbox`            |
| Commands                 | `command_started`, `command_output`, `command_completed`, `command_failed`, `command_timed_out`, `command_cancelled`                | `command`, `runtime` |
| Diff capture             | `git_diff_requested`, `git_diff_completed`                                                                                          | `sandbox`, `runtime` |
| Agent tools              | `agent_tool_call`, `agent_tool_result`                                                                                              | `agent`              |
| Cleanup extension points | `cleanup_started`, `cleanup_completed`                                                                                              | `cleanup`            |

`command_cancelled`, `cleanup_started`, and `cleanup_completed` are currently
declared event types without an active producer call site. Add a producer
before treating them as emitted behavior.

## SSE delivery and replay

Each single-stream SSE route accepts a non-negative integer cursor. The legacy
task route is:

```http
GET /tasks/task_<id>/events?after=12
```

If `after` is omitted, the route uses the `Last-Event-ID` header; an explicit
`after` query parameter takes precedence. The cursor is a sequence number, not
the `evt_...` event identifier. Invalid cursors return the normal structured
`invalid_cursor` error.

Session and run streams use the same encoding:

```text
id: 13
event: command_output
data: {"id":"evt_...","streamScope":"run","streamId":"run_...", ...}

```

The SSE `id` is the numeric sequence, `event` is the event type, and `data` is
the JSON `PublicEvent`. Keepalive comments are sent every 15 seconds.

Each subscriber is keyed by `streamScope:streamId`. The route subscribes to
`SseHub` before querying the durable log. While the
replay query is running, `SseHub` buffers newly published events. After replay,
the hub sorts the buffer, drops sequences already covered by the replay, and
starts live delivery. This subscribe-first ordering closes the race between
replay and live publication.

`SseHub` is process-local memory. It is deliberately not a queue or a source
of truth: a process restart drops open connections and buffered events, while
clients reconnect using their last sequence and the database replay. A future
multi-instance deployment will need shared live fanout, but must retain the
same durable replay contract.

## Adding a new event

When adding a lifecycle step or producer:

1. Add the event name to `EVENT_TYPES` and choose an existing
   `producerService`.
2. Define the top-level related IDs and a small, documented payload.
3. Append it in the same transaction as the state mutation when one exists.
4. Publish only after the transaction commits; never publish from inside the
   transaction callback.
5. Add EventStore/SseHub or producer tests for ordering, replay, and the public
   payload shape.
6. Update the owning module documentation and this taxonomy.

Do not add a second event table, a sandbox-only stream, or a new runtime
abstraction for a producer. Session and run streams share the same EventStore
and durable Event table. Large operational output belongs in artifacts; event
payloads should contain bounded previews and artifact identifiers.

## Verification

Event-specific tests are:

- [`tests/event-store.test.ts`](../../../tests/event-store.test.ts) — sequence
  allocation, scoped streams, task-stream replay, and rollback behavior;
- [`tests/sse-hub.test.ts`](../../../tests/sse-hub.test.ts) — fanout, replay
  buffering, ordering, and duplicate suppression; and
- [`tests/task-routes.test.ts`](../../../tests/task-routes.test.ts) — HTTP SSE
  headers and replay integration.

Run the normal repository checks from the root:

```bash
npm run typecheck
npm run lint
npm test
```
