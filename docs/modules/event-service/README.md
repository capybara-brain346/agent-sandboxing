# Event Service

## Purpose

The Event Service provides the durable, ordered event log for a task and the
live Server-Sent Events (SSE) delivery layer. It is implemented as two
collaborators rather than a standalone HTTP service:

- [`EventStore`](../../../src/services/events/event-store.ts) persists and
  replays events in Postgres.
- [`SseHub`](../../../src/services/events/sse-hub.ts) fans committed events out
  to open SSE responses in the current process.

The public stream is exposed by
[`GET /tasks/:taskId/events`](../../../src/routes/task.routes.ts). There is no
separate event router or sandbox event stream. Task, sandbox, command, diff,
and future service events share the owning task's stream.

## Design invariants

The following rules define the event contract:

1. Every event belongs to a task. `streamId` is currently always the owning
   `taskId`; taskless or sandbox-only streams are not supported.
2. Sequences are positive integers, start at `1`, and are strictly increasing
   within a task stream.
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
TaskService / SandboxService / CommandExecutionService
                         |
                         v
              state + EventStore.appendInTransaction
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
`EventStore` and a publish callback through their constructors. The production
`EventStore` and `SseHub` instances are created at module load; tests replace
them with plain collaborators.

## Persistence and sequence allocation

The [`Event`](../../../prisma/schema.prisma) model stores:

| Field                    | Meaning                                              |
| ------------------------ | ---------------------------------------------------- |
| `id`                     | Public event identifier with the `evt_` prefix.      |
| `streamId`               | Ordered stream identifier; currently the task ID.    |
| `sequence`               | Per-stream replay cursor and ordering key.           |
| `type`                   | One member of `EVENT_TYPES`.                         |
| `producerService`        | Service that produced the event.                     |
| `producerId`             | ID of the producing task, sandbox, or command.       |
| `taskId`                 | Required owning task relation.                       |
| `sandboxId`, `commandId` | Optional related resource IDs.                       |
| `correlationId`          | Optional ID for tracing one operation across events. |
| `payload`                | Event-specific JSON object.                          |
| `createdAt`              | Database creation timestamp.                         |

`Task.nextEventSequence` owns allocation. Inside the caller's transaction,
`EventStore`:

1. locks the task row with `SELECT ... FOR UPDATE`;
2. reads `next_event_sequence`;
3. creates the event with that sequence; and
4. increments `next_event_sequence`.

The database also enforces `@@unique([streamId, sequence])`. Concurrent
producers therefore serialize on the task row and cannot allocate duplicate
positions in one stream.

Use `appendInTransaction` or `appendTaskEventInTransaction` when an event is
part of another state change. Use `append` or `appendTaskEvent` for a
standalone event; `append` creates its own transaction. Neither method
publishes automatically. The producer publishes the returned event only after
the transaction has resolved successfully.

## Public event shape

`PublicEvent` is defined in
[`src/types/event.types.ts`](../../../src/types/event.types.ts):

```json
{
  "id": "evt_<id>",
  "streamId": "task_<id>",
  "taskId": "task_<id>",
  "sandboxId": "sbox_<id>",
  "commandId": null,
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

Agent tool events use the same task-stream envelope. `agent_tool_call` payloads
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

The task events route accepts a non-negative integer cursor:

```http
GET /tasks/task_<id>/events?after=12
```

If `after` is omitted, the route uses the `Last-Event-ID` header; an explicit
`after` query parameter takes precedence. The cursor is a sequence number, not
the `evt_...` event identifier. Invalid cursors return the normal structured
`invalid_cursor` error.

Each event is encoded as:

```text
id: 13
event: command_output
data: {"id":"evt_...","streamId":"task_...", ...}

```

The SSE `id` is the numeric sequence, `event` is the event type, and `data` is
the JSON `PublicEvent`. Keepalive comments are sent every 15 seconds.

The route subscribes to `SseHub` before querying the durable log. While the
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
abstraction for a producer. The current task stream and `EventStore` are the
shared append point.

## Verification

Event-specific tests are:

- [`tests/event-store.test.ts`](../../../tests/event-store.test.ts) — sequence
  allocation, task-stream replay, and rollback behavior;
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
